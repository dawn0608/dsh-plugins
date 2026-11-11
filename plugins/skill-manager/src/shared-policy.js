import { randomUUID } from 'node:crypto';
import { mkdir, readlink, rename, symlink, unlink, writeFile, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isRecord, ManagerError } from './host-bundle.js';
import { readSyncState, regularFile, sharedPolicyEnabled } from './shared-sync.js';

export const policyFile = home => join(home, 'skill-manager', 'shared-policy.json');
const missing = error => { if (error.code !== 'ENOENT') throw error; return null; };

export async function readSharedPolicy(home) {
  const bytes = await regularFile(policyFile(home), 2 * 1024 * 1024).catch(missing);
  if (bytes) {
    const state = JSON.parse(bytes);
    if (state.version !== 1 || !isRecord(state.entries) || Object.values(state.entries).some(x => typeof x !== 'boolean')) {
      throw new ManagerError('unavailable');
    }
    return state;
  }
  const previous = await readSyncState(home);
  return { version: 1, entries: Object.fromEntries(Object.entries(previous?.entries ?? {})
    .map(([path, entry]) => [path, sharedPolicyEnabled(entry)]).filter(([, enabled]) => typeof enabled === 'boolean')) };
}

// Publish lock ownership atomically; never unlink a dead generation another writer may replace.
async function locked(home, operation) {
  const path = policyFile(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let generation = 0; generation < 1000; generation++) {
    const lock = path + '.lock-' + generation;
    const owner = `${process.pid}-${randomUUID()}`;
    try { await symlink(owner, lock); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const target = await readlink(lock).catch(() => null);
      const pid = Number(/^([1-9][0-9]*)-/.exec(target)?.[1]);
      if (!Number.isSafeInteger(pid) || pid > 0x7fffffff) throw new ManagerError('conflict');
      try { process.kill(pid, 0); } catch (failure) { if (failure.code === 'ESRCH') continue; }
      throw new ManagerError('conflict');
    }
    try { return await operation(path); }
    finally { if (await readlink(lock).catch(() => null) === owner) await unlink(lock); }
  }
  throw new ManagerError('conflict');
}

async function save(path, state) {
  const temp = path + '.' + randomUUID();
  try {
    await writeFile(temp, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally { await unlink(temp).catch(missing); }
}

export async function ensureSharedPolicy(home) {
  if (await lstat(policyFile(home)).catch(missing)) return readSharedPolicy(home);
  return locked(home, async path => {
    const state = await readSharedPolicy(home);
    if (!await lstat(path).catch(missing)) await save(path, state);
    return state;
  });
}

export async function setSharedEnabled(home, skillPath, enabled) {
  if (typeof enabled !== 'boolean') throw new ManagerError('invalid');
  return locked(home, async path => {
    const state = await readSharedPolicy(home);
    state.entries[skillPath] = enabled;
    await save(path, state);
  });
}
