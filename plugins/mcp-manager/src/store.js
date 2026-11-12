/**
 * State assembly and the lock-protected write path.
 *
 * Every local mutation re-reads the patch under the profile writer lock, finds the
 * target row by its stable Cordis id, verifies the row fingerprint the browser
 * read, builds the next text, and only then replaces the file atomically.
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { readProfilePatch, withProfileLock, writeProfilePatch } from './atomic.js';
import { PatchError } from './errors.js';
import { logEvent } from './log.js';
import { buildSetEnabled, readPatch } from './patch.js';

const PATCH_NAME = 'cordis.patch.yml';

function isProfileDirectory(dir) {
  try {
    if (!statSync(join(dir, PATCH_NAME)).isFile()) return false;
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return Boolean(manifest && manifest.dsh && manifest.dsh.profile);
  } catch {
    return false;
  }
}

/** Read the profile directory supplied by the launcher. */
function launcherProfileDirectory(env) {
  if (typeof env.DSH_PROFILE_DIR === 'string' && isProfileDirectory(env.DSH_PROFILE_DIR)) {
    return env.DSH_PROFILE_DIR;
  }
  for (const argument of process.argv.slice(1)) {
    if (!isAbsolute(argument)) continue;
    if (isProfileDirectory(argument)) return argument;
  }
  return undefined;
}

/**
 * Resolve the explicit override, the active host profile, or launcher settings.
 * @param {{env?: NodeJS.ProcessEnv, patchPath?: unknown,
 *   profileContext?: {dir?: unknown, patchPath?: unknown}}} [options]
 */
export function resolveProfile(options = {}) {
  const env = options.env || process.env;
  if (typeof options.patchPath === 'string' && options.patchPath !== '') {
    if (!isAbsolute(options.patchPath)) throw new PatchError('profile-unavailable', { reason: 'relative-path' });
    const dir = dirname(options.patchPath);
    return { dir, patchPath: options.patchPath };
  }
  const context = options.profileContext;
  if (context && typeof context.dir === 'string' && isAbsolute(context.dir)
    && typeof context.patchPath === 'string' && isAbsolute(context.patchPath)) {
    return { dir: context.dir, patchPath: context.patchPath };
  }
  let dir;
  if (typeof env.DSH_PROFILE_DIR === 'string' && env.DSH_PROFILE_DIR !== '') {
    dir = env.DSH_PROFILE_DIR;
  } else if (typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' && typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE !== '') {
    dir = join(env.DSH_HOME, 'profiles', env.DSH_PROFILE);
  } else {
    dir = launcherProfileDirectory(env);
  }
  if (dir === undefined) throw new PatchError('profile-unavailable', { reason: 'no-profile' });
  return { dir, patchPath: join(dir, PATCH_NAME) };
}

function toServer(entry, duplicateNames) {
  return {
    id: entry.id ?? null,
    name: entry.name ?? null,
    transport: entry.transport ?? null,
    enabled: entry.enabled,
    editable: entry.editable,
    readOnlyCode: entry.readOnlyCode,
    rowHash: entry.rowHash || null,
    duplicate: entry.name ? duplicateNames.has(entry.name) : false,
  };
}

/** Build the complete read model from one patch text. */
export function stateFromText(text) {
  const parsed = readPatch(text);
  return { ok: true, servers: parsed.entries.map(entry => toServer(entry, parsed.duplicateNames)) };
}

function findEntry(parsed, request) {
  const id = typeof request.id === 'string' && request.id !== '' ? request.id : undefined;
  if (id !== undefined) {
    const matches = parsed.entries.filter(entry => entry.id === id && entry.rowIndex !== null);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new PatchError('conflict', { reason: 'ambiguous-id' });
    return undefined;
  }
  const name = typeof request.name === 'string' && request.name !== '' ? request.name : undefined;
  if (name === undefined) return undefined;
  const matches = parsed.entries.filter(entry => entry.name === name && entry.rowIndex !== null);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new PatchError('conflict', { reason: 'ambiguous-name' });
  return undefined;
}

function requireTarget(parsed, request) {
  const target = findEntry(parsed, request);
  if (!target) throw new PatchError('not-found');
  if (!target.editable) throw new PatchError('read-only', { code: target.readOnlyCode });
  if (typeof request.rowHash !== 'string' || request.rowHash !== target.rowHash) {
    throw new PatchError('conflict', { reason: 'row-changed' });
  }
  return target;
}

/**
 * @param {{profile: () => {dir: string, patchPath: string}, log?: typeof logEvent}} options
 */
export function createStore(options) {
  const log = typeof options.log === 'function' ? options.log : logEvent;
  const lockOptions = Number.isFinite(options.lockTimeoutMs) ? { timeoutMs: options.lockTimeoutMs } : {};

  const readState = async (resolved = options.profile()) => {
    const { text } = readProfilePatch(resolved.patchPath);
    return stateFromText(text);
  };

  const mutate = async (request, operation, event) => {
    const started = Date.now();
    const resolved = options.profile();
    let result;
    await withProfileLock(resolved.dir, async () => {
      const fresh = readProfilePatch(resolved.patchPath);
      result = operation(fresh);
      if (result.text !== fresh.text) {
        writeProfilePatch(resolved.patchPath, result.text, { expected: fresh.text, mode: fresh.mode });
      }
    }, lockOptions);
    log(event, {
      action: request.action,
      name: result?.name,
      id: result?.id,
      enabled: result?.enabled,
      durationMs: Date.now() - started,
    });
    return readState();
  };

  return {
    readState,

    async setEnabled(request) {
      if (typeof request.enabled !== 'boolean') throw new PatchError('invalid', { reason: 'enabled' });
      return mutate(request, fresh => {
        const parsed = readPatch(fresh.text);
        const target = requireTarget(parsed, request);
        return buildSetEnabled(fresh.text, target, request.enabled);
      }, 'enabled');
    },
  };
}
