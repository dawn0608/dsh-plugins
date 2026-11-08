import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createCoordinator } from '../src/sync-daemon.js';
import { readSyncState, registerSharedPolicy, syncDirectory } from '../src/shared-sync.js';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-shared-sync-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'dsh');
  const agentsHome = join(root, 'agents');
  const codexHome = join(root, 'codex');
  const claudeHome = join(root, 'claude');
  const path = join(agentsHome, 'skills', 'shared', 'SKILL.md');
  const workspace = join(root, 'workspace');
  const local = join(workspace, '.claude', 'settings.local.json');
  const body = '---\nname: shared\ndescription: Shared test skill\n---\nFixture body\n';
  for (const dir of [dirname(path), codexHome, claudeHome, dirname(local), syncDirectory(home)]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }
  await writeFile(path, body);
  const setCodex = enabled => writeFile(join(codexHome, 'config.toml'),
    enabled ? 'model = "fixture"\n' : 'model = "fixture"\n[[skills.config]]\npath = ' + JSON.stringify(path) + '\nenabled = false\n');
  const claude = join(claudeHome, 'settings.json');
  await setCodex(true);
  await writeFile(claude, '{"permissions":{"deny":["Bash(private)"]}}\n');
  let fail = false;
  const sync = await createCoordinator({
    home, agentsHome, claudeHome, codexHome,
    writeSkill: async (binary, directory, target, enabled) => {
      assert.equal(directory, codexHome);
      assert.equal(target, path);
      if (fail) throw Error('isolated writer unavailable');
      await setCodex(enabled);
    },
  });
  const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
  const state = async () => (await readSyncState(home)).entries[path];
  return { home, agentsHome, path, body, claude, claudeHome, workspace, local, sync, setCodex, readJson, state,
    fail: value => { fail = value; } };
}

test('syncs all three inputs and absorbs only the Claude local shared-skill change', async t => {
  const f = await fixture(t);
  await writeFile(f.local, '{"skillOverrides":{"private":"off"},"other":42}');
  await f.sync({ type: 'enroll', cwd: f.workspace });
  assert.equal(await readlink(join(f.claudeHome, 'skills', 'shared')), dirname(f.path));
  assert.equal((await f.state()).enabled, true);

  await f.setCodex(false);
  await f.sync();
  assert.equal((await f.state()).enabled, false);
  assert.equal((await f.readJson(f.claude)).skillOverrides.shared, 'off');

  await writeFile(f.local, '{"skillOverrides":{"private":"off","shared":"on"},"other":42}');
  await f.sync();
  assert.equal((await f.state()).enabled, true);
  assert.deepEqual(await f.readJson(f.local), { skillOverrides: { private: 'off' }, other: 42 });

  await f.sync({ type: 'set', path: f.path, enabled: false });
  await f.sync();
  assert.equal((await f.state()).enabled, false);
  assert.deepEqual(await f.readJson(f.claude), {
    permissions: { deny: ['Bash(private)'] }, skillOverrides: { shared: 'off' },
  });
  await f.sync({ type: 'set', path: f.path, enabled: true });
  assert.equal((await f.state()).enabled, true);
  assert.equal(await readFile(f.path, 'utf8'), f.body);
});

test('retries an incomplete write and preserves a private Claude same-name entry', async t => {
  const f = await fixture(t);
  await f.sync();
  f.fail(true);
  await assert.rejects(f.sync({ type: 'set', path: f.path, enabled: false }), { code: 'unavailable' });
  assert.equal((await f.state()).error, 'unavailable');
  f.fail(false);
  await f.sync();
  assert.equal((await f.state()).enabled, false);
  assert.equal((await f.state()).error, undefined);
  const link = join(f.claudeHome, 'skills', 'shared');
  await rm(link);
  await mkdir(link);
  await writeFile(join(link, 'SKILL.md'), 'private contents');
  await assert.rejects(f.sync({ type: 'set', path: f.path, enabled: true }), { code: 'conflict' });
  assert.equal(await readFile(join(link, 'SKILL.md'), 'utf8'), 'private contents');
  await rm(dirname(f.path), { recursive: true });
  await f.sync();
  assert.equal((await lstat(link)).isDirectory(), true);
});

test('Harness policy contributes only disabled shared files and keeps them previewable', async t => {
  const f = await fixture(t);
  await f.sync();
  let provider;
  const unregister = registerSharedPolicy({
    registerProvider(make) { provider = make({ invalidate() {} }); return () => {}; },
  }, f.home, f.agentsHome);
  t.after(unregister);
  assert.deepEqual(await provider.list(), []);
  await f.setCodex(false);
  await f.sync();
  const [candidate] = await provider.list();
  assert.deepEqual(candidate.invocation, { userInvocable: false, modelInvocable: false });
  assert.equal(candidate.source, 'user-agents');
  assert.equal((await provider.get(candidate)).content, 'Fixture body');
  await f.setCodex(true);
  await f.sync();
  assert.deepEqual(await provider.list(), []);
});
