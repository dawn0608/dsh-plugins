import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeSkillPath, skillId } from '../src/skill.js';

async function host(t, catalog = {}) {
  const base = await mkdtemp(join(await realpath(tmpdir()), 'dsh-skill-manager-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const agentsHome = join(base, 'agents');
  const scope = {};
  const leases = [];
  const options = {
    agentsHome,
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
  };
  const { createSkillManager } = await import('../src/host.js');
  return { base, agentsHome, scope, leases, request: createSkillManager(options) };
}

const skillText = '---\nname: sample\ndescription: Sample skill\n---\n# Instructions\n';
const rejectsCode = (promise, code) => assert.rejects(promise, { code });

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
  const detail = async () => request({ action: 'detail', id: (await list()).id });
  assert.equal((await list()).repository, repository);
  assert.deepEqual(await detail(), { body: 'Shared skill body', origin: 'third-party', repository });
  assert.equal(JSON.stringify(await list()).includes(root), false);

  loaded = { ...entry, source: 'project-agents', content: 'Other skill body' };
  await rejectsCode(detail(), 'conflict');
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
    assert.deepEqual(await request({ action: 'detail', id: (await list()).skills[0].id }), {
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

test('treats skills shipped inside an official Harness package as built in', async t => {
  const entries = [];
  const { base, request } = await host(t, {
    async snapshot() { return { skills: entries, complete: true }; },
    async get() { return { ...entries[0], content: 'Harness documentation body' }; },
  });
  const preset = join(base, 'installation', 'node_modules', '@deepseek-ai', 'dsh-agent-preset');
  const path = join(preset, 'skills', 'dsh-doc', 'SKILL.md');
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(join(preset, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-agent-preset' }));
  await writeFile(path, skillText);
  entries.push({ name: 'dsh-doc', description: 'Harness documentation', source: 'custom', path });

  const [row] = (await request({ action: 'list' })).skills;
  assert.equal(row.origin, 'builtin');
  assert.deepEqual(await request({ action: 'detail', id: row.id }), {
    body: 'Harness documentation body', origin: 'builtin',
  });
});

test('keeps custom skills outside official packages unconfirmed', async t => {
  const entries = [];
  const { base, request } = await host(t, {
    async snapshot() { return { skills: entries, complete: true }; },
    async get(name) { return { ...entries.find(skill => skill.name === name), content: 'Sample body' }; },
  });
  await writeFile(join(base, 'package.json'), JSON.stringify({ name: 'example-project' }));
  const loose = join(base, 'custom', 'loose.md');
  const thirdParty = join(base, 'vendor', 'toolkit', 'skills', 'sample', 'SKILL.md');
  await mkdir(join(loose, '..'), { recursive: true });
  await mkdir(join(thirdParty, '..'), { recursive: true });
  await writeFile(loose, skillText);
  await writeFile(thirdParty, skillText);
  await writeFile(join(base, 'vendor', 'toolkit', 'package.json'), JSON.stringify({ name: '@example/toolkit' }));
  entries.push({ name: 'loose', description: 'Custom root skill', source: 'custom', path: loose });
  entries.push({ name: 'sample', description: 'Third-party package skill', source: 'custom', path: thirdParty });

  const rows = (await request({ action: 'list' })).skills;
  assert.deepEqual(rows.map(row => row.origin), [undefined, undefined]);
  for (const row of rows) {
    assert.deepEqual(await request({ action: 'detail', id: row.id }), { body: 'Sample body' });
  }
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

test('registers only the authenticated streaming route and bounds JSON requests', async () => {
  const { apply, inject } = await import('../src/index.js');
  const routes = [];
  apply({
    skills: { async snapshot() { return { skills: [], complete: true }; } },
    agentPresets: { acquireScope: async () => ({ key: {}, async [Symbol.asyncDispose]() {} }) },
    effect: callback => callback(),
    connection: { fetch: { register: route => { routes.push(route); } } },
    get webServer() { assert.fail('unauthenticated HTTP route'); },
  });
  assert.deepEqual(inject.toSorted(), ['agentPresets', 'connection', 'skills']);
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
  assert.deepEqual(await call({ headers, body: JSON.stringify({ action: 'list', cwd: '/unauthorized' }) }), {
    status: 400, result: { ok: false, code: 'invalid' },
  });
  assert.deepEqual(await call({ headers, body: JSON.stringify({ action: 'list' }) }), {
    status: 200, result: { ok: true, value: { skills: [], complete: true } },
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

test('Windows device paths and case preserve detail identity without filesystem reads', () => {
  assert.equal(normalizeSkillPath(String.raw`\\?\C:\Users\Name\skills\one\SKILL.md`, 'win32'),
    normalizeSkillPath('c:/users/name/skills/one/SKILL.md', 'win32'));
  const skill = { name: 'one', source: 'user-agents', path: '/missing/one/SKILL.md' };
  assert.equal(skillId(skill), skillId({ ...skill, description: 'updated' }));
  assert.notEqual(skillId(skill), skillId({ ...skill, source: 'project-agents' }));
});
