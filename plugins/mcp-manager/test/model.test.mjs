import assert from 'node:assert/strict';
import test from 'node:test';
import { serverLabel, serverStatus, transportLabel } from '../src/client/model.js';

const translate = (key, params) => (params && params.name ? `${key}:${params.name}` : key);

test('localizes transport names and falls back for unknown transports', () => {
  assert.equal(transportLabel({ transport: 'stdio' }, translate), 'transportStdio');
  assert.equal(transportLabel({ transport: 'streamable-http' }, translate), 'transportHttp');
  assert.equal(transportLabel({ transport: 'other' }, translate), 'transportUnknown');
});

test('derives the row status from enablement and tool discovery', () => {
  assert.deepEqual(serverStatus({ enabled: false, tools: 3 }, translate), { tone: 'muted', text: 'disabled', dot: false });
  assert.deepEqual(serverStatus({ enabled: true, tools: null }, translate), { tone: 'muted', text: 'toolsUnknown', dot: false });
  assert.deepEqual(serverStatus({ enabled: true, tools: 0 }, translate), { tone: 'warn', text: 'toolsNone', dot: true });
  assert.deepEqual(serverStatus({ enabled: true, tools: 4 }, translate), { tone: 'success', text: 'tools', dot: true });
});

test('labels unnamed rows by id and then by a localized fallback', () => {
  assert.equal(serverLabel({ name: 'docs', id: 'x' }, translate), 'docs');
  assert.equal(serverLabel({ name: '', id: 'mcp-panel-x' }, translate), 'mcp-panel-x');
  assert.equal(serverLabel({}, translate), 'unknownName');
});
