import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDraft } from '../src/shared/draft.js';
import {
  blankForm,
  blankPair,
  contextFor,
  errorText,
  fieldLocation,
  formToDraft,
  pairToForm,
  serverToForm,
  validateForm,
} from '../src/client/model.js';

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

test('maps API servers into form drafts and back', () => {
  const server = {
    name: 'docs',
    transport: 'streamable-http',
    enabled: false,
    config: {
      url: 'https://example.com/mcp',
      headers: [
        { key: 'Authorization', mode: 'ref', variable: 'DOCS_TOKEN', prefix: 'Bearer ' },
        { key: 'X-Api-Key', mode: 'literal', secret: true, configured: true },
        { key: 'X-Trace', mode: 'literal', value: 'abc' },
      ],
    },
  };
  const form = serverToForm(server);
  assert.equal(form.enabled, false);
  assert.equal(form.url, 'https://example.com/mcp');
  assert.deepEqual(form.headers.map(pair => pair.mode), ['ref', 'keep', 'literal']);
  const draft = formToDraft(form);
  assert.equal(draft.transport, 'streamable-http');
  assert.equal(draft.headers[1].mode, 'keep');
  assert.equal(draft.headers[2].value, 'abc');
});

test('form round-trips a stdio server and keeps empty lines out of args', () => {
  const form = serverToForm({
    name: 'local',
    transport: 'stdio',
    enabled: true,
    config: { command: '/bin/echo', args: ['a', 'b'], cwd: '', env: [] },
  });
  assert.equal(form.argsText, 'a\nb');
  form.argsText = 'a\n\n b \n';
  assert.deepEqual(formToDraft(form).args, ['a', 'b']);
});

test('blank helpers and context follow the page contract', () => {
  const form = blankForm();
  assert.equal(form.transport, 'stdio');
  assert.deepEqual(blankPair(), { key: '', mode: 'literal', value: '', variable: '', prefix: '' });
  const context = contextFor([
    { name: 'docs', config: { headers: [{ key: 'A' }] } },
    { name: 'local', config: { env: [{ key: 'B' }] } },
  ], { name: 'docs', config: { headers: [{ key: 'A' }] } });
  assert.deepEqual(context.names.sort(), ['docs', 'local']);
  assert.equal(context.selfName, 'docs');
  assert.deepEqual(context.existingHeaderKeys, ['A']);
  assert.deepEqual(context.existingEnvKeys, []);
  assert.equal(pairToForm({ key: 'A', mode: 'expr', configured: true }).mode, 'keep');
});

test('field errors localize and field locations parse', () => {
  const translate = (key, params) => (params && params.name ? `${key}:${params.name}` : key);
  assert.equal(errorText(translate, { code: 'duplicate', params: { name: 'docs' } }), 'nameDuplicate:docs');
  assert.equal(errorText(translate, { code: 'nope' }), 'invalid');
  assert.deepEqual(fieldLocation('env[2].value'), { group: 'env', index: 2, side: 'value', field: 'env[2].value' });
  assert.deepEqual(fieldLocation('name'), { field: 'name' });
});

test('the shared validator drives the page form validation', () => {
  const form = blankForm();
  form.name = 'x';
  form.command = '';
  const { errors } = validateForm(form, { names: [] });
  assert.deepEqual(errors.map(item => item.code), ['required']);
});
