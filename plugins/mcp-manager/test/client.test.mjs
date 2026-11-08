import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function fakeDocument() {
  const tags = [];
  return {
    tags,
    createElement() {
      const tag = { dataset: {}, textContent: '', removed: false, remove() { tag.removed = true; } };
      tags.push(tag);
      return tag;
    },
    head: { appendChild() {} },
  };
}

function loadClient(documentObject = fakeDocument()) {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  let entry;
  const window = {
    __ModuleLoader__: {
      load(value) {
        entry = value;
      },
    },
  };
  vm.runInNewContext(source, { window, document: documentObject, console });
  assert.ok(entry, 'client bundle did not call window.__ModuleLoader__.load');
  return entry;
}

function fakeRequire() {
  const react = fakeReact();
  return specifier => {
    if (specifier === 'react') return react;
    if (specifier === 'react-dom') return { createPortal: () => null };
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Switch: () => null, Tag: () => null };
    throw new Error(`unexpected client module: ${specifier}`);
  };
}

function fakeReact() {
  return {
    createElement: () => null,
    Component: class Component {},
    useState: () => [undefined, () => {}],
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useSyncExternalStore: () => undefined,
  };
}

function fakeContext() {
  const registrations = [];
  const injected = [];
  const ctx = {
    effect(operation) {
      return operation();
    },
    locale: {
      register: () => () => {},
      bind: () => key => key,
      getSnapshot: () => ({ active: 'en', revision: 1 }),
      subscribe: () => () => {},
    },
    slots: {
      inject(key, callback) {
        injected.push(key);
        return callback();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  return { ctx, registrations, injected };
}

test('client bundle registers the package name as its loader id', () => {
  const entry = loadClient();
  assert.equal(entry.id, '@dawn0608/dsh-mcp-manager');
  assert.equal(entry.id, pkg.name);
  assert.equal(typeof entry.factory, 'function');
});

test('client factory exposes apply and the declared services', () => {
  const entry = loadClient();
  const mod = entry.factory(fakeRequire());
  assert.equal(typeof mod.apply, 'function');
  assert.deepEqual([...mod.inject].sort(), ['locale', 'slots']);
});

test('apply registers the MCP section and its navigation icon', () => {
  const entry = loadClient();
  const mod = entry.factory(fakeRequire());
  const { ctx, registrations, injected } = fakeContext();
  mod.apply(ctx);

  assert.deepEqual(injected, ['settings.section', 'settings.section.icon']);
  assert.equal(registrations.length, 2);
  const section = registrations[0];
  assert.equal(section.options.name, 'settings.section');
  assert.equal(section.options.id, 'mcp-manager');
  assert.equal(section.options.order, 17);
  assert.equal(section.options.label(), 'MCP Management');
  assert.equal(typeof section.component, 'function');

  const icon = registrations[1];
  assert.equal(icon.options.name, 'settings.section.icon');
  assert.equal(icon.options.id, 'mcp-manager');
  assert.equal(typeof icon.component, 'function');
});

test('the style effect is owned and removed', () => {
  const documentObject = fakeDocument();
  const entry = loadClient(documentObject);
  const mod = entry.factory(fakeRequire());
  const disposers = [];
  const ctx = {
    effect(operation) {
      const dispose = operation();
      disposers.push(dispose);
      return dispose;
    },
    locale: {
      register: () => () => {},
      bind: () => key => key,
      getSnapshot: () => ({ active: 'en', revision: 1 }),
      subscribe: () => () => {},
    },
    slots: { inject: () => () => {}, register: () => () => {} },
  };
  mod.apply(ctx);
  assert.equal(documentObject.tags.length, 1);
  assert.equal(documentObject.tags[0].dataset.plugin, pkg.name);
  assert.ok(documentObject.tags[0].textContent.includes('.dshmcp_page'));
  for (const dispose of disposers) {
    if (typeof dispose === 'function') dispose();
  }
  assert.equal(documentObject.tags[0].removed, true);
});
