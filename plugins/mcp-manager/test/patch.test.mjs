import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildSetEnabled, MCP_CLIENT, readPatch } from '../src/patch.js';

const FIXTURE = readFileSync(new URL('./fixtures/patch.yml', import.meta.url), 'utf8');

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
  test(`inserts disabled without rewriting ${pairs} with 65 entries`, () => {
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
