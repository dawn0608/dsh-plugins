import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RemoveDialog } from '../src/client/dialog.js';
import { DICTS, translateFrom } from '../src/client/i18n.js';
import { createPage } from '../src/client/page.js';

const skills = [
  { id: 'managed', name: 'managed-skill', description: 'Imported description', group: 'imported', source: 'profile', enabled: true, shadowed: false },
  { id: 'workspace', name: 'workspace-skill', description: 'Workspace description', group: 'workspace', source: 'workspace', enabled: null, shadowed: false },
  { id: 'local', name: 'local-skill', description: 'Local description', group: 'local', source: 'user', enabled: null, shadowed: true },
  { id: 'builtin', name: 'builtin-skill', description: 'Built-in description', group: 'builtin', source: 'builtin', enabled: null, shadowed: false },
];

function render(language, patch = {}) {
  const snapshot = { skills, workspaces: [{ id: 'one', title: 'Workspace One' }], workspaceId: null, busy: false, listError: null, ...patch };
  const store = {
    subscribe: () => () => {}, getSnapshot: () => snapshot,
    start() {}, stop() {},
  };
  const locale = {
    bind: () => (key, params) => translateFrom(DICTS[language], key, params),
    subscribe: () => () => {}, getSnapshot: () => ({ active: language, revision: 1 }),
  };
  const Page = createPage(locale, () => store);
  return renderToStaticMarkup(React.createElement(Page));
}

test('Skills shows localized controls and one independent switch for imported rows', () => {
  for (const lang of ['zh', 'en']) {
    const html = render(lang);
    assert.match(html, new RegExp(`<h1[^>]*>${DICTS[lang].title}</h1>`));
    assert.ok(html.includes(`aria-label="${DICTS[lang].search}"`));
    assert.ok(html.includes(`aria-label="${DICTS[lang].workspaceSelector}"`));
    assert.ok(html.includes('Workspace One'));
    assert.equal((html.match(/role="switch"/g) || []).length, 1);
    assert.match(html, /<button[^>]*data-skill-id="managed"[^>]*>(?:(?!<\/button>).)*managed-skill(?:(?!<\/button>).)*Imported description(?:(?!<\/button>).)*<\/button><button[^>]*role="switch"[^>]*aria-checked="true"/);
    assert.match(html, /workspace-skill.*local-skill.*builtin-skill/);
    assert.ok(html.includes(DICTS[lang].shadowed));
  }
});

test('an incomplete refresh shows its warning alongside the existing catalog', () => {
  const html = render('en', { listError: 'incomplete' });
  assert.ok(html.includes(DICTS.en.incomplete));
  assert.ok(html.includes('managed-skill'));
});

test('the add action is primary and the catalog labels shared skills and its global scope', () => {
  const english = render('en');
  const chinese = render('zh');
  assert.match(english, /<button[^>]*class="dshskill_control dshskill_primary"[^>]*>[^]*?Add skill<\/button>/);
  assert.match(english, /<option value="" selected="">Global<\/option>/);
  assert.match(english, /<h2[^>]*>Shared &amp; local<\/h2>/);
  assert.match(chinese, /<option value="" selected="">全局<\/option>/);
  assert.match(chinese, /<h2[^>]*>共享与本地<\/h2>/);
});

test('uninstall confirmation describes removing the imported copy from Harness', () => {
  const html = renderToStaticMarkup(React.createElement(RemoveDialog, {
    skill: skills[0],
    translate: (key, params) => translateFrom(DICTS.en, key, params),
  }));
  assert.match(html, /Remove the imported copy of “managed-skill” from Harness\?/);
  assert.match(html, /<button[^>]*data-initial-focus=""[^>]*>Cancel<\/button>/);
});
