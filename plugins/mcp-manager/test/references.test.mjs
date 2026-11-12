import assert from 'node:assert/strict';
import test from 'node:test';
import { redactForLog } from '../src/shared/references.js';

test('redacts bearer tokens, assignments and provider-shaped keys from logs', () => {
  assert.equal(redactForLog('Authorization: Bearer abcdef123456'), 'Authorization: ***');
  assert.equal(redactForLog('MCP_TOKEN=super-secret-value'), 'MCP_TOKEN=***');
  assert.equal(redactForLog('key sk-1234567890abcdef'), 'key ***');
  assert.equal(redactForLog('plain message'), 'plain message');
});
