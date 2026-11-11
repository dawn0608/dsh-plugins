import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('bundles a standalone Host and licenses while clearing stale build artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-build-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@dawn0608/dsh-example', type: 'module' }));
    await mkdir(join(root, 'node_modules/example-dep'), { recursive: true });
    await writeFile(join(root, 'node_modules/example-dep/package.json'), JSON.stringify({ name: 'example-dep', version: '1.0.0', type: 'module', main: 'index.js', license: 'MIT' }));
    await writeFile(join(root, 'node_modules/example-dep/index.js'), 'export const result = 42;');
    await writeFile(join(root, 'node_modules/example-dep/LICENSE'), 'Copyright Example. Permission to redistribute.');
    await writeFile(join(root, 'src/index.js'), 'export { result } from "example-dep"; export function apply() {}');
    await mkdir(join(root, 'lib'));
    await writeFile(join(root, 'lib/stale.js'), 'obsolete');
    const build = spawnSync(process.execPath, [resolve(import.meta.dirname, '../build-plugin.mjs'), root], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    await rm(join(root, 'src'), { recursive: true });
    assert.match(await readFile(join(root, 'lib/THIRD_PARTY_NOTICES.md'), 'utf8'), /example-dep@1.0.0[\s\S]*Copyright Example/);
    await rm(join(root, 'node_modules'), { recursive: true });
    const run = spawnSync(process.execPath, ['--input-type=module', '--eval', `import { result } from ${JSON.stringify(pathToFileURL(join(root, 'lib/index.js')).href)}; console.log(result);`], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '42\n');
    assert.ok(!(await readdir(join(root, 'lib'))).includes('stale.js'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
