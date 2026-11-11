import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createCoordinator } from '../src/sync-daemon.js';
import { ensureSharedPolicy, policyFile, readSharedPolicy, setSharedEnabled } from '../src/shared-policy.js';
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
  const sync = await createCoordinator({
    home, agentsHome, claudeHome, codexHome,
    writeSkill: async () => assert.fail('no Codex writes allowed'),
    writeClaude: async () => assert.fail('no Claude settings writes allowed'),
  });
  const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
  const state = async () => (await readSyncState(home)).entries[path];
  return { home, agentsHome, codexHome, path, body, claude, claudeHome, workspace, local, sync, setCodex, readJson, state };
}

test('each app keeps its switches through content edits and daemon restarts', async t => {
  const f = await fixture(t);
  await f.setCodex(false);
  await writeFile(f.claude, '{"skillOverrides":{"shared":"off"}}');
  await writeFile(f.local, '{"skillOverrides":{"shared":"on"}}');
  const paths = [join(f.codexHome, 'config.toml'), f.claude, f.local];
  const before = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  await f.sync();
  assert.equal((await readSharedPolicy(f.home)).entries[f.path], undefined);
  await setSharedEnabled(f.home, f.path, false);
  await writeFile(f.path, f.body + 'updated');
  const restart = await createCoordinator(f);
  await restart();
  assert.deepEqual(await Promise.all(paths.map(path => readFile(path, 'utf8'))), before);
  assert.equal((await readSharedPolicy(f.home)).entries[f.path], false);
  assert.equal(await readFile(join(f.claudeHome, 'skills', 'shared', 'SKILL.md'), 'utf8'), f.body + 'updated');
  await setSharedEnabled(f.home, f.path, true);
  await restart();
  assert.deepEqual(await Promise.all(paths.map(path => readFile(path, 'utf8'))), before);
});

test('preserves effective Harness policy once without replaying old pending operations', async t => {
  const f = await fixture(t);
  await writeFile(join(syncDirectory(f.home), 'state.json'), JSON.stringify({ version: 1,
    projects: { '/nonexistent-worktree': {} }, entries: { [f.path]: {
      name: 'shared', enabled: true, codex: true, claude: 'off', pending: true, policyEnabled: false,
    } } }));
  const before = await readFile(f.claude);
  await f.sync();
  assert.equal((await readSharedPolicy(f.home)).entries[f.path], false);
  assert.equal((await readSyncState(f.home)).version, 2);
  assert.equal((await f.state()).pending, undefined);
  assert.deepEqual(await readFile(f.claude), before);
  await setSharedEnabled(f.home, f.path, true);
  await f.sync();
  assert.equal((await readSharedPolicy(f.home)).entries[f.path], true);
});

test('Harness local policy works without a running sync daemon and retains preview', async t => {
  const f = await fixture(t);
  let provider;
  t.after(registerSharedPolicy({ registerProvider(make) {
    provider = make({ invalidate() {} }); return () => {};
  } }, f.home, f.agentsHome));
  await setSharedEnabled(f.home, f.path, false);
  const [entry] = await provider.list();
  assert.deepEqual(entry.invocation, { userInvocable: false, modelInvocable: false });
  assert.equal((await provider.get(entry)).content, 'Fixture body');
  await setSharedEnabled(f.home, f.path, true);
  assert.deepEqual(await provider.list(), []);
});

test('source deletion and rename remove only unchanged service-owned links', async t => {
  const f = await fixture(t);
  await f.sync();
  const link = join(f.claudeHome, 'skills', 'shared');
  await rename(dirname(f.path), join(f.agentsHome, 'skills', 'renamed'));
  await writeFile(join(f.agentsHome, 'skills', 'renamed', 'SKILL.md'), f.body.replace('name: shared', 'name: renamed'));
  await f.sync();
  await assert.rejects(lstat(link), { code: 'ENOENT' });
  assert.equal(await readlink(join(f.claudeHome, 'skills', 'renamed')), join(f.agentsHome, 'skills', 'renamed'));
  await rm(join(f.agentsHome, 'skills', 'renamed'), { recursive: true });
  await f.sync();
  await assert.rejects(lstat(join(f.claudeHome, 'skills', 'renamed')), { code: 'ENOENT' });
  assert.deepEqual((await readSyncState(f.home)).entries, {});
});

for (const kind of ['preexisting', 'replaced']) test(`preserves ${kind} links on source deletion`, async t => {
  const f = await fixture(t), link = join(f.claudeHome, 'skills', 'shared');
  if (kind === 'preexisting') await symlink(dirname(f.path), link);
  await f.sync();
  if (kind === 'replaced') {
    await rename(link, link + '.original');
    await symlink(dirname(f.path), link);
  }
  await rm(dirname(f.path), { recursive: true });
  await f.sync();
  assert.ok((await lstat(link)).isSymbolicLink());
});

test('invalid source and unavailable root retain links and local policy and recover', async t => {
  const f = await fixture(t);
  await f.sync(); await setSharedEnabled(f.home, f.path, false);
  await writeFile(f.path, 'incomplete skill'); await f.sync();
  assert.equal((await f.state()).error, 'unavailable');
  assert.equal((await readSyncState(f.home)).health.status, 'degraded');
  const root = join(f.agentsHome, 'skills');
  await rename(root, root + '.away');
  await assert.rejects(f.sync(), { code: 'unavailable' });
  assert.equal((await readSharedPolicy(f.home)).entries[f.path], false);
  assert.equal(await readlink(join(f.claudeHome, 'skills', 'shared')), dirname(f.path));
  await rename(root + '.away', root); await writeFile(f.path, f.body); await f.sync();
  assert.equal((await readSyncState(f.home)).health.status, 'ok');
});

test('one local name collision does not block another valid shared skill', async t => {
  const f = await fixture(t);
  const collision = join(f.claudeHome, 'skills', 'shared');
  await mkdir(collision); await writeFile(join(collision, 'SKILL.md'), 'private');
  const second = join(f.agentsHome, 'skills', 'second'); await mkdir(second);
  await writeFile(join(second, 'SKILL.md'), f.body.replace('name: shared', 'name: second'));
  await f.sync();
  assert.equal((await f.state()).error, 'conflict');
  assert.equal(await readFile(join(collision, 'SKILL.md'), 'utf8'), 'private');
  assert.equal(await readlink(join(f.claudeHome, 'skills', 'second')), second);
});

test('missing or invalid native configuration no longer gates shared links', async t => {
  const f = await fixture(t);
  await rm(join(f.codexHome, 'config.toml')); await writeFile(f.claude, '{invalid');
  await f.sync(); assert.equal((await readSyncState(f.home)).health.status, 'ok');
  assert.equal(await readFile(f.claude, 'utf8'), '{invalid');
});

test('configured source directory links resolve without losing ownership', async t => {
  const f = await fixture(t), root = join(f.agentsHome, 'skills'), target = join(f.agentsHome, 'source');
  await rename(root, target); await symlink(target, root, 'dir'); await f.sync();
  assert.equal(await readlink(join(f.claudeHome, 'skills', 'shared')), join(target, 'shared'));
});

test('concurrent local changes are rejected without losing another skill choice', async t => {
  const f = await fixture(t); await ensureSharedPolicy(f.home);
  const results = await Promise.allSettled([setSharedEnabled(f.home, f.path, false), setSharedEnabled(f.home, f.path+'2', false)]);
  for (let i=0;i<results.length;i++) if (results[i].status === 'rejected') {
    assert.equal(results[i].reason.code, 'conflict'); await setSharedEnabled(f.home, f.path+(i?'2':''), false);
  }
  assert.deepEqual((await readSharedPolicy(f.home)).entries, { [f.path]:false, [f.path+'2']:false });
  await writeFile(policyFile(f.home), '{invalid');
  await assert.rejects(setSharedEnabled(f.home, f.path, true));
  assert.equal(await readFile(policyFile(f.home), 'utf8'), '{invalid');
});

test('unknown state schema is not replaced with an empty policy or catalog', async t => {
  const f = await fixture(t), statePath = join(syncDirectory(f.home), 'state.json');
  const entries = { [f.path]: { name: 'shared', policyEnabled: false } };
  await writeFile(statePath, JSON.stringify({ version: 99, entries }));
  await assert.rejects(f.sync(), { code: 'unavailable' });
  assert.equal((await f.readJson(statePath)).version, 99);
  assert.deepEqual((await f.readJson(statePath)).entries, entries);
  await assert.rejects(lstat(policyFile(f.home)), { code: 'ENOENT' });
});
