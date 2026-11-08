import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repository = resolve(import.meta.dirname, '../..');
const run = (script, directory) => spawnSync(process.execPath, [join(repository, 'scripts', script), directory], { encoding: 'utf8' });

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-checks-'));
  try {
    const plugin = join(root, 'plugins/example');
    await cp(join(repository, 'templates/plugin'), plugin, { recursive: true });
    await mkdir(join(plugin, 'lib'), { recursive: true });
    await writeFile(join(plugin, 'lib/index.js'), 'export function apply() {}\n');
    await writeFile(join(plugin, 'lib/client.js'), 'window.__ModuleLoader__.load({ id: "@dawn0608/dsh-example", factory: () => ({}) });\n');
    await fn(root, plugin);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('valid plugin and bilingual details pass the layout check', () => fixture(async root => {
  const result = run('check-plugin.mjs', root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /passed \(1\)/);
}));

test('rejects a patch whose insert id differs from its package directory', () => fixture(async (root, plugin) => {
  await writeFile(join(plugin, 'cordis.patch.yml'), '- insert:\n    - id: wrong\n      name: "@dawn0608/dsh-example"\n');
  const result = run('check-plugin.mjs', root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /insert id/);
}));

test('rejects Chinese details pointing at English or an unpackaged document', () => fixture(async (root, plugin) => {
  const file = join(plugin, 'locale/zh.json');
  const locale = JSON.parse(await readFile(file, 'utf8'));
  locale.meta.detail = 'README.md';
  await writeFile(file, JSON.stringify(locale));
  const result = run('check-plugin.mjs', root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta.detail/);
}));

test('rejects runtime imports of internal Client components', () => fixture(async (root, plugin) => {
  await writeFile(join(plugin, 'lib/client.js'), 'window.__ModuleLoader__.load({ id: "@dawn0608/dsh-example", factory: (require) => require("@deepseek-ai/dsh-client-ui-primitives") });');
  const result = run('check-plugin.mjs', root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /runtime import/);
}));

test('rejects missing patch exports and client dictionary mismatches', () => fixture(async (root, plugin) => {
  const file = join(plugin, 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  delete pkg.exports['./cordis.patch.yml'];
  await writeFile(file, JSON.stringify(pkg));
  await writeFile(join(plugin, 'src/client/i18n.js'), 'export const DICTS = { en: { title: "Title" }, zh: {} };');
  const result = run('check-plugin.mjs', root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cordis.patch.yml/);
  assert.match(result.stderr, /dictionary/);
}));

test('detects duplicate insert ids even when aliases contain the same package name', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-profile-check-'));
  try {
    await writeFile(join(root, 'package.json'), '{"private":true}');
    for (const alias of ['original', 'alias']) {
      const dir = join(root, 'node_modules', alias);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@dawn0608/dsh-example' }));
      await writeFile(join(dir, 'cordis.patch.yml'), '- insert:\n    - id: example\n      name: "@dawn0608/dsh-example"\n');
    }
    const result = run('check-profile.mjs', root);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /duplicate plugin insert ids/);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('rejects source or secret files in the publication allowlist', () => fixture(async (root, plugin) => {
  const file = join(plugin, 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  pkg.files.push('src', '.env');
  await writeFile(file, JSON.stringify(pkg));
  const result = run('check-plugin.mjs', root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unexpected publication path/);
}));
