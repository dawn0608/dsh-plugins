#!/usr/bin/env node
/**
 * Validate every package under `plugins/` against the repo plugin layout.
 * Run after `npm run build`: the check reads the built `lib/` artifacts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDocument } from 'yaml';

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, '..'));
const pluginsDir = join(root, 'plugins');
const failures = [];
/** Every plugin in this repository uses the owner's npm scope and the dsh- prefix. */
const PACKAGE_SCOPE = '@dawn0608';
const PACKAGE_PREFIX = 'dsh-';

function check(condition, plugin, message) {
  if (!condition) failures.push(`${plugin}: ${message}`);
}

function listTestFiles(dir) {
  const testDir = join(dir, 'test');
  if (!existsSync(testDir)) return [];
  return readdirSync(testDir).filter(name => name.endsWith('.test.mjs'));
}

const plugins = readdirSync(pluginsDir, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(pluginsDir, entry.name, 'package.json')))
  .map(entry => entry.name)
  .sort();

if (plugins.length === 0) {
  console.error('check: plugins/ has no packages');
  process.exit(1);
}

for (const dirName of plugins) {
  const dir = join(pluginsDir, dirName);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const name = typeof pkg.name === 'string' ? pkg.name : dirName;
  const expectedName = `${PACKAGE_SCOPE}/${PACKAGE_PREFIX}${dirName}`;
  check(name === expectedName, dirName, `package name must be ${expectedName}`);

  for (const file of ['package.json', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'README.zh.md', 'LICENSE']) {
    check(existsSync(join(dir, file)), dirName, `missing ${file}`);
  }

  const hostEntry = ['src/index.js', 'src/index.ts'].find(file => existsSync(join(dir, file)));
  check(hostEntry !== undefined, dirName, 'missing src/index.js');

  const clientDeclared = Boolean(pkg.dsh && pkg.dsh.client);
  const clientEntry = ['src/client/index.js', 'src/client/index.ts'].find(file => existsSync(join(dir, file)));
  if (clientDeclared) {
    check(clientEntry !== undefined, dirName, 'dsh.client declared but src/client/index.js is missing');
    check(pkg.exports && pkg.exports['./client'] === './lib/client.js', dirName, 'exports["./client"] must be ./lib/client.js');
    const bundlePath = join(dir, 'lib/client.js');
    check(existsSync(bundlePath), dirName, 'missing lib/client.js (run npm run build)');
    if (existsSync(bundlePath)) {
      const source = readFileSync(bundlePath, 'utf8');
      check(source.includes(`id: ${JSON.stringify(name)}`), dirName, 'client bundle loader id does not match the package name');
      check(/factory\s*:/.test(source), dirName, 'client bundle has no factory');
      check(!/\brequire\s*\(\s*['"]@deepseek-ai\/dsh-client[^'"]*['"]\s*\)/.test(source), dirName, 'client has an unsupported internal Client runtime import');
    }
  } else {
    check(clientEntry === undefined, dirName, 'src/client exists but dsh.client is not declared');
  }

  check(pkg.main === './lib/index.js', dirName, 'main must be ./lib/index.js');
  check(pkg.exports && pkg.exports['.'] === './lib/index.js', dirName, 'exports["."] must be ./lib/index.js');
  check(existsSync(join(dir, 'lib/index.js')), dirName, 'missing lib/index.js (run npm run build)');
  check(pkg.exports && pkg.exports['./locale/*.json'] === './locale/*.json', dirName, 'missing the ./locale/*.json export');
  check(pkg.exports && pkg.exports['./icon'] === './icon.svg', dirName, 'missing the ./icon export');
  check(pkg.exports?.['./cordis.patch.yml'] === './cordis.patch.yml', dirName, 'missing the ./cordis.patch.yml export');
  check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', dirName, 'dsh.bundle.patch must be ./cordis.patch.yml');

  for (const file of ['lib', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md', 'README.zh.md', 'LICENSE']) {
    check(Array.isArray(pkg.files) && pkg.files.includes(file), dirName, `files must include ${file}`);
  }
  const allowedFiles = new Set(['lib', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md', 'README.zh.md', 'LICENSE']);
  for (const file of pkg.files ?? []) check(allowedFiles.has(file), dirName, `unexpected publication path: ${file}`);

  if (existsSync(join(dir, 'cordis.patch.yml'))) {
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8');
    const document = parseDocument(patch);
    check(document.errors.length === 0, dirName, 'cordis.patch.yml is invalid YAML');
    const value = document.errors.length === 0 ? document.toJS() : undefined;
    const rows = Array.isArray(value) ? value.flatMap(block => Array.isArray(block?.insert) ? block.insert : []) : [];
    check(rows.length === 1 && rows[0]?.id === dirName, dirName, `insert id must be ${dirName} in a single bundle row`);
    check(rows[0]?.name === name, dirName, 'cordis.patch.yml does not name the package');
  }

  for (const lang of ['en', 'zh']) {
    const localePath = join(dir, `locale/${lang}.json`);
    if (!existsSync(localePath)) continue;
    const meta = JSON.parse(readFileSync(localePath, 'utf8')).meta;
    check(typeof meta?.title === 'string' && meta.title.trim() !== '', dirName, `locale/${lang}.json is missing meta.title`);
    check(typeof meta?.description === 'string' && meta.description.trim() !== '', dirName, `locale/${lang}.json is missing meta.description`);
    const detail = meta?.detail ?? 'README.md';
    const expectedDetail = lang === 'zh' ? 'README.zh.md' : 'README.md';
    check(detail === expectedDetail && pkg.files?.includes(detail) && existsSync(join(dir, detail)), dirName, `locale/${lang}.json meta.detail must resolve to packaged ${expectedDetail}`);
  }

  const dictionaries = join(dir, 'src/client/i18n.js');
  if (clientDeclared && existsSync(dictionaries)) {
    try {
      const { DICTS } = await import(pathToFileURL(dictionaries).href);
      check(Boolean(DICTS?.en && DICTS?.zh) && JSON.stringify(Object.keys(DICTS.en).sort()) === JSON.stringify(Object.keys(DICTS.zh).sort()), dirName, 'client dictionary keys differ between en and zh');
    } catch (error) {
      check(false, dirName, `cannot read client dictionary: ${error.message}`);
    }
  }

  for (const [command, entry] of Object.entries(typeof pkg.bin === 'object' ? pkg.bin : {})) {
    check(typeof entry === 'string' && entry.startsWith('lib/') && existsSync(join(dir, entry)), dirName, `bin ${command} must point to a built lib/ entry`);
  }

  if (existsSync(join(dir, 'icon.svg'))) {
    check(statSync(join(dir, 'icon.svg')).size <= 256 * 1024, dirName, 'icon.svg exceeds 256 KiB');
    check(readFileSync(join(dir, 'icon.svg'), 'utf8').trimStart().startsWith('<svg'), dirName, 'icon.svg is not an SVG document');
  }

  check(typeof pkg.scripts?.build === 'string', dirName, 'missing scripts.build');
  check(typeof pkg.scripts?.test === 'string', dirName, 'missing scripts.test');
  check(typeof pkg.scripts?.prepack === 'string', dirName, 'missing scripts.prepack');
  check(typeof pkg.engines?.dsh === 'string', dirName, 'missing engines.dsh');
  check(pkg.engines?.node === '>=24', dirName, 'engines.node must be >=24');
  check(listTestFiles(dir).length > 0, dirName, 'test/ has no *.test.mjs');
}

// Local script imports must point at a shipped/source entry, not a removed tool.
function inspectRuntime(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['test', 'node_modules'].includes(entry.name)) continue;
    const file = join(dir, entry.name);
    if (entry.isDirectory()) { inspectRuntime(file); continue; }
    if (!/\.(?:mjs|js)$/.test(entry.name)) continue;
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)["'](\.{1,2}\/[^"']+)["']/g)) {
      check(existsSync(resolve(dirname(file), match[1])), file, `missing local import: ${match[1]}`);
    }
    // These removed entry points must not silently return through a build helper.
    const removed = /sharedSync|deleteShared|dsh-skill-sync-install|skill-sync\.sock|sync-codex-mcp|mcp_sync\.py/;
    check(file === join(root, 'scripts', 'check-plugin.mjs') || !removed.test(source), file, 'removed synchronization entry point');
  }
}
inspectRuntime(join(root, 'scripts'));
for (const name of plugins) inspectRuntime(join(pluginsDir, name, 'src'));

if (failures.length > 0) {
  console.error(`plugin layout check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`plugin layout check passed (${plugins.length}): ${plugins.join(', ')}`);
