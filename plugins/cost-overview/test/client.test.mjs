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
      const tag = {
        dataset: {},
        textContent: '',
        remove() {},
      };
      tags.push(tag);
      return tag;
    },
    head: { appendChild() {} },
  };
}

function loadClient({ console: consoleObject = console, document: documentObject = fakeDocument() } = {}) {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  let entry;
  const window = {
    __ModuleLoader__: {
      load(value) {
        entry = value;
      },
    },
  };
  vm.runInNewContext(source, { window, console: consoleObject, document: documentObject });
  assert.ok(entry, 'client bundle did not call window.__ModuleLoader__.load');
  return entry;
}

function fakeRequire() {
  return {
    createElement: () => null,
    createPortal: () => null,
  };
}

function makeContext({ entries = [] } = {}) {
  const registrations = [];
  const ctx = {
    effect(callback) {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    locale: {
      register() {},
      bind() {
        return () => 'text';
      },
      getSnapshot() {
        return { active: 'en' };
      },
    },
    slots: {
      inject(name, callback) {
        assert.equal(name, 'conversation.composer.dock');
        callback();
      },
      entries(name) {
        assert.equal(name, 'conversation.composer.dock');
        return entries;
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  return { ctx, registrations };
}

test('client bundle registers the package name as its loader id', () => {
  const entry = loadClient();
  assert.equal(entry.id, '@dawn0608/dsh-cost-overview');
  assert.equal(entry.id, pkg.name);
  assert.equal(typeof entry.factory, 'function');
});

test('client factory exposes apply and the declared services', () => {
  const entry = loadClient();
  const mod = entry.factory(fakeRequire);
  assert.equal(typeof mod.apply, 'function');
  assert.deepEqual([...mod.inject].sort(), ['locale', 'slots']);
});

test('client registers one slot entry with the package registrant', () => {
  const { ctx, registrations } = makeContext();
  const mod = loadClient().factory(fakeRequire);
  mod.apply(ctx);
  assert.equal(registrations.length, 1);
  const options = registrations[0].options;
  assert.equal(options.name, 'conversation.composer.dock');
  assert.equal(options.id, 'cost-overview');
  assert.equal(options.order, 2);
  assert.equal(options.registrant, pkg.name);
});

test('client skips a duplicate slot entry and explains why', () => {
  const warnings = [];
  const { ctx, registrations } = makeContext({
    entries: [{ options: { id: 'cost-overview' } }],
  });
  const entry = loadClient({
    console: { ...console, warn: (...args) => warnings.push(args.join(' ')) },
  });
  const mod = entry.factory(fakeRequire);
  mod.apply(ctx);
  assert.equal(registrations.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /skipping duplicate registration/);
});

test('client registers when another slot occupant has a different id', () => {
  const { ctx, registrations } = makeContext({
    entries: [{ options: { id: 'usage' } }],
  });
  const mod = loadClient().factory(fakeRequire);
  mod.apply(ctx);
  assert.equal(registrations.length, 1);
});

test('client registers when the slot service cannot list entries', () => {
  const { ctx, registrations } = makeContext();
  delete ctx.slots.entries;
  const mod = loadClient().factory(fakeRequire);
  mod.apply(ctx);
  assert.equal(registrations.length, 1);
});
