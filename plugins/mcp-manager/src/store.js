/**
 * State assembly and the lock-protected write path.
 *
 * Every local mutation re-reads the patch under the profile writer lock, finds the
 * target row by its stable Cordis id, verifies the row fingerprint the browser
 * read, builds the next text, and only then replaces the file atomically.
 */

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { readProfilePatch, withProfileLock, writeProfilePatch } from './atomic.js';
import { PatchError } from './errors.js';
import { logEvent } from './log.js';
import { buildDelete, buildSave, buildSetEnabled, readPatch } from './patch.js';

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

/** Compatibility fallback for launchers that pass the profile directory as an argument. */
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
 * Resolve the explicit override, the active host profile, or a legacy launch hint.
 * @param {{env?: NodeJS.ProcessEnv, patchPath?: unknown,
 *   profileContext?: {dir?: unknown, patchPath?: unknown, name?: unknown}}} [options]
 */
export function resolveProfile(options = {}) {
  const env = options.env || process.env;
  if (typeof options.patchPath === 'string' && options.patchPath !== '') {
    if (!isAbsolute(options.patchPath)) throw new PatchError('profile-unavailable', { reason: 'relative-path' });
    const dir = dirname(options.patchPath);
    const profile = typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE !== '' ? env.DSH_PROFILE : basename(dir);
    return { dir, patchPath: options.patchPath, profile };
  }
  const context = options.profileContext;
  if (context && typeof context.dir === 'string' && isAbsolute(context.dir)
    && typeof context.patchPath === 'string' && isAbsolute(context.patchPath)
    && typeof context.name === 'string' && context.name !== '') {
    return { dir: context.dir, patchPath: context.patchPath, profile: context.name };
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
  const profile = typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE !== '' ? env.DSH_PROFILE : basename(dir);
  return { dir, patchPath: join(dir, PATCH_NAME), profile };
}

function revisionOf(text) {
  return createHash('sha256').update(text).digest('hex');
}

function toServer(entry, duplicateNames, countTools) {
  return {
    id: entry.id ?? null,
    name: entry.name ?? null,
    transport: entry.transport ?? null,
    enabled: entry.enabled,
    editable: entry.editable,
    readOnlyCode: entry.readOnlyCode,
    rowHash: entry.rowHash || null,
    deletable: entry.rowIndex !== null,
    tools: entry.name ? countTools(entry.name) : null,
    duplicate: entry.name ? duplicateNames.has(entry.name) : false,
  };
}

/** Build the complete read model from one patch text. */
export function stateFromText(text, { profile, patchPath, countTools, revision = revisionOf(text) }) {
  const parsed = readPatch(text);
  const warnings = [...parsed.warnings];
  for (const name of parsed.duplicateNames) warnings.push({ code: 'duplicate-name', name });
  return {
    ok: true,
    profile,
    patchPath,
    revision,
    servers: parsed.entries.map(entry => toServer(entry, parsed.duplicateNames, countTools)),
    warnings,
  };
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
 * @param {{profile: () => {dir: string, patchPath: string, profile: string}, countTools?: (name: string) => number | null, log?: typeof logEvent}} options
 */
export function createStore(options) {
  const countTools = typeof options.countTools === 'function' ? options.countTools : () => null;
  const log = typeof options.log === 'function' ? options.log : logEvent;
  const lockOptions = Number.isFinite(options.lockTimeoutMs) ? { timeoutMs: options.lockTimeoutMs } : {};

  const readState = async (resolved = options.profile()) => {
    const { text, bytes } = readProfilePatch(resolved.patchPath);
    return stateFromText(text, { ...resolved, countTools, revision: revisionOf(bytes) });
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
      transport: request.draft ? request.draft.transport : undefined,
      enabled: result?.enabled,
      durationMs: Date.now() - started,
    });
    return readState();
  };

  return {
    readState,

    async save(request) {
      return mutate(request, fresh => {
        const parsed = readPatch(fresh.text);
        let target;
        if (request.mode === 'edit') {
          target = findEntry(parsed, request);
          if (!target) throw new PatchError('not-found');
          if (!target.editable) throw new PatchError('read-only', { code: target.readOnlyCode });
          if (typeof request.rowHash !== 'string' || request.rowHash !== target.rowHash) {
            throw new PatchError('conflict', { reason: 'row-changed' });
          }
        } else if (request.mode !== 'add') {
          throw new PatchError('invalid', { reason: 'mode' });
        }
        return buildSave(fresh.text, target, request.draft);
      }, 'saved');
    },

    async remove(request) {
      return mutate(request, fresh => {
        const parsed = readPatch(fresh.text);
        const target = findEntry(parsed, request);
        if (!target) throw new PatchError('not-found');
        if (typeof request.rowHash !== 'string' || request.rowHash !== target.rowHash) {
          throw new PatchError('conflict', { reason: 'row-changed' });
        }
        return buildDelete(fresh.text, target);
      }, 'deleted');
    },

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
