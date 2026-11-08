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

test('the plugin manager opens the packaged detail in the selected language', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const [language, title, detail] of [
    ['zh', '费用概览', 'README.zh.md'],
    ['en', 'Cost Overview', 'README.md'],
  ]) {
    const { meta } = readLocale(language);
    assert.equal(meta.title, title);
    assert.equal(DICTS[language].panelTitle, title);
    assert.ok(meta.description.trim());
    assert.equal(meta.detail, detail);
    assert.ok(pkg.files.includes(detail));
    const readme = readFileSync(new URL(`../${detail}`, import.meta.url), 'utf8');
    assert.equal(readme.split('\n', 1)[0], `# ${title}`);
  }
});

test('format interpolates named placeholders and leaves unknown ones', () => {
  assert.equal(format('{count} 次', { count: 3 }), '3 次');
  assert.equal(format('{missing}', {}), '{missing}');
});
