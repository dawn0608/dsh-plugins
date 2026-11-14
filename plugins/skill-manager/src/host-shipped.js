import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';

const MAX_MANIFEST_BYTES = 64 * 1024;
const OFFICIAL_PACKAGE_SCOPE = '@deepseek-ai/';
const CACHE_LIMIT = 256;

/** Read one directory's manifest name; `undefined` means there is no manifest there. */
async function packageName(manifest) {
  try {
    const info = await stat(manifest);
    if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) return null;
    const parsed = JSON.parse(await readFile(manifest, 'utf8'));
    return typeof parsed?.name === 'string' ? parsed.name : null;
  } catch (error) {
    return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? undefined : null;
  }
}

/** Walk up to the nearest package and report whether it is published by Harness. */
async function officialPackage(directory) {
  for (let current = directory; ;) {
    const name = await packageName(join(current, 'package.json'));
    if (name !== undefined) return name !== null && name.startsWith(OFFICIAL_PACKAGE_SCOPE);
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

// The preset composition mounts packaged skills through `customSkillDirs`, so a
// custom skill that resolves inside an official package ships with Harness.
export function createShippedLookup() {
  const cache = new Map();
  return async function shipped(skill) {
    if (skill?.source !== 'custom' || typeof skill.path !== 'string' || !isAbsolute(skill.path)) return false;
    const directory = dirname(skill.path);
    if (cache.has(directory)) return cache.get(directory);
    const found = await officialPackage(directory);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(directory, found);
    return found;
  };
}
