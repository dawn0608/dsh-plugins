import assert from 'node:assert/strict';
import test from 'node:test';
import { createBalanceStore } from '../src/client/store.js';

function mockChannel(t) {
  const calls = [];
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  globalThis.window = { __DSH_TRANSPORT__: { streamBaseUrl: 'ws://127.0.0.1:6543/stream' } };
  globalThis.location = new URL('https://example.test/mounted/');
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  });
  t.mock.method(globalThis, 'fetch', (url, options) => {
    const { promise, resolve, reject } = Promise.withResolvers();
    calls.push({
      url,
      options,
      resolve(total) {
        resolve(Response.json({
          cost: { ok: true, total, unknownModels: [] },
          balance: { ok: true, wallets: [{ total: 100, currency: 'CNY' }] },
          pricing: { loaded: true },
        }));
      },
      reject,
      respond(status) {
        resolve(new Response(null, { status }));
      },
    });
    return promise;
  });
  const store = createBalanceStore();
  t.after(() => store.dispose?.());
  return { calls, store };
}

test('an A → B → A switch aborts both old reads and accepts only the newest A', async t => {
  const { calls, store } = mockChannel(t);
  const oldA = store.refresh({ sessionId: 'A' });
  const oldB = store.refresh({ sessionId: 'B' });
  const newA = store.refresh({ sessionId: 'A' });
  assert.equal(store.current().cost, undefined);
  calls[2].resolve(3);
  await newA;
  // The transport may deliver a response even after its AbortSignal fires.
  calls[1].resolve(2);
  calls[0].resolve(1);
  await Promise.all([oldA, oldB]);
  assert.equal(store.current().sessionId, 'A');
  assert.equal(store.current().cost.total, 3);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls[1].options.signal.aborted, true);
});

test('overlapping refreshes coalesce into one trailing read without waiting for throttle', async t => {
  const { calls, store } = mockChannel(t);
  const initial = store.refresh({ sessionId: 'A' });
  store.refresh({ sessionId: 'A', force: true });
  store.refresh({ sessionId: 'A' });
  assert.equal(calls.length, 1);
  calls[0].resolve(1);
  await initial;
  assert.equal(calls.length, 2);
  const settled = new Promise(resolve => {
    store.subscribe(snapshot => {
      if (snapshot.cost?.total === 2) resolve();
    });
  });
  calls[1].resolve(2);
  await settled;
  assert.equal(calls.length, 2);
});

test('switching sessions drops a queued refresh for the previous session', async t => {
  const { calls, store } = mockChannel(t);
  const oldA = store.refresh({ sessionId: 'A' });
  store.refresh({ sessionId: 'A', force: true });
  const newB = store.refresh({ sessionId: 'B' });
  calls[0].resolve(1);
  calls[1].resolve(2);
  await Promise.all([oldA, newB]);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls.length, 2);
  assert.equal(store.current().cost.total, 2);
});

test('dispose aborts pending work and suppresses its trailing refresh and updates', async t => {
  const { calls, store } = mockChannel(t);
  const read = store.refresh({ sessionId: 'A' });
  store.refresh({ sessionId: 'A', force: true });
  const published = store.current();
  assert.equal(typeof store.dispose, 'function');
  store.dispose();
  calls[0].resolve(1);
  await read;
  await store.refresh({ sessionId: 'B', force: true });
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls.length, 1);
  assert.equal(store.current(), published);
});

for (const status of [401, 403]) {
  test(`HTTP ${status} uses the relative authenticated channel exactly once`, async t => {
    const { calls, store } = mockChannel(t);
    const read = store.refresh({ sessionId: 'id with /' });
    calls[0].respond(status);
    await Promise.race([read, new Promise(resolve => setImmediate(resolve))]);
    assert.deepEqual(calls.map(call => call.url), ['api/cost-overview/state?session=id%20with%20%2F']);
    assert.equal(calls[0].options.credentials, 'same-origin');
    assert.equal(store.current().reason, 'forbidden');
  });
}

test('a request times out after nine seconds even if the transport fails to settle', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { calls, store } = mockChannel(t);
  const read = store.refresh({ sessionId: 'A' });
  t.mock.timers.tick(8999);
  assert.equal(calls[0].options.signal.aborted, false);
  t.mock.timers.tick(1);
  await Promise.race([read, new Promise(resolve => setImmediate(resolve))]);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(store.current().status, 'unavailable');
  assert.equal(store.current().reason, 'timeout');
  assert.equal(calls.length, 1);
});

test('a network failure exposes an error for the current session and recovers on refresh', async t => {
  const { calls, store } = mockChannel(t);
  const failed = store.refresh({ sessionId: 'A' });
  calls[0].reject(new TypeError('simulated connection failure'));
  await Promise.race([failed, new Promise(resolve => setImmediate(resolve))]);
  assert.equal(store.current().sessionId, 'A');
  assert.equal(store.current().status, 'unavailable');
  assert.equal(store.current().reason, 'network');

  const recovered = store.refresh({ sessionId: 'A', force: true });
  assert.equal(store.current().reason, 'network');
  calls[1].resolve(2);
  await recovered;
  assert.equal(store.current().status, 'ready');
  assert.equal(store.current().reason, undefined);
  assert.equal(store.current().cost.total, 2);
});
