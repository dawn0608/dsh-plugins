import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDraft } from '../src/shared/draft.js';

function codes(result) {
  return result.errors.map(item => item.code);
}

test('accepts a valid stdio draft', () => {
  const result = validateDraft({
    name: 'local',
    transport: 'stdio',
    command: '/opt/homebrew/bin/node',
    args: ['server.mjs', '--flag=1'],
    env: [{ key: 'TOKEN', mode: 'ref', variable: 'MCP_TOKEN' }],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.draft.transport, 'stdio');
  assert.deepEqual(result.draft.args, ['server.mjs', '--flag=1']);
});

test('accepts a valid streamable-http draft with a header reference', () => {
  const result = validateDraft({
    name: 'remote',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: [{ key: 'Authorization', mode: 'ref', variable: 'MCP_TOKEN', prefix: 'Bearer ' }],
  });
  assert.deepEqual(result.errors, []);
});

test('rejects illegal names, reserved names and live duplicates', () => {
  assert.deepEqual(codes(validateDraft({ name: 'bad name', transport: 'stdio', command: '/bin/echo' })), ['name-format']);
  assert.deepEqual(codes(validateDraft({ name: 'x'.repeat(33), transport: 'stdio', command: '/bin/echo' })), ['name-format']);
  assert.deepEqual(codes(validateDraft({ name: 'node_repl', transport: 'stdio', command: '/bin/echo' })), ['name-reserved']);
  assert.deepEqual(codes(validateDraft({ name: 'docs', transport: 'stdio', command: '/bin/echo' }, { names: ['docs'] })), ['duplicate']);
  assert.deepEqual(codes(validateDraft({ name: 'docs', transport: 'stdio', command: '/bin/echo' }, { names: ['docs'], selfName: 'docs' })), []);
});

test('validates required transport fields and URLs', () => {
  assert.deepEqual(codes(validateDraft({ name: 'a', transport: 'stdio' })), ['required']);
  assert.deepEqual(codes(validateDraft({ name: 'a', transport: 'streamable-http' })), ['required']);
  assert.deepEqual(codes(validateDraft({ name: 'a', transport: 'streamable-http', url: 'https://user:pass@example.com/x' })), ['url-invalid']);
  assert.deepEqual(codes(validateDraft({ name: 'a', transport: 'streamable-http', url: 'ftp://example.com/x' })), ['url-invalid']);
  assert.deepEqual(codes(validateDraft({ name: 'a', transport: 'streamable-http', url: 'not a url' })), ['url-invalid']);
});

test('validates pair names, duplicates and reference shapes', () => {
  assert.deepEqual(codes(validateDraft({
    name: 'a',
    transport: 'stdio',
    command: '/bin/echo',
    env: [
      { key: 'A', mode: 'literal', value: '1' },
      { key: 'A', mode: 'literal', value: '2' },
    ],
  })), ['duplicate']);
  assert.deepEqual(codes(validateDraft({
    name: 'a',
    transport: 'stdio',
    command: '/bin/echo',
    env: [{ key: 'BAD-NAME', mode: 'literal', value: '1' }],
  })), ['env-name-invalid']);
  assert.deepEqual(codes(validateDraft({
    name: 'a',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: [{ key: 'Bad Header', mode: 'literal', value: '1' }],
  })), ['header-name-invalid']);
  assert.deepEqual(codes(validateDraft({
    name: 'a',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: [{ key: 'X', mode: 'ref', variable: '9BAD' }],
  })), ['ref-variable-invalid']);
  assert.deepEqual(codes(validateDraft({
    name: 'a',
    transport: 'stdio',
    command: '/bin/echo',
    env: [{ key: 'A', mode: 'ref', variable: 'A', prefix: 'x' }],
  })), ['ref-prefix-invalid']);
  assert.deepEqual(codes(validateDraft({
    name: 'a',
    transport: 'stdio',
    command: '/bin/echo',
    env: [{ key: 'A', mode: 'keep' }],
  })), ['keep-unavailable']);
  assert.deepEqual(codes(validateDraft({
    name: 'a',
    transport: 'stdio',
    command: '/bin/echo',
    env: [{ key: 'A', mode: 'keep' }],
  }, { existingEnvKeys: ['A'] })), []);
});
