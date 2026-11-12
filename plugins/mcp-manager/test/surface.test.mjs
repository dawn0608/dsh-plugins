import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createApi } from '../src/routes.js';
import { stateFromText } from '../src/store.js';

test('removed mutation APIs reject requests without invoking a writer', async () => {
  const api = createApi({ store: { save() { assert.fail('save called'); }, remove() { assert.fail('remove called'); } }, log() {} });
  for (const action of ['save', 'delete', 'deleteShared']) {
    const result = await api({ method: 'POST', headers: { 'x-dsh-mcp-manager': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ action, mode: 'add' }) });
    assert.equal(result.status, 400, action);
  }
});

test('list returns only the fields used by the local enablement page', () => {
  const value = stateFromText(readFileSync(new URL('./fixtures/patch.yml', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(value).sort(), ['ok', 'servers']);
  assert.deepEqual(Object.keys(value.servers[0]).sort(), ['duplicate', 'editable', 'enabled', 'id', 'name', 'readOnlyCode', 'rowHash', 'transport']);
});
