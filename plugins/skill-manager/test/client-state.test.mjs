import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from '../src/client/api.js';
import { createCatalog } from '../src/client/catalog.js';

const skill = {
  id: 'id-alpha', name: 'alpha', description: 'A skill', origin: 'third-party',
  source: 'user-agents',
};
const catalog = (skills = [skill], complete = true) => ({ skills, complete });

test('only posts JSON to the authenticated relative route and preserves a typed Host error', async () => {
  const body = { action: 'detail', id: skill.id };
  let calls = 0;
  await assert.rejects(request(body, undefined, async (url, options) => {
    calls += 1;
    assert.equal(url, 'api/skill-manager');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-dsh-skill-manager'], '1');
    assert.equal(options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), body);
    return Response.json({ ok: false, code: 'conflict' }, { status: 409 });
  }), { code: 'conflict' });
  assert.equal(calls, 1);
});

test('retains the last complete catalog when a refresh is incomplete or fails', async () => {
  const replies = [catalog(), catalog([], false), Object.assign(new Error(), { code: 'unavailable' })];
  const store = createCatalog(async () => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  });
  await store.refresh();
  assert.deepEqual(store.getSnapshot().skills, [skill]);
  await store.refresh();
  assert.deepEqual(store.getSnapshot().skills, [skill]);
  assert.equal(store.getSnapshot().listError, 'incomplete');
  await store.refresh();
  assert.deepEqual(store.getSnapshot().skills, [skill]);
  assert.equal(store.getSnapshot().listError, 'unavailable');
});

test('shows available global skills when the first catalog is incomplete', async () => {
  const partial = { ...skill, name: 'partially discovered' };
  const replies = [catalog([partial], false), catalog()];
  const store = createCatalog(async body => {
    assert.deepEqual(body, { action: 'list' });
    return replies.shift();
  });

  await store.refresh();
  assert.deepEqual(store.getSnapshot().skills, [partial]);
  assert.equal(store.getSnapshot().listError, 'incomplete');

  await store.refresh();
  assert.deepEqual(store.getSnapshot().skills, [skill]);
  assert.equal(store.getSnapshot().listError, null);
});

test('stopping the mounted controller aborts its read and ignores a late reply', async () => {
  let complete;
  let readSignal;
  const store = createCatalog((_, signal) => {
    readSignal = signal;
    return new Promise(resolve => { complete = resolve; });
  });
  store.start();
  assert.equal(readSignal.aborted, false);
  store.stop();
  assert.equal(readSignal.aborted, true);
  complete(catalog());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.getSnapshot().skills, null);
});

test('a previous mount cannot overwrite a new catalog after cancellation', async t => {
  let finish;
  let reads = 0;
  const newer = { ...skill, description: 'Refreshed skill' };
  const store = createCatalog(async () => {
    if (++reads === 1) return new Promise(resolve => { finish = resolve; });
    return catalog([newer]);
  });
  t.after(() => store.stop());
  store.start();
  store.stop();
  store.start();
  await new Promise(resolve => setImmediate(resolve));
  finish(catalog());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(store.getSnapshot().skills, [newer]);
});

test('coalesces overlapping refreshes into one trailing read and recovers after a failed read', async () => {
  let finish;
  let reads = 0;
  const store = createCatalog(async body => {
    assert.deepEqual(body, { action: 'list' });
    reads++;
    if (reads === 1) return new Promise(resolve => { finish = resolve; });
    if (reads === 3) throw new Error('connection lost');
    return catalog();
  });
  const initial = store.refresh();
  await Promise.all([store.refresh(), store.refresh(), store.refresh()]);
  assert.equal(reads, 1);
  finish(catalog([], false));
  await initial;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 2);
  assert.equal(store.getSnapshot().listError, null);
  await store.refresh();
  assert.equal(store.getSnapshot().listError, 'unavailable');
  await store.refresh();
  assert.deepEqual(store.getSnapshot(), { skills: [skill], listError: null });
  store.stop();
});

test('aborting a carrier that ignores cancellation still ends the request', async () => {
  const controller = new AbortController();
  const pending = request({ action: 'list' }, controller.signal, () => new Promise(() => {}));
  controller.abort();
  await assert.rejects(pending, { code: 'unavailable' });
});


test('authentication status takes precedence over a JSON error envelope', async () => {
  for (const status of [401, 403]) {
    await assert.rejects(request({ action: 'list' }, undefined, async () =>
      Response.json({ ok: false, code: 'internal' }, { status })), { code: 'forbidden' });
  }
});
