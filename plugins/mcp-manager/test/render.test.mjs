import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPage } from '../src/client/page.js';

const translate = key => key;

// The Harness module loader supplies this control in the installed app.
function Switch({ checked, label, disabled }) {
  return React.createElement('button', { type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label, disabled });
}

function createPageWith(snapshot) {
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    load: () => {},
    stop: () => {},
    setEnabled: async () => ({ ok: true }),
    dispose: () => {},
  };
  return createPage({
    translate,
    Switch,
    subscribeLocale: () => () => {},
    localeVersion: () => 0,
    createStore: () => controller,
  });
}

function render(snapshot) {
  const Page = createPageWith(snapshot);
  return renderToStaticMarkup(React.createElement(Page));
}

const BASE_STATE = {
  ok: true,
  profile: 'desktop',
  patchPath: '/tmp/cordis.patch.yml',
  revision: 'a'.repeat(64),
  warnings: [],
};

test('renders static service rows with refresh and enablement switches only', () => {
  const html = render({
    status: 'ready',
    error: null,
    busy: null,
    refreshing: false,
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
  });
  assert.match(html, /class="dshmcp_page"/);
  assert.match(html, />title</);
  assert.doesNotMatch(html, />intro<|pathLabel|\/tmp\/cordis\.patch\.yml/);
  assert.match(html, /aria-label="refresh"/);
  assert.match(html, /docs/);
  assert.match(html, /transportHttp/);
  assert.match(html, /transportStdio/);
  assert.doesNotMatch(html, /https:\/\/example\.com\/mcp|\/bin\/echo hello/);
  assert.match(html, /duplicate/);
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /data-tone="success"/);
  assert.match(html, /data-tone="warn"/);
  assert.doesNotMatch(html, /aria-label="(?:editTitle|deleteServer)"|<form/);
  assert.equal((html.match(/<button\b/g) || []).length, 3);
});

test('renders the empty and error states instead of throwing', () => {
  const empty = render({
    status: 'ready',
    error: null,
    busy: null,
    refreshing: false,
    state: { ...BASE_STATE, servers: [] },
  });
  assert.match(empty, /emptyTitle/);
  assert.doesNotMatch(empty, /emptyHint/);

  const failed = render({ status: 'error', state: null, error: { code: 'network' }, busy: null, refreshing: false });
  assert.match(failed, /loadFailed/);
  assert.match(failed, /retry/);
});

test('renders a read-only row without a switch or edit action', () => {
  const html = render({
    status: 'ready',
    error: null,
    busy: null,
    refreshing: false,
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
  assert.match(html, /readOnly/);
  assert.match(html, /readOnlyNotInsert/);
  assert.doesNotMatch(html, /role="switch"/);
  assert.doesNotMatch(html, /aria-label="editTitle"|aria-label="deleteServer"/);
});
