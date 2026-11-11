import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DICTS, format } from '../src/client/i18n.js';
import { createPage } from '../src/client/page.js';

// The Harness module loader supplies this control in the installed app.
function Switch({ checked, label, disabled }) {
  return React.createElement('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled });
}

function Tag({ tone, children }) {
  return React.createElement('span', { 'data-native-tag': tone }, children);
}

function createPageWith(snapshot, translate) {
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    start: () => {},
    stop: () => {},
    setEnabled: async () => ({ ok: true }),
    dispose: () => {},
  };
  return createPage({
    translate,
    Switch,
    Tag,
    subscribeLocale: () => () => {},
    localeVersion: () => 0,
    createStore: () => controller,
  });
}

function render(snapshot, translate = key => key) {
  const Page = createPageWith(snapshot, translate);
  return renderToStaticMarkup(React.createElement(Page));
}

const BASE_STATE = {
  ok: true,
  profile: 'desktop',
  patchPath: '/tmp/cordis.patch.yml',
  revision: 'a'.repeat(64),
  warnings: [],
};

test('renders each transport immediately before its switch without tool status in either language', () => {
  const snapshot = {
    status: 'ready',
    error: null,
    busy: null,
    state: {
      ...BASE_STATE,
      servers: [
        {
          id: 'mcp-sync-docs',
          name: 'docs',
          transport: 'streamable-http',
          enabled: true,
          editable: true,
          deletable: true,
          rowHash: 'r1',
          tools: 2,
          duplicate: false,
          config: { url: 'https://example.com/mcp', headers: [] },
        },
        {
          id: 'mcp-sync-off',
          name: 'off',
          transport: 'stdio',
          enabled: false,
          editable: true,
          deletable: true,
          rowHash: 'r2',
          tools: 0,
          duplicate: true,
          config: { command: '/bin/echo', args: ['hello'], cwd: '', env: [] },
        },
      ],
    },
  };
  for (const dict of Object.values(DICTS)) {
    const html = render(snapshot, (key, params) => format(dict[key], params));
    assert.ok(html.includes(`>${dict.title}<`));
    assert.match(html, />docs<.*>Streamable HTTP<\/span><button[^>]*role="switch" aria-checked="true"/);
    assert.match(html, />off<.*>STDIO<\/span><button[^>]*role="switch" aria-checked="false"/);
    assert.ok(html.includes(`data-native-tag="warning">${dict.duplicate}<`));
    assert.doesNotMatch(html, /工具|\btools?\b|dshmcp_dot|本地|远程|\b(?:local|remote)\b/i);
    assert.doesNotMatch(html, /\/tmp\/cordis\.patch\.yml|https:\/\/example\.com\/mcp|\/bin\/echo hello|<form/);
    assert.equal((html.match(/<button\b/g) || []).length, 2);
  }
});

test('renders the empty and error states instead of throwing', () => {
  const empty = render({
    status: 'ready',
    error: null,
    busy: null,
    state: { ...BASE_STATE, servers: [] },
  });
  assert.match(empty, /emptyTitle/);
  assert.doesNotMatch(empty, /emptyHint/);

  const failed = render({ status: 'error', state: null, error: { code: 'network' }, busy: null });
  assert.match(failed, /loadFailed/);
  assert.doesNotMatch(failed, /<button/);
});

test('renders a read-only row without a switch or edit action', () => {
  const html = render({
    status: 'ready',
    error: null,
    busy: null,
    state: {
      ...BASE_STATE,
      servers: [
        {
          id: 'top',
          name: null,
          transport: null,
          enabled: true,
          editable: false,
          readOnlyCode: 'not-insert',
          deletable: true,
          rowHash: null,
          tools: null,
          duplicate: false,
          config: null,
        },
      ],
    },
  });
  assert.match(html, /data-native-tag="neutral">readOnly</);
  assert.match(html, /readOnlyNotInsert/);
  assert.doesNotMatch(html, /role="switch"/);
  assert.doesNotMatch(html, /aria-label="editTitle"|aria-label="deleteServer"/);
});

test('scopes pending and failed toggle feedback to the selected service row', () => {
  const target = { id: 'two', name: 'target', transport: 'stdio', enabled: true, editable: true };
  const snapshot = {
    status: 'ready',
    error: null,
    state: { ...BASE_STATE, servers: [{ ...target, id: 'one', name: 'other' }, target] },
  };
  const action = { id: target.id, name: target.name };
  const pending = render({ ...snapshot, busy: true, action });
  const pendingRows = pending.match(/<li\b[^>]*>.*?<\/li>/g);
  assert.doesNotMatch(pendingRows[0], /saving/);
  assert.match(pendingRows[1], /role="status">saving</);

  const failure = { ...action, error: { code: 'locked' } };
  const failed = render({ ...snapshot, busy: false, action: failure });
  const failedRows = failed.match(/<li\b[^>]*>.*?<\/li>/g);
  assert.doesNotMatch(failedRows[0], /locked/);
  assert.match(failedRows[1], /role="alert">locked</);
  assert.equal((failed.match(/role="alert"/g) || []).length, 1);

  const removed = render({ ...snapshot, busy: false, action: failure,
    state: { ...BASE_STATE, servers: [snapshot.state.servers[0]] } });
  assert.match(removed, /role="alert">target.*locked/);
  assert.doesNotMatch(removed.match(/<li\b[^>]*>.*?<\/li>/)[0], /locked/);
});

test('shows only the local switch even when a stale response advertises shared removal', () => {
  const markup = render({ status: 'ready', error: null, busy: false, state: {
    ...BASE_STATE, servers: [{ id: 'docs', name: 'docs', editable: true, enabled: true, transport: 'stdio', sharedRemovable: true }],
  } });
  assert.equal((markup.match(/<button/g) ?? []).length, 1);
  assert.match(markup, /role="switch"/);
  assert.doesNotMatch(markup, /dialog|shared-removal|removeShared/);
});
