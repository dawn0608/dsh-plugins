import assert from 'node:assert/strict';
import test from 'node:test';
import { request, readSelection } from '../src/client/api.js';
import { createCatalog } from '../src/client/catalog.js';

const skill = {
  id: 'id-alpha', name: 'alpha', description: 'A skill', group: 'imported',
  source: 'profile', enabled: false, shadowed: false,
};
const workspaces = [{ id: 'workspace-id', title: 'Workspace' }];
const catalog = (skills = [skill], complete = true) => ({ skills, workspaces, complete });

test('only posts JSON to the authenticated relative route and preserves a typed Host error', async () => {
  const body = { action: 'setEnabled', workspaceId: null, id: skill.id, enabled: true };
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

test('reads a selected skill folder with binary resources and drops only the picker root', async () => {
  const entry = (name, webkitRelativePath, bytes) => Object.assign(new File([Uint8Array.from(bytes)], name), { webkitRelativePath });
  const result = await readSelection([
    entry('SKILL.md', 'outer/SKILL.md', [65]),
    entry('data.bin', 'outer/resources/data.bin', [0, 255, 16]),
  ], 'folder');
  assert.deepEqual(result, {
    source: 'outer',
    files: [{ path: 'SKILL.md', data: 'QQ==' }, { path: 'resources/data.bin', data: 'AP8Q' }],
  });
});

test('rejects limits and invalid single-file choices before reading any file', async () => {
  let reads = 0;
  const entry = (name, size) => ({ name, size, arrayBuffer: async () => { reads += 1; } });
  await assert.rejects(readSelection([entry('SKILL.md', 8 * 1024 * 1024 + 1)], 'file'), { code: 'too-large' });
  await assert.rejects(readSelection(Array(257).fill(entry('SKILL.md', 1)), 'folder'), { code: 'too-large' });
  await assert.rejects(readSelection([entry('OTHER.md', 1)], 'file'), { code: 'invalid' });
  assert.equal(reads, 0);
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

test('shows available skills and workspaces when the first catalog is incomplete', async () => {
  const partial = { ...skill, name: 'partially discovered' };
  const replies = [catalog([partial], false), catalog()];
  const store = createCatalog(async () => replies.shift());

  await store.refresh();
  assert.deepEqual(store.getSnapshot().skills, [partial]);
  assert.deepEqual(store.getSnapshot().workspaces, workspaces);
  assert.equal(store.getSnapshot().listError, 'incomplete');

  await store.refresh();
  assert.deepEqual(store.getSnapshot().skills, [skill]);
  assert.equal(store.getSnapshot().listError, null);
});

test('a refresh started before a write cannot overwrite its resulting state', async () => {
  let resolveStale;
  let staleSignal;
  let reads = 0;
  const store = createCatalog(async (body, signal) => {
    if (body.action === 'setEnabled') {
      assert.deepEqual(body, { action: 'setEnabled', workspaceId: null, id: skill.id, enabled: true });
      return {};
    }
    reads += 1;
    if (reads === 2) {
      staleSignal = signal;
      return new Promise(resolve => { resolveStale = resolve; });
    }
    if (reads === 3) return catalog([], false);
    return catalog();
  });
  await store.refresh();
  const stale = store.refresh();
  assert.equal(await store.mutate({ action: 'setEnabled', id: skill.id, enabled: true }), true);
  assert.equal(staleSignal.aborted, true);
  resolveStale(catalog());
  await stale;
  assert.equal(store.getSnapshot().skills[0].enabled, true);
  assert.equal(store.getSnapshot().listError, 'incomplete');
});

test('switching the selected workspace discards an older scope’s results', async () => {
  let resolveStale;
  const workspaceSkill = { ...skill, id: 'workspace-skill', enabled: null, group: 'workspace' };
  const store = createCatalog(async ({ workspaceId }) => workspaceId === null
    ? new Promise(resolve => { resolveStale = resolve; })
    : catalog([workspaceSkill]));
  const stale = store.refresh();
  await store.setWorkspace('workspace-id');
  resolveStale(catalog());
  await stale;
  assert.equal(store.getSnapshot().workspaceId, 'workspace-id');
  assert.deepEqual(store.getSnapshot().skills, [workspaceSkill]);
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
