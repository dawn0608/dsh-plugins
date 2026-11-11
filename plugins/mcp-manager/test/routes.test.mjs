import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DraftError } from '../src/errors.js';
import { MAX_BODY_BYTES, createApi, createFetchHandler } from '../src/routes.js';
import { apply, inject } from '../src/index.js';
import { request } from '../src/client/api.js';

function fakeStore() {
  return {
    async readState() {
      return { ok: true, servers: [] };
    },
    async save() {
      return { ok: true, servers: [{ name: 'saved' }] };
    },
    async remove() {
      return { ok: true, servers: [] };
    },
    async setEnabled() {
      return { ok: true, servers: [] };
    },
  };
}

const messages = [];
const api = createApi({ store: fakeStore(), log: (event, fields) => messages.push([event, fields]) });

test('serves GET and rejects unsupported methods', async () => {
  const get = await api({ method: 'GET', headers: {} });
  assert.equal(get.status, 200);
  assert.equal(get.body.ok, true);
  const put = await api({ method: 'PUT', headers: {} });
  assert.equal(put.status, 405);
});

test('requires the marker header and JSON for writes', async () => {
  const missingMarker = await api({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(missingMarker.status, 403);
  const wrongType = await api({
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-dsh-mcp-manager': '1' },
    body: '{}',
  });
  assert.equal(wrongType.status, 415);
  const badJson = await api({
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-dsh-mcp-manager': '1' },
    body: '{',
  });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.code, 'invalid-json');
});

test('dispatches save/delete/setEnabled and maps field errors', async () => {
  const headers = { 'content-type': 'application/json', 'x-dsh-mcp-manager': '1' };
  const save = await api({ method: 'POST', headers, body: JSON.stringify({ action: 'save', mode: 'add', draft: {} }) });
  assert.equal(save.status, 200);
  assert.equal(save.body.servers[0].name, 'saved');
  const unknown = await api({ method: 'POST', headers, body: JSON.stringify({ action: 'other' }) });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, 'invalid');
  const badMode = await api({ method: 'POST', headers, body: JSON.stringify({ action: 'save', mode: 'x' }) });
  assert.equal(badMode.status, 400);

  const failing = createApi({
    log: () => {},
    store: {
      ...fakeStore(),
      async save() {
        throw new DraftError([{ field: 'name', code: 'required' }]);
      },
    },
  });
  const invalid = await failing({ method: 'POST', headers, body: JSON.stringify({ action: 'save', mode: 'add', draft: {} }) });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.errors, [{ field: 'name', code: 'required' }]);
});

test('rejects an over-limit request body', async () => {
  const apiWithStore = createApi({ store: fakeStore(), log: () => {} });
  const headers = { 'content-type': 'application/json', 'x-dsh-mcp-manager': '1' };
  const response = await apiWithStore({
    method: 'POST',
    headers,
    body: 'x'.repeat(MAX_BODY_BYTES + 1),
  });
  assert.equal(response.status, 413);
});

test('registers only the authenticated connection route', () => {
  assert.deepEqual(inject, ['connection']);
  const routes = [];
  apply({
    effect(register) { register(); },
    connection: { fetch: { register(route) { routes.push(route); } } },
  });
  assert.deepEqual(routes.map(({ path, methods }) => ({ path, methods })), [
    { path: '/api/mcp-manager', methods: ['GET', 'HEAD', 'POST'] },
  ]);
});

test('the registered route reads the active host profile without profile environment or arguments', async t => {
  t.mock.property(process, 'env', Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_'))));
  t.mock.property(process, 'argv', ['node', 'dsh', 'web']);
  const dir = mkdtempSync(join(tmpdir(), 'mcp-manager-host-profile-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const patchPath = join(dir, 'host.patch.yml');
  writeFileSync(patchPath, '[]\n');

  let route;
  apply({
    effect(register) { register(); },
    connection: { fetch: { register(definition) { route = definition; } } },
    get(service) {
      if (service === 'profileContext') return { name: 'web-isolated', dir, patchPath };
    },
  });

  const response = await route.fetch(new Request('http://localhost/api/mcp-manager'));
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.profile, 'web-isolated');
  assert.equal(state.patchPath, patchPath);
  assert.deepEqual(state.servers, []);
});

test('the authenticated adapter returns headers with no body on HEAD', async () => {
  const response = await createFetchHandler(api)(new Request('http://localhost/api/mcp-manager', { method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
});

test('the browser only uses the relative connection route, including on failures', async t => {
  globalThis.window = { __DSH_TRANSPORT__: { streamBaseUrl: 'ws://127.0.0.1:55111/stream' } };
  globalThis.location = new URL('https://example.com/desktop/');
  t.after(() => {
    delete globalThis.window;
    delete globalThis.location;
  });
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([url, options.method, options.credentials, options.headers['x-dsh-mcp-manager']]);
    return new Response(null, { status: 403 });
  };
  await assert.rejects(request({ fetchImpl }), { code: 'unauthorized' });
  await assert.rejects(request({ method: 'POST', body: { action: 'setEnabled' }, fetchImpl }), { code: 'unauthorized' });
  assert.deepEqual(calls, [
    ['api/mcp-manager', 'GET', 'same-origin', undefined],
    ['api/mcp-manager', 'POST', 'same-origin', '1'],
  ]);
});

test('rejects cross-client removal even if a caller supplies a bridge', async () => {
  let called = false;
  const isolated = createApi({ store: { ...fakeStore(), deleteShared() { called = true; return { ok: true }; } }, log() {} });
  const response = await isolated({ method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-mcp-manager': '1' }, body: JSON.stringify({ action: 'deleteShared', name: 'fixture' }) });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
