import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditorCard } from '../src/client/editor.js';
import { blankForm, serverToForm } from '../src/client/model.js';
import { createPage } from '../src/client/page.js';

const translate = key => key;

function createPageWith(snapshot) {
  const controller = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    load: () => {},
    stop: () => {},
    save: async () => ({ ok: true }),
    remove: async () => ({ ok: true }),
    setEnabled: async () => ({ ok: true }),
    dismissNotice: () => {},
    dispose: () => {},
  };
  return createPage({
    translate,
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

test('renders the ready page with header, rows, add action and path', () => {
  const html = render({
    status: 'ready',
    error: null,
    busy: null,
    notice: null,
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
  assert.match(html, />intro</);
  assert.match(html, /aria-label="refresh"/);
  assert.match(html, /<header[^>]*>[\s\S]*>add<[\s\S]*<\/header>/);
  assert.match(html, />add</);
  assert.match(html, /class="dshmcp_footnote"/);
  assert.match(html, /<details[^>]*><summary[^>]*>pathLabel<\/summary>[\s\S]*\/tmp\/cordis\.patch\.yml/);
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
  assert.match(html, />edit</);
  assert.doesNotMatch(html, /aria-label="deleteServer"/);
});

test('renders the empty and error states instead of throwing', () => {
  const empty = render({
    status: 'ready',
    error: null,
    busy: null,
    notice: null,
    refreshing: false,
    state: { ...BASE_STATE, servers: [] },
  });
  assert.match(empty, /emptyTitle/);
  assert.match(empty, /emptyHint/);

  const failed = render({ status: 'error', state: null, error: { code: 'network' }, busy: null, notice: null, refreshing: false });
  assert.match(failed, /loadFailed/);
  assert.match(failed, /retry/);
});

test('renders a read-only row without a switch or edit action', () => {
  const html = render({
    status: 'ready',
    error: null,
    busy: null,
    notice: null,
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
          deletable: false,
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

test('a deletable read-only entry keeps its delete entry point', () => {
  const html = render({
    status: 'ready',
    state: {
      ...BASE_STATE,
      servers: [{ id: 'readonly', name: 'legacy', editable: false, deletable: true, readOnlyCode: 'row-shape' }],
    },
  });
  assert.match(html, /aria-label="deleteServer"/);
  assert.doesNotMatch(html, /role="switch"|aria-label="editTitle"/);
});

function renderEditor(props = {}) {
  return renderToStaticMarkup(React.createElement(EditorCard, {
    mode: 'add',
    form: blankForm(),
    errors: [],
    translate,
    onChange: () => {},
    ...props,
  }));
}

test('advanced settings collapse for a new service and open for existing credentials', () => {
  assert.match(renderEditor(), /<details(?![^>]*\bopen="")[^>]*><summary[^>]*>advanced<\/summary>/);
  const target = {
    name: 'remote',
    deletable: true,
    transport: 'streamable-http',
    config: { url: 'https://example.com/mcp', headers: [{ key: 'Authorization', mode: 'hidden' }] },
  };
  const html = renderEditor({ mode: 'edit', target, form: { ...serverToForm(target), name: 'draft-name' } });
  assert.match(html, /<h2[^>]*>editTitle<\/h2>/);
  assert.match(html, /<details[^>]*\bopen=""[^>]*>/);
  assert.match(html, /https:\/\/example\.com\/mcp/);
  assert.match(html, />hidden</);
  assert.match(html, /aria-label="deleteServer"/);
});

test('the editor disables navigation and submission during a save', () => {
  const html = renderEditor({ busy: { action: 'save' } });
  assert.match(html, /<button[^>]*disabled=""[^>]*>[\s\S]*?>back</);
  assert.match(html, /<fieldset[^>]*disabled=""/);
  assert.match(html, /<button[^>]*type="submit"[^>]*disabled=""[^>]*>saving<\/button>/);
});

test('field hints describe inputs separately from their labels', () => {
  const html = renderEditor();
  assert.match(html, /<label[^>]*for="dshmcp-name"[^>]*>name<\/label><input[^>]*aria-describedby="dshmcp-name-hint"/);
  assert.match(html, /<label[^>]*for="dshmcp-command"[^>]*>command<\/label><input[^>]*aria-describedby="dshmcp-command-hint"/);
});

test('renders notices for saved and pending states', () => {
  const saved = render({
    status: 'ready',
    error: null,
    busy: null,
    notice: { code: 'saved', params: { name: 'docs' } },
    refreshing: false,
    state: { ...BASE_STATE, servers: [] },
  });
  assert.match(saved, /dshmcp_notice_success/);

  const pending = render({
    status: 'ready',
    error: null,
    busy: null,
    notice: { code: 'savedPending' },
    refreshing: false,
    state: { ...BASE_STATE, servers: [] },
  });
  assert.match(pending, /dshmcp_notice_warn/);
});
