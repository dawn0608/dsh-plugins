import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('builds and marks declared CLI entries executable without a source checkout at runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-build-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@dawn0608/dsh-example', type: 'module', bin: { 'example-install': 'lib/install.js' } }));
    await mkdir(join(root, 'node_modules/example-dep'), { recursive: true });
    await writeFile(join(root, 'node_modules/example-dep/package.json'), JSON.stringify({ name: 'example-dep', version: '1.0.0', type: 'module', main: 'index.js', license: 'MIT' }));
    await writeFile(join(root, 'node_modules/example-dep/index.js'), 'export const result = 42;');
    await writeFile(join(root, 'node_modules/example-dep/LICENSE'), 'Copyright Example. Permission to redistribute.');
    await writeFile(join(root, 'src/index.js'), 'export { result } from "example-dep"; export function apply() {}');
    await writeFile(join(root, 'src/worker.js'), 'export const value = "standalone";');
    await writeFile(join(root, 'src/install.js'), '#!/usr/bin/env node\nimport { value } from "./worker.js"; console.log(value);');
    const build = spawnSync(process.execPath, [resolve(import.meta.dirname, '../build-plugin.mjs'), root, '--entry', 'src/worker.js', '--entry', 'src/install.js'], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    await rm(join(root, 'src'), { recursive: true });
    assert.match(await readFile(join(root, 'lib/THIRD_PARTY_NOTICES.md'), 'utf8'), /example-dep@1.0.0[\s\S]*Copyright Example/);
    const run = spawnSync(process.execPath, [join(root, 'lib/install.js')], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, 'standalone\n');
    assert.ok((await stat(join(root, 'lib/install.js'))).mode & 0o111);
    assert.match(await readFile(join(root, 'lib/install.js'), 'utf8'), /^#!\/usr\/bin\/env node/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
