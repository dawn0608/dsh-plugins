import assert from 'node:assert/strict';
import test from 'node:test';
import { apply } from '../lib/index.js';
import { stateCandidates } from '../src/client/store.js';

test('web and connection routes serve the state URLs used by the client', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 503 }));
  const originalKeyEnv = process.env.COST_OVERVIEW_API_KEY_ENV;
  const missingKey = 'DSH_COST_OVERVIEW_TEST_MISSING_KEY';
  process.env.COST_OVERVIEW_API_KEY_ENV = missingKey;
  globalThis.window = {};
  globalThis.location = new URL('http://localhost');
  t.after(() => {
    if (originalKeyEnv === undefined) delete process.env.COST_OVERVIEW_API_KEY_ENV;
    else process.env.COST_OVERVIEW_API_KEY_ENV = originalKeyEnv;
    delete globalThis.window;
    delete globalThis.location;
  });

  let webRoute;
  let channelRoute;
  apply({
    get: () => undefined,
    effect: register => register(),
    webServer: { register: route => { webRoute = route; } },
    connection: { fetch: { register: route => { channelRoute = route; } } },
  });

  const [webUrl, channelUrl] = stateCandidates('session with spaces');
  assert.equal(webRoute.path, '/plugin/cost-overview/state');
  assert.equal(channelRoute.path, '/api/cost-overview/state');
  assert.equal(new URL(webUrl).pathname, webRoute.path);
  assert.equal(new URL(channelUrl, 'http://localhost').pathname, channelRoute.path);

  let webState;
  await webRoute.handler({ method: 'GET', url: webUrl }, {
    writeHead(status) { assert.equal(status, 200); },
    end(body) { webState = JSON.parse(body); },
  });
  const response = await channelRoute.fetch(new Request(new URL(channelUrl, 'http://localhost')));
  assert.equal(response.status, 200);
  for (const state of [webState, await response.json()]) {
    assert.deepEqual(
      { ok: state.balance.ok, reason: state.balance.reason, apiKeyEnv: state.balance.apiKeyEnv },
      { ok: false, reason: 'missing-key', apiKeyEnv: missingKey },
    );
    assert.deepEqual(state.cost, { ok: false, reason: 'price-failed' });
  }
});
