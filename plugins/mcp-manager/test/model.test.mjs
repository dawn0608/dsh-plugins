import assert from 'node:assert/strict';
import test from 'node:test';
import { serverLabel, transportLabel } from '../src/client/model.js';

const translate = (key, params) => (params && params.name ? `${key}:${params.name}` : key);

test('localizes supported transport names and leaves unknown transports unlabeled', () => {
  assert.equal(transportLabel({ transport: 'stdio' }, translate), 'transportStdio');
  assert.equal(transportLabel({ transport: 'streamable-http' }, translate), 'transportHttp');
  assert.equal(transportLabel({ transport: 'other' }, translate), null);
});

test('labels unnamed rows by id and then by a localized fallback', () => {
  assert.equal(serverLabel({ name: 'docs', id: 'x' }, translate), 'docs');
  assert.equal(serverLabel({ name: '', id: 'mcp-panel-x' }, translate), 'mcp-panel-x');
  assert.equal(serverLabel({}, translate), 'unknownName');
});
