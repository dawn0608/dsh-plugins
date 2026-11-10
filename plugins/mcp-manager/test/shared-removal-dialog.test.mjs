import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { Switch, Tag } from '../../../src/client/host-controls.js';
import { createController } from '../src/client/controller.js';
import { DICTS, format } from '../src/client/i18n.js';
import { createPage } from '../src/client/page.js';

test('the dialog confirms the original row and profile snapshot after a background refresh', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const { document } = dom.window;
  const globals = { window: dom.window, document, IS_REACT_ACT_ENVIRONMENT: true };
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  // JSDOM does not implement the browser's dialog top layer.
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };

  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  let revision = 'a'.repeat(64);
  let rowHash = 'b'.repeat(64);
  const bodies = [];
  const server = { id: 'row-id', name: 'docs', editable: true, sharedRemovable: true, enabled: true, transport: 'stdio' };
  const controller = createController({
    fetchImpl: async (_, init) => {
      if (init.method === 'GET') return Response.json({ ok: true, revision, servers: [{ ...server, rowHash }] });
      bodies.push(JSON.parse(init.body));
      return pending;
    },
  });
  const tZh = (key, params) => format(DICTS.zh[key], params);
  const Page = createPage({
    translate: tZh, Switch, Tag, subscribeLocale: () => () => {}, localeVersion: () => 0, createStore: () => controller,
  });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const key of Object.keys(globals)) delete globalThis[key];
  });

  await act(() => root.render(h(Page)));
  const trigger = [...document.querySelectorAll('li button')].find(button => button.textContent === '从三端移除');
  assert.ok(trigger);
  trigger.focus();
  await act(() => trigger.click());
  const dialog = document.querySelector('dialog[open]');
  assert.match(dialog.textContent, /docs/);
  assert.equal(document.activeElement.textContent, '取消');
  await act(() => dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.activeElement, trigger);
  assert.equal(bodies.length, 0);

  await act(() => trigger.click());
  revision = 'c'.repeat(64);
  rowHash = 'd'.repeat(64);
  await act(() => controller.load());
  const confirmation = document.querySelector('dialog[open]');
  const confirm = [...confirmation.querySelectorAll('button')].find(button => button.textContent === '从三端移除');
  await act(() => confirm.click());
  assert.deepEqual(bodies, [{
    action: 'deleteShared', id: 'row-id', name: 'docs', rowHash: 'b'.repeat(64), revision: 'a'.repeat(64),
  }]);
  assert.equal(confirm.disabled, true);
  assert.match(confirmation.querySelector('[role="status"]').textContent, /正在/);
  await act(() => confirmation.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
  assert.equal(document.querySelector('dialog[open]'), confirmation);

  await act(() => finish(Response.json({ ok: true, removal: 'pending', revision, servers: [] })));
  assert.equal(document.querySelector('dialog'), null);
  assert.match(document.querySelector('[role="status"]').textContent, /docs.*等待/);
  assert.equal(document.activeElement.id, 'dshmcp-title');
});
