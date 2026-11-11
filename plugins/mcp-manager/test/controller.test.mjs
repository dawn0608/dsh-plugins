import assert from 'node:assert/strict';
import test from 'node:test';
import { createController } from '../src/client/controller.js';

const STATE = {
  ok: true,
  profile: 'desktop',
  patchPath: '/tmp/cordis.patch.yml',
  revision: 'a'.repeat(64),
  servers: [
    { id: 'one', name: 'docs', transport: 'streamable-http', enabled: true, editable: true, deletable: true, rowHash: 'r1', tools: 2 },
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
  const result = await controller.setEnabled({ id: 'one', name: 'docs', rowHash: 'r1' }, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'conflict');
  assert.equal(posts, 1);
  assert.equal(fake.calls.filter(call => call.init.method === 'GET').length, 2);
  assert.equal(controller.getSnapshot().state.servers.length, 1);
  assert.deepEqual(controller.getSnapshot().action, {
    id: 'one', name: 'docs', error: { code: 'conflict', params: undefined },
  });
  controller.dispose();
});

test('setEnabled posts the toggle and updates the state', async () => {
  let body;
  let finishWrite;
  const response = new Promise(resolve => { finishWrite = resolve; });
  const fake = fakeFetch((url, init) => {
    body = JSON.parse(init.body);
    return response;
  });
  const controller = createController({ fetchImpl: fake.fetchImpl });
  const pending = controller.setEnabled({ id: 'one', name: 'docs', rowHash: 'r1' }, false);
  assert.deepEqual(controller.getSnapshot().action, { id: 'one', name: 'docs' });
  assert.equal(controller.getSnapshot().busy, true);
  assert.equal((await controller.setEnabled({ id: 'two', name: 'other', rowHash: 'r2' }, false)).ok, false);
  assert.equal(fake.calls.length, 1);
  finishWrite(reply(200, { ...STATE, servers: [{ ...STATE.servers[0], enabled: false }] }));
  const result = await pending;
  assert.equal(result.ok, true);
  assert.deepEqual(body, { action: 'setEnabled', id: 'one', name: 'docs', rowHash: 'r1', enabled: false });
  assert.equal(controller.getSnapshot().state.servers[0].enabled, false);
  assert.equal(controller.getSnapshot().action, null);
  controller.dispose();
});

test('an older refresh cannot undo a confirmed toggle', async () => {
  let release;
  const refresh = new Promise(resolve => { release = resolve; });
  const updated = { ...STATE, servers: [{ ...STATE.servers[0], enabled: false }] };
  const fake = fakeFetch((url, init) => init.method === 'GET' ? refresh : reply(200, updated));
  const controller = createController({ fetchImpl: fake.fetchImpl });
  const pending = controller.load();
  const result = await controller.setEnabled(STATE.servers[0], false);
  release(reply(200, STATE));
  await pending;
  assert.equal(result.ok, true);
  assert.equal(controller.getSnapshot().state.servers[0].enabled, false);
  controller.dispose();
});

test('automatically reloads changed configuration, recovers from errors, and stops on cleanup', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  let result = reply(200, STATE);
  const fake = fakeFetch(() => result);
  const controller = createController({ fetchImpl: fake.fetchImpl });
  t.after(() => controller.dispose());

  controller.start();
  await settle();
  assert.equal(controller.getSnapshot().state, STATE);
  assert.equal(fake.calls.length, 1);

  result = reply(500, { ok: false, code: 'internal' });
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(controller.getSnapshot().error.code, 'internal');
  assert.equal(controller.getSnapshot().state, STATE);

  const updated = { ...STATE, servers: [...STATE.servers, { ...STATE.servers[0], id: 'two', name: 'added' }] };
  result = reply(200, updated);
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(controller.getSnapshot().error, null);
  assert.equal(controller.getSnapshot().state.servers[1].name, 'added');

  controller.stop();
  t.mock.timers.tick(10000);
  assert.equal(fake.calls.length, 3);
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

test('reconciles authoritative state after a network failure before releasing busy', async () => {
  const updated = { ...STATE, servers: [{ ...STATE.servers[0], enabled: false }] };
  const fake = fakeFetch((url, init) => {
    if (init.method === 'POST') throw new TypeError('response was lost after commit');
    return reply(200, updated);
  });
  const controller = createController({ fetchImpl: fake.fetchImpl });
  assert.deepEqual(await controller.setEnabled(STATE.servers[0], false), { ok: false, code: 'network' });
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().state?.servers[0].enabled, false);
  assert.equal(controller.getSnapshot().action.error.code, 'network');
  controller.dispose();
});

test('times out a hung write, aborts fetch, reloads and ignores the late response', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let late;
  const response = new Promise(resolve => { late = resolve; });
  const authoritative = { ...STATE, revision: 'authoritative' };
  const fake = fakeFetch((url, init) => init.method === 'POST' ? response : reply(200, authoritative));
  const controller = createController({ fetchImpl: fake.fetchImpl, writeTimeoutMs: 25 });
  t.after(() => controller.dispose());
  const pending = controller.setEnabled(STATE.servers[0], false);
  t.mock.timers.tick(25);
  const signal = fake.calls[0].init.signal;
  assert.equal(signal?.aborted, true);
  assert.deepEqual(await pending, { ok: false, code: 'timeout' });
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().state.revision, 'authoritative');
  late(reply(200, { ...STATE, revision: 'late' }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getSnapshot().state.revision, 'authoritative');
});

test('stopping the controller aborts a write without publishing its late response after restart', async t => {
  let late;
  const response = new Promise(resolve => { late = resolve; });
  const authoritative = { ...STATE, revision: 'authoritative' };
  const fake = fakeFetch((url, init) => init.method === 'POST' ? response : reply(200, authoritative));
  const controller = createController({ fetchImpl: fake.fetchImpl });
  t.after(() => controller.dispose());
  const pending = controller.setEnabled(STATE.servers[0], false);
  controller.stop();
  assert.equal(fake.calls[0].init.signal?.aborted, true);
  assert.equal(controller.getSnapshot().busy, false);
  controller.start();
  late(reply(200, { ...STATE, revision: 'late' }));
  assert.deepEqual(await pending, { ok: false, code: 'aborted' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getSnapshot().state.revision, 'authoritative');
});
