import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { isRecord } from './skill-file.js';

const MAX_PROVENANCE_BYTES = 1024 * 1024;

async function readManifest(path) {
  if (!(await lstat(path)).isFile()) return undefined;
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
  await using file = await open(path, flags);
  const stats = await file.stat();
  if (!stats.isFile() || stats.size > MAX_PROVENANCE_BYTES) return undefined;
  const buffer = Buffer.alloc(stats.size + 1);
  const { bytesRead } = await file.read(buffer);
  if (bytesRead !== stats.size) return undefined;
  return JSON.parse(buffer.toString('utf8', 0, bytesRead));
}

function repositoryUrl(value) {
  if (typeof value !== 'string' || !/^https:\/\/[^\s\\?#\p{Cc}]+$/iu.test(value)) return undefined;
  const url = URL.parse(value);
  if (!url || url.username || url.password) return undefined;
  return url.href;
}

export async function readProvenance(agentsHome) {
  if (!agentsHome) return () => undefined;
  let root;
  let records;
  try {
    root = await realpath(join(agentsHome, 'skills'));
    records = await readManifest(join(root, '.provenance.json'));
  } catch {
    return () => undefined;
  }
  if (!isRecord(records)) return () => undefined;

  return skill => {
    if (skill.source !== 'user-agents' || typeof skill.path !== 'string' || !isAbsolute(skill.path)) return undefined;
    // Harness reports the resolved instruction file, so use the resolved root as well.
    const path = relative(root, skill.path);
    if (path === '' || path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) return undefined;
    const key = path.split(sep).join('/');
    const record = Object.hasOwn(records, key) ? records[key] : undefined;
    if (!isRecord(record) || (record.origin !== 'self' && record.origin !== 'third-party')) return undefined;
    const repository = record.origin === 'third-party' ? repositoryUrl(record.repository) : undefined;
    return repository ? { origin: record.origin, repository } : { origin: record.origin };
  };
}
