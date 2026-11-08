import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, readlink, realpath, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { parse as parseToml } from 'smol-toml';
import { isManagedName, isRecord, ManagerError } from './host-bundle.js';
import { readSyncState, regularFile, requestSync, sharedSkills, syncDirectory, syncSocket, syncStateFile } from './shared-sync.js';

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

async function dropLink(root, entry, skillPath) {
  if (!entry.linkOwned || !isManagedName(entry.name)) return;
  const link = join(root, entry.name);
  const existing = await lstat(link).catch(missing);
  if (!existing?.isSymbolicLink()) return;
  if (resolve(root, await readlink(link)) === dirname(skillPath)) await unlink(link).catch(missing);
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

export async function createCoordinator({ home, agentsHome, claudeHome, codexHome, codexBinary, writeSkill = writeCodex }) {
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
    const skills = await sharedSkills(agentsHome);
    const codexPath = join(codexHome, 'config.toml');
    const claudePath = join(claudeHome, 'settings.json');
    const native = await codexRules(await readDocument(codexPath, parseToml));
    const initialClaude = overrides(await readDocument(claudePath));
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
      const conflict = !linkOk || projectCollision || (codex.byName && !codex.enabled) ||
        (!explicit && (intents.size > 1 || (old?.contested && intents.size === 0)));
      const enabled = explicit ? action.enabled
        : old?.pending ? old.enabled
        : intents.size === 1 && !conflict ? [...intents][0]
        : old?.enabled ?? (codex.enabled && claude !== 'off');
      const entry = {
        name, enabled: conflict ? old?.enabled ?? enabled : enabled,
        codex: codex.enabled, claude, linkOwned: Boolean(old?.linkOwned || linkOk),
        ...(!explicit && (intents.size > 1 || old?.contested && intents.size === 0) && { contested: true }),
        ...(conflict && { error: 'conflict' }),
      };
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
    const state = { version: 1, entries, projects: enrollment };
    // Persist the desired state before fan-out so a crash can retry without treating echoes as input.
    await writeDocument(stateDocument, state);

    for (const [path, entry] of Object.entries(entries)) {
      if (entry.error) continue;
      const { name, enabled } = entry;
      try {
        const skill = skills.get(path);
        if (entry.pending) {
          const current = readCodex(await codexRules(await readDocument(codexPath, parseToml)), skill);
          if (current.enabled !== enabled) {
            if (current.byName || current.enabled !== entry.codex) throw new ManagerError('conflict');
            await writeSkill(codexBinary, codexHome, current.path, enabled);
            const confirmed = readCodex(await codexRules(await readDocument(codexPath, parseToml)), skill);
            if (confirmed.enabled !== enabled) throw new ManagerError('conflict');
          }
          const settings = await readDocument(claudePath);
          const currentClaude = overrides(settings)[name] ?? null;
          if ((currentClaude !== 'off') !== enabled) {
            if (currentClaude !== entry.claude) throw new ManagerError('conflict');
            await updateClaude(settings, name, enabled ? undefined : 'off');
          }
          entry.codex = enabled;
          entry.claude = overrides(await readDocument(claudePath))[name] ?? null;
          delete entry.pending;
        }
        for (const intent of cleanup.get(path) ?? []) {
          const current = await localDocument(intent.directory);
          if (overrides(current)[name] !== intent.value) continue;
          await updateClaude(current, name, undefined);
          delete enrollment[intent.directory][name];
        }
      } catch (error) {
        entry.error = error.code === 'conflict' ? 'conflict' : 'unavailable';
      }
    }
    for (const [path, old] of Object.entries(previous.entries)) {
      if (!skills.has(path)) await dropLink(claudeRoot, old, path);
    }
    await writeDocument(await readDocument(statePath), state);
    const result = action.type === 'set' ? entries[action.path] : undefined;
    if (result?.error) throw new ManagerError(result.error);
    return result?.enabled;
  }

  return action => serial(() => tick(action));
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
      Promise.resolve().then(() => {
        const request = JSON.parse(buffer);
        if (request.type === 'ping') return true;
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const options = {
    home: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    agentsHome: process.env.DSH_AGENTS_HOME ?? join(homedir(), '.agents'),
    claudeHome: process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'),
    codexHome: process.env.CODEX_HOME ?? join(homedir(), '.codex'),
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
