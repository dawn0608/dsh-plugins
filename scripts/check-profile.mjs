#!/usr/bin/env node
/**
 * Flag duplicate plugin insert ids in one DSH profile.
 *
 * DSH keys browser modules by package name. Installing the same plugin under
 * two names (for example a local alias beside the published package) creates
 * two client modules; when both insert the same Loader row id, the client slot
 * ledger can reject the second one. Group installed packages by the ids their
 * cordis.patch.yml inserts so an alias is visible before it reaches the boot
 * graph.
 *
 * Usage:
 *   node scripts/check-profile.mjs <profile-dir>
 *   DSH_PROFILE_DIR=<profile-dir> node scripts/check-profile.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = process.argv[2];
if (arg === undefined && !process.env.DSH_PROFILE_DIR) {
  console.error('usage: node scripts/check-profile.mjs <profile-dir>');
  console.error('       DSH_PROFILE_DIR=<profile-dir> node scripts/check-profile.mjs');
  process.exit(2);
}
const profileDir = resolve(arg ?? process.env.DSH_PROFILE_DIR);
const nodeModules = join(profileDir, 'node_modules');

if (!existsSync(join(profileDir, 'package.json')) || !existsSync(nodeModules)) {
  console.error(`check-profile: ${profileDir} is not a DSH profile directory`);
  process.exit(2);
}

/**
 * Read the ids of top-level `- insert:` rows in a Loader patch.
 * The patch is user-authored YAML; only the simple id lines this check needs
 * are read, so `!!js`, config blocks, and comments stay untouched.
 */
function parseInsertIds(patch) {
  const ids = [];
  let inInsert = false;
  let insertIndent = -1;
  for (const line of String(patch).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (!inInsert) {
      if (/^(?:-\s*)?insert:\s*$/.test(trimmed)) {
        inInsert = true;
        insertIndent = indent;
      }
      continue;
    }
    if (indent <= insertIndent) {
      inInsert = false;
      continue;
    }
    const match = /^-\s*id:\s*['"]?([^'"\s]+)/.exec(trimmed);
    if (match) ids.push(match[1]);
  }
  return ids;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    return false;
  }
}

/** Enumerate installed package directories, including scopes, without descending into .pnpm. */
function installedPackageDirs(directory) {
  const dirs = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (!entry.name.startsWith('@')) {
      if (isDirectory(path)) dirs.push(path);
      continue;
    }
    if (!isDirectory(path)) continue;
    for (const child of readdirSync(path, { withFileTypes: true })) {
      if (!child.name.startsWith('.') && isDirectory(join(path, child.name))) dirs.push(join(path, child.name));
    }
  }
  return dirs;
}

const packages = [];
for (const dir of installedPackageDirs(nodeModules)) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch (error) {
    continue;
  }
  const declared = pkg.dsh?.bundle?.patch;
  const patchPath = typeof declared === 'string'
    ? resolve(dir, declared)
    : join(dir, 'cordis.patch.yml');
  if (!existsSync(patchPath)) continue;
  const ids = parseInsertIds(readFileSync(patchPath, 'utf8'));
  if (ids.length === 0) continue;
  packages.push({ name: pkg.name, dir, ids });
}

const byId = new Map();
for (const pkg of packages) {
  for (const id of pkg.ids) {
    const rows = byId.get(id) ?? [];
    rows.push(pkg);
    byId.set(id, rows);
  }
}
const duplicates = [...byId].filter(([, rows]) => new Set(rows.map(row => row.name)).size > 1);

if (duplicates.length === 0) {
  console.log(`profile check passed (${packages.length} plugin package${packages.length === 1 ? '' : 's'}): ${profileDir}`);
  process.exit(0);
}

console.error(`profile check failed: duplicate plugin insert ids in ${profileDir}`);
for (const [id, rows] of duplicates) {
  console.error(`  ${id}:`);
  for (const row of rows) console.error(`    - ${row.name} (${row.dir})`);
}
process.exit(1);
