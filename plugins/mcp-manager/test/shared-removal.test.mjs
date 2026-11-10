import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apply } from '../src/index.js';

const PATCH = `- insert:
  - id: docs
    name: '@deepseek-ai/dsh-mcp-client'
    config:
      serverName: -docs
      command: /bin/echo
`.replaceAll('\n', '\r\n');
const ENDPOINT = 'http://localhost/api/mcp-manager';

function setup(t, { profile = 'desktop', optIn = true, override = false, patch = PATCH } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-shared-removal-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const patchPath = join(dir, 'cordis.patch.yml');
  const script = join(dir, 'fake-bridge.cjs');
  const receipt = join(dir, 'called.json');
  const outcome = join(dir, 'outcome');
  writeFileSync(patchPath, patch);
  writeFileSync(outcome, 'removed');
  // Run a real process in an isolated profile with a controllable bridge result.
  writeFileSync(script, `
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    fs.writeFileSync(${JSON.stringify(receipt)}, JSON.stringify(args));
    if (fs.existsSync(path.join(path.dirname(args[2]), 'package.json.lock'))) process.exit(5);
    const status = fs.readFileSync(${JSON.stringify(outcome)}, 'utf8');
    if (status === 'removed' || status === 'pending') fs.writeFileSync(args[2], '[]\\n');
    console.log(status === 'invalid-output' ? 'private bridge details' : JSON.stringify({ status }));
    console.error('private stderr details');
    process.exitCode = status === 'removed' || status === 'pending' ? 0 : 1;
  `);

  let route;
  const config = {
    ...(optIn ? { sharedSync: { python: process.execPath, script } } : {}),
    ...(override ? { patchPath } : {}),
  };
  apply({
    effect(register) { register(); },
    connection: { fetch: { register(definition) { route = definition; } } },
    get(service) {
      if (service === 'profileContext') return { name: profile, dir, patchPath };
    },
  }, config);

  return {
    patchPath, receipt, outcome,
    async read() { return (await route.fetch(new Request(ENDPOINT))).json(); },
    post(body, authenticated = true) {
      return route.fetch(new Request(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authenticated ? { 'x-dsh-mcp-manager': '1' } : {}) },
        body: JSON.stringify(body),
      }));
    },
  };
}

function selection(state) {
  const { id, name, rowHash } = state.servers[0];
  return { action: 'deleteShared', id, name, rowHash, revision: state.revision };
}

test('runs the opted-in Desktop bridge outside the lock with the server name and exact revision', async t => {
  const space = setup(t);
  const state = await space.read();
  const revision = createHash('sha256').update(Buffer.from(PATCH, 'utf8')).digest('hex');
  assert.equal(state.revision, revision);
  assert.equal(state.servers[0].sharedRemovable, true);
  const response = await space.post({ ...selection(state), patchPath: '/forged/path', python: '/forged/executable' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.removal, 'removed');
  assert.deepEqual(result.servers, []);
  assert.deepEqual(JSON.parse(readFileSync(space.receipt, 'utf8')), [
    'remove-from-profile', '--patch-path', space.patchPath, '--revision', revision, '--', '-docs',
  ]);
});

test('distinguishes deferred synchronization and sanitized bridge failures', async t => {
  for (const [status, expectedStatus, code] of [
    ['pending', 200, null], ['conflict', 409, 'conflict'], ['unmanaged', 409, 'shared-unmanaged'],
    ['unavailable', 503, 'shared-unavailable'], ['invalid-output', 502, 'shared-unknown'],
  ]) {
    const space = setup(t);
    writeFileSync(space.outcome, status);
    const response = await space.post(selection(await space.read()));
    assert.equal(response.status, expectedStatus, status);
    const result = await response.json();
    if (code === null) {
      assert.equal(result.removal, 'pending');
      assert.deepEqual(result.servers, []);
    } else {
      assert.equal(result.code, code);
      assert.doesNotMatch(JSON.stringify(result), /private|fake-bridge/);
      assert.equal(readFileSync(space.patchPath, 'utf8'), PATCH);
    }
  }
});

test('rejects stale or forged confirmations before starting the bridge', async t => {
  const space = setup(t);
  const target = selection(await space.read());
  for (const payload of [
    { ...target, id: undefined },
    { ...target, name: 'another-server' },
    { ...target, rowHash: '0'.repeat(64) },
  ]) {
    const result = await space.post(payload);
    assert.ok(result.status >= 400);
  }
  assert.equal((await space.post(target, false)).status, 403);
  writeFileSync(space.patchPath, `# Unrelated edit\r\n${PATCH}`);
  assert.equal((await space.read()).servers[0].rowHash, target.rowHash);
  const response = await space.post(target);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'conflict');
  assert.equal(existsSync(space.receipt), false);
});

test('requires desktop opt-in, even for a forged POST with a valid row snapshot', async t => {
  for (const options of [{ optIn: false }, { profile: 'web-isolated' }, { override: true }]) {
    const space = setup(t, options);
    const state = await space.read();
    assert.ok(!state.servers[0].sharedRemovable);
    const response = await space.post(selection(state));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'shared-unavailable');
    assert.equal(existsSync(space.receipt), false);
  }
});

test('disables shared removal for duplicate names and read-only rows while preserving local deletion', async t => {
  const second = PATCH.split('\r\n').slice(1).join('\r\n').replace('id: docs', 'id: another');
  const space = setup(t, { patch: PATCH + second });
  const state = await space.read();
  assert.equal(state.servers.length, 2);
  assert.ok(state.servers.every(row => row.duplicate && !row.sharedRemovable));
  const target = selection(state);
  const refused = await space.post(target);
  assert.equal(refused.status, 409);
  assert.equal(existsSync(space.receipt), false);
  const deleted = await space.post({ ...target, action: 'delete' });
  assert.equal(deleted.status, 200);
  assert.equal((await deleted.json()).servers[0].id, 'another');
  assert.equal(existsSync(space.receipt), false);

  const readOnly = setup(t, { patch: PATCH.replace('    config:', '    extra: 1\r\n    config:') });
  const lockedState = await readOnly.read();
  assert.equal(lockedState.servers[0].editable, false);
  assert.ok(!lockedState.servers[0].sharedRemovable);
  const locked = await readOnly.post(selection(lockedState));
  assert.equal(locked.status, 409);
  assert.equal((await locked.json()).code, 'read-only');
  assert.equal(existsSync(readOnly.receipt), false);
});
