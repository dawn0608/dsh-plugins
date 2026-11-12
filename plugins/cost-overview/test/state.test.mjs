import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { apply, inject } from '../lib/index.js';

test('only the connection route is registered and serves GET and HEAD', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const missingKey = `DSH_COST_OVERVIEW_TEST_${randomUUID()}`;

  let channelRoute;
  apply({
    get: name => name === 'settings' ? {
      describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: missingKey } }],
    } : undefined,
    effect: register => register(),
    webServer: { register: () => assert.fail('registered a route outside the connection') },
    connection: { fetch: { register: route => { channelRoute = route; } } },
  });

  assert.deepEqual(inject, ['connection']);
  assert.equal(channelRoute.path, '/api/cost-overview/state');
  const url = new URL('api/cost-overview/state?session=session%20with%20spaces', 'http://localhost');
  const response = await channelRoute.fetch(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const state = await response.json();
  assert.deepEqual(
    { ok: state.balance.ok, reason: state.balance.reason, apiKeyEnv: state.balance.apiKeyEnv },
    { ok: false, reason: 'missing-key', apiKeyEnv: missingKey },
  );
  assert.deepEqual(state.cost, { ok: false, reason: 'price-failed' });

  const head = await channelRoute.fetch(new Request(url, { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('disposing the host cancels upstream price and balance reads', async t => {
  const signals = [];
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_, reject) => {
    signals.push(signal);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const disposers = [];
  let route;
  apply({
    get: name => name === 'credentials' ? { resolve: async () => ({ value: 'test-key' }) } : undefined,
    effect: register => { const dispose = register(); if (typeof dispose === 'function') disposers.push(dispose); },
    connection: { fetch: { register(value) { route = value; return () => {}; } } },
  });
  const pending = route.fetch(new Request('http://localhost/api/cost-overview/state'));
  t.after(() => pending);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signals.length, 2);
  for (const dispose of disposers.reverse()) dispose();
  assert.ok(signals.every(signal => signal.aborted));
  await pending;
});
