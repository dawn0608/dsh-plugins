import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

async function host(t, catalog = {}) {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'dsh-skill-manager-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home');
  const agentsHome = join(base, 'agents');
  const workspace = { id: 'registered', title: 'Workspace', path: join(base, 'workspace') };
  const scope = {};
  const leases = [];
  const options = {
    home, agentsHome,
    agentPresets: {
      async acquireScope() {
        const lease = { key: scope, released: false, async [Symbol.asyncDispose]() { this.released = true; } };
        leases.push(lease);
        return lease;
      },
    },
    skills: {
      async snapshot() { return { skills: [], complete: true }; },
      async get() { return undefined; },
      ...catalog,
    },
    workspaceRegistry: {
      list: () => [workspace],
      get: id => id === workspace.id ? workspace : undefined,
    },
  };
  const { createSkillManager } = await import('../src/host.js');
  const create = () => createSkillManager(options);
  return { base, home, agentsHome, workspace, scope, leases, create, request: create() };
}

const skillText = '---\nname: sample\ndescription: Sample skill\n---\n# Instructions\n';
const managedId = async request => {
  const { skills } = await request({ action: 'list' });
  const row = skills.find(skill => skill.group === 'imported' && skill.name === 'sample');
  assert.match(row?.id ?? '', /^managed:sample:/);
  return row.id;
};
const file = (path, bytes) => ({ path, data: Buffer.from(bytes).toString('base64') });
const files = () => [file('SKILL.md', skillText), file('references/example.bin', [0, 255, 15])];
const importSkill = (request, entries = files()) => request({ action: 'import', files: entries, expectedName: 'sample' });
const rejectsCode = (promise, code) => assert.rejects(promise, { code });

test('imports original bytes and persists disabled and enabled state across Host instances', async t => {
  const { home, create, request } = await host(t);
  assert.deepEqual(await request({ action: 'inspect', files: files() }), { name: 'sample', description: 'Sample skill' });
  assert.deepEqual(await request({ action: 'list' }), {
    skills: [], workspaces: [{ id: 'registered', title: 'Workspace' }], complete: true,
  });
  await assert.rejects(lstat(home), { code: 'ENOENT' });

  await importSkill(request);
  const rowId = await managedId(request);
  const bundle = join(home, 'skill-manager', 'bundles', 'sample');
  const active = join(home, 'skills', 'sample');
  assert.equal(await realpath(active), bundle);
  assert.equal(await readFile(join(bundle, 'SKILL.md'), 'utf8'), skillText);
  assert.deepEqual(await readFile(join(active, 'references/example.bin')), Buffer.from([0, 255, 15]));

  await create()({ action: 'setEnabled', id: rowId, enabled: false });
  await assert.rejects(lstat(active), { code: 'ENOENT' });
  const disabled = create();
  assert.deepEqual((await disabled({ action: 'list' })).skills, [{
    id: rowId, name: 'sample', description: 'Sample skill',
    group: 'imported', source: 'managed', enabled: false, shadowed: false,
  }]);
  assert.deepEqual(await disabled({ action: 'detail', id: rowId }), { body: '# Instructions' });

  await disabled({ action: 'setEnabled', id: rowId, enabled: true });
  assert.equal(await realpath(active), bundle);
  await create()({ action: 'remove', id: rowId });
  await assert.rejects(lstat(active), { code: 'ENOENT' });
  await assert.rejects(lstat(bundle), { code: 'ENOENT' });
  assert.deepEqual((await request({ action: 'list' })).skills, []);
});

test('resolves a registered workspace, displays its winning skill and hides discovery paths', async t => {
  const calls = [];
  const project = { name: 'sample', description: 'Project skill', source: 'project-agents', path: '/private/project/skill/SKILL.md' };
  const local = { name: 'shared', description: 'Shared skill', source: 'user-agents', path: '/private/home/shared.md' };
  const builtin = { name: 'official', description: 'Packaged skill', source: 'bundled', resourceBase: { path: '/private/app' } };
  const { workspace, request, scope, leases } = await host(t, {
    async snapshot({ cwd, signal, scope }) {
      calls.push(['snapshot', cwd, signal, scope]);
      return { complete: true, skills: cwd === undefined ? [local, builtin] : [project, local, builtin] };
    },
    async get(name, { cwd, signal, scope }) {
      calls.push(['get', cwd, signal, scope]);
      return name === 'sample' && cwd !== undefined ? { ...project, content: '# Workspace' } : undefined;
    },
  });
  const { signal } = new AbortController();
  await request({ action: 'import', files: files(), expectedName: 'sample', workspaceId: workspace.id }, signal);
  assert.equal(calls[0][1], undefined);
  const state = await request({ action: 'list', workspaceId: workspace.id }, signal);
  const rowId = state.skills.find(skill => skill.group === 'imported').id;
  assert.match(rowId, /^managed:sample:/);
  assert.deepEqual(state.skills, [
    { id: 'catalog:official', name: 'official', description: 'Packaged skill', group: 'builtin', source: 'bundled', enabled: null, shadowed: false, origin: 'builtin' },
    { id: rowId, name: 'sample', description: 'Sample skill', group: 'imported', source: 'managed', enabled: true, shadowed: true },
    { id: 'catalog:sample', name: 'sample', description: 'Project skill', group: 'workspace', source: 'project-agents', enabled: null, shadowed: false },
    { id: 'catalog:shared', name: 'shared', description: 'Shared skill', group: 'local', source: 'user-agents', enabled: null, shadowed: false },
  ]);
  assert.deepEqual(state.workspaces, [{ id: workspace.id, title: workspace.title }]);
  assert.equal(JSON.stringify(state).includes('/private/'), false);
  assert.deepEqual(await request({ action: 'detail', id: 'catalog:sample', workspaceId: workspace.id }, signal), { body: '# Workspace' });
  assert.deepEqual(calls.at(-1), ['get', workspace.path, signal, scope]);
  assert.ok(calls.every(call => call[3] === scope));
  assert.ok(leases.length > 0 && leases.every(lease => lease.released));
  assert.deepEqual(await request({ action: 'detail', id: rowId, workspaceId: workspace.id }, signal), { body: '# Instructions' });
  await rejectsCode(request({ action: 'list', workspaceId: workspace.path }), 'invalid');
  await rejectsCode(request({ action: 'list', workspaceId: 'unknown' }), 'not-found');
  await rejectsCode(request({ action: 'remove', id: 'catalog:sample', workspaceId: workspace.id }), 'forbidden');
});

test('applies refreshed provenance only to the discovered shared skill file', async t => {
  const entries = [];
  let loaded;
  const { base, agentsHome, request } = await host(t, {
    async snapshot() { return { skills: entries, complete: true }; },
    async get() { return loaded; },
  });
  const root = join(agentsHome, 'skills');
  const relativePath = 'folder/SKILL.md';
  const path = join(root, relativePath);
  const registry = join(root, '.provenance.json');
  const repository = 'https://github.com/example/project';
  await mkdir(join(root, 'folder'), { recursive: true });
  await writeFile(path, skillText);
  const entry = { name: 'sample', description: 'Shared skill', source: 'user-agents', path };
  entries.push(entry);
  loaded = { ...entry, content: 'Shared skill body' };
  const list = async () => (await request({ action: 'list' })).skills[0];
  assert.equal((await list()).origin, undefined);
  await writeFile(registry, JSON.stringify({ [relativePath]: { origin: 'self' } }));
  assert.equal((await list()).origin, 'self');
  await writeFile(registry, JSON.stringify({ [relativePath]: { origin: 'third-party', repository } }));
  assert.equal((await list()).origin, 'third-party');
  const detail = () => request({ action: 'detail', id: 'catalog:sample' });
  assert.equal((await list()).repository, undefined);
  assert.deepEqual(await detail(), { body: 'Shared skill body', origin: 'third-party', repository });
  assert.equal(JSON.stringify(await list()).includes(root), false);

  loaded = { ...entry, source: 'project-agents', content: 'Other skill body' };
  assert.deepEqual(await detail(), { body: 'Other skill body' });
  entry.source = 'project-agents';
  assert.equal((await list()).origin, undefined);
  entry.source = 'user-agents';
  entry.path = join(base, 'other', relativePath);
  await writeFile(registry, JSON.stringify({ '../../other/folder/SKILL.md': { origin: 'self' }, [relativePath]: { origin: 'self' } }));
  assert.equal((await list()).origin, undefined);
});

test('keeps the catalog readable with invalid provenance and drops unsafe repository URLs', async t => {
  const entries = [];
  const { agentsHome, request } = await host(t, {
    async snapshot() { return { skills: entries, complete: true }; },
    async get() { return { ...entries[0], content: 'Sample body' }; },
  });
  const root = join(agentsHome, 'skills');
  const registry = join(root, '.provenance.json');
  const path = join(root, 'sample.md');
  await mkdir(root, { recursive: true });
  await writeFile(path, skillText);
  entries.push({ name: 'sample', description: 'Shared skill', source: 'user-agents', path });
  await writeFile(registry, '{');
  const list = () => request({ action: 'list' });
  assert.equal((await list()).complete, true);
  assert.equal((await list()).skills[0].origin, undefined);
  await writeFile(registry, JSON.stringify({ 'sample.md': { origin: 'other' } }));
  assert.equal((await list()).skills[0].origin, undefined);
  for (const repository of ['javascript:alert(1)', 'http://example.org/repo', 'https://a:b@example.org/repo', 'https://example.org/repo?token=x', 'https://example.org/repo#fragment']) {
    await writeFile(registry, JSON.stringify({ 'sample.md': { origin: 'third-party', repository } }));
    const [row] = (await list()).skills;
    assert.equal(row.origin, 'third-party');
    assert.deepEqual(await request({ action: 'detail', id: 'catalog:sample' }), {
      body: 'Sample body', origin: 'third-party',
    });
  }
});

test('does not read a provenance file linked outside the shared skills root', async t => {
  const entries = [];
  const { base, agentsHome, request } = await host(t, {
    async snapshot() { return { skills: entries, complete: true }; },
  });
  const root = join(agentsHome, 'skills');
  const path = join(root, 'sample.md');
  const outside = join(base, 'outside.json');
  await mkdir(root, { recursive: true });
  await writeFile(path, skillText);
  await writeFile(outside, JSON.stringify({ 'sample.md': { origin: 'self' } }));
  await symlink(outside, join(root, '.provenance.json'));
  entries.push({ name: 'sample', description: 'Shared skill', source: 'user-agents', path });

  const state = await request({ action: 'list' });
  assert.equal(state.complete, true);
  assert.equal(state.skills[0].origin, undefined);
});

test('releases the preset lease if the Harness catalog is unavailable', async t => {
  const { request, scope, leases } = await host(t, {
    async snapshot(options) {
      assert.equal(options.scope, scope);
      throw new Error('catalog failure');
    },
  });
  await rejectsCode(request({ action: 'list' }), 'unavailable');
  assert.equal(leases.length, 1);
  assert.equal(leases[0].released, true);
});

test('fails closed before import when the global catalog is incomplete or has a duplicate', async t => {
  const observation = { skills: [], complete: false };
  const { home, request } = await host(t, { async snapshot() { return observation; } });
  assert.equal((await request({ action: 'list' })).complete, false);
  await rejectsCode(importSkill(request), 'incomplete');
  observation.complete = true;
  observation.skills = [{ name: 'sample', description: 'Existing skill', source: 'user-agents' }];
  await rejectsCode(importSkill(request), 'duplicate');
  await assert.rejects(lstat(home), { code: 'ENOENT' });
});

test('an enabled imported skill deduplicates its Harness catalog entry and loads actual Harness detail', async t => {
  const observation = { skills: [], complete: true };
  const { home, request } = await host(t, {
    async snapshot() { return observation; },
    async get() { return { ...observation.skills[0], content: 'Fresh Harness body' }; },
  });
  await importSkill(request);
  const rowId = await managedId(request);
  observation.skills = [{
    name: 'sample', description: 'Sample skill', source: 'user-dsh',
    path: join(home, 'skill-manager', 'bundles', 'sample', 'SKILL.md'),
    resourceBase: { kind: 'directory', path: join(home, 'skills', 'sample') },
  }];
  assert.deepEqual((await request({ action: 'list' })).skills.map(skill => skill.id), [rowId]);
  assert.deepEqual(await request({ action: 'detail', id: rowId }), { body: 'Fresh Harness body' });
  await request({ action: 'setEnabled', id: rowId, enabled: false });
  const { skills } = await request({ action: 'list' });
  assert.deepEqual(skills.map(({ id, enabled }) => [id, enabled]), [[rowId, false]]);
});

test('recognizes Harness real paths when the Host home has a system path alias', async t => {
  const { base, home } = await host(t);
  const alias = join(base, 'alias');
  await symlink(base, alias, 'dir');
  const { createSkillManager } = await import('../src/host.js');
  const observation = { skills: [], complete: true };
  const request = createSkillManager({
    home: join(alias, 'home'),
    skills: { snapshot: async () => observation },
    agentPresets: { acquireScope: async () => ({ key: {}, async [Symbol.asyncDispose]() {} }) },
    workspaceRegistry: { list: () => [] },
  });
  await importSkill(request);
  const rowId = await managedId(request);
  observation.skills = [{
    name: 'sample', description: 'Sample skill', source: 'user-dsh',
    path: await realpath(join(home, 'skills', 'sample', 'SKILL.md')),
  }];
  assert.deepEqual((await request({ action: 'list' })).skills.map(skill => skill.id), [rowId]);
});

test('validates bundle paths, collisions, base64, frontmatter and decoded limits before touching disk', async t => {
  const { home, request } = await host(t);
  for (const path of ['../SKILL.md', '/outside', 'C:/outside', 'a\\outside', 'a//b', 'a/./b', 'a/../b', 'a/CON', 'a/b.']) {
    await rejectsCode(importSkill(request, [...files(), file(path, '')]), 'invalid');
  }
  for (const paths of [['A/a', 'a/b'], ['a', 'a/b'], ['é/x', 'e\u0301/y'], ['Σ/x', 'ς/y'], ['skill.md']]) {
    await rejectsCode(importSkill(request, [...files(), ...paths.map(path => file(path, ''))]), 'invalid');
  }
  for (const contents of [
    'no frontmatter',
    '---\nname: Sample\ndescription: example\n---',
    '---\nname: sample\ndescription: 123\n---',
    '---\nname: sample\ndescription: Example\nuser-invocable: perhaps\n---',
    '---\nname: sample\ndescription: Example\nmodelInvocable: true\n---',
    '---\nname: sample\nname: other\ndescription: Example\n---',
  ]) {
    await rejectsCode(importSkill(request, [file('SKILL.md', contents)]), 'invalid');
  }
  await rejectsCode(importSkill(request, [{ path: 'SKILL.md', data: '**' }]), 'invalid');
  await rejectsCode(importSkill(request, [{ path: 'SKILL.md', data: 'ZR==' }]), 'invalid');
  await rejectsCode(importSkill(request, [file('SKILL.md', [0xff])]), 'invalid');
  await rejectsCode(importSkill(request, [file('SKILL.md', skillText + '\0')]), 'invalid');
  await rejectsCode(importSkill(request, [...files(), file('huge', Buffer.alloc(8 * 1024 * 1024))]), 'too-large');
  await rejectsCode(importSkill(request, Array.from({ length: 257 }, (_, i) => file(String(i), ''))), 'too-large');
  await rejectsCode(request({ action: 'import', files: files(), expectedName: 'other' }), 'invalid');
  const longName = 'a'.repeat(251);
  await rejectsCode(request({ action: 'inspect', files: [file('SKILL.md', skillText.replace('sample', longName))] }), 'invalid');
  await assert.rejects(lstat(home), { code: 'ENOENT' });
});

test('accepts Harness boolean spellings and a CRLF skill with folded YAML', async t => {
  const { request } = await host(t);
  const contents = '---\r\nname: sample\r\ndescription: >-\r\n  One sentence.\r\n  Another.\r\ndisable-model-invocation: 1\r\nuser-invocable: OFF\r\n---\r\nRead me';
  assert.deepEqual(await request({ action: 'inspect', files: [file('SKILL.md', contents)] }), {
    name: 'sample', description: 'One sentence. Another.',
  });
});

test('strips a UTF-8 BOM for discovery while keeping the original document bytes', async t => {
  const { home, request } = await host(t);
  const contents = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(skillText)]);
  const entries = [file('SKILL.md', contents)];
  assert.deepEqual(await request({ action: 'inspect', files: entries }), { name: 'sample', description: 'Sample skill' });
  await importSkill(request, entries);
  assert.deepEqual(await readFile(join(home, 'skills', 'sample', 'SKILL.md')), contents);
});

test('refuses unmanaged roots, bundles and replacement links without deleting unrelated data', async t => {
  const { base, home, request } = await host(t);
  const unrelated = join(base, 'unrelated');
  await mkdir(unrelated);
  await writeFile(join(unrelated, 'keep'), 'keep');
  await symlink(unrelated, home, 'dir');
  await rejectsCode(importSkill(request), 'conflict');
  await unlink(home);
  await mkdir(home);
  const activeRoot = join(home, 'skills');
  await symlink(unrelated, activeRoot, 'dir');
  await rejectsCode(importSkill(request), 'conflict');
  await assert.rejects(lstat(join(home, 'skill-manager')), { code: 'ENOENT' });
  await unlink(activeRoot);
  await mkdir(activeRoot);
  const storeRoot = join(home, 'skill-manager');
  await symlink(unrelated, storeRoot, 'dir');
  await rejectsCode(importSkill(request), 'conflict');
  await unlink(storeRoot);

  const flat = join(activeRoot, 'Sample.md');
  await writeFile(flat, 'unrelated flat');
  await rejectsCode(importSkill(request), 'conflict');
  assert.equal(await readFile(flat, 'utf8'), 'unrelated flat');
  await unlink(flat);

  await importSkill(request);
  const rowId = await managedId(request);
  const active = join(activeRoot, 'sample');
  const bundle = await realpath(active);
  const originalTarget = await readlink(active);
  await unlink(active);
  await symlink(unrelated, active, 'dir');
  await rejectsCode(request({ action: 'setEnabled', id: rowId, enabled: false }), 'conflict');
  await rejectsCode(request({ action: 'remove', id: rowId }), 'conflict');
  assert.equal(await realpath(active), unrelated);
  await unlink(active);
  await symlink(originalTarget, active, 'dir');
  await rejectsCode(request({ action: 'remove', id: rowId }), 'conflict');
  assert.equal(await realpath(active), bundle);
  assert.equal(await readFile(join(unrelated, 'keep'), 'utf8'), 'keep');
});

test('serializes concurrent imports and leaves a single intact active bundle', async t => {
  const { create, home, request } = await host(t);
  const results = await Promise.allSettled([importSkill(request), importSkill(create())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'duplicate');
  assert.equal(await readFile(join(home, 'skills', 'sample', 'SKILL.md'), 'utf8'), skillText);
});

function killHostDuring(home, { method = 'symlinkSync', pathPart, before = false, payload }) {
  const moduleUrl = new URL('../src/host.js', import.meta.url);
  const script = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const operation = fs[${JSON.stringify(method)}];
    fs[${JSON.stringify(method)}] = (source, path, ...args) => {
      const kill = path.includes(${JSON.stringify(pathPart)});
      if (kill && ${before}) process.kill(process.pid, 'SIGKILL');
      const result = operation(source, path, ...args);
      if (kill) process.kill(process.pid, 'SIGKILL');
      return result;
    };
    syncBuiltinESMExports();
    const { createSkillManager } = await import(${JSON.stringify(moduleUrl.href)});
    const manager = createSkillManager({
      home: ${JSON.stringify(home)},
      skills: { snapshot: async () => ({ skills: [], complete: true }) },
      agentPresets: { acquireScope: async () => ({ key: {}, async [Symbol.asyncDispose]() {} }) },
      workspaceRegistry: { list: () => [] },
    });
    await manager(${JSON.stringify(payload ?? { action: 'import', expectedName: 'sample', files: files() })});
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
}

test('a Host killed after taking the write lock does not block future mutations', { skip: process.platform === 'win32' }, async t => {
  const { home, request } = await host(t);
  killHostDuring(home, { pathPart: '.write-lock-0' });
  await importSkill(request);
  assert.equal((await request({ action: 'list' })).skills[0].enabled, true);
  await request({ action: 'remove', id: await managedId(request) });
});

test('a Host killed after publishing an activation leaves a usable owned bundle', { skip: process.platform === 'win32' }, async t => {
  const { home, request } = await host(t);
  killHostDuring(home, { pathPart: 'skills/sample' });
  const rowId = await managedId(request);
  assert.equal((await request({ action: 'list' })).skills[0].enabled, true);
  assert.deepEqual(await request({ action: 'detail', id: rowId }), { body: '# Instructions' });
  await request({ action: 'setEnabled', id: rowId, enabled: false });
  await assert.rejects(lstat(join(home, 'skills', 'sample')), { code: 'ENOENT' });
  await request({ action: 'remove', id: rowId });
});

test('an unsafe activation root leaves the native catalog readable and rejects mutation', async t => {
  const native = { name: 'official', description: 'Native skill', source: 'bundled' };
  const { base, home, request } = await host(t, { async snapshot() { return { skills: [native], complete: true }; } });
  await mkdir(home);
  await symlink(base, join(home, 'skills'), 'dir');
  const state = await request({ action: 'list' });
  assert.equal(state.complete, false);
  assert.deepEqual(state.skills.map(skill => skill.id), ['catalog:official']);
  await rejectsCode(importSkill(request), 'conflict');
});

test('an ID from a previous import cannot disable or remove a newly imported copy', async t => {
  const { home, request } = await host(t);
  await importSkill(request);
  const original = await managedId(request);
  await request({ action: 'remove', id: original });
  await importSkill(request);
  const replacement = await managedId(request);
  assert.notEqual(replacement, original);
  await rejectsCode(request({ action: 'setEnabled', id: original, enabled: false }), 'not-found');
  await rejectsCode(request({ action: 'remove', id: original }), 'not-found');
  assert.equal(await readFile(join(home, 'skills', 'sample', 'SKILL.md'), 'utf8'), skillText);
});

test('an interrupted staged import can be retried without reserving the skill name', { skip: process.platform === 'win32' }, async t => {
  const { home, request } = await host(t);
  killHostDuring(home, { method: 'renameSync', pathPart: 'bundles/sample', before: true });
  await assert.rejects(lstat(join(home, 'skill-manager', 'bundles', 'sample')), { code: 'ENOENT' });
  await importSkill(request);
  assert.equal(await readFile(join(home, 'skills', 'sample', 'SKILL.md'), 'utf8'), skillText);
});

test('an interrupted removal resumes from its owned tombstone and permits reimport', { skip: process.platform === 'win32' }, async t => {
  const { home, request } = await host(t);
  await importSkill(request);
  const id = await managedId(request);
  killHostDuring(home, { method: 'renameSync', pathPart: '.trash-', payload: { action: 'remove', id } });
  await assert.rejects(lstat(join(home, 'skill-manager', 'bundles', 'sample')), { code: 'ENOENT' });
  assert.deepEqual((await request({ action: 'list' })).skills, []);
  await request({ action: 'remove', id });
  await importSkill(request);
  assert.notEqual(await managedId(request), id);
});

test('registers only the authenticated streaming route and bounds JSON requests', async () => {
  const { apply, inject } = await import('../src/index.js');
  const routes = [];
  apply({
    skills: { async snapshot() { return { skills: [], complete: true }; } },
    agentPresets: { acquireScope: async () => ({ key: {}, async [Symbol.asyncDispose]() {} }) },
    workspaceRegistry: { list: () => [], get: () => undefined },
    effect: callback => callback(),
    connection: { fetch: { register: route => { routes.push(route); } } },
    get webServer() { assert.fail('unauthenticated HTTP route'); },
  });
  assert.deepEqual(inject.toSorted(), ['agentPresets', 'connection', 'skills', 'workspaceRegistry']);
  assert.equal(routes.length, 1);
  const route = routes[0];
  assert.equal(route.path, '/api/skill-manager');
  assert.equal(route.requestBody, 'streaming');
  assert.deepEqual(route.methods, ['POST']);
  const endpoint = 'http://localhost/api/skill-manager';
  const headers = { 'content-type': 'application/json', 'x-dsh-skill-manager': '1' };
  const call = async ({ url = endpoint, method = 'POST', body = '{}', ...options } = {}) => {
    const response = await route.fetch(new Request(url, { method, ...(method === 'POST' && { body }), ...options }));
    return { status: response.status, result: await response.json() };
  };
  assert.deepEqual(await call({ method: 'GET', headers }), { status: 405, result: { ok: false, code: 'forbidden' } });
  assert.deepEqual(await call({ headers: { 'content-type': 'application/json' } }), { status: 403, result: { ok: false, code: 'forbidden' } });
  assert.deepEqual(await call({ headers: { ...headers, 'content-type': 'text/plain' } }), { status: 415, result: { ok: false, code: 'invalid' } });
  assert.deepEqual(await call({ headers, body: '{' }), { status: 400, result: { ok: false, code: 'invalid' } });
  assert.deepEqual(await call({ headers, body: JSON.stringify({ action: 'inspect', files: files(), cwd: '/unauthorized' }) }), {
    status: 400, result: { ok: false, code: 'invalid' },
  });
  assert.deepEqual(await call({ headers, body: JSON.stringify({ action: 'inspect', files: files() }) }), {
    status: 200, result: { ok: true, value: { name: 'sample', description: 'Sample skill' } },
  });
  assert.deepEqual(await call({ headers: { ...headers, 'content-length': '13000000' } }), {
    status: 413, result: { ok: false, code: 'too-large' },
  });
  const stream = new ReadableStream({
    start(controller) {
      for (let index = 0; index < 13; index += 1) controller.enqueue(Buffer.alloc(1024 * 1024));
      controller.close();
    },
  });
  assert.deepEqual(await call({ headers, body: stream, duplex: 'half' }), {
    status: 413, result: { ok: false, code: 'too-large' },
  });
});

test('reports stopped and failed daemon health without removing disabled shared policy state', async t => {
  const { home, request } = await host(t);
  const directory = join(home, 'skill-manager', 'shared-sync');
  await mkdir(directory, { recursive: true });
  const state = { version: 1, projects: {}, entries: {}, health: {
    status: 'ok', lastAttemptAt: '2000-01-01T00:00:00.000Z', lastSuccessAt: '2000-01-01T00:00:00.000Z',
  } };
  await writeFile(join(directory, 'state.json'), JSON.stringify(state));
  let result = await request({ action: 'list' });
  assert.equal(result.syncError, 'sharedStopped');
  assert.equal(result.syncHealth.lastSuccessAt, state.health.lastSuccessAt);
  state.health.status = 'unavailable';
  state.health.lastAttemptAt = new Date().toISOString();
  await writeFile(join(directory, 'state.json'), JSON.stringify(state));
  result = await request({ action: 'list' });
  assert.equal(result.syncError, 'sharedUnavailable');
});
