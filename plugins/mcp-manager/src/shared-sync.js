/** Host-only adapter for the explicitly configured MCP synchronization bridge. */

import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { PatchError } from './errors.js';

const runFile = promisify(execFile);
const BRIDGE_TIMEOUT_MS = 30_000;

function absolutePath(value) {
  return typeof value === 'string' && !value.includes('\0') && isAbsolute(value);
}

export function createSharedRemoval(config) {
  if (!absolutePath(config?.python) || !absolutePath(config?.script)) return undefined;
  const { python, script } = config;
  return async (name, patchPath, revision) => {
    let stdout;
    let exitCode = 0;
    try {
      ({ stdout } = await runFile(python, [
        script, 'remove-from-profile', '--patch-path', patchPath, '--revision', revision, '--', name,
      ], { timeout: BRIDGE_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 }));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'ENOEXEC') {
        throw new PatchError('shared-unavailable');
      }
      // A killed or otherwise interrupted bridge may already have made changes.
      if (!Number.isInteger(error.code)) throw new PatchError('shared-unknown');
      exitCode = error.code;
      stdout = error.stdout;
    }

    let status;
    try {
      status = JSON.parse(stdout)?.status;
    } catch {
      throw new PatchError('shared-unknown');
    }
    if (exitCode === 0 && (status === 'removed' || status === 'pending')) return status;
    if (exitCode !== 0) {
      if (status === 'conflict') throw new PatchError('conflict');
      if (status === 'unavailable') throw new PatchError('shared-unavailable');
      if (status === 'unmanaged') throw new PatchError('shared-unmanaged');
    }
    throw new PatchError('shared-unknown');
  };
}
