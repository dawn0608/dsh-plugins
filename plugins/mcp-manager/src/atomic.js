/**
 * Profile writer: the same `package.json.lock` exclusive-create lock the
 * Harness profile operations use, followed by a same-directory temporary
 * file and a rename.
 *
 * Readers never take the lock (the rename is atomic); only read-modify-write
 * cycles do, and every write re-checks the bytes it based its edit on.
 */

import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PatchError } from './errors.js';

const MAX_PATCH_BYTES = 1024 * 1024;
const DEFAULT_LOCK_TIMEOUT_MS = 4000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function described(error) {
  return error && typeof error === 'object' ? error.code : undefined;
}

/**
 * Read the patch with the checks every writer relies on.
 * @returns {{text: string, mode: number}}
 */
export function readProfilePatch(path) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    throw new PatchError('profile-unavailable', { reason: described(error) || 'missing' });
  }
  if (!stats.isFile()) throw new PatchError('profile-unavailable', { reason: 'not-regular' });
  if (stats.size > MAX_PATCH_BYTES) throw new PatchError('profile-unavailable', { reason: 'too-large' });
  try {
    return { text: readFileSync(path, 'utf8'), mode: stats.mode & 0o777 };
  } catch (error) {
    throw new PatchError('profile-unavailable', { reason: described(error) || 'unreadable' });
  }
}

/** Whether a recorded lock owner still exists. */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return described(error) !== 'ESRCH';
  }
}

function lockPid(fd) {
  const stats = fstatSync(fd);
  if (!stats.isFile() || stats.size > 64) return undefined;
  const buffer = Buffer.alloc(64);
  const size = readSync(fd, buffer, 0, buffer.length, 0);
  const record = buffer.toString('utf8', 0, size).trim();
  if (!/^\d+$/.test(record)) return undefined;
  const pid = Number(record);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}

function ownsPath(fd, path) {
  const opened = fstatSync(fd, { bigint: true });
  const current = lstatSync(path, { bigint: true });
  return opened.dev === current.dev && opened.ino === current.ino;
}

function closeLock(fd, path) {
  if (fd === undefined) return;
  try {
    if (path !== undefined && ownsPath(fd, path)) unlinkSync(path);
  } catch {
    // Gone, replaced or inaccessible.
  }
  try {
    closeSync(fd);
  } catch {
    // Best-effort cleanup.
  }
}

/** Only one contender can reclaim a stale lock, and only the file it inspected. */
function takeover(lockPath) {
  const claim = `${lockPath}.takeover`;
  let staleFd;
  let claimFd;
  try {
    staleFd = openSync(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const pid = lockPid(staleFd);
    if (pid === undefined || alive(pid)) return false;

    claimFd = openSync(claim, 'wx', 0o600);
    writeSync(claimFd, `${process.pid}\n`);
    if (lockPid(staleFd) !== pid || alive(pid) || !ownsPath(staleFd, lockPath)) return false;
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  } finally {
    closeLock(staleFd);
    closeLock(claimFd, claim);
  }
}

/**
 * Hold the profile writer lock around one operation.
 * @template T
 * @param {string} profileDir
 * @param {() => Promise<T> | T} operation
 * @param {{timeoutMs?: number}} [options]
 * @returns {Promise<T>}
 */
export async function withProfileLock(profileDir, operation, options = {}) {
  const lockPath = join(profileDir, 'package.json.lock');
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_LOCK_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let fd;
    try {
      fd = openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      const code = described(error);
      if (code !== 'EEXIST' && code !== 'EPERM') {
        throw new PatchError('locked', { reason: code || 'unknown' });
      }
      if (code === 'EPERM') {
        try {
          lstatSync(lockPath);
        } catch {
          throw new PatchError('locked', { reason: 'EPERM' });
        }
      }
      if (takeover(lockPath)) continue;
      if (Date.now() >= deadline) throw new PatchError('locked', { timeoutMs });
      await sleep(20 + Math.floor(Math.random() * 60));
      continue;
    }
    try {
      writeSync(fd, `${process.pid}\n`);
    } catch (error) {
      closeLock(fd, lockPath);
      throw new PatchError('locked', { reason: described(error) || 'record' });
    }
    try {
      return await operation();
    } finally {
      closeLock(fd, lockPath);
    }
  }
}

/**
 * Replace the patch atomically, refusing to overwrite bytes that changed since
 * the caller read them.
 * @param {string} path
 * @param {string} text
 * @param {{expected: Buffer | string, mode?: number}} options
 */
export function writeProfilePatch(path, text, options) {
  const expected = Buffer.isBuffer(options.expected) ? options.expected : Buffer.from(String(options.expected), 'utf8');
  const mode = typeof options.mode === 'number' ? options.mode : 0o600;
  const directory = dirname(path);
  const temp = join(directory, `.${basename(path)}.mcp-manager-${process.pid}-${randomBytes(6).toString('hex')}`);
  let fd;
  try {
    fd = openSync(temp, 'wx', mode);
    writeSync(fd, text, null, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      unlinkSync(temp);
    } catch {
      // ignore
    }
    throw new PatchError('write-failed', { reason: described(error) || 'temp' });
  }

  try {
    let current;
    try {
      current = readFileSync(path);
    } catch (error) {
      throw new PatchError('write-failed', { reason: described(error) || 'reread' });
    }
    if (!current.equals(expected)) throw new PatchError('conflict');
    replace(temp, path);
    try {
      const parent = openSync(directory, 'r');
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
    } catch {
      // Directory fsync is a durability nicety; the rename already committed.
    }
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // ignore
    }
    if (error instanceof PatchError) throw error;
    throw new PatchError('write-failed', { reason: described(error) || 'rename' });
  }
}

function replace(source, target) {
  const platform = process.platform;
  if (platform !== 'win32') {
    renameSync(source, target);
    return;
  }
  const deadline = Date.now() + 1000;
  for (;;) {
    try {
      renameSync(source, target);
      return;
    } catch (error) {
      const code = described(error);
      if (!['EACCES', 'EBUSY', 'EPERM'].includes(code) || Date.now() >= deadline) throw error;
    }
  }
}
