import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { withProfileLock } from '../src/atomic.js';
import { PatchError } from '../src/errors.js';
import { createStore, resolveProfile, stateFromText } from '../src/store.js';

const FIXTURE = readFileSync(new URL('./fixtures/patch.yml', import.meta.url), 'utf8');

function profile() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-manager-store-'));
  const patchPath = join(dir, 'cordis.patch.yml');
  writeFileSync(patchPath, FIXTURE, { mode: 0o600 });
  const create = () => ({ dir, patchPath, profile: 'desktop' });
  const store = createStore({
    profile: create,
    lockTimeoutMs: 50,
    log: () => {},
  });
  return {
    dir,
    patchPath,
    store,
    text: () => readFileSync(patchPath, 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function conflict(error) {
  return error instanceof PatchError && error.code === 'conflict';
}

test('resolves the profile patch from the environment and explicit config', () => {
  assert.deepEqual(resolveProfile({ env: { DSH_PROFILE_DIR: join(tmpdir(), 'profile'), DSH_PROFILE: 'desktop' } }), {
    dir: join(tmpdir(), 'profile'),
    patchPath: join(tmpdir(), 'profile', 'cordis.patch.yml'),
    profile: 'desktop',
  });
  assert.equal(
    resolveProfile({ env: { DSH_HOME: join(tmpdir(), 'home'), DSH_PROFILE: 'web' } }).patchPath,
    join(tmpdir(), 'home', 'profiles', 'web', 'cordis.patch.yml'),
  );
  assert.throws(() => resolveProfile({ env: {} }), error => error.code === 'profile-unavailable');
  assert.throws(() => resolveProfile({ env: {}, patchPath: 'relative.yml' }), error => error.code === 'profile-unavailable');
});

const HOST_PROFILE = { name: 'web-isolated', dir: join(tmpdir(), 'host-profile'), patchPath: join(tmpdir(), 'host-profile', 'patch.yml') };

test('uses the host profile context when the CLI supplies no profile environment or argument', t => {
  t.mock.property(process, 'argv', ['node', 'dsh', 'web']);
  assert.deepEqual(resolveProfile({ env: {}, profileContext: HOST_PROFILE }), {
    dir: HOST_PROFILE.dir,
    patchPath: HOST_PROFILE.patchPath,
    profile: HOST_PROFILE.name,
  });
});

test('prefers the explicit patch path over host context and host context over environment', () => {
  const env = { DSH_PROFILE_DIR: join(tmpdir(), 'env-profile'), DSH_PROFILE: 'env-profile' };
  assert.deepEqual(resolveProfile({ env, profileContext: HOST_PROFILE }), {
    dir: HOST_PROFILE.dir,
    patchPath: HOST_PROFILE.patchPath,
    profile: HOST_PROFILE.name,
  });
  assert.deepEqual(resolveProfile({ env, profileContext: HOST_PROFILE, patchPath: join(tmpdir(), 'custom', 'patch.yml') }), {
    dir: join(tmpdir(), 'custom'),
    patchPath: join(tmpdir(), 'custom', 'patch.yml'),
    profile: 'env-profile',
  });
  assert.throws(
    () => resolveProfile({ env, profileContext: HOST_PROFILE, patchPath: 'relative.yml' }),
    { code: 'profile-unavailable' },
  );
  assert.equal(resolveProfile({
    env,
    profileContext: { ...HOST_PROFILE, patchPath: 'relative.yml' },
  }).patchPath, join(tmpdir(), 'env-profile', 'cordis.patch.yml'));
});

test('finds the profile directory the desktop launcher passes as an argument', () => {
  const space = profile();
  const original = process.argv;
  try {
    writeFileSync(join(space.dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-desktop', dsh: { profile: { bundles: [] } } }));
    process.argv = ['node', '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh', space.dir];
    assert.deepEqual(resolveProfile({ env: {} }), {
      dir: space.dir,
      patchPath: join(space.dir, 'cordis.patch.yml'),
      profile: basename(space.dir),
    });
  } finally {
    process.argv = original;
    space.cleanup();
  }
});

test('reads the patch as an actionable state without configuration details', async () => {
  const space = profile();
  try {
    const state = await space.store.readState();
    assert.equal(state.ok, true);
    assert.deepEqual(state.servers.map(server => server.name), ['docs', 'local', 'off']);
    assert.equal(state.servers[2].enabled, false);
    assert.ok(state.servers.every(server => !Object.hasOwn(server, 'config')));
    assert.doesNotMatch(JSON.stringify(state), /docs\.example\.com|DOCS_TOKEN|JAVA_HOME|\/usr\/bin\/env/);
    assert.equal(typeof state.servers[0].rowHash, 'string');
  } finally {
    space.cleanup();
  }
});

test('a toggle to the existing value leaves the patch file untouched', async t => {
  const space = profile();
  t.after(space.cleanup);
  const before = await space.store.readState();
  const inode = statSync(space.patchPath, { bigint: true }).ino;
  const [docs] = before.servers;
  const after = await space.store.setEnabled({ action: 'setEnabled', id: docs.id, rowHash: docs.rowHash, enabled: true });
  assert.deepEqual(after, before);
  assert.equal(statSync(space.patchPath, { bigint: true }).ino, inode);
});

test('locks the host profile directory even when the patch file has a different parent', async t => {
  const space = profile();
  t.after(space.cleanup);
  const folder = join(space.dir, 'nested');
  const patchPath = join(folder, 'patch.yml');
  mkdirSync(folder);
  writeFileSync(patchPath, FIXTURE);
  const store = createStore({
    profile: () => ({ dir: space.dir, patchPath, profile: 'isolated' }),
    lockTimeoutMs: 1,
    log: () => {},
  });
  const [target] = (await store.readState()).servers;
  await withProfileLock(space.dir, async () => {
    await assert.rejects(store.setEnabled({ id: target.id, rowHash: target.rowHash, enabled: false }), { code: 'locked' });
  });
  assert.equal(readFileSync(patchPath, 'utf8'), FIXTURE);
});

test('local toggles leave other applications’ configuration byte-for-byte unchanged', async t => {
  const space = profile();
  t.after(space.cleanup);
  const otherFiles = ['.claude.json', '.codex/config.toml', '.claude/settings.json'];
  for (const file of otherFiles) {
    const path = join(space.dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `unrelated ${file}\n`);
  }
  const original = otherFiles.map(file => readFileSync(join(space.dir, file)));
  const [row] = (await space.store.readState()).servers;
  await space.store.setEnabled({ id: row.id, rowHash: row.rowHash, enabled: false });
  assert.equal(typeof space.store.deleteShared, 'undefined');
  assert.ok((await space.store.readState()).servers.every(row => !('sharedRemovable' in row)));
  for (const [index, file] of otherFiles.entries()) assert.deepEqual(readFileSync(join(space.dir, file)), original[index]);
});
