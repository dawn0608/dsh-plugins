import assert from 'node:assert/strict';
import test from 'node:test';
import { createController } from '../src/client/controller.js';

const STATE = {
  ok: true,
  profile: 'desktop',
  patchPath: '/tmp/cordis.patch.yml',
  revision: 'a'.repeat(64),
  servers: [
    { id: 'one', name: 'docs', transport: 'streamable-http', enabled: true, editable: true, deletable: true, rowHash: 'r1', tools: 2, config: { url: 'https://example.com/mcp', headers: [] } },
  ],
  warnings: [],
};

function reply(status, payload) {
  return {
    status,
    ok: status < 400,
    async json() {
      return payload;
    },
  };
}

function fakeFetch(handler) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return handler(String(url), init);
    },
  };
}

test('loads the state and exposes it through the snapshot', async () => {
  const fake = fakeFetch(() => reply(200, STATE));
  const controller = createController({ fetchImpl: fake.fetchImpl });
  await controller.load();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.status, 'ready');
  assert.equal(snapshot.state.servers[0].name, 'docs');
  assert.equal(fake.calls[0].url, 'api/mcp-manager');
  controller.dispose();
});

test('loads a failure without throwing and keeps it in the snapshot', async () => {
  const fake = fakeFetch(() => {
    throw new TypeError('offline');
  });
  const controller = createController({ fetchImpl: fake.fetchImpl });
  await controller.load();
  assert.equal(controller.getSnapshot().status, 'error');
  assert.equal(controller.getSnapshot().error.code, 'network');
  controller.dispose();
});

test('saves with the expected body and reports field errors', async () => {
  let seen;
  const fake = fakeFetch((url, init) => {
    seen = JSON.parse(init.body);
    if (seen.draft.name === 'bad') {
      return reply(422, { ok: false, code: 'invalid', errors: [{ field: 'name', code: 'required' }] });
    }
    return reply(200, STATE);
  });
  const controller = createController({ fetchImpl: fake.fetchImpl });
  const target = { id: 'one', name: 'docs', rowHash: 'r1' };
  const ok = await controller.save({
    name: 'docs',
    transport: 'streamable-http',
    enabled: false,
    url: 'https://example.com/mcp',
    headers: [],
  }, { mode: 'edit', target });
  assert.equal(ok.ok, true);
  assert.equal(seen.action, 'save');
  assert.equal(seen.mode, 'edit');
  assert.equal(seen.id, 'one');
  assert.equal(seen.rowHash, 'r1');
  assert.deepEqual(controller.getSnapshot().notice, { code: 'saved', params: { name: 'docs' } });

  const invalid = await controller.save({ name: 'bad', transport: 'stdio', enabled: false, command: '/bin/echo' }, { mode: 'add' });
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors, [{ field: 'name', code: 'required' }]);
  controller.dispose();
});

test('a conflict reloads the state before returning the failure', async () => {
  let posts = 0;
  const fake = fakeFetch((url, init) => {
    if (init.method === 'POST') {
      posts += 1;
      return reply(409, { ok: false, code: 'conflict', message: 'changed' });
    }
    return reply(200, STATE);
  });
  const controller = createController({ fetchImpl: fake.fetchImpl });
  await controller.load();
  const result = await controller.remove({ id: 'one', name: 'docs', rowHash: 'r1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'conflict');
  assert.equal(posts, 1);
  assert.equal(fake.calls.filter(call => call.init.method === 'GET').length, 2);
  assert.equal(controller.getSnapshot().state.servers.length, 1);
  controller.dispose();
});

test('setEnabled posts the toggle and updates the state', async () => {
  let body;
  const fake = fakeFetch((url, init) => {
    body = JSON.parse(init.body);
    return reply(200, { ...STATE, servers: [{ ...STATE.servers[0], enabled: false }] });
  });
  const controller = createController({ fetchImpl: fake.fetchImpl });
  const result = await controller.setEnabled({ id: 'one', name: 'docs', rowHash: 'r1' }, false);
  assert.equal(result.ok, true);
  assert.deepEqual(body, { action: 'setEnabled', id: 'one', name: 'docs', rowHash: 'r1', enabled: false });
  assert.equal(controller.getSnapshot().state.servers[0].enabled, false);
  controller.dispose();
});

test('reports a manual refresh while it is in flight', async () => {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const fake = fakeFetch(async () => {
    await gate;
    return reply(200, STATE);
  });
  const controller = createController({ fetchImpl: fake.fetchImpl });
  const pending = controller.load();
  assert.equal(controller.getSnapshot().refreshing, true);
  release();
  await pending;
  assert.equal(controller.getSnapshot().refreshing, false);
  controller.dispose();
});

test('a disabled controller ignores later publications', async () => {
  const fake = fakeFetch(() => reply(200, STATE));
  const controller = createController({ fetchImpl: fake.fetchImpl });
  let notifications = 0;
  controller.subscribe(() => {
    notifications += 1;
  });
  controller.dispose();
  await controller.load();
  assert.equal(notifications, 0);
});
