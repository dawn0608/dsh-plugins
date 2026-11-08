import { constants, watchFile, unwatchFile } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isManagedName, isRecord, ManagerError, MAX_BUNDLE_BYTES, parseSkillFile } from './host-bundle.js';

export function resolveSyncHomes(env = process.env, userHome = homedir()) {
  const expand = (value, fallback) => {
    const path = value || join(userHome, fallback);
    if (path === '~') return userHome;
    if (path.startsWith('~/')) return resolve(userHome, path.slice(2));
    return resolve(path);
  };
  return { home: expand(env.DSH_HOME, '.dsh'), agentsHome: expand(env.DSH_AGENTS_HOME, '.agents'),
    codexHome: expand(env.CODEX_HOME, '.codex'), claudeHome: expand(env.CLAUDE_CONFIG_DIR, '.claude') };
}

export const syncDirectory = home => join(home, 'skill-manager', 'shared-sync');
export const syncSocket = home => join(syncDirectory(home), 'control.sock');
export const syncStateFile = home => join(syncDirectory(home), 'state.json');
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const disabled = { modelInvocable: false, userInvocable: false };

export async function regularFile(path, limit) {
  const before = await lstat(path);
  if (!before.isFile() || before.size > limit) throw new ManagerError('invalid');
  await using file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  const stat = await file.stat();
  if (!stat.isFile() || stat.dev !== before.dev || stat.ino !== before.ino || stat.size > limit) {
    throw new ManagerError('conflict');
  }
  const bytes = Buffer.alloc(stat.size + 1);
  const { bytesRead } = await file.read(bytes);
  if (bytesRead !== stat.size) throw new ManagerError('conflict');
  return bytes.subarray(0, bytesRead);
}

export async function sharedSkills(agentsHome) {
  const root = await realpath(join(agentsHome, 'skills')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  const skills = new Map();
  if (!root) return skills;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isManagedName(entry.name) || entry.name === 'synced' || entry.name === 'anthropic-skills') continue;
    const path = join(root, entry.name, 'SKILL.md');
    try {
      if (await realpath(path) !== path) continue;
      const parsed = parseSkillFile(await regularFile(path, MAX_BUNDLE_BYTES));
      if (parsed.name === entry.name) skills.set(path, { path, name: parsed.name, description: parsed.description });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'invalid') throw error;
    }
  }
  return skills;
}

export async function readSyncState(home) {
  try {
    const value = JSON.parse(await regularFile(syncStateFile(home), MAX_STATE_BYTES));
    if (value.version !== 1 || !isRecord(value.entries)) return null;
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new ManagerError('unavailable');
  }
}

export function requestSync(home, message) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(syncSocket(home));
    let data = '';
    const fail = () => {
      socket.destroy();
      reject(new ManagerError('unavailable'));
    };
    socket.setEncoding('utf8');
    socket.setTimeout(9000, fail);
    socket.on('error', fail);
    socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
    socket.on('data', chunk => {
      data += chunk;
      if (data.length > 8192) return fail();
      if (!data.includes('\n')) return;
      socket.destroy();
      try {
        const reply = JSON.parse(data);
        if (!reply.ok) return reject(new ManagerError(reply.error === 'conflict' ? 'conflict' : 'unavailable'));
        resolve(reply.result);
      } catch {
        fail();
      }
    });
    socket.on('end', fail);
  });
}

export function registerSharedPolicy(skills, home, agentsHome) {
  if (typeof skills.registerProvider !== 'function') return () => {};
  let invalidate;
  const dispose = skills.registerProvider(control => {
    invalidate = control.invalidate;
    return {
      name: 'skill-manager-shared-policy',
      async list() {
        const state = await readSyncState(home);
        if (!state || !Object.values(state.entries).some(entry => entry.enabled === false)) return [];
        return [...(await sharedSkills(agentsHome)).values()]
          .filter(skill => state.entries[skill.path]?.enabled === false)
          .map(skill => ({
            ...skill,
            provider: 'skill-manager-shared-policy',
            source: 'user-agents',
            // Immediately ahead of the default user-agents provider. Project and user-dsh win.
            rank: 499,
            invocation: disabled,
            locator: skill.path,
            resourceBase: { kind: 'directory', path: dirname(skill.path) },
          }));
      },
      async get(candidate) {
        try {
          if (await realpath(candidate.path) !== candidate.path) return undefined;
          const { name, description, body } = parseSkillFile(await regularFile(candidate.path, MAX_BUNDLE_BYTES));
          return { ...candidate, name, description, content: body };
        } catch (error) {
          if (error.code === 'ENOENT' || error.code === 'invalid') return undefined;
          throw error;
        }
      },
    };
  });
  const path = syncStateFile(home);
  watchFile(path, { persistent: false, interval: 500 }, invalidate);
  return () => {
    unwatchFile(path, invalidate);
    dispose();
  };
}
