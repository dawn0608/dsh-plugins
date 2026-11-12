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

function loadClient({ console: consoleObject = console, document: documentObject = fakeDocument(), globals = {}, viewport = {} } = {}) {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  let entry;
  const window = {
    ...viewport,
    __ModuleLoader__: {
      load(value) {
        entry = value;
      },
    },
  };
  vm.runInNewContext(source, { window, console: consoleObject, document: documentObject, ...globals });
  assert.ok(entry, 'client bundle did not call window.__ModuleLoader__.load');
  return entry;
}

function fakeRequire() {
  return {
    createElement: () => null,
    createPortal: () => null,
  };
}

function makeContext({ entries = [], language = 'en' } = {}) {
  const registrations = [];
  const ctx = {
    effect(callback) {
      const dispose = callback();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    locale: {
      register() {},
      bind() {
        return key => key;
      },
      getSnapshot() {
        return { active: language };
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

function mountEntry(fetch, { language = 'en', tokens = 1 } = {}) {
  const { ctx, registrations } = makeContext({ language });
  const document = {
    ...fakeDocument(),
    body: {},
    documentElement: { clientWidth: 500, clientHeight: 200 },
    addEventListener() {},
    removeEventListener() {},
  };
  const viewport = {
    innerWidth: 500, innerHeight: 200,
    addEventListener() {}, removeEventListener() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  };
  const anchor = { ownerDocument: document, getBoundingClientRect: () => ({ left: 480, top: 20, bottom: 44 }) };
  document.defaultView = viewport;
  const panelStyle = new Map();
  const panel = {
    offsetWidth: 300,
    offsetHeight: 176,
    style: {
      setProperty: (key, value) => panelStyle.set(key, value),
      getPropertyValue: key => panelStyle.get(key) ?? '',
      getPropertyPriority: () => '',
      removeProperty: key => panelStyle.delete(key),
    },
  };
  let cursor;
  let effects;
  const hooks = [];
  const schedule = (setup, deps) => {
    const index = cursor++;
    const previous = hooks[index];
    if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return;
    effects.push(() => {
      previous?.cleanup?.();
      hooks[index] = { deps, cleanup: setup() };
    });
  };
  const react = {
    createElement: (type, props, children) => {
      if (props?.ref) props.ref.current = type === 'span' ? anchor : panel;
      return { type, props, children };
    },
    useState(initial) {
      const index = cursor++;
      hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [hooks[index].value, value => {
        hooks[index].value = typeof value === 'function' ? value(hooks[index].value) : value;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      hooks[index] ??= { current: initial };
      return hooks[index];
    },
    useEffect: schedule,
    useLayoutEffect: schedule,
  };
  const client = loadClient({
    document,
    viewport,
    globals: {
      location: new URL('https://example.test/mounted/'),
      AbortController, clearTimeout, setTimeout, clearInterval, setInterval, fetch,
    },
  });
  client.factory(id => id === 'react-dom' ? { createPortal: value => value } : react).apply(ctx);
  const Entry = registrations[0].component;
  return {
    panelStyle,
    render(sessionId = 'A') {
      cursor = 0;
      effects = [];
      const tree = Entry({ sessionId, useProjection: () => ({ outputTokens: tokens }) });
      const panelComponent = tree?.children[1];
      if (panelComponent) tree.children[1] = panelComponent.type(panelComponent.props);
      effects.forEach(run => run());
      return tree;
    },
    unmount() {
      hooks.forEach(hook => hook?.cleanup?.());
    },
  };
}

function textOf(element) {
  if (Array.isArray(element)) return element.map(textOf).join(' ');
  return element && typeof element === 'object' ? textOf(element.children) : String(element ?? '');
}

function readyState({ models = [], unknownModels = [], pricingStatus = 'complete' } = {}) {
  return Response.json({
    cost: { ok: true, total: pricingStatus === 'complete' ? 1.25 : null, knownSubtotal: 1.25, pricingStatus, calls: 1, toolRequests: 0, models, unknownModels },
    balance: { ok: true, wallets: [{ total: 100, currency: 'CNY' }] },
  });
}

test('a failed channel read keeps the existing error pill available for a session with tokens', async t => {
  const mounted = mountEntry(async () => new Response(null, { status: 403 }));
  t.after(() => mounted.unmount());
  assert.equal(mounted.render(), null);
  await new Promise(resolve => setImmediate(resolve));
  const tree = mounted.render();
  assert.match(textOf(tree), /— · Balance —/);
  tree.children[0].props.onClick();
  assert.match(textOf(mounted.render().children[1]), /Cannot access session data/);
});

test('missing prices remain null and partial totals are labeled in both languages', async t => {
  for (const [language, marker] of [['en', /Known subtotal ¥1\.25/], ['zh', /已知部分 ¥1\.25/]]) {
    const mounted = mountEntry(async () => readyState({
      models: [
        { key: 'third-party/model', label: 'third-party/model', cost: null, calls: 1 },
        { key: 'deepseek-flash', label: 'DeepSeek Flash', cost: 0, calls: 1 },
      ],
      unknownModels: ['third-party/model'], pricingStatus: 'partial',
    }), { language });
    t.after(() => mounted.unmount());
    mounted.render();
    await new Promise(resolve => setImmediate(resolve));
    const tree = mounted.render();
    assert.match(textOf(tree.children[0]), marker);
    tree.children[0].props.onClick();
    const panel = textOf(mounted.render().children[1]);
    assert.match(panel, marker);
    assert.match(panel, new RegExp('third-party/model ' + (language === 'zh' ? '无法计价' : 'Price unavailable')));
    assert.match(panel, /DeepSeek Flash ¥0\.00/);
  }
});

test('the measured dialog clamps both axes and caps its height in a short viewport', async t => {
  const mounted = mountEntry(async () => readyState());
  t.after(() => mounted.unmount());
  mounted.render();
  await new Promise(resolve => setImmediate(resolve));
  mounted.render().children[0].props.onClick();
  mounted.render();
  const dialog = mounted.render().children[1];
  assert.equal(dialog.props.style.left, 188);
  assert.equal(dialog.props.style.top, 12);
  assert.equal(mounted.panelStyle.get('--dsh-anchored-max-height'), '176px');
});
