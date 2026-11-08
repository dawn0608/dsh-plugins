import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DICTS, format } from '../src/client/i18n.js';

function readLocale(language) {
  return JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'));
}

test('client zh/en dictionaries expose identical key sets', () => {
  const zh = Object.keys(DICTS.zh).sort();
  const en = Object.keys(DICTS.en).sort();
  assert.ok(zh.length > 0);
  assert.deepEqual(zh, en);
  for (const dictionary of [DICTS.zh, DICTS.en]) {
    for (const [key, value] of Object.entries(dictionary)) {
      assert.equal(typeof value, 'string', `${key} must be a string`);
      assert.notEqual(value.trim(), '', `${key} must not be empty`);
    }
  }
});

test('locale metadata points to a packaged detail document in both languages', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const [language, title] of Object.entries({ en: 'MCP Management', zh: 'MCP 管理' })) {
    const meta = readLocale(language).meta;
    assert.equal(meta?.title, title);
    assert.equal(DICTS[language].title, title);
    assert.equal(typeof meta?.description, 'string', `${language} meta.description`);
    assert.notEqual(meta.description.trim(), '');
    assert.ok(pkg.files.includes(meta.detail), `${language} meta.detail must name a packaged file`);
    const document = readFileSync(new URL(`../${meta.detail}`, import.meta.url), 'utf8');
    assert.equal(document.split('\n', 1)[0], `# ${title}`);
  }
});

test('format interpolates named placeholders and leaves unknown ones', () => {
  assert.equal(format('{count} 次', { count: 3 }), '3 次');
  assert.equal(format('{missing}', {}), '{missing}');
});
