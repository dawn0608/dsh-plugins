import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { chmod, lstat, mkdir, readlink, realpath, rename, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parse as parseToml } from 'smol-toml';
import { isRecord, ManagerError } from './host-bundle.js';
import { readSyncState, regularFile, requestSync, resolveSyncHomes, sharedPolicyEnabled, sharedSkills, syncDirectory, syncSocket, syncStateFile } from './shared-sync.js';

const LIMIT = 2 * 1024 * 1024;
const missing = error => {
  if (error.code !== 'ENOENT') throw error;
  return null;
};
const exists = async path => Boolean(await lstat(path).catch(missing));

async function readDocument(path, parse = JSON.parse) {
  const bytes = await regularFile(path, LIMIT).catch(missing);
  const value = bytes ? parse(bytes.toString('utf8')) : {};
  if (!isRecord(value)) throw new ManagerError('invalid');
  return { path, bytes, value };
}

async function readNativeDocument(path, parse, required = true) {
  const document = await readDocument(path, parse);
  if (required && !document.bytes?.length) throw new ManagerError('unavailable');
  return document;
}

async function writeDocument({ path, bytes }, value) {
  const content = Buffer.from(JSON.stringify(value, null, 2) + '\n');
  if (content.equals(bytes ?? Buffer.alloc(0))) return;
  const temp = path + '.' + randomUUID();
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    const current = await regularFile(path, LIMIT).catch(missing);
    if (Boolean(current) !== Boolean(bytes) || (current && !current.equals(bytes))) throw new ManagerError('conflict');
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(missing);
  }
}

async function writeDocumentSafe(path, value) {
  await writeDocument(await readDocument(path), value);
}

function overrides(document) {
  const value = document.value.skillOverrides;
  if (value !== undefined && !isRecord(value)) throw new ManagerError('invalid');
  return value ?? {};
}

async function updateClaude(document, name, value) {
  const next = { ...overrides(document) };
  if (value === undefined) delete next[name];
  else next[name] = value;
  const settings = { ...document.value };
  if (Object.keys(next).length) settings.skillOverrides = next;
  else delete settings.skillOverrides;
  await writeDocument(document, settings);
}

async function codexRules(document) {
  const rules = document.value.skills?.config ?? [];
  if (!Array.isArray(rules)) throw new ManagerError('invalid');
  return Promise.all(rules.map(async rule => {
    if (!isRecord(rule) || typeof rule.enabled !== 'boolean') throw new ManagerError('invalid');
    if (typeof rule.path !== 'string' || !isAbsolute(rule.path)) return rule;
    return { ...rule, canonical: await realpath(rule.path).catch(missing) ?? resolve(rule.path) };
  }));
}

function readCodex(rules, skill) {
  const last = rules.findLast(rule => rule.canonical === skill.path || rule.name === skill.name);
  return { enabled: last?.enabled ?? true, byName: Boolean(last?.name), path: last?.path ?? skill.path };
}

// Use the same persisted write operation as the native Skills switch.
export async function writeCodex(binary, codexHome, path, enabled) {
  const child = spawn(binary, ['app-server'], {
    env: { ...process.env, CODEX_HOME: codexHome },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const result = new Promise((resolve, reject) => {
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    child.once('error', reject);
    child.once('exit', () => reject(new ManagerError('unavailable')));
    child.stdin.on('error', reject);
    lines.on('line', line => {
      try {
        const reply = JSON.parse(line);
        if (reply.error && (reply.id === 1 || reply.id === 2)) return reject(new ManagerError('unavailable'));
        if (reply.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'skills/config/write', params: { path, enabled } });
        } else if (reply.id === 2) resolve();
      } catch {
        reject(new ManagerError('unavailable'));
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'dsh-skill-sync', version: '1' } } });
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 6000);
  try {
    await result;
  } finally {
    clearTimeout(timer);
    lines.close();
    child.kill();
  }
}

async function reconcileLink(claudeRoot, skill) {
  const link = join(claudeRoot, skill.name);
  const target = dirname(skill.path);
  const existing = await lstat(link).catch(missing);
  if (existing) return existing.isSymbolicLink() && await realpath(link).catch(missing) === target;
  try {
    await symlink(target, link, 'dir');
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

async function localDocument(workspace) {
  const directory = join(workspace, '.claude');
  const stat = await lstat(directory).catch(missing);
  if (stat && (!stat.isDirectory() || await realpath(directory) !== directory)) throw new ManagerError('conflict');
  return readDocument(join(directory, 'settings.local.json'));
}

async function projectPaths(cwd) {
  const path = await realpath(cwd);
  const result = [path];
  for (let directory = path; dirname(directory) !== directory; directory = dirname(directory)) {
    if (await exists(join(directory, '.git'))) {
      if (directory !== path) result.push(directory);
      break;
    }
  }
  return result;
}

async function hasLocalSkill(directory, name, claudeHome) {
  const roots = await projectPaths(directory);
  for (let path = roots[0]; ; path = dirname(path)) {
    const settings = join(path, '.claude');
    if (settings !== claudeHome && (await exists(join(settings, 'skills', name)) ||
        await exists(join(settings, 'commands', name + '.md')))) return true;
    if (path === roots.at(-1)) return false;
  }
}

function localIntents(projects, name) {
  return projects.flatMap(project => {
    const value = overrides(project.document)[name];
    const prior = project.previous[name];
    return (value === 'on' || value === 'off') && value !== prior
      ? [{ ...project, value }] : [];
  });
}

export async function createCoordinator({ home, agentsHome, claudeHome, codexHome, codexBinary, writeSkill = writeCodex, writeClaude = updateClaude }) {
  const statePath = syncStateFile(home);
  const claudeRoot = join(claudeHome, 'skills');
  await mkdir(claudeRoot, { recursive: true, mode: 0o700 });
  if (!(await lstat(claudeRoot)).isDirectory()) throw new ManagerError('invalid');
  const claudeRootHome = await realpath(claudeHome);
  let tail = Promise.resolve();
  const serial = task => {
    const next = tail.then(task);
    tail = next.catch(() => {});
    return next;
  };

  async function tick(action = {}) {
    const stateDocument = await readDocument(statePath);
    const previous = stateDocument.bytes
      ? await readSyncState(home)
      : { version: 1, entries: {}, projects: {} };
    if (!previous || !isRecord(previous.projects)) throw new ManagerError('invalid');
    const sharedRoot = await stat(join(agentsHome, 'skills')).catch(missing);
    if (!sharedRoot?.isDirectory()) throw new ManagerError('unavailable');
    const skills = await sharedSkills(agentsHome);
    const codexPath = join(codexHome, 'config.toml');
    const claudePath = join(claudeHome, 'settings.json');
    const hasBaseline = Object.keys(previous.entries).length > 0;
    const knownNative = previous.nativePresent ?? { codex: hasBaseline, claude: hasBaseline };
    const codexDocument = await readNativeDocument(codexPath, parseToml, knownNative.codex);
    const claudeDocument = await readNativeDocument(claudePath, JSON.parse, knownNative.claude);
    const native = await codexRules(codexDocument);
    const initialClaude = overrides(claudeDocument);
    const nativePresent = { codex: Boolean(codexDocument.bytes?.length), claude: Boolean(claudeDocument.bytes?.length) };
    const projects = [];
    const enrollment = { ...previous.projects };
    if (action.type === 'enroll') {
      if (typeof action.cwd !== 'string' || !isAbsolute(action.cwd)) throw new ManagerError('invalid');
      for (const path of await projectPaths(action.cwd)) {
        if (Object.hasOwn(enrollment, path)) continue;
        if (Object.keys(enrollment).length >= 256) delete enrollment[Object.keys(enrollment)[0]];
        enrollment[path] = overrides(await localDocument(path));
      }
    }
    for (const [directory, baseline] of Object.entries(enrollment)) {
      try {
        const document = await localDocument(directory);
        projects.push({ directory, previous: baseline, document });
        enrollment[directory] = { ...overrides(document) };
      } catch {
        // A temporary invalid or inaccessible project file keeps its last baseline.
      }
    }
    if (action.type === 'set' && (!skills.has(action.path) || typeof action.enabled !== 'boolean')) {
      throw new ManagerError('conflict');
    }

    const entries = {};
    for (const [path, old] of Object.entries(previous.entries)) {
      // A scan can miss a skill while its source is being replaced or repaired.
      if (skills.has(path)) continue;
      entries[path] = { ...old, error: 'unavailable' };
      for (const project of projects) {
        const baseline = enrollment[project.directory];
        if (Object.hasOwn(project.previous, old.name)) baseline[old.name] = project.previous[old.name];
        else delete baseline[old.name];
      }
    }
    const cleanup = new Map();
    for (const skill of skills.values()) {
      const { name, path } = skill;
      const old = previous.entries[path];
      const codex = readCodex(native, skill);
      const claude = initialClaude[name] ?? null;
      const linkOk = await reconcileLink(claudeRoot, skill).catch(() => false);
      const rawIntents = localIntents(projects, name);
      const local = [];
      let projectCollision = false;
      for (const project of projects) {
        if (await hasLocalSkill(project.directory, name, claudeRootHome)) {
          projectCollision = true;
          break;
        }
      }
      for (const intent of rawIntents) {
        if (linkOk && !projectCollision) local.push(intent);
      }
      const explicit = action.type === 'set' && action.path === path;
      const intents = new Set(local.map(intent => intent.value === 'on'));
      if (old && !old.pending && codex.enabled !== old.codex) intents.add(codex.enabled);
      if (old && !old.pending && claude !== old.claude && (claude === 'off' || old.claude === 'off')) {
        intents.add(claude !== 'off');
      }
      const diverged = old?.pending && (
        (codex.enabled !== old.codex && codex.enabled !== old.enabled) ||
        (claude !== old.claude && (claude !== 'off') !== old.enabled) ||
        local.some(intent => (intent.value === 'on') !== old.enabled));
      const contested = !explicit && (diverged || intents.size > 1 || old?.contested);
      const conflict = !linkOk || projectCollision || (codex.byName && !codex.enabled) ||
        contested;
      const enabled = explicit ? action.enabled
        : old?.pending ? old.enabled
        : intents.size === 1 && !conflict ? [...intents][0]
        : old?.enabled ?? (codex.enabled && claude !== 'off');
      const entry = {
        name, enabled: conflict ? old?.enabled ?? enabled : enabled,
        codex: old?.pending && !explicit ? old.codex : codex.enabled,
        claude: old?.pending && !explicit ? old.claude : claude,
        ...(contested && { contested: true }),
        ...(conflict && { error: 'conflict' }),
      };
      entry.policyEnabled = entry.enabled && (sharedPolicyEnabled(old) ?? (codex.enabled && claude !== 'off'));
      if (!conflict) {
        if (codex.enabled !== enabled || (claude !== 'off') !== enabled) entry.pending = true;
        if (local.length) cleanup.set(path, local);
      }
      for (const intent of local) {
        // Keep unconsumed edits visible on the next pass if any write fails.
        enrollment[intent.directory][name] = intent.previous[name] ?? null;
      }
      entries[path] = entry;
    }
    const state = { version: 1, entries, projects: enrollment, nativePresent, health: { ...previous.health,
      status: 'syncing', lastAttemptAt: new Date().toISOString() } };
    const checkpoint = () => writeDocumentSafe(statePath, state);
    // Persist the desired state before fan-out so a crash can retry without treating echoes as input.
    await writeDocument(stateDocument, state);

    for (const [path, entry] of Object.entries(entries)) {
      if (entry.error) continue;
      const { name, enabled } = entry;
      try {
        const skill = skills.get(path);
        if (entry.pending) {
          const current = readCodex(await codexRules(await readNativeDocument(codexPath, parseToml, nativePresent.codex)), skill);
          if (current.enabled !== enabled) {
            if (current.byName || current.enabled !== entry.codex) throw new ManagerError('conflict');
            await writeSkill(codexBinary, codexHome, current.path, enabled);
            const confirmed = readCodex(await codexRules(await readNativeDocument(codexPath, parseToml)), skill);
            if (confirmed.enabled !== enabled) throw new ManagerError('conflict');
            nativePresent.codex = true;
          }
          entry.codex = enabled;
          await checkpoint();
          const settings = await readNativeDocument(claudePath, JSON.parse, nativePresent.claude);
          const currentClaude = overrides(settings)[name] ?? null;
          if ((currentClaude !== 'off') !== enabled) {
            if (currentClaude !== entry.claude) throw new ManagerError('conflict');
            await writeClaude(settings, name, enabled ? undefined : 'off');
            nativePresent.claude = true;
          }
          entry.claude = overrides(await readNativeDocument(claudePath, JSON.parse, nativePresent.claude))[name] ?? null;
          if ((entry.claude !== 'off') !== enabled) throw new ManagerError('conflict');
          await checkpoint();
          delete entry.pending;
        }
        for (const intent of cleanup.get(path) ?? []) {
          const current = await localDocument(intent.directory);
          if (overrides(current)[name] !== intent.value) continue;
          await updateClaude(current, name, undefined);
          delete enrollment[intent.directory][name];
        }
        // Release a known disable only after every destination and cleanup succeeded.
        entry.policyEnabled = enabled;
      } catch (error) {
        entry.error = error.code === 'conflict' ? 'conflict' : 'unavailable';
        if (entry.error === 'conflict') entry.contested = true;
        await checkpoint();
      }
    }
    state.health.status = Object.values(entries).some(entry => entry.error) ? 'degraded' : 'ok';
    if (state.health.status === 'ok') state.health.lastSuccessAt = new Date().toISOString();
    await checkpoint();
    const result = action.type === 'set' ? entries[action.path] : undefined;
    if (result?.error) throw new ManagerError(result.error);
    return result?.enabled;
  }

  return action => serial(async () => {
    try { return await tick(action); } catch (error) {
      const document = await readDocument(statePath);
      const state = document.bytes ? document.value : { version: 1, entries: {}, projects: {} };
      if (state.version === 1 && isRecord(state.entries)) {
        state.health = { ...state.health, status: error.code === 'conflict' ? 'degraded' : 'unavailable', lastAttemptAt: new Date().toISOString() };
        await writeDocument(document, state);
      }
      throw error;
    }
  });
}

export async function serve(options) {
  const directory = syncDirectory(options.home);
  const path = syncSocket(options.home);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dir = await lstat(directory);
  if (!dir.isDirectory() || (dir.mode & 0o077) !== 0 || dir.uid !== process.getuid()) throw new ManagerError('invalid');
  const existing = await lstat(path).catch(missing);
  if (existing) {
    if (!existing.isSocket()) throw new ManagerError('invalid');
    // launchd owns the sole instance. A closed socket may remain after a crash.
    const live = await requestSync(options.home, { type: 'ping' }).then(() => true, () => false);
    if (live) throw new ManagerError('conflict');
    await unlink(path);
  }

  const sync = await createCoordinator(options);
  const installId = process.env.DSH_SKILL_SYNC_INSTALL_ID;
  const activated = async () => !installId ||
    (await readDocument(join(directory, 'runtime', 'ready.json')).catch(() => null))?.value.installId === installId;
  const server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.setTimeout(10000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    let buffer = '';
    const receive = chunk => {
      buffer += chunk;
      if (buffer.length > 8192) return socket.destroy();
      if (!buffer.includes('\n')) return;
      socket.off('data', receive);
      Promise.resolve().then(async () => {
        const request = JSON.parse(buffer);
        if (request.type === 'ping') return { installId: installId ?? null };
        if (!await activated()) throw new ManagerError('unavailable');
        if (request.type !== 'set' && request.type !== 'enroll') throw new ManagerError('invalid');
        return sync(request);
      }).then(result => socket.end(JSON.stringify({ ok: true, result }) + '\n'),
        error => socket.end(JSON.stringify({ ok: false, error: error.code ?? 'unavailable' }) + '\n'));
    };
    socket.on('data', receive);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(path, resolve));
  await chmod(path, 0o600);
  let lastError;
  const poll = async () => {
    try {
      if (!await activated()) return;
      await sync();
      lastError = undefined;
    } catch (error) {
      const code = error.code ?? 'unavailable';
      if (lastError !== code) process.stderr.write('skill sync: ' + code + '\n');
      lastError = code;
    }
  };
  let timer;
  let stopped = false;
  const loop = async () => {
    await poll();
    if (!stopped) timer = setTimeout(loop, 1000);
  };
  void loop();
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    server.close();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  server.once('close', () => {
    stopped = true;
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    clearTimeout(timer);
  });
  return server;
}

let directEntry = false;
try {
  directEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
} catch {
  // stdin and other non-file hosts may import the daemon without a resolvable entry.
}
if (directEntry) {
  const options = {
    ...resolveSyncHomes(),
    codexBinary: process.env.DSH_SKILL_SYNC_CODEX ?? 'codex',
  };
  try {
    if (process.argv[2] === 'enroll') {
      let input = '';
      for await (const chunk of process.stdin) {
        input += chunk;
        if (input.length > 128 * 1024) throw new ManagerError('invalid');
      }
      const { cwd, new_cwd } = JSON.parse(input);
      await requestSync(options.home, { type: 'enroll', cwd: new_cwd ?? cwd });
    } else {
      await serve(options);
    }
  } catch (error) {
    process.stderr.write('skill sync: ' + (error.code ?? 'unavailable') + '\n');
    process.exitCode = 1;
  }
}
