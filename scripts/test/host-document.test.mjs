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

test('renders headings, GFM tables, footnotes, code controls and math', () => {
  const html = render({ status: 'found', markdown: '# Heading\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nNote[^1]\n\n[^1]: Footnote\n\n```js\nconst x = 1;\n```\n\n$x^2$' });
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<table>/);
  assert.match(html, /Notes/);
  assert.match(html, /Footnote/);
  assert.match(html, />Copy<\/button>/);
  assert.match(html, />Unwrap<\/button>/);
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
    await act(() => buttons.find(button => button.textContent === 'Unwrap').click());
    assert.equal(document.querySelector('pre').style.whiteSpace, 'pre');
    await act(() => buttons.find(button => button.textContent === 'Copy').click());
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
