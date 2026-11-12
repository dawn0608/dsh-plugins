import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DICTS, translateFrom } from '../src/client/i18n.js';

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

test('each plugin locale points to its own packaged detail document', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  for (const language of ['en', 'zh']) {
    const meta = readLocale(language).meta;
    assert.equal(typeof meta?.title, 'string', `${language} meta.title`);
    assert.equal(typeof meta?.description, 'string', `${language} meta.description`);
    assert.notEqual(meta.title.trim(), '');
    assert.notEqual(meta.description.trim(), '');
    const expected = language === 'zh' ? 'README.zh.md' : 'README.md';
    assert.equal(meta.detail, expected);
    assert.ok(manifest.files.includes(expected));
    assert.match(readFileSync(new URL(`../${expected}`, import.meta.url), 'utf8'), new RegExp(`^# ${meta.title}\\n`));
  }
});

test('format interpolates named placeholders and leaves unknown ones', () => {
  assert.equal(translateFrom(DICTS.zh, 'openDetail', { name: 'example' }), '查看 example');
  assert.match(translateFrom(DICTS.en, 'openDetail', {}), /\{name\}/);
});
