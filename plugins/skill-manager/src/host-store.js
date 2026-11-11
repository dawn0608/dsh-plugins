import {
  closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readlinkSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, toNamespacedPath } from 'node:path';
import { randomUUID } from 'node:crypto';
import { foldPath, isManagedName, isRecord, ManagerError, MANAGED_ID, MAX_BUNDLE_BYTES, parseSkillFile } from './host-bundle.js';

function stat(path) {
  try {
    return lstatSync(path, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function identity(stats) {
  return `${stats.dev}:${stats.ino}:${stats.birthtimeNs}`;
}

function linkTargets(path, expected) {
  const target = resolve(dirname(path), readlinkSync(path));
  return process.platform === 'win32'
    ? toNamespacedPath(target).toLowerCase() === toNamespacedPath(resolve(expected)).toLowerCase()
    : target === resolve(expected);
}

function directoryLink(target, path) {
  symlinkSync(resolve(target), path, process.platform === 'win32' ? 'junction' : 'dir');
}

function safeDirectory(path, create) {
  let stats = stat(path);
  if (!stats && create) {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    stats = stat(path);
  }
  if (!stats) return false;
  if (!stats.isDirectory() || (process.getuid && (stats.uid !== BigInt(process.getuid()) || (stats.mode & 0o022n) !== 0n))) {
    throw new ManagerError('conflict');
  }
  return true;
}

function readRegularFile(path, limit, expected) {
  // O_NONBLOCK keeps a substituted FIFO from hanging before the fstat check.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  const fd = openSync(path, flags);
  try {
    const stats = fstatSync(fd, { bigint: true });
    if (!stats.isFile() || stats.size > BigInt(limit) || identity(stats) !== expected) {
      throw new ManagerError('conflict');
    }
    const bytes = readFileSync(fd);
    if (bytes.length > limit) throw new ManagerError('conflict');
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function readRecord(path) {
  const stats = stat(path);
  if (!stats) return undefined;
  if (!stats.isFile()) throw new ManagerError('conflict');
  try {
    const token = identity(stats);
    const data = JSON.parse(readRegularFile(path, 1024, token));
    if (!isRecord(data) || data.version !== 1 || typeof data.id !== 'string' || !MANAGED_ID.test(data.id) ||
        !(data.bundle === null || typeof data.bundle === 'string') || typeof data.removing !== 'boolean' ||
        !(data.activation === null || (isRecord(data.activation) &&
          typeof data.activation.anchor === 'string' && MANAGED_ID.test(data.activation.anchor) &&
          (data.activation.link === null || typeof data.activation.link === 'string')))) {
      throw new ManagerError('conflict');
    }
    return { data, token };
  } catch {
    throw new ManagerError('conflict');
  }
}

function sameEntry(path, token) {
  const stats = stat(path);
  return stats !== undefined && identity(stats) === token;
}

function unlinkOwned(path, token) {
  if (!sameEntry(path, token)) throw new ManagerError('conflict');
  unlinkSync(path);
}

function writeRecord(path, data, token) {
  const temp = join(dirname(path), `.${randomUUID()}.json`);
  writeFileSync(temp, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
  try {
    if (token === undefined) {
      // Hard-link a complete regular file to publish without replacing.
      linkSync(temp, path);
    } else {
      if (!sameEntry(path, token)) throw new ManagerError('conflict');
      renameSync(temp, path);
    }
    return readRecord(path);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function createSkillStore(home) {
  const manager = join(home, 'skill-manager');
  const bundles = join(manager, 'bundles');
  const records = join(manager, 'records');
  const skills = join(home, 'skills');
  function roots(create = false) {
    if (!safeDirectory(home, create)) return false;
    safeDirectory(skills, false);
    if (!safeDirectory(manager, create)) return false;
    const bundlesExist = safeDirectory(bundles, create);
    const recordsExist = safeDirectory(records, create);
    if (create) safeDirectory(skills, true);
    return bundlesExist && recordsExist;
  }

  // A complete regular file publishes ownership atomically, including on
  // Windows without symlink privileges. Dead generations stay
  // in place, so concurrent Hosts never race to unlink and replace a live lock.
  function takeLock() {
    for (let generation = 0; ; generation += 1) {
      const path = join(manager, `.write-lock-${generation}`);
      const temp = join(manager, `.lock-${randomUUID()}`);
      writeFileSync(temp, JSON.stringify({ pid: process.pid, nonce: randomUUID() }), { flag: 'wx', mode: 0o600 });
      const token = identity(stat(temp));
      try {
        linkSync(temp, path);
        if (!sameEntry(path, token)) throw new ManagerError('conflict');
        return () => unlinkOwned(path, token);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        unlinkSync(temp);
      }
      const stats = stat(path);
      if (!stats?.isFile()) throw new ManagerError('conflict');
      let owner;
      try {
        owner = JSON.parse(readRegularFile(path, 1024, identity(stats)));
      } catch {
        throw new ManagerError('conflict');
      }
      const pid = owner?.pid;
      if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff || !MANAGED_ID.test(owner?.nonce ?? '')) {
        throw new ManagerError('conflict');
      }
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') continue;
        throw new ManagerError('conflict');
      }
      throw new ManagerError('conflict');
    }
  }

  function mutate(create, operation) {
    if (!roots(create)) throw new ManagerError('not-found');
    const release = takeLock();
    try {
      if (!roots()) throw new ManagerError('conflict');
      return operation();
    } catch (error) {
      if (['EBUSY', 'EACCES', 'EPERM'].includes(error.code)) throw new ManagerError('conflict');
      throw error;
    } finally {
      release();
    }
  }

  function pathsFor(name) {
    return {
      bundle: join(bundles, name),
      record: join(records, `${name}.json`),
      active: join(skills, name),
    };
  }

  function anchorPath(activation) {
    return join(records, `.${activation.anchor}.link`);
  }

  function activeLink(paths, record, stats = stat(paths.active)) {
    const { activation } = record.data;
    if (!activation) return false;
    if (!stats?.isSymbolicLink() || (activation.link !== null && identity(stats) !== activation.link)) return false;
    const anchor = anchorPath(activation);
    return linkTargets(paths.active, anchor) && stat(anchor)?.isSymbolicLink() === true &&
      linkTargets(anchor, paths.bundle);
  }

  function discardAnchor(paths, activation) {
    if (!activation) return;
    const anchor = anchorPath(activation);
    const stats = stat(anchor);
    if (stats?.isSymbolicLink() && linkTargets(anchor, paths.bundle)) unlinkOwned(anchor, identity(stats));
  }

  function lookup(name, id) {
    const paths = pathsFor(name);
    const record = readRecord(paths.record);
    if (!record || (id !== undefined && id !== record.data.id)) throw new ManagerError('not-found');
    return { paths, record };
  }

  function assertOwnedBundle(paths, record) {
    if (!safeDirectory(paths.bundle, false) || !sameEntry(paths.bundle, record.data.bundle)) {
      throw new ManagerError('conflict');
    }
  }

  function read(name, id) {
    if (!roots()) throw new ManagerError('not-found');
    const { paths, record } = lookup(name, id);
    if (record.data.removing || !stat(paths.bundle)) throw new ManagerError('not-found');
    assertOwnedBundle(paths, record);
    const path = join(paths.bundle, 'SKILL.md');
    const stats = stat(path);
    if (!stats?.isFile()) throw new ManagerError('conflict');
    const skill = parseSkillFile(readRegularFile(path, MAX_BUNDLE_BYTES, identity(stats)));
    if (skill.name !== name) throw new ManagerError('conflict');
    const active = stat(paths.active);
    return {
      ...skill, ...paths, id: record.data.id, resolvedFile: realpathSync(path),
      enabled: activeLink(paths, record, active),
      activeMissing: active === undefined,
    };
  }

  function list() {
    try {
      if (!roots()) return { skills: [], complete: true };
    } catch (error) {
      if (!(error instanceof ManagerError)) throw error;
      return { skills: [], complete: false };
    }
    const entries = [];
    let complete = true;
    for (const entry of readdirSync(records)) {
      if (!entry.endsWith('.json')) continue;
      const name = entry.slice(0, -5);
      if (!isManagedName(name)) continue;
      try {
        entries.push(read(name));
      } catch (error) {
        if (error.code === 'not-found') continue;
        if (!(error instanceof ManagerError) && error.code !== 'ENOENT') throw error;
        complete = false;
      }
    }
    return { skills: entries, complete };
  }

  function assertFree(root, names) {
    const keys = names.map(foldPath);
    if (readdirSync(root).some(entry => keys.includes(foldPath(entry)))) throw new ManagerError('conflict');
  }

  function enable(name, paths, record) {
    if (activeLink(paths, record)) return;
    safeDirectory(skills, true);
    assertFree(skills, [name, `${name}.md`]);

    // Record the private, unpredictable link target before publishing the
    // activation. If the Host exits at publication, the next Host can still
    // verify ownership, even before the final inode was recorded.
    const activation = { anchor: randomUUID(), link: null };
    const anchor = anchorPath(activation);
    directoryLink(paths.bundle, anchor);
    let prepared;
    try {
      prepared = writeRecord(paths.record, { ...record.data, activation }, record.token);
    } catch (error) {
      discardAnchor(paths, activation);
      throw error;
    }
    discardAnchor(paths, record.data.activation);
    try {
      directoryLink(anchor, paths.active);
    } catch (error) {
      if (error.code === 'EEXIST') throw new ManagerError('conflict');
      throw error;
    }

    const link = identity(stat(paths.active));
    try {
      writeRecord(paths.record, { ...prepared.data, activation: { ...activation, link } }, prepared.token);
    } catch (error) {
      unlinkOwned(paths.active, link);
      throw error;
    }
  }

  function disable(paths, record) {
    const stats = stat(paths.active);
    if (!stats) return;
    if (!activeLink(paths, record, stats)) throw new ManagerError('conflict');
    unlinkOwned(paths.active, identity(stats));
  }

  function stagePath(record) {
    return join(manager, `.stage-${record.data.id}`);
  }

  function discardInstall(paths, record) {
    const staging = stagePath(record);
    if (sameEntry(staging, record.data.bundle)) rmSync(staging, { recursive: true });
    if (sameEntry(paths.bundle, record.data.bundle)) rmSync(paths.bundle, { recursive: true });
    discardAnchor(paths, record.data.activation);
    unlinkOwned(paths.record, record.token);
  }

  function finishRemoval(paths, record) {
    const trash = join(manager, `.trash-${record.data.id}`);
    if (sameEntry(paths.bundle, record.data.bundle)) {
      assertOwnedBundle(paths, record);
      if (stat(trash)) throw new ManagerError('conflict');
      renameSync(paths.bundle, trash);
    }
    if (stat(trash)) {
      if (!sameEntry(trash, record.data.bundle)) throw new ManagerError('conflict');
      rmSync(trash, { recursive: true });
    }
    discardAnchor(paths, record.data.activation);
    unlinkOwned(paths.record, record.token);
  }

  function install(skill) {
    return mutate(true, () => {
      const paths = pathsFor(skill.name);
      const prior = readRecord(paths.record);
      if (prior?.data.removing) {
        finishRemoval(paths, prior);
      } else if (prior) {
        if (stat(paths.bundle)) {
          assertOwnedBundle(paths, prior);
          throw new ManagerError('duplicate');
        }
        // The previous Host died before moving its stage into place.
        if (stat(paths.active)) throw new ManagerError('conflict');
        discardInstall(paths, prior);
      }
      assertFree(skills, [skill.name, `${skill.name}.md`]);
      assertFree(bundles, [skill.name]);
      assertFree(records, [`${skill.name}.json`]);
      const data = { version: 1, id: randomUUID(), bundle: null, activation: null, removing: false };
      let record = writeRecord(paths.record, data);
      const staging = stagePath(record);
      let bundle;
      try {
        mkdirSync(staging, { mode: 0o700 });
        bundle = identity(stat(staging));
        record = writeRecord(paths.record, { ...data, bundle }, record.token);
        for (const [relativePath, bytes] of skill.entries) {
          const path = join(staging, relativePath);
          mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
          writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
        }
        // Publication happens only after the complete staged tree and its
        // ownership record are present, while the per-home lock is held.
        assertFree(bundles, [skill.name]);
        renameSync(staging, paths.bundle);
        enable(skill.name, paths, record);
      } catch (error) {
        const current = readRecord(paths.record);
        if (current?.data.id === data.id && !activeLink(paths, current)) {
          if (bundle && sameEntry(staging, bundle)) rmSync(staging, { recursive: true });
          discardInstall(paths, current);
        }
        throw error;
      }
    });
  }

  function setEnabled(name, id, enabled) {
    return mutate(false, () => {
      const { paths, record } = lookup(name, id);
      if (record.data.removing) throw new ManagerError('not-found');
      assertOwnedBundle(paths, record);
      if (enabled) {
        // A damaged bundle must never become active.
        read(name, id);
        enable(name, paths, record);
      } else {
        disable(paths, record);
      }
    });
  }

  function remove(name, id) {
    return mutate(false, () => {
      const { paths, record } = lookup(name, id);
      if (record.data.removing) {
        finishRemoval(paths, record);
        return;
      }
      assertOwnedBundle(paths, record);
      disable(paths, record);
      const tombstone = writeRecord(paths.record, { ...record.data, removing: true }, record.token);
      finishRemoval(paths, tombstone);
    });
  }

  return { install, list, read, remove, setEnabled };
}
