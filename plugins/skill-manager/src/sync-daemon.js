import { realpathSync } from 'node:fs';
import { chmod, lstat, mkdir, readlink, realpath, rename, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isManagedName, ManagerError } from './host-bundle.js';
import { ensureSharedPolicy } from './shared-policy.js';
import { readSyncState, regularFile, requestSync, resolveSyncHomes, sharedSkills, syncDirectory, syncSocket, syncStateFile } from './shared-sync.js';

const missing = error => { if (error.code !== 'ENOENT') throw error; return null; };
async function readDocument(path) {
  const bytes = await regularFile(path, 2 * 1024 * 1024).catch(missing);
  return { path, bytes, value: bytes ? JSON.parse(bytes) : {} };
}
async function writeDocument({ path, bytes }, value) {
  const temp = path + '.' + randomUUID();
  try {
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const current = await regularFile(path, 2 * 1024 * 1024).catch(missing);
    if (Boolean(current) !== Boolean(bytes) || (current && !current.equals(bytes))) throw new ManagerError('conflict');
    await rename(temp, path);
  } finally { await unlink(temp).catch(missing); }
}
const identity = info => `${info.dev}:${info.ino}:${info.birthtimeNs}`;

async function reconcileLink(root, skill, old) {
  const path = join(root, skill.name), target = dirname(skill.path);
  let info = await lstat(path, { bigint: true }).catch(missing);
  if (info) {
    if (!info.isSymbolicLink() || await realpath(path).catch(missing) !== target) throw new ManagerError('conflict');
    return old?.linkIdentity === identity(info) && old.linkOwned ? { linkOwned: true, linkIdentity: old.linkIdentity } : {};
  }
  await symlink(target, path, 'dir');
  info = await lstat(path, { bigint: true });
  return { linkOwned: true, linkIdentity: identity(info) };
}
async function dropLink(root, entry, source) {
  if (!entry.linkOwned || !entry.linkIdentity || !isManagedName(entry.name)) return;
  const path = join(root, entry.name);
  const info = await lstat(path, { bigint: true }).catch(missing);
  if (!info?.isSymbolicLink() || identity(info) !== entry.linkIdentity) return;
  if (resolve(root, await readlink(path)) !== dirname(source)) return;
  if (await lstat(dirname(source)).catch(missing)) return;
  const current = await lstat(path, { bigint: true }).catch(missing);
  if (current && identity(current) === entry.linkIdentity) await unlink(path);
}

export async function createCoordinator({ home, agentsHome, claudeHome }) {
  const statePath = syncStateFile(home), claudeRoot = join(claudeHome, 'skills');
  await mkdir(claudeRoot, { recursive: true, mode: 0o700 });
  if (!(await lstat(claudeRoot)).isDirectory()) throw new ManagerError('invalid');
  let tail = Promise.resolve();
  async function tick() {
    const document = await readDocument(statePath);
    const previous = await readSyncState(home) ?? { version: 2, entries: {} };
    // Preserve the effective Harness choice before discarding old fan-out intents.
    await ensureSharedPolicy(home);
    const root = await realpath(join(agentsHome, 'skills')).catch(missing);
    if (!root || !(await stat(root)).isDirectory()) throw new ManagerError('unavailable');
    const skills = await sharedSkills(agentsHome);
    const entries = {};
    for (const [path, old] of Object.entries(previous.entries)) {
      if (skills.has(path)) continue;
      // A different root, invalid SKILL.md or incomplete source remains recoverable.
      try {
        if (dirname(dirname(path)) !== root || await lstat(dirname(path)).catch(missing)) {
          entries[path] = { ...old, error: 'unavailable' };
        } else await dropLink(claudeRoot, old, path);
      } catch { entries[path] = { ...old, error: 'unavailable' }; }
    }
    for (const skill of skills.values()) {
      try { entries[skill.path] = { name: skill.name, ...await reconcileLink(claudeRoot, skill, previous.entries[skill.path]) }; }
      catch (error) { entries[skill.path] = { ...previous.entries[skill.path], name: skill.name,
        error: error.code === 'conflict' || error.code === 'EEXIST' ? 'conflict' : 'unavailable' }; }
    }
    const health = { ...previous.health, lastAttemptAt: new Date().toISOString(),
      status: Object.values(entries).some(entry => entry.error) ? 'degraded' : 'ok' };
    if (health.status === 'ok') health.lastSuccessAt = health.lastAttemptAt;
    await writeDocument(document, { version: 2, entries, health });
  }
  return () => {
    const next = tail.then(async () => {
      try { await tick(); }
      catch (error) {
        const document = await readDocument(statePath);
        const state = { version: 2, entries: {}, ...document.value };
        state.health = { ...state.health, status: 'unavailable', lastAttemptAt: new Date().toISOString() };
        await writeDocument(document, state);
        throw error;
      }
    });
    tail = next.catch(() => {});
    return next;
  };
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
        throw new ManagerError('invalid');
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
try { directEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href; } catch {}
if (directEntry) {
  // A still-open client may invoke a removed hook once; it must never register a project.
  if (process.argv[2] !== 'enroll') serve(resolveSyncHomes()).catch(error => {
    process.stderr.write('skill sync: ' + (error.code ?? 'unavailable') + '\n');
    process.exitCode = 1;
  });
}
