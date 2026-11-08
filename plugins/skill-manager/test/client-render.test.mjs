import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemoveDialog } from '../src/client/dialog.js';
import { DICTS, translateFrom } from '../src/client/i18n.js';
import { createPage } from '../src/client/page.js';

const skills = [
  { id: 'managed', name: 'managed-skill', description: 'Imported description', group: 'imported', source: 'profile', enabled: true, shadowed: false },
  { id: 'local', name: 'local-skill', description: 'Local description', group: 'local', source: 'user-agents', enabled: null, shadowed: true, origin: 'self' },
  { id: 'builtin', name: 'builtin-skill', description: 'Built-in description', group: 'builtin', source: 'bundled', enabled: null, shadowed: false, origin: 'builtin' },
  { id: 'external', name: 'external-skill', description: 'Third-party description', group: 'local', source: 'user-agents', enabled: null, shadowed: false, origin: 'third-party' },
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
  const snapshot = { skills, busy: false, listError: null, ...patch };
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

test('Skills shows localized controls and one independent switch for imported rows', () => {
  for (const lang of ['zh', 'en']) {
    const html = render(lang);
    assert.match(html, new RegExp(`<h1[^>]*>${DICTS[lang].title}</h1>`));
    assert.ok(html.includes(`aria-label="${DICTS[lang].search}"`));
    assert.equal((html.match(/role="switch"/g) || []).length, 1);
    assert.match(html, /<button[^>]*data-skill-id="managed"[^>]*aria-describedby="([^"]+)"[^>]*>managed-skill<\/button><\/div><span[^>]*id="\1">Imported description<\/span><\/div>.*?<button[^>]*role="switch"[^>]*aria-checked="true"/);
    assert.match(html, /builtin-skill.*local-skill.*managed-skill.*external-skill/);
    assert.doesNotMatch(html, /<a\b/);
    assert.ok(html.includes(DICTS[lang].shadowed));
  }
});

test('an incomplete refresh shows its warning alongside the existing catalog', () => {
  const html = render('en', { listError: 'incomplete' });
  assert.ok(html.includes(DICTS.en.incomplete));
  assert.ok(html.includes('managed-skill'));
});

test('a disabled shared skill remains visible and can be switched on', () => {
  const html = render('zh', { skills: [{ ...skills[1], enabled: false }, skills[2]] });
  assert.equal((html.match(/role="switch"/g) || []).length, 1);
  assert.match(html, /local-skill.*role="switch"[^>]*aria-checked="false"/);
});

test('the catalog has a minimal header and shows three ordered provenance groups in both languages', () => {
  const english = render('en');
  const chinese = render('zh');
  assert.match(english, /<h2[^>]*>Built-in skills<\/h2>.*<h2[^>]*>Self-authored skills<\/h2>.*<h2[^>]*>Third-party skills<\/h2>.*managed-skill/);
  assert.match(chinese, /<h2[^>]*>内置技能<\/h2>.*<h2[^>]*>自建技能<\/h2>.*<h2[^>]*>第三方技能<\/h2>.*managed-skill/);
  assert.doesNotMatch(render('zh', { skills: [skills[0]] }), /内置技能|自建技能/);
  assert.doesNotMatch(english, /<select\b|Add skill|Browse and manage skills in Harness/);
  assert.doesNotMatch(chinese, /<select\b|添加技能|浏览和管理 Harness 中的技能/);
});

test('uninstall confirmation describes removing the imported copy from Harness', () => {
  const html = renderToStaticMarkup(React.createElement(RemoveDialog, {
    skill: skills[0],
    translate: (key, params) => translateFrom(DICTS.en, key, params),
  }));
  assert.match(html, /Remove the imported copy of “managed-skill” from Harness\?/);
  assert.match(html, /<button[^>]*data-initial-focus=""[^>]*>Cancel<\/button>/);
});
