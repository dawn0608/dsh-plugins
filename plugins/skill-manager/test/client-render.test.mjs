import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { DICTS, translateFrom } from '../src/client/i18n.js';
import { createPage } from '../src/client/page.js';

const skills = [
  { id: 'harness', name: 'harness-skill', description: 'Harness description', source: 'user-dsh' },
  { id: 'local', name: 'local-skill', description: 'Local description', source: 'user-agents', origin: 'self' },
  { id: 'builtin', name: 'builtin-skill', description: 'Built-in description', source: 'bundled', origin: 'builtin' },
  { id: 'external', name: 'external-skill', description: 'Third-party description', source: 'user-agents', origin: 'third-party' },
];

const controls = {
  BackIcon: () => null,
  Input: ({ icon, ...props }) => React.createElement(React.Fragment, null, icon, React.createElement('input', props)),
  SearchIcon: () => null,
  SkillEmblem: () => null,
  StateDot: () => null,
  Switch: ({ checked, label, disabled }) => React.createElement('button', {
    type: 'button', role: 'switch', 'aria-label': label, 'aria-checked': checked, disabled,
  }),
  Tag: ({ children }) => React.createElement('span', null, children),
};

function render(language, patch = {}) {
  const snapshot = { skills, listError: null, ...patch };
  const store = {
    subscribe: () => () => {}, getSnapshot: () => snapshot,
    start() {}, stop() {},
  };
  const locale = {
    bind: () => (key, params) => translateFrom(DICTS[language], key, params),
    subscribe: () => () => {}, getSnapshot: () => ({ active: language, revision: 1 }),
  };
  const Page = createPage(locale, controls, () => store);
  return renderToStaticMarkup(React.createElement(Page));
}

test('Skills shows localized read-only rows and their accessible descriptions', () => {
  for (const lang of ['zh', 'en']) {
    const html = render(lang);
    assert.match(html, new RegExp(`<h1[^>]*>${DICTS[lang].title}</h1>`));
    assert.ok(html.includes(`aria-label="${DICTS[lang].search}"`));
    assert.doesNotMatch(html, /role="switch"/);
    assert.match(html, /<button[^>]*data-skill-id="harness"[^>]*aria-describedby="([^"]+)"[^>]*>harness-skill<\/button><\/div><span[^>]*id="\1">Harness description<\/span>/);
    assert.match(html, /builtin-skill.*local-skill.*harness-skill.*external-skill/);
    assert.doesNotMatch(html, /<a\b/);
    assert.doesNotMatch(html, /Shadowed|已被覆盖/);
  }
});

test('an incomplete refresh shows its warning alongside the existing catalog', () => {
  const html = render('en', { listError: 'incomplete' });
  assert.ok(html.includes(DICTS.en.incomplete));
  assert.ok(html.includes('harness-skill'));
});

test('even a stale row with enablement fields cannot expose a skill switch', () => {
  const html = render('zh', { skills: [{ ...skills[1], canToggle: true, enabled: false }, skills[2]] });
  assert.match(html, /local-skill/);
  assert.doesNotMatch(html, /role="switch"/);
});

test('the catalog has a minimal header and shows three ordered provenance groups in both languages', () => {
  const english = render('en');
  const chinese = render('zh');
  assert.match(english, /<h2[^>]*>Built-in skills<\/h2>.*<h2[^>]*>Self-authored skills<\/h2>.*<h2[^>]*>Third-party skills<\/h2>.*harness-skill/);
  assert.match(chinese, /<h2[^>]*>内置技能<\/h2>.*<h2[^>]*>自建技能<\/h2>.*<h2[^>]*>第三方技能<\/h2>.*harness-skill/);
  assert.doesNotMatch(render('zh', { skills: [skills[0]] }), /内置技能|自建技能/);
  assert.doesNotMatch(english, /<select\b|Add skill|Browse and manage skills in Harness/);
  assert.doesNotMatch(chinese, /<select\b|添加技能|浏览和管理 Harness 中的技能/);
});

test('opening a read-only detail keeps preview, attribution and return focus without write requests', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com' });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    calls.push(JSON.parse(options.body));
    return Response.json({ ok: true, value: { body: '# Sample', origin: 'third-party', repository: 'https://github.com/example/skill' } });
  });
  const snapshot = { skills: [{ ...skills[0], canToggle: true, enabled: true }], listError: null };
  const store = { subscribe: () => () => {}, getSnapshot: () => snapshot, start() {}, stop() {} };
  const locale = { bind: () => (key, params) => translateFrom(DICTS.en, key, params),
    subscribe: () => () => {}, getSnapshot: () => ({ active: 'en', revision: 1 }) };
  const Page = createPage(locale, { ...controls, SkillDocument: ({ preview }) => React.createElement('article', null, preview?.body) }, () => store);
  await React.act(() => root.render(React.createElement(Page)));
  document.querySelector('.dshskill_page').scrollTop = 120;
  await React.act(() => document.querySelector('[data-skill-id="harness"]').click());
  assert.equal(document.querySelector('[role="switch"]'), null);
  assert.equal(document.activeElement, document.querySelector('h1'));
  assert.equal(document.querySelector('article').textContent, '# Sample');
  const link = document.querySelector('a');
  assert.equal(link.href, 'https://github.com/example/skill');
  assert.equal(link.textContent, 'example/skill↗');
  assert.equal(link.rel, 'noopener noreferrer');
  await React.act(() => document.querySelector('[aria-label="Back to Skills"]').click());
  assert.equal(document.activeElement, document.querySelector('[data-skill-id="harness"]'));
  assert.equal(document.querySelector('.dshskill_page').scrollTop, 120);
  assert.deepEqual(calls, [{ action: 'detail', id: 'harness' }]);
});
