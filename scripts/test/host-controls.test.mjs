import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, Input, Switch, Tag } from '../../src/client/host-controls.js';

test('the local switch retains the native accessible state and disables writes', () => {
  const html = renderToStaticMarkup(h(Switch, { checked: true, disabled: true, label: 'MCP', onChange() {} }));
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /aria-label="MCP"/);
  assert.match(html, /disabled=""/);
});

test('native controls preserve input attributes and do not create a nested button', () => {
  const html = renderToStaticMarkup(h(Input, { placeholder: 'Search', 'aria-label': 'Skills', value: 'test', onChange() {} }));
  assert.match(html, /<span[^>]*><input[^>]*placeholder="Search"/);
  assert.match(html, /aria-label="Skills"/);
  assert.match(html, /value="test"/);
  const button = renderToStaticMarkup(h(Button, { variant: 'outline', size: 'sm', disabled: true }, 'Remove'));
  assert.equal((button.match(/<button/g) || []).length, 1);
  assert.match(button, /disabled=""/);
  assert.match(renderToStaticMarkup(h(Tag, { tone: 'warning' }, 'Read only')), /data-tone="warning"/);
});
