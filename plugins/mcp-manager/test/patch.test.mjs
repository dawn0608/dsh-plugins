import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildDelete, buildSave, buildSetEnabled, MCP_CLIENT, readPatch } from '../src/patch.js';
import { matchReference } from '../src/shared/references.js';

const FIXTURE = readFileSync(new URL('./fixtures/patch.yml', import.meta.url), 'utf8');

function draftError(operation) {
  try {
    operation();
  } catch (error) {
    assert.equal(error.name, 'DraftError', `expected a draft error, got ${error.name}: ${error.message}`);
    return error.errors;
  }
  assert.fail('expected a DraftError');
}

function entry(parsed, name) {
  const found = parsed.entries.find(item => item.name === name);
  assert.ok(found, `missing entry ${name}`);
  return found;
}

test('reads the existing rows, transports, enablement and references', () => {
  const parsed = readPatch(FIXTURE);
  assert.deepEqual(parsed.entries.map(item => item.name), ['docs', 'local', 'off']);
  assert.equal(parsed.entries[0].transport, 'streamable-http');
  assert.equal(parsed.entries[1].transport, 'stdio');
  assert.equal(parsed.entries[2].enabled, false);
  assert.equal(parsed.duplicateNames.size, 0);
  assert.deepEqual(matchReference(parsed.entries[0].config.headers.Authorization.__jsExpr), {
    variable: 'DOCS_TOKEN',
    prefix: 'Bearer ',
  });
  assert.deepEqual(matchReference(parsed.entries[0].config.headers['X-Trace'].__jsExpr), {
    variable: 'TRACE_TOKEN',
    prefix: '',
  });
});

test('adds a row with an environment reference and a stable generated id', () => {
  const result = buildSave(FIXTURE, null, {
    name: 'panel-test',
    transport: 'stdio',
    enabled: true,
    command: '/opt/homebrew/opt/node@24/bin/node',
    args: ['/tmp/echo.mjs', '--flag=a b'],
    env: [{ key: 'PANEL_TOKEN', mode: 'ref', variable: 'PANEL_TEST_TOKEN' }],
  });
  assert.equal(result.id, 'mcp-panel-panel-test');
  const parsed = readPatch(result.text);
  const added = entry(parsed, 'panel-test');
  assert.equal(added.enabled, true);
  assert.deepEqual(added.config.args, ['/tmp/echo.mjs', '--flag=a b']);
  assert.match(result.text, /PANEL_TOKEN: !!js 'process\.env\.PANEL_TEST_TOKEN'/);
  assert.match(result.text, /args:\n {6}- "\/tmp\/echo\.mjs"/);
});

test('preserves every other row byte for byte when adding', () => {
  const before = readPatch(FIXTURE);
  const result = buildSave(FIXTURE, null, {
    name: 'second',
    transport: 'streamable-http',
    enabled: false,
    url: 'https://second.example.com/mcp',
  });
  for (const original of before.entries) {
    assert.ok(result.text.includes(original.raw.trimEnd()), `row ${original.name} changed`);
  }
  assert.ok(result.text.includes('# Synthetic profile patch'));
  assert.ok(result.text.includes('- id: ui-extra'));
  assert.equal(readPatch(result.text).entries.find(item => item.name === 'second').enabled, false);
});

test('edits a row in place, keeps its id, and preserves unknown config fields', () => {
  const source = FIXTURE.replace('      transport: stdio\n    disabled: true', '      toolCallTimeoutMs: 5000\n      transport: stdio\n    disabled: true');
  const parsed = readPatch(source);
  const local = entry(parsed, 'local');
  const result = buildSave(source, local, {
    name: 'local',
    transport: 'stdio',
    enabled: true,
    command: '/usr/bin/env',
    args: ['node', '--trace-warnings'],
    cwd: '',
    env: [{ key: 'JAVA_HOME', mode: 'literal', value: '/opt/java' }],
  });
  const after = readPatch(result.text);
  const edited = after.entries.find(item => item.name === 'local');
  assert.equal(edited.id, 'mcp-sync-local');
  assert.deepEqual(edited.config.args, ['node', '--trace-warnings']);
  assert.equal(edited.config.env.JAVA_HOME, '/opt/java');
  assert.equal(after.entries.find(item => item.name === 'docs').raw.trimEnd(), entry(parsed, 'docs').raw.trimEnd());
  assert.equal(after.entries.find(item => item.name === 'off').config.toolCallTimeoutMs, 5000);
});

test('keeps a hidden literal value when the draft says keep', () => {
  const source = FIXTURE.replace(
    "        X-Trace: !!js 'process.env.TRACE_TOKEN'",
    '        X-Api-Key: "plain-text-secret"',
  );
  const parsed = readPatch(source);
  const docs = entry(parsed, 'docs');
  const result = buildSave(source, docs, {
    name: 'docs',
    transport: 'streamable-http',
    enabled: true,
    url: 'https://docs2.example.com/mcp',
    headers: [
      { key: 'Authorization', mode: 'ref', variable: 'DOCS_TOKEN', prefix: 'Bearer ' },
      { key: 'X-Api-Key', mode: 'keep' },
    ],
  });
  assert.ok(result.text.includes('plain-text-secret'));
  assert.ok(result.text.includes('https://docs2.example.com/mcp'));
});

test('disables and re-enables a row at the row level', () => {
  const parsed = readPatch(FIXTURE);
  const docs = entry(parsed, 'docs');
  const disabled = buildSetEnabled(FIXTURE, docs, false);
  const row = readPatch(disabled.text).entries.find(item => item.name === 'docs');
  assert.equal(row.enabled, false);
  assert.match(disabled.text, /disabled: true/);
  const enabled = buildSetEnabled(disabled.text, row, true);
  assert.equal(readPatch(enabled.text).entries.find(item => item.name === 'docs').enabled, true);
  assert.equal((enabled.text.match(/disabled: true/g) || []).length, 1);
});

test('toggling a row preserves hidden literal and opaque expression values', () => {
  const literal = FIXTURE.replace("        X-Trace: !!js 'process.env.TRACE_TOKEN'", '        X-Api-Key: "plain-text-secret"');
  const literalDocs = entry(readPatch(literal), 'docs');
  const toggled = buildSetEnabled(literal, literalDocs, false);
  assert.ok(toggled.text.includes('plain-text-secret'));
  assert.equal(readPatch(toggled.text).entries.find(item => item.name === 'docs').enabled, false);

  const opaque = FIXTURE.replace("        X-Trace: !!js 'process.env.TRACE_TOKEN'", "        X-Custom: !!js lookup('custom')");
  const opaqueDocs = entry(readPatch(opaque), 'docs');
  const toggledAgain = buildSetEnabled(opaque, opaqueDocs, false);
  assert.ok(toggledAgain.text.includes("X-Custom: !!js lookup('custom')"));
});

test('delete removes an added row and restores the original text', () => {
  const added = buildSave(FIXTURE, null, {
    name: 'temp',
    transport: 'stdio',
    enabled: true,
    command: '/bin/echo',
  });
  const row = readPatch(added.text).entries.find(item => item.name === 'temp');
  const removed = buildDelete(added.text, row);
  assert.equal(removed.text, FIXTURE);
});

test('removes an insert block when its last row is deleted', () => {
  const added = buildSave(FIXTURE, null, {
    name: 'solo',
    transport: 'stdio',
    enabled: true,
    command: '/bin/echo',
  });
  const source = added.text.replace('- insert:\n  - id: ui-extra\n    name: \'@deepseek-ai/dsh-extra\'\n', '');
  const parsed = readPatch(source);
  const row = entry(parsed, 'solo');
  const removed = buildDelete(source, row);
  assert.ok(!removed.text.includes('mcp-panel-solo'));
  assert.ok(readPatch(removed.text).entries.every(item => item.name !== 'solo'));
});

test('rejects invalid names, duplicates and missing fields', () => {
  assert.deepEqual(draftError(() => buildSave(FIXTURE, null, { name: '', transport: 'stdio', command: '/bin/echo' })).map(item => item.code), ['required']);
  assert.deepEqual(draftError(() => buildSave(FIXTURE, null, { name: 'bad name', transport: 'stdio', command: '/bin/echo' })).map(item => item.code), ['name-format']);
  assert.deepEqual(draftError(() => buildSave(FIXTURE, null, { name: 'docs', transport: 'stdio', command: '/bin/echo' })).map(item => item.code), ['duplicate']);
  assert.deepEqual(draftError(() => buildSave(FIXTURE, null, { name: 'fresh', transport: 'stdio', command: '' })).map(item => item.code), ['required']);
  assert.deepEqual(draftError(() => buildSave(FIXTURE, null, { name: 'fresh', transport: 'streamable-http', url: '' })).map(item => item.code), ['required']);
  assert.deepEqual(draftError(() => buildSave(FIXTURE, null, { name: 'fresh', transport: 'streamable-http', url: 'ftp://example.com/x' })).map(item => item.code), ['url-invalid']);
  assert.deepEqual(draftError(() => buildSave(FIXTURE, null, {
    name: 'fresh',
    transport: 'stdio',
    command: '/bin/echo',
    env: [{ key: '9BAD', mode: 'literal', value: 'x' }],
  })).map(item => item.code), ['env-name-invalid']);
  assert.deepEqual(draftError(() => buildSave(FIXTURE, null, {
    name: 'fresh',
    transport: 'stdio',
    command: '/bin/echo',
    env: [{ key: 'TOKEN', mode: 'ref', variable: 'bad name' }],
  })).map(item => item.code), ['ref-variable-invalid']);
});

test('rejects editing a duplicated name even when it is the row being edited', () => {
  const doubled = FIXTURE.replace('serverName: off', 'serverName: local');
  const parsed = readPatch(doubled);
  assert.ok(parsed.duplicateNames.has('local'));
  const local = entry(parsed, 'local');
  const errors = draftError(() => buildSave(doubled, local, {
    name: 'local',
    transport: 'stdio',
    enabled: true,
    command: '/usr/bin/env',
    args: ['node'],
  }));
  assert.ok(errors.some(item => item.code === 'duplicate'));
});

test('marks structurally unsupported rows read-only with a reason', () => {
  const source = [
    '- id: top-level-mcp',
    `  name: '${MCP_CLIENT}'`,
    '  config:',
    '    serverName: top',
    '    command: /bin/echo',
    '- insert:',
    '  - id: shape',
    `    name: '${MCP_CLIENT}'`,
    '    config:',
    '      serverName: shape',
    '      command: /bin/echo',
    '      enabled: true',
    '- insert:',
    '  - id: conditional',
    `    name: '${MCP_CLIENT}'`,
    '    disabled: !!js true',
    '    config:',
    '      serverName: conditional',
    '      command: /bin/echo',
    '- insert:',
    '  - id: no-name',
    `    name: '${MCP_CLIENT}'`,
    '    config:',
    '      command: /bin/echo',
    '- insert:',
    '  - id: dup',
    `    name: '${MCP_CLIENT}'`,
    '    config:',
    '      serverName: dup',
    '      command: /bin/echo',
    '  - id: dup',
    `    name: '${MCP_CLIENT}'`,
    '    config:',
    '      serverName: dup2',
    '      command: /bin/echo',
    '',
  ].join('\n');
  const parsed = readPatch(source);
  const reasons = parsed.entries.map(item => [item.id, item.editable, item.readOnlyCode]);
  assert.deepEqual(reasons, [
    ['top-level-mcp', false, 'not-insert'],
    ['shape', false, 'config-enabled'],
    ['conditional', false, 'conditional-disabled'],
    ['no-name', false, 'missing-name'],
    ['dup', false, 'duplicate-id'],
    ['dup', false, 'duplicate-id'],
  ]);
  assert.equal(parsed.entries[2].enabled, null);
});

test('changes only the existing disabled value, preserving comments, references, CRLF and EOF', () => {
  const source = [
    '- insert:',
    '    - id: sample',
    `      name: "${MCP_CLIENT}" # package`,
    '      "disabled": TRUE # leave this comment',
    '      config:',
    '        serverName: sample',
    "        command: '/bin/echo'",
    '        env: { TOKEN: !!js process.env.TEST_TOKEN, EMPTY: null } # keep',
    '        args: []',
    '        other: &setting [x, y] # custom config',
    '# trailing comment',
  ].join('\r\n');
  const expected = source.replace('TRUE', 'false');
  assert.equal(buildSetEnabled(source, entry(readPatch(source), 'sample'), true).text, expected);
  assert.equal(buildSetEnabled(expected, entry(readPatch(expected), 'sample'), true).text, expected);
});

for (const [transport, pairs, settings] of [
  ['stdio', 'env', 'command: /bin/echo'],
  ['streamable-http', 'headers', 'url: https://example.com/mcp'],
]) {
  test(`inserts disabled without rewriting ${pairs} when 65 entries exceed draft limits`, () => {
    const source = [
      '- insert:',
      '  - id: sample # id comment',
      `    name: '${MCP_CLIENT}'`,
      '    config:',
      '      serverName: sample',
      `      transport: ${transport}`,
      `      ${settings}`,
      `      ${pairs}:`,
      '        P0: !!js process.env.MCP_TOKEN',
      ...Array.from({ length: 64 }, (_, i) => `        P${i + 1}: 'v${i + 1}' # preserve`),
    ].join('\n');
    const result = buildSetEnabled(source, entry(readPatch(source), 'sample'), false);
    assert.match(result.text, /(?:^|\n) +(?:- )?disabled: true(?:\n|$)/);
    // Remove only the inserted YAML field, regardless of its position in the map.
    const restored = result.text
      .replace(/(^[ ]*- )disabled: true\n[ ]+(?=id:)/m, '$1')
      .replace(/^[ ]+disabled: true\n/m, '');
    assert.equal(restored, source);
    assert.equal(entry(readPatch(result.text), 'sample').enabled, false);
  });
}

test('marks an MCP row with a foreign insert ID collision read-only across blocks', () => {
  const source = `${FIXTURE}- insert:\n  - id: mcp-sync-docs\n    name: example-other-plugin\n`;
  const row = entry(readPatch(source), 'docs');
  assert.equal(row.editable, false);
  assert.equal(row.readOnlyCode, 'duplicate-id');
  assert.throws(() => buildSetEnabled(source, row, false), { code: 'read-only' });
});

test('refuses a toggle when another setting aliases the disabled value', () => {
  const source = [
    '- insert:',
    '  - id: one',
    "    name: '@deepseek-ai/dsh-mcp-client'",
    '    disabled: &status true',
    '    config: {serverName: one, command: /bin/echo, customOption: *status}',
    '',
  ].join('\n');
  assert.throws(
    () => buildSetEnabled(source, entry(readPatch(source), 'one'), true),
    { code: 'verify-failed' },
  );
});

test('local service names do not inherit another application’s reserved names', () => {
  const result = buildSave(FIXTURE, null, { name: 'node_repl', transport: 'stdio', command: 'node' });
  assert.ok(readPatch(result.text).entries.some(item => item.name === 'node_repl'));
});
