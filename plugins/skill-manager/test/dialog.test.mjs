import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { RemoveDialog } from '../src/client/dialog.js';
import { DICTS, translateFrom } from '../src/client/i18n.js';

for (const language of ['en', 'zh']) test(`uninstall dialog keeps close, cancel focus and busy protection (${language})`, async t => {
  const dom = new JSDOM('<button id="trigger">Uninstall</button><div id="root"></div>');
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const values = [dom.window, dom.window.document, true];
  keys.forEach((key, index) => Object.defineProperty(globalThis, key, { value: values[index], configurable: true, writable: true }));
  // JSDOM lacks the native dialog top-layer methods; actual focus/trapping is
  // also verified against Chromium in the isolated host acceptance run.
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  document.getElementById('trigger').focus();
  const translate = (key, params) => translateFrom(DICTS[language], key, params);
  let closes = 0;
  const props = { skill: { id: 'temporary-copy', name: 'Temporary' }, translate,
    store: { mutate: async () => assert.fail('closing must never uninstall') },
    close: () => { closes++; }, removed: () => assert.fail('closing must never remove') };
  await act(() => root.render(h(RemoveDialog, { ...props, busy: false })));
  const dialog = document.querySelector('dialog');
  const close = dialog.querySelector(`button[aria-label="${translate('close')}"]`);
  assert.ok(close, 'native header has an accessible close button');
  assert.equal(document.activeElement.textContent, translate('cancel'));
  assert.equal(close.textContent, '');
  assert.match(dialog.querySelector('h2').textContent, /Uninstall|卸载/);
  assert.match(dialog.textContent, /Temporary/);
  await act(() => close.click());
  assert.equal(closes, 1);
  await act(() => root.render(h(RemoveDialog, { ...props, busy: true, error: 'unavailable' })));
  assert.ok([...dialog.querySelectorAll('button')].every(button => button.disabled));
  await act(() => close.click());
  const cancel = new dom.window.Event('cancel', { bubbles: false, cancelable: true });
  await act(() => dialog.dispatchEvent(cancel));
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(closes, 1, 'busy Escape and close are blocked');
  assert.equal(dialog.querySelector('[role="alert"]').textContent, translate('unavailable'));
  await act(() => root.render(h(RemoveDialog, { ...props, busy: false })));
  await act(() => dialog.dispatchEvent(new dom.window.Event('cancel', { cancelable: true })));
  assert.equal(closes, 2, 'idle Escape closes');
  await act(() => root.unmount());
  assert.equal(document.activeElement.id, 'trigger', 'closing restores focus');
});
