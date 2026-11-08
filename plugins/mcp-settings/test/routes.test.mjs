import assert from 'node:assert/strict';
import test from 'node:test';
import { DraftError } from '../src/errors.js';
import { MAX_BODY_BYTES, createApi, trustedRequest } from '../src/routes.js';

test('trusts loopback hosts and same-origin browser requests', () => {
  assert.equal(trustedRequest({ host: '127.0.0.1:57198' }), true);
  assert.equal(trustedRequest({ host: 'localhost:57198' }), true);
  assert.equal(trustedRequest({ host: '[::1]:57198' }), true);
  assert.equal(trustedRequest({ host: '127.0.0.1:57198', origin: 'http://127.0.0.1:57198' }), true);
  assert.equal(trustedRequest({ host: '127.0.0.1:57198', origin: 'null' }), true);
  assert.equal(trustedRequest({ host: '127.0.0.1:57198', 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(trustedRequest({ host: 'evil.example.com', origin: 'http://evil.example.com' }), false);
  assert.equal(trustedRequest({ host: '127.0.0.1:57198', origin: 'http://evil.example.com' }), false);
  assert.equal(trustedRequest({ host: '127.0.0.1:57198', 'sec-fetch-site': 'cross-site' }), false);
  assert.equal(trustedRequest({}), false);
});

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
  const get = await api({ method: 'GET', headers: { host: '127.0.0.1:1' } });
  assert.equal(get.status, 200);
  assert.equal(get.body.ok, true);
  const put = await api({ method: 'PUT', headers: {} });
  assert.equal(put.status, 405);
});

test('requires loopback trust, the marker header and JSON for writes', async () => {
  const crossSite = await api({ method: 'POST', headers: { host: 'evil.example.com' }, body: '{}' });
  assert.equal(crossSite.status, 403);
  const missingMarker = await api({
    method: 'POST',
    headers: { host: '127.0.0.1:1', 'content-type': 'application/json' },
    body: '{}',
    checkTrust: true,
  });
  assert.equal(missingMarker.status, 403);
  const wrongType = await api({
    method: 'POST',
    headers: { host: '127.0.0.1:1', 'content-type': 'text/plain', 'x-dsh-mcp-settings': '1' },
    body: '{}',
    checkTrust: true,
  });
  assert.equal(wrongType.status, 415);
  const badJson = await api({
    method: 'POST',
    headers: { host: '127.0.0.1:1', 'content-type': 'application/json', 'x-dsh-mcp-settings': '1' },
    body: '{',
    checkTrust: true,
  });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.code, 'invalid-json');
});

test('dispatches save/delete/setEnabled and maps field errors', async () => {
  const headers = { host: '127.0.0.1:1', 'content-type': 'application/json', 'x-dsh-mcp-settings': '1' };
  const save = await api({ method: 'POST', headers, body: JSON.stringify({ action: 'save', mode: 'add', draft: {} }), checkTrust: true });
  assert.equal(save.status, 200);
  assert.equal(save.body.servers[0].name, 'saved');
  const unknown = await api({ method: 'POST', headers, body: JSON.stringify({ action: 'other' }), checkTrust: true });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, 'invalid');
  const badMode = await api({ method: 'POST', headers, body: JSON.stringify({ action: 'save', mode: 'x' }), checkTrust: true });
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
  const invalid = await failing({ method: 'POST', headers, body: JSON.stringify({ action: 'save', mode: 'add', draft: {} }), checkTrust: true });
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body.errors, [{ field: 'name', code: 'required' }]);
});

test('rejects an over-limit request body', async () => {
  const apiWithStore = createApi({ store: fakeStore(), log: () => {} });
  const headers = { host: '127.0.0.1:1', 'content-type': 'application/json', 'x-dsh-mcp-settings': '1' };
  const response = await apiWithStore({
    method: 'POST',
    headers,
    body: 'x'.repeat(MAX_BODY_BYTES + 1),
    checkTrust: true,
  });
  assert.equal(response.status, 413);
});
