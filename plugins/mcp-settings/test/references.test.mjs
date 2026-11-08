import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeValue,
  isExpression,
  isSensitiveKey,
  matchReference,
  quoteDouble,
  quoteSingle,
  redactForLog,
  referenceExpression,
} from '../src/shared/references.js';

test('recognizes the two reference shapes', () => {
  assert.deepEqual(matchReference('process.env.MCP_TOKEN'), { variable: 'MCP_TOKEN', prefix: '' });
  assert.deepEqual(matchReference('`Bearer ${process.env.MCP_TOKEN}`'), { variable: 'MCP_TOKEN', prefix: 'Bearer ' });
  assert.deepEqual(matchReference('  process.env.A_1  '), { variable: 'A_1', prefix: '' });
  assert.equal(matchReference('process.env.BAD NAME'), null);
  assert.equal(matchReference('`${process.env.A}${process.env.B}`'), null);
  assert.equal(matchReference('`Bearer ${process.env.A} trailing`'), null);
  assert.equal(matchReference('lookup()'), null);
});

test('encodes references back into Loader expressions', () => {
  assert.equal(referenceExpression({ variable: 'MCP_TOKEN', prefix: '' }), 'process.env.MCP_TOKEN');
  assert.equal(referenceExpression({ variable: 'MCP_TOKEN', prefix: 'Bearer ' }), '`Bearer ${process.env.MCP_TOKEN}`');
});

test('describes values without returning secret literals', () => {
  assert.deepEqual(describeValue('PATH', '/usr/bin'), { mode: 'literal', value: '/usr/bin', secret: false });
  assert.deepEqual(describeValue('Authorization', 'Bearer plain'), { mode: 'literal', secret: true, configured: true });
  assert.deepEqual(describeValue('X-Token', { __jsExpr: 'process.env.T' }), { mode: 'ref', variable: 'T', prefix: '' });
  assert.deepEqual(describeValue('Authorization', { __jsExpr: '`Bearer ${process.env.T}`' }), {
    mode: 'ref',
    variable: 'T',
    prefix: 'Bearer ',
  });
  assert.deepEqual(describeValue('Authorization', { __jsExpr: 'lookup()' }), { mode: 'expr', configured: true, secret: true });
  assert.deepEqual(describeValue('EMPTY', undefined), { mode: 'literal', configured: false, secret: false });
  assert.equal(isExpression({ __jsExpr: 'x' }), true);
  assert.equal(isExpression('x'), false);
});

test('sensitive keys follow the documented heuristic', () => {
  for (const key of ['Authorization', 'X-Api-Key', 'MCP_TOKEN', 'client_secret', 'password', 'Cookie']) {
    assert.equal(isSensitiveKey(key), true, key);
  }
  for (const key of ['PATH', 'JAVA_HOME', 'X-Trace', 'Accept']) {
    assert.equal(isSensitiveKey(key), false, key);
  }
});

test('redacts bearer tokens, assignments and provider-shaped keys from logs', () => {
  assert.equal(redactForLog('Authorization: Bearer abcdef123456'), 'Authorization: ***');
  assert.equal(redactForLog('MCP_TOKEN=super-secret-value'), 'MCP_TOKEN=***');
  assert.equal(redactForLog('key sk-1234567890abcdef'), 'key ***');
  assert.equal(redactForLog('plain message'), 'plain message');
});

test('quotes YAML scalars safely', () => {
  assert.equal(quoteSingle("it's"), "'it''s'");
  assert.equal(quoteDouble('a"b'), '"a\\"b"');
  assert.equal(quoteDouble('line\nbreak'), '"line\\nbreak"');
});
