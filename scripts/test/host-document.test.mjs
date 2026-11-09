import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { DetailDocument } from '../../src/client/host-document.js';

const labels = { title: 'Preview', loading: 'Loading', retry: 'Retry', markdown: {
  code: { copyLabel: 'Copy', copiedLabel: 'Copied', toolbarLabels: { codeLabel: 'Code', wrapLabel: 'Wrap', unwrapLabel: 'Unwrap' } }, footnotes: 'Notes',
} };
const render = state => renderToStaticMarkup(h(DetailDocument, { state, labels, onRetry() {} }));

async function mountedDocument(t, writeText) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com' });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText } });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await act(() => root.render(h(DetailDocument, { state: { status: 'found', markdown: '```js\nconst x = 1;\n```' }, labels, onRetry() {} })));
  return { root, dom, button: name => document.querySelector(`button[aria-label="${name}"]`) };
}

test('icon-only controls expose wrap state and copy success resets after one second', async t => {
  const { button, root } = await mountedDocument(t, async text => assert.equal(text, 'const x = 1;'));
  assert.ok(button('Wrap'), 'wrap has an accessible name');
  assert.equal(button('Wrap').textContent, '');
  assert.equal(button('Wrap').getAttribute('aria-pressed'), 'true');
  assert.equal(button('Wrap').querySelector('use').getAttribute('href'), '#dsw-icon-nowrap-fill-regular');
  await act(() => button('Wrap').click());
  assert.equal(button('Wrap').getAttribute('aria-pressed'), 'false');
  assert.equal(button('Wrap').querySelector('use').getAttribute('href'), '#dsw-icon-wrap-fill-regular');
  assert.equal(document.querySelector('pre').style.whiteSpace, 'pre');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await act(async () => button('Copy').click());
  assert.ok(button('Copied'));
  assert.equal(button('Copied').querySelector('use').getAttribute('href'), '#dsw-icon-check-outline-regular');
  await act(() => t.mock.timers.tick(999));
  assert.ok(button('Copied'));
  await act(() => t.mock.timers.tick(1));
  assert.ok(button('Copy'));
  await act(async () => button('Copy').click());
  await act(() => root.unmount());
  await act(() => t.mock.timers.runAll());
  assert.equal(document.querySelector('button'), null);
});

test('a failed clipboard write leaves the icon action available for retry', async t => {
  let attempts = 0;
  const { button } = await mountedDocument(t, async () => { if (++attempts === 1) throw Error('denied'); });
  assert.ok(button('Copy'));
  await act(async () => button('Copy').click());
  assert.ok(button('Copy'));
  assert.equal(button('Copy').disabled, false);
  await act(async () => button('Copy').click());
  assert.ok(button('Copied'));
});

test('tooltips use a viewport-fitted portal on hover and focus and dispose their resources', async t => {
  const { button, dom, root } = await mountedDocument(t, async () => {});
  assert.ok(button('Copy'));
  const observers = new Set();
  dom.window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe() { this.callback([]); }
    disconnect() { observers.delete(this); }
  };
  const listeners = new Set();
  const add = dom.window.addEventListener.bind(dom.window);
  const remove = dom.window.removeEventListener.bind(dom.window);
  dom.window.addEventListener = (type, listener, options) => { if (['scroll', 'resize'].includes(type)) listeners.add(listener); add(type, listener, options); };
  dom.window.removeEventListener = (type, listener, options) => { listeners.delete(listener); remove(type, listener, options); };
  button('Copy').getBoundingClientRect = () => ({ left: 990, right: 1014, top: 1, bottom: 25, width: 24, height: 24 });
  const nativeRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.getAttribute('role') === 'tooltip' ? { width: 90, height: 26 } : nativeRect.call(this);
  };
  const pointer = (type, pointerType = 'mouse') => Object.assign(new dom.window.Event(type, { bubbles: true }), { pointerType });
  await act(() => button('Copy').dispatchEvent(pointer('pointerover')));
  let tooltip = document.querySelector('[role="tooltip"]');
  assert.ok(tooltip, 'hover displays a tooltip');
  assert.equal(tooltip.parentElement, document.body);
  assert.equal(tooltip.textContent, 'Copy');
  assert.equal(button('Copy').getAttribute('aria-describedby'), tooltip.id);
  assert.equal(tooltip.dataset.side, 'bottom', 'top-edge anchor flips below');
  assert.equal(parseFloat(tooltip.style.left), 922, 'right edge stays inside the 12px margin');
  assert.equal(parseFloat(tooltip.style.top), 33);
  await act(() => button('Copy').dispatchEvent(pointer('pointerout')));
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  assert.equal(observers.size, 0);
  assert.equal(listeners.size, 0);
  await act(() => button('Wrap').focus());
  tooltip = document.querySelector('[role="tooltip"]');
  assert.equal(tooltip?.textContent, 'Unwrap');
  await act(() => button('Wrap').click());
  assert.equal(document.querySelector('[role="tooltip"]'), null, 'click dismisses the tooltip');
  await act(() => button('Wrap').blur());
  await act(() => button('Copy').dispatchEvent(pointer('pointerover', 'touch')));
  assert.equal(document.querySelector('[role="tooltip"]'), null, 'touch does not emulate hover');
  await act(() => button('Copy').focus());
  assert.ok(document.querySelector('[role="tooltip"]'));
  await act(() => root.unmount());
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  assert.equal(observers.size, 0);
  assert.equal(listeners.size, 0);
});

test('renders headings, GFM tables, footnotes, code controls and math', () => {
  const html = render({ status: 'found', markdown: '# Heading\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nNote[^1]\n\n[^1]: Footnote\n\n```js\nconst x = 1;\n```\n\n$x^2$' });
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /Notes/);
  assert.match(html, /Footnote/);
  assert.match(html, /aria-label="Copy"/);
  assert.match(html, /data-icon="dsw-icon-copy-outline-regular"/);
  assert.match(html, /aria-label="Wrap" aria-pressed="true"/);
  assert.doesNotMatch(html, />Copy<\/button>|>Unwrap<\/button>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /color:var\(--shiki-/);
});

test('uses the native scroll layout only for wide tables outside blockquotes', () => {
  const wide = '| A | B | C | D |\n| - | - | - | - |\n| 1 | 2 | 3 | 4 |';
  const narrow = '| A | B | C |\n| - | - | - |\n| 1 | 2 | 3 |';
  const quoted = wide.split('\n').map(line => `>   ${line}`).join('\n');
  const markdown = `${narrow}\n\n> - Quoted table\n>\n${quoted}\n\n${wide}`;
  const html = render({ status: 'found', markdown });
  const tables = JSDOM.fragment(html).querySelectorAll('.dshdoc_md_tableScroll > table');

  assert.deepEqual(Array.from(tables, table => table.parentElement.className), [
    'dshdoc_md_tableScroll dshdoc_md_tableFill',
    'dshdoc_md_tableScroll dshdoc_md_tableFill',
    'dshdoc_md_tableScroll md-table-wide',
  ]);
});

test('omits raw HTML and images and does not activate unsafe or relative links', () => {
  const html = render({ status: 'found', markdown: '<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [file](./local.txt) [safe](https://example.com)\n\n![remote](https://example.com/a.png) ![local](a.png)' });
  assert.doesNotMatch(html, /<script|<img|javascript:|href="\.\//);
  assert.match(html, /href="https:\/\/example.com\/"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('renders the existing loading, localized retry and empty states', () => {
  assert.match(render({ status: 'loading' }), /aria-busy="true"/);
  assert.match(render({ status: 'error', message: 'Failure' }), /role="alert"/);
  assert.match(render({ status: 'error', message: 'Failure' }), />Retry<\/button>/);
  assert.equal(render({ status: 'none' }), '');
});

test('code copy and wrap controls operate and a pending copy is harmless after unmount', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com' });
  const descriptors = new Map(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let completeCopy;
  let copied;
  const pendingCopy = new Promise(resolve => { completeCopy = resolve; });
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async value => { copied = value; await pendingCopy; } } });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(() => root.render(h(DetailDocument, { state: { status: 'found', markdown: '```js\nconst x = 1;\n```' }, labels, onRetry() {} })));
    const buttons = [...document.querySelectorAll('button')];
    await act(() => buttons.find(button => button.getAttribute('aria-label') === 'Wrap').click());
    assert.equal(document.querySelector('pre').style.whiteSpace, 'pre');
    await act(() => buttons.find(button => button.getAttribute('aria-label') === 'Copy').click());
    assert.equal(copied, 'const x = 1;');
    await act(() => root.unmount());
    await act(async () => { completeCopy(); await pendingCopy; });
    assert.equal(document.getElementById('root').childElementCount, 0);
  } finally {
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
