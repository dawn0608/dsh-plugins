import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DICTS, format } from '../src/client/i18n.js';
import { ERROR_KEYS } from '../src/client/model.js';

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

test('every validation error code has copy in both languages', () => {
  for (const key of Object.values(ERROR_KEYS)) {
    assert.equal(typeof DICTS.zh[key], 'string', `zh missing ${key}`);
    assert.equal(typeof DICTS.en[key], 'string', `en missing ${key}`);
  }
});

test('locale metadata carries a title and description in both languages', () => {
  for (const language of ['en', 'zh']) {
    const meta = readLocale(language).meta;
    assert.equal(typeof meta?.title, 'string', `${language} meta.title`);
    assert.equal(typeof meta?.description, 'string', `${language} meta.description`);
    assert.notEqual(meta.title.trim(), '');
    assert.notEqual(meta.description.trim(), '');
  }
});

test('format interpolates named placeholders and leaves unknown ones', () => {
  assert.equal(format('{count} 次', { count: 3 }), '3 次');
  assert.equal(format('{missing}', {}), '{missing}');
});
