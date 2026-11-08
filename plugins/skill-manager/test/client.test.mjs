import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { JSDOM } from 'jsdom';
import { DICTS, NS, translateFrom } from '../src/client/i18n.js';

test('the built client contributes a matching sidebar and main entry owned by the slots', () => {
  const dom = new JSDOM();
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  let entry;
  const tags = [];
  const document = {
    createElement: () => ({ dataset: {}, remove() { tags.splice(tags.indexOf(this), 1); } }),
    head: { appendChild: tag => { tags.push(tag); } },
  };
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: value => { entry = value; } } },
    document,
    DOMParser: dom.window.DOMParser,
  });
  assert.equal(entry.id, '@dawn0608/dsh-skill-manager');
  const client = entry.factory(id => {
    if (id === 'react/jsx-runtime') return jsxRuntime;
    assert.equal(id, 'react');
    return React;
  });
  assert.deepEqual([...client.inject].sort(), ['locale', 'slots']);
  const effects = [];
  const registrations = [];
  let owner;
  let language = 'en';
  let dictionaries;
  client.apply({
    effect(operation) { effects.push(operation()); },
    slots: {
      inject(slot, callback) {
        owner = slot;
        try { callback(); } finally { owner = null; }
      },
      register(options, Component) {
        assert.equal(owner, options.name);
        registrations.push({ options, Component });
      },
    },
    locale: {
      register(namespace, dict) {
        assert.equal(namespace, NS);
        dictionaries = dict;
        return () => { dictionaries = undefined; };
      },
      bind(namespace) {
        assert.equal(namespace, NS);
        return (key, params) => translateFrom(dictionaries[language], key, params);
      },
      getSnapshot: () => ({ active: language, revision: 1 }),
      subscribe: () => () => {},
    },
  });

  assert.equal(registrations.length, 2);
  const [sidebar, main] = registrations;
  assert.equal(sidebar.options.name, 'sidebar.panellist');
  assert.equal(sidebar.options.id, 'skill-manager');
  assert.equal(sidebar.options.order, 5);
  assert.equal(sidebar.options.label(), DICTS.en.title);
  language = 'zh';
  assert.equal(sidebar.options.label(), DICTS.zh.title);
  assert.equal(main.options.name, 'main');
  assert.equal(main.options.key, sidebar.options.id);
  assert.equal(typeof sidebar.Component, 'function');
  assert.equal(typeof main.Component, 'function');
  assert.equal(tags[0].dataset.plugin, entry.id);
  effects.forEach(dispose => dispose());
  assert.equal(tags.length, 0);
  assert.equal(dictionaries, undefined);
  dom.window.close();
});

test('the client dictionaries cover the same UI keys in both languages', () => {
  assert.deepEqual(Object.keys(DICTS.zh).sort(), Object.keys(DICTS.en).sort());
});
