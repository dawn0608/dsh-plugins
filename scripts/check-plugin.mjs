#!/usr/bin/env node
/**
 * Validate every package under `plugins/` against the repo plugin layout.
 * Run after `npm run build`: the check reads the built `lib/` artifacts.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
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
    }
  } else {
    check(clientEntry === undefined, dirName, 'src/client exists but dsh.client is not declared');
  }

  check(pkg.main === './lib/index.js', dirName, 'main must be ./lib/index.js');
  check(pkg.exports && pkg.exports['.'] === './lib/index.js', dirName, 'exports["."] must be ./lib/index.js');
  check(existsSync(join(dir, 'lib/index.js')), dirName, 'missing lib/index.js (run npm run build)');
  check(pkg.exports && pkg.exports['./locale/*.json'] === './locale/*.json', dirName, 'missing the ./locale/*.json export');
  check(pkg.exports && pkg.exports['./icon'] === './icon.svg', dirName, 'missing the ./icon export');

  for (const file of ['lib', 'cordis.patch.yml', 'locale', 'icon.svg', 'README.md', 'README.zh.md', 'LICENSE']) {
    check(Array.isArray(pkg.files) && pkg.files.includes(file), dirName, `files must include ${file}`);
  }

  if (existsSync(join(dir, 'cordis.patch.yml'))) {
    const patch = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8');
    check(patch.includes('insert'), dirName, 'cordis.patch.yml has no insert entry');
    check(patch.includes(name), dirName, 'cordis.patch.yml does not name the package');
  }

  for (const lang of ['en', 'zh']) {
    const localePath = join(dir, `locale/${lang}.json`);
    if (!existsSync(localePath)) continue;
    const meta = JSON.parse(readFileSync(localePath, 'utf8')).meta;
    check(typeof meta?.title === 'string' && meta.title.trim() !== '', dirName, `locale/${lang}.json is missing meta.title`);
    check(typeof meta?.description === 'string' && meta.description.trim() !== '', dirName, `locale/${lang}.json is missing meta.description`);
  }

  if (existsSync(join(dir, 'icon.svg'))) {
    check(statSync(join(dir, 'icon.svg')).size <= 256 * 1024, dirName, 'icon.svg exceeds 256 KiB');
    check(readFileSync(join(dir, 'icon.svg'), 'utf8').trimStart().startsWith('<svg'), dirName, 'icon.svg is not an SVG document');
  }

  check(typeof pkg.scripts?.build === 'string', dirName, 'missing scripts.build');
  check(typeof pkg.scripts?.test === 'string', dirName, 'missing scripts.test');
  check(typeof pkg.scripts?.prepack === 'string', dirName, 'missing scripts.prepack');
  check(typeof pkg.engines?.dsh === 'string', dirName, 'missing engines.dsh');
  check(listTestFiles(dir).length > 0, dirName, 'test/ has no *.test.mjs');
}

if (failures.length > 0) {
  console.error(`plugin layout check failed (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`plugin layout check passed (${plugins.length}): ${plugins.join(', ')}`);
