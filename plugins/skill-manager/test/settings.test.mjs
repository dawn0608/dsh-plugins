import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem';
import Settings from '@deepseek-ai/dsh-settings';
import ConfigEditor from '@deepseek-ai/dsh-config-editor';
import { mountRootInclude, readProfilePatches } from '@deepseek-ai/dsh-app-boot';
import { parse, stringify } from 'yaml';
import * as manager from '../lib/index.js';

// Exercise native Loader refs, Settings revisions, ConfigEditor persistence and restart.
test('native Settings persists profile-only switches, rejects stale writes and restores them after restart', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'skill-settings-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home'), agents = join(base, 'agents'), dir = join(home, 'profiles', 'test');
  const oldHome = process.env.DSH_HOME, oldAgents = process.env.DSH_AGENTS_HOME;
  Object.assign(process.env, { DSH_HOME: home, DSH_AGENTS_HOME: agents });
  t.after(() => {
    if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
    if (oldAgents === undefined) delete process.env.DSH_AGENTS_HOME; else process.env.DSH_AGENTS_HOME = oldAgents;
  });
  await mkdir(dir, { recursive: true });
  await mkdir(join(agents, 'skills', 'sample'), { recursive: true });
  const skillFile = join(agents, 'skills', 'sample', 'SKILL.md');
  const original = '---\nname: sample\ndescription: Sample\n---\nInstructions';
  await writeFile(skillFile, original);
  const patchPath = join(dir, 'cordis.patch.yml');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'test-profile', private: true, dependencies: {}, dsh: { bundles: [] } }));
  await writeFile(join(base, 'base.yml'), '[]\n');
  await writeFile(patchPath, '- insert:\n  - id: skill-manager\n    name: cordis:test-manager\n');
  const profile = { name: 'test', dir, patchPath, installAnchor: dir, cwd: base, home, startedBundles: [], overlays: [] };
  async function boot(targetProfile = profile) {
    const ctx = new Context();
    let handler;
    ctx.provide('profileContext', targetProfile);
    ctx.provide('agentPresets', { acquireScope: async () => ({ key: undefined, async [Symbol.asyncDispose]() {} }) });
    ctx.provide('connection', { fetch: { register(route) { handler = route.fetch; return () => {}; } } });
    await ctx.plugin(Loader).ready;
    await ctx.plugin(SkillRegistry).ready;
    await ctx.plugin(filesystem, { dshHome: home, agentsHome: agents, watch: false }).ready;
    await ctx.plugin(ConfigEditor).ready;
    await ctx.plugin(Settings).ready;
    ctx.loader.builtins['test-manager'] = manager;
    await mountRootInclude(ctx, join(base, 'base.yml'), readProfilePatches('dsh', targetProfile));
    await ctx.loader.await();
    assert.ok(handler, 'plugin registered authenticated route');
    const call = async body => {
      const response = await handler(new Request('http://localhost/api/skill-manager', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-skill-manager': '1' }, body: JSON.stringify(body),
      }));
      return { status: response.status, ...await response.json() };
    };
    return { ctx, call };
  }
  // Two live Harness profiles share skill files but must not share enablement.
  const otherDir = join(home, 'profiles', 'other');
  await mkdir(otherDir, { recursive: true });
  await writeFile(join(otherDir, 'package.json'), await readFile(join(dir, 'package.json')));
  const otherPatch = join(otherDir, 'cordis.patch.yml');
  await writeFile(otherPatch, await readFile(patchPath));
  const other = await boot({ ...profile, name: 'other', dir: otherDir, patchPath: otherPatch, installAnchor: otherDir });
  t.after(() => other.ctx.fiber.dispose());
  const protectedPaths = [skillFile, otherPatch, join(base, '.codex', 'config.toml'), join(base, '.claude', 'settings.json')];
  for (const path of protectedPaths.slice(2)) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, 'unrelated client configuration\n');
  }
  const protectedBytes = await Promise.all(protectedPaths.map(path => readFile(path)));
  const first = await boot();
  t.after(() => first.ctx.fiber.dispose());
  const list = (await first.call({ action: 'list' })).value;
  assert.equal(list.skills[0].canToggle, true);
  const action = { action: 'setEnabled', id: list.skills[0].id, enabled: false, revision: list.revision };
  assert.equal((await first.call(action)).ok, true);
  assert.match(await readFile(patchPath, 'utf8'), /disabledSkills:/);
  assert.equal((await first.ctx.skills.get('sample')).invocation.userInvocable, false);
  assert.equal((await other.ctx.skills.get('sample')).invocation.userInvocable, true);
  assert.equal((await other.call({ action: 'list' })).value.skills[0].enabled, true);
  assert.equal((await first.call({ ...action, enabled: true })).status, 409);
  assert.equal(await readFile(skillFile, 'utf8'), original);
  // An external profile edit is reconciled before native revision validation.
  const current = (await first.call({ action: 'list' })).value;
  const document = parse(await readFile(patchPath, 'utf8'));
  document.find(row => row.id === 'skill-manager').config.disabledSkills = [];
  await writeFile(patchPath, stringify(document));
  assert.equal((await first.call({ ...action, revision: current.revision })).status, 409);
  const refreshed = (await first.call({ action: 'list' })).value;
  assert.equal((await first.call({ ...action, revision: refreshed.revision })).ok, true);
  await first.ctx.fiber.dispose();
  const second = await boot();
  t.after(() => second.ctx.fiber.dispose());
  const after = (await second.call({ action: 'list' })).value;
  assert.equal(after.skills[0].enabled, false);
  assert.equal((await second.ctx.skills.get('sample')).invocation.modelInvocable, false);
  assert.equal((await second.call({ ...action, enabled: true, revision: after.revision })).ok, true);
  assert.equal((await second.ctx.skills.get('sample')).invocation.userInvocable, true);
  assert.deepEqual(await Promise.all(protectedPaths.map(path => readFile(path))), protectedBytes);
});
