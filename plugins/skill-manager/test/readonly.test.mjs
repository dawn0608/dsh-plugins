import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import { createScope } from '@deepseek-ai/dsh-scope';
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem';
import { apply as registerSkillTool } from '@deepseek-ai/dsh-tool-skill';
import { mountRootInclude, readProfilePatches } from '@deepseek-ai/dsh-app-boot';
import { stringify } from 'yaml';
import * as manager from '../lib/index.js';

const markdown = (name, flags = '') => `---\nname: ${name}\ndescription: Test skill\n${flags}---\n# ${name}\n`;

test('a native profile remains read-only and preserves discovery and invocation, including stale disabled records', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'skill-readonly-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home'), agents = join(base, 'agents'), dir = join(home, 'profiles', 'test');
  const project = join(base, 'project');
  const originalEnv = { DSH_HOME: process.env.DSH_HOME, DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME };
  Object.assign(process.env, { DSH_HOME: home, DSH_AGENTS_HOME: agents });
  t.after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const files = {
    shared: join(agents, 'skills', 'shared', 'SKILL.md'),
    harness: join(home, 'skills', 'harness', 'SKILL.md'),
    project: join(project, '.agents', 'skills', 'shared', 'SKILL.md'),
    modelOnly: join(home, 'skills', 'model-only', 'SKILL.md'),
  };
  for (const [key, path] of Object.entries(files)) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, markdown(key === 'project' ? 'shared' : key === 'modelOnly' ? 'model-only' : key,
      key === 'harness' ? 'disable-model-invocation: true\n' : key === 'modelOnly' ? 'user-invocable: false\n' : ''));
  }
  await mkdir(dir, { recursive: true });
  const patchPath = join(dir, 'cordis.patch.yml');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'test-profile', private: true, dependencies: {}, dsh: { bundles: [] } }));
  await writeFile(join(base, 'base.yml'), '[]\n');
  await writeFile(patchPath, stringify([{ insert: [{ id: 'skill-manager', name: 'cordis:test-manager', config: {
    disabledSkills: [{ source: 'user-agents', path: files.shared, name: 'shared' }],
  } }] }]));
  const protectedPaths = [patchPath, ...Object.values(files), join(base, '.codex', 'config.toml'), join(base, '.claude', 'settings.json')];
  for (const path of protectedPaths.slice(-2)) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'unrelated configuration\n');
  }
  const protectedBytes = await Promise.all(protectedPaths.map(path => readFile(path)));
  const profile = { name: 'test', dir, patchPath, installAnchor: dir, cwd: base, home, startedBundles: [], overlays: [] };

  // Reboot the same profile without Settings or ConfigEditor services.
  for (let restart = 0; restart < 2; restart++) {
    const ctx = new Context();
    t.after(() => ctx.fiber.dispose());
    const key = {};
    let handler;
    ctx.provide('profileContext', profile);
    ctx.provide('agentPresets', { acquireScope: async () => ({ key, async [Symbol.asyncDispose]() {} }) });
    ctx.provide('connection', { fetch: { register(route) { handler = route.fetch; return () => { handler = undefined; }; } } });
    await ctx.plugin(Loader).ready;
    await ctx.plugin(SkillRegistry).ready;
    const preset = createScope(ctx, key);
    await preset.ctx.plugin(filesystem, { dshHome: home, agentsHome: agents, watch: false }).ready;
    preset.ctx.get('skills').register({ name: 'builtin', description: 'Built-in', source: 'bundled', content: 'Builtin body' });
    preset.ctx.get('skills').register({ name: 'plugin-skill', description: 'Plugin', source: 'runtime', content: 'Plugin body' });
    const lookups = [{ scope: key }, { scope: key, cwd: project }];
    const before = await Promise.all(lookups.map(options => ctx.skills.snapshot(options)));
    assert.equal(before[1].skills.find(skill => skill.name === 'shared').source, 'project-agents');
    ctx.loader.builtins['test-manager'] = manager;
    await mountRootInclude(ctx, join(base, 'base.yml'), readProfilePatches('dsh', profile));
    await ctx.loader.await();
    assert.equal(typeof handler, 'function', 'read-only plugin starts without configuration write services');
    const call = async body => {
      const response = await handler(new Request('http://localhost/api/skill-manager', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-skill-manager': '1' }, body: JSON.stringify(body),
      }));
      return { status: response.status, ...await response.json() };
    };
    const list = (await call({ action: 'list' })).value;
    assert.deepEqual(Object.keys(list).sort(), ['complete', 'skills']);
    assert.equal(list.complete, true);
    assert.equal(list.skills.length, 5);
    for (const row of list.skills) {
      for (const field of ['enabled', 'canToggle', 'revision', 'path', 'invocation']) assert.equal(Object.hasOwn(row, field), false, field);
      assert.equal((await call({ action: 'detail', id: row.id })).ok, true);
    }
    for (const action of ['setEnabled', 'inspect', 'import', 'remove', 'save', 'delete']) {
      const result = await call({ action, id: list.skills[0].id, enabled: false, revision: 0 });
      assert.deepEqual(result, { status: 400, ok: false, code: 'invalid' });
    }
    assert.deepEqual(await Promise.all(lookups.map(options => ctx.skills.snapshot(options))), before);

    let tool;
    const hooks = [];
    const agent = { session: { surface: { nodes: [] }, seq: 0 } };
    createScope(ctx, agent, { parent: key });
    registerSkillTool({ skills: ctx.skills, workingDirectory: { ensure: async () => undefined },
      tools: { register(value) { tool = value; }, get() { return tool; } },
      on(event, callback) { if (event === 'agent/pre-step') hooks.push(callback); },
    });
    const signal = new AbortController().signal;
    const next = async () => ({ kind: 'continue', messages: [] });
    const step = name => ({ agent, signal, messages: [{ id: 'test-user', source: { kind: 'user' }, content: [{ type: 'text', text: '/' + name }] }] });
    assert.equal((await tool.execute({ name: 'shared' }, { signal, agent })).name, 'shared');
    await assert.rejects(tool.execute({ name: 'harness' }, { signal, agent }), /not available for model invocation/);
    assert.equal((await tool.execute({ name: 'model-only' }, { signal, agent })).name, 'model-only');
    assert.equal((await hooks[0](step('shared'), next)).messages[0].source.kind, 'skill-invocation');
    assert.equal((await hooks[0](step('harness'), next)).messages[0].source.kind, 'skill-invocation');
    assert.equal((await hooks[0](step('model-only'), next)).messages.length, 0);
    const names = (await hooks[1](step('shared'), next)).messages[0].source.entries.map(row => row.name).sort();
    assert.deepEqual(names, ['builtin', 'model-only', 'plugin-skill', 'shared']);
    assert.deepEqual(await Promise.all(protectedPaths.map(path => readFile(path))), protectedBytes);
    await ctx.fiber.dispose();
    assert.equal(handler, undefined);
  }
});
