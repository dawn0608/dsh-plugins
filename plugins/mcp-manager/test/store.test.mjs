import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    countTools: name => (name === 'docs' ? 2 : name === 'local' ? 1 : 0),
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
  assert.deepEqual(resolveProfile({ env: { DSH_PROFILE_DIR: '/tmp/profile', DSH_PROFILE: 'desktop' } }), {
    dir: '/tmp/profile',
    patchPath: '/tmp/profile/cordis.patch.yml',
    profile: 'desktop',
  });
  assert.equal(
    resolveProfile({ env: { DSH_HOME: '/tmp/home', DSH_PROFILE: 'web' } }).patchPath,
    '/tmp/home/profiles/web/cordis.patch.yml',
  );
  assert.throws(() => resolveProfile({ env: {} }), error => error.code === 'profile-unavailable');
  assert.throws(() => resolveProfile({ env: {}, patchPath: 'relative.yml' }), error => error.code === 'profile-unavailable');
});

const HOST_PROFILE = { name: 'web-isolated', dir: '/tmp/host-profile', patchPath: '/tmp/host-profile/patch.yml' };

test('uses the host profile context when the CLI supplies no profile environment or argument', t => {
  t.mock.property(process, 'argv', ['node', 'dsh', 'web']);
  assert.deepEqual(resolveProfile({ env: {}, profileContext: HOST_PROFILE }), {
    dir: HOST_PROFILE.dir,
    patchPath: HOST_PROFILE.patchPath,
    profile: HOST_PROFILE.name,
  });
});

test('prefers the explicit patch path over host context and host context over environment', () => {
  const env = { DSH_PROFILE_DIR: '/tmp/env-profile', DSH_PROFILE: 'env-profile' };
  assert.deepEqual(resolveProfile({ env, profileContext: HOST_PROFILE }), {
    dir: HOST_PROFILE.dir,
    patchPath: HOST_PROFILE.patchPath,
    profile: HOST_PROFILE.name,
  });
  assert.deepEqual(resolveProfile({ env, profileContext: HOST_PROFILE, patchPath: '/tmp/custom/patch.yml' }), {
    dir: '/tmp/custom',
    patchPath: '/tmp/custom/patch.yml',
    profile: 'env-profile',
  });
  assert.throws(
    () => resolveProfile({ env, profileContext: HOST_PROFILE, patchPath: 'relative.yml' }),
    { code: 'profile-unavailable' },
  );
  assert.equal(resolveProfile({
    env,
    profileContext: { ...HOST_PROFILE, patchPath: 'relative.yml' },
  }).patchPath, '/tmp/env-profile/cordis.patch.yml');
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
      profile: space.dir.split('/').at(-1),
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
    assert.equal(state.profile, 'desktop');
    assert.equal(state.patchPath, space.patchPath);
    assert.match(state.revision, /^[a-f0-9]{64}$/);
    assert.deepEqual(state.servers.map(server => server.name), ['docs', 'local', 'off']);
    assert.equal(state.servers[0].tools, 2);
    assert.equal(state.servers[2].enabled, false);
    assert.equal(state.servers[0].deletable, true);
    assert.ok(state.servers.every(server => !Object.hasOwn(server, 'config')));
    assert.doesNotMatch(JSON.stringify(state), /docs\.example\.com|DOCS_TOKEN|JAVA_HOME|\/usr\/bin\/env/);
    assert.equal(typeof state.servers[0].rowHash, 'string');
    assert.deepEqual(state.warnings, []);
  } finally {
    space.cleanup();
  }
});

test('keeps a literal secret on an unrelated save without exposing it in the response', async () => {
  const space = profile();
  try {
    writeFileSync(space.patchPath, FIXTURE.replace("        X-Trace: !!js 'process.env.TRACE_TOKEN'", '        X-Api-Key: "plain-text-secret"'), { mode: 0o600 });
    const state = await space.store.readState();
    const docs = state.servers.find(server => server.name === 'docs');
    assert.ok(!JSON.stringify(state).includes('plain-text-secret'));

    const saved = await space.store.save({
      action: 'save',
      mode: 'edit',
      id: docs.id,
      name: docs.name,
      rowHash: docs.rowHash,
      draft: {
        name: 'docs',
        transport: 'streamable-http',
        enabled: true,
        url: 'https://docs2.example.com/mcp',
        headers: [
          { key: 'Authorization', mode: 'ref', variable: 'DOCS_TOKEN', prefix: 'Bearer ' },
          { key: 'X-Api-Key', mode: 'keep' },
        ],
      },
    });
    assert.ok(saved.servers.every(server => !Object.hasOwn(server, 'config')));
    assert.ok(space.text().includes('https://docs2.example.com/mcp'));
    assert.ok(space.text().includes('plain-text-secret'));
  } finally {
    space.cleanup();
  }
});

test('adds, edits, disables and deletes through the lock-protected store', async () => {
  const space = profile();
  try {
    const added = await space.store.save({
      action: 'save',
      mode: 'add',
      draft: {
        name: 'panel-test',
        transport: 'stdio',
        enabled: true,
        command: '/opt/homebrew/opt/node@24/bin/node',
        args: ['/tmp/echo.mjs'],
        env: [{ key: 'PANEL_TOKEN', mode: 'ref', variable: 'PANEL_TEST_TOKEN' }],
      },
    });
    const created = added.servers.find(server => server.name === 'panel-test');
    assert.ok(created);
    assert.equal(created.tools, 0);
    assert.match(space.text(), /PANEL_TOKEN: !!js 'process\.env\.PANEL_TEST_TOKEN'/);

    const edited = await space.store.save({
      action: 'save',
      mode: 'edit',
      id: created.id,
      name: created.name,
      rowHash: created.rowHash,
      draft: {
        name: 'panel-test',
        transport: 'stdio',
        enabled: true,
        command: '/opt/homebrew/opt/node@24/bin/node',
        args: ['/tmp/echo.mjs', '--edited'],
        env: [{ key: 'PANEL_TOKEN', mode: 'ref', variable: 'PANEL_TEST_TOKEN' }],
      },
    });
    assert.match(space.text(), /- "--edited"/);

    const current = edited.servers.find(server => server.name === 'panel-test');
    const disabled = await space.store.setEnabled({
      action: 'setEnabled',
      id: current.id,
      name: current.name,
      rowHash: current.rowHash,
      enabled: false,
    });
    assert.equal(disabled.servers.find(server => server.name === 'panel-test').enabled, false);

    const off = disabled.servers.find(server => server.name === 'panel-test');
    const deleted = await space.store.remove({
      action: 'delete',
      id: off.id,
      name: off.name,
      rowHash: off.rowHash,
    });
    assert.ok(!deleted.servers.some(server => server.name === 'panel-test'));
    assert.equal(space.text(), FIXTURE);
  } finally {
    space.cleanup();
  }
});

test('rejects a stale row fingerprint without touching the file', async () => {
  const space = profile();
  try {
    const state = await space.store.readState();
    const docs = state.servers.find(server => server.name === 'docs');
    writeFileSync(space.patchPath, space.text().replace('serverName: docs', 'serverName: docs'), { mode: 0o600 });
    await assert.rejects(space.store.save({
      action: 'save',
      mode: 'edit',
      id: docs.id,
      name: docs.name,
      rowHash: 'stale',
      draft: { name: 'docs', transport: 'streamable-http', enabled: true, url: 'https://x.example.com/mcp', headers: [] },
    }), conflict);
    assert.equal(space.text(), FIXTURE);
  } finally {
    space.cleanup();
  }
});

test('rejects a duplicate add and reports field errors', async () => {
  const space = profile();
  try {
    await assert.rejects(space.store.save({
      action: 'save',
      mode: 'add',
      draft: { name: 'docs', transport: 'stdio', enabled: true, command: '/bin/echo' },
    }), error => error.name === 'DraftError' && error.errors.some(item => item.code === 'duplicate'));
    assert.equal(space.text(), FIXTURE);
  } finally {
    space.cleanup();
  }
});

test('reports a busy profile and a broken YAML document', async () => {
  const space = profile();
  try {
    let release;
    const gate = new Promise(resolve => {
      release = resolve;
    });
    const held = withProfileLock(space.dir, () => gate);
    await new Promise(resolve => setTimeout(resolve, 20));
    await assert.rejects(space.store.save({
      action: 'save',
      mode: 'add',
      draft: { name: 'blocked', transport: 'stdio', enabled: true, command: '/bin/echo' },
    }), error => error.code === 'locked');
    release();
    await held;

    writeFileSync(space.patchPath, '- id: [unclosed\n', { mode: 0o600 });
    await assert.rejects(space.store.readState(), error => error.code === 'parse-failed');
  } finally {
    space.cleanup();
  }
});

test('stateFromText counts tools through the supplied reader', () => {
  const state = stateFromText(FIXTURE, {
    profile: 'desktop',
    patchPath: '/tmp/cordis.patch.yml',
    countTools: name => (name === 'docs' ? 7 : null),
  });
  assert.equal(state.servers[0].tools, 7);
  assert.equal(state.servers[1].tools, null);
});

test('a toggle to the existing value leaves the patch file untouched', async t => {
  const space = profile();
  t.after(space.cleanup);
  const before = await space.store.readState();
  const inode = statSync(space.patchPath, { bigint: true }).ino;
  const [docs] = before.servers;
  const after = await space.store.setEnabled({ action: 'setEnabled', id: docs.id, rowHash: docs.rowHash, enabled: true });
  assert.equal(after.revision, before.revision);
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
