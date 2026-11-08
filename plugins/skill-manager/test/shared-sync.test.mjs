import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createCoordinator } from '../src/sync-daemon.js';
import { readSyncState, registerSharedPolicy, syncDirectory } from '../src/shared-sync.js';

async function fixture(t, options = {}) {
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
    home, agentsHome, claudeHome, codexHome, ...options,
    writeSkill: async (binary, directory, target, enabled) => {
      assert.equal(directory, codexHome);
      assert.equal(target, path);
      if (fail) throw Error('isolated writer unavailable');
      await setCodex(enabled);
    },
  });
  const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
  const state = async () => (await readSyncState(home)).entries[path];
  return { home, agentsHome, codexHome, path, body, claude, claudeHome, workspace, local, sync, setCodex, readJson, state,
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


test('records each successful destination before retry and preserves newer external Codex choice', async t => {
  const f = await fixture(t, { writeClaude: async () => { throw Error('isolated Claude failure'); } });
  await f.sync();
  await assert.rejects(f.sync({ type: 'set', path: f.path, enabled: false }), { code: 'unavailable' });
  assert.equal((await f.state()).codex, false);
  assert.equal((await f.state()).pending, true);
  await f.setCodex(true);
  await f.sync();
  assert.equal((await f.state()).error, 'conflict');
  assert.equal((await f.state()).enabled, false);
  assert.equal(await readFile(join(f.codexHome, 'config.toml'), 'utf8'), 'model = "fixture"\n');
  await f.sync();
  assert.equal((await f.state()).error, 'conflict');
  await f.sync({ type: 'set', path: f.path, enabled: true });
  assert.equal((await f.state()).error, undefined);
  assert.equal((await f.state()).enabled, true);
});

test('pending retries preserve newer external Claude choice and disabled Harness policy', async t => {
  const f = await fixture(t);
  await f.sync();
  f.fail(true);
  await assert.rejects(f.sync({ type: 'set', path: f.path, enabled: false }), { code: 'unavailable' });
  await writeFile(f.claude, '{"skillOverrides":{"shared":"on"}}');
  f.fail(false);
  await f.sync();
  assert.equal((await f.state()).error, 'conflict');
  assert.equal((await f.readJson(f.claude)).skillOverrides.shared, 'on');
  assert.equal((await f.state()).enabled, false);
});

test('preexisting correct links and legacy ownership claims are never deleted', async t => {
  const f = await fixture(t);
  const link = join(f.claudeHome, 'skills', 'shared');
  await symlink(dirname(f.path), link);
  await f.sync();
  assert.equal((await f.state()).linkOwned, false);
  const state = await readSyncState(f.home);
  state.entries[f.path].linkOwned = true;
  delete state.entries[f.path].linkIdentity;
  await writeFile(join(syncDirectory(f.home), 'state.json'), JSON.stringify(state));
  await rm(dirname(f.path), { recursive: true });
  await f.sync();
  assert.equal((await lstat(link)).isSymbolicLink(), true);
});

test('only deletes its original link, preserving a same-target replacement', async t => {
  const f = await fixture(t);
  await f.sync();
  const link = join(f.claudeHome, 'skills', 'shared');
  await rm(link);
  await symlink(dirname(f.path), link);
  await rm(dirname(f.path), { recursive: true });
  await f.sync();
  assert.equal((await lstat(link)).isSymbolicLink(), true);
});

test('persists coordinator failures and success timestamps without clearing disabled entries', async t => {
  const f = await fixture(t);
  await f.sync({ type: 'set', path: f.path, enabled: false });
  const before = await readSyncState(f.home);
  assert.equal(before.health.status, 'ok');
  assert.ok(Date.parse(before.health.lastSuccessAt));
  await writeFile(join(f.codexHome, 'config.toml'), '[invalid');
  await assert.rejects(f.sync());
  const failed = await readSyncState(f.home);
  assert.equal(failed.health.status, 'unavailable');
  assert.equal(failed.health.lastSuccessAt, before.health.lastSuccessAt);
  assert.equal(failed.entries[f.path].enabled, false);
  await f.setCodex(false);
  await f.sync();
  assert.equal((await readSyncState(f.home)).health.status, 'ok');
});

test('removes an unchanged service-owned link when its shared skill disappears', async t => {
  const f = await fixture(t);
  await f.sync();
  await rm(dirname(f.path), { recursive: true });
  await f.sync();
  await assert.rejects(lstat(join(f.claudeHome, 'skills', 'shared')), { code: 'ENOENT' });
});


test('restarts from the Codex checkpoint and completes the failed Claude destination', async t => {
  const f = await fixture(t, { writeClaude: async () => { throw Error('isolated Claude failure'); } });
  await f.sync();
  await assert.rejects(f.sync({ type: 'set', path: f.path, enabled: false }), { code: 'unavailable' });
  const restarted = await createCoordinator({ home: f.home, agentsHome: f.agentsHome, claudeHome: f.claudeHome,
    codexHome: f.codexHome, writeSkill: async () => { assert.fail('confirmed Codex destination must not be rewritten'); } });
  await restarted();
  assert.equal((await f.readJson(f.claude)).skillOverrides.shared, 'off');
  assert.equal((await f.state()).pending, undefined);
  assert.equal((await f.state()).error, undefined);
  assert.equal((await readSyncState(f.home)).health.status, 'ok');
});
