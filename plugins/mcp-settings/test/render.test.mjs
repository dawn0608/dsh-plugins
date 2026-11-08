import assert from 'node:assert/strict';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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

test('renders the ready page with the server list and actions', () => {
  const html = render({
    status: 'ready',
    error: null,
    busy: null,
    notice: null,
    state: {
      ok: true,
      profile: 'desktop',
      patchPath: '/tmp/cordis.patch.yml',
      revision: 'a'.repeat(64),
      warnings: [],
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
          config: { command: '/bin/echo', args: [], cwd: '', env: [] },
        },
      ],
    },
  });
  assert.match(html, /dshmcp_section/);
  assert.match(html, /docs/);
  assert.match(html, /transportHttp/);
  assert.match(html, /transportStdio/);
  assert.match(html, /duplicate/);
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /refresh/);
  assert.match(html, /add/);
});

test('renders the empty and error states instead of throwing', () => {
  const empty = render({
    status: 'ready',
    error: null,
    busy: null,
    notice: null,
    state: { ok: true, profile: 'desktop', patchPath: '/tmp/x.yml', servers: [], warnings: [] },
  });
  assert.match(empty, /emptyTitle/);

  const failed = render({ status: 'error', state: null, error: { code: 'network' }, busy: null, notice: null });
  assert.match(failed, /loadFailed/);
  assert.match(failed, /retry/);
});

test('renders a read-only row without edit or switch controls', () => {
  const html = render({
    status: 'ready',
    error: null,
    busy: null,
    notice: null,
    state: {
      ok: true,
      profile: 'desktop',
      patchPath: '/tmp/x.yml',
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
      warnings: [],
    },
  });
  assert.match(html, /readOnly/);
  assert.match(html, /readOnlyNotInsert/);
  assert.doesNotMatch(html, /role="switch"/);
  assert.doesNotMatch(html, /dshmcp_switch/);
});
