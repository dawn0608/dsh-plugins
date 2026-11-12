import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SkillRegistry, { isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill';
import * as filesystem from '@deepseek-ai/dsh-skill-filesystem';
import { createLocalPolicy, normalizeSkillPath } from '../src/policy.js';
import { createSkillManager } from '../src/host.js';

const markdown = (name, flags = '') => `---\nname: ${name}\ndescription: Test skill\n${flags}---\n# Body\n`;
async function fixture(t) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'skill-policy-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'dsh'), agentsHome = join(base, 'agents');
  const files = { harness: join(home, 'skills', 'harness', 'SKILL.md'), shared: join(agentsHome, 'skills', 'shared', 'SKILL.md') };
  for (const [name, path] of Object.entries(files)) {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, markdown(name, 'disable-model-invocation: true\n'));
  }
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SkillRegistry).ready;
  await ctx.plugin(filesystem, { dshHome: home, agentsHome, watch: false }).ready;
  let state = { disabledSkills: [], revision: 0, writable: true };
  const policy = createLocalPolicy({ home, agentsHome,
    readSettings: () => state,
    updateSettings: async (records, revision) => {
      assert.equal(state.revision, revision);
      state = { ...state, disabledSkills: records, revision: revision + 1 };
    },
  });
  ctx.skills.registerProvider(control => policy.provider(control));
  const manager = createSkillManager({ agentsHome, skills: ctx.skills, policy,
    agentPresets: { acquireScope: async () => ({ key: undefined, async [Symbol.asyncDispose]() {} }) },
  });
  const toggle = async (name, enabled) => {
    const list = await manager({ action: 'list' });
    const row = list.skills.find(row => row.name === name);
    await manager({ action: 'setEnabled', id: row.id, enabled, revision: list.revision });
  };
  return { base, home, agentsHome, ctx, files, manager, policy, toggle, state: () => state };
}

test('real native registry disables both user roots, retains preview and restores original invocation rules', async t => {
  const f = await fixture(t);
  for (const name of ['harness', 'shared']) {
    const bytes = await readFile(f.files[name]);
    await f.toggle(name, false);
    const skill = await f.ctx.skills.get(name);
    assert.equal(isModelInvocable(skill), false);
    assert.equal(isUserInvocable(skill), false);
    const row = (await f.manager({ action: 'list' })).skills.find(row => row.name === name);
    assert.equal(row.canToggle, true);
    assert.equal(row.enabled, false);
    assert.equal((await f.manager({ action: 'detail', id: row.id })).body, '# Body');
    assert.deepEqual(await readFile(f.files[name]), bytes);
    await f.toggle(name, true);
    const restored = await f.ctx.skills.get(name);
    assert.equal(isModelInvocable(restored), false); // frontmatter is restored, not forced on
    assert.equal(isUserInvocable(restored), true);
  }
});

test('same-name project and runtime skills keep native precedence; bundled skills have no switch', async t => {
  const f = await fixture(t);
  await f.toggle('shared', false);
  const project = join(f.base, 'project');
  await mkdir(join(project, '.agents', 'skills', 'shared'), { recursive: true });
  await writeFile(join(project, '.agents', 'skills', 'shared', 'SKILL.md'), markdown('shared'));
  assert.equal((await f.ctx.skills.get('shared', { cwd: project })).source, 'project-agents');
  assert.equal(isUserInvocable(await f.ctx.skills.get('shared', { cwd: project })), true);
  f.ctx.skills.register({ name: 'builtin', description: 'Builtin', source: 'bundled', content: 'Body' });
  const row = (await f.manager({ action: 'list' })).skills.find(row => row.name === 'builtin');
  assert.equal(row.canToggle, false);
  await assert.rejects(f.manager({ action: 'setEnabled', id: row.id, enabled: false, revision: f.state().revision }), { code: 'forbidden' });
  f.ctx.skills.register({ name: 'shared', description: 'Runtime', source: 'runtime', content: 'Runtime' });
  assert.equal((await f.ctx.skills.get('shared')).source, 'runtime');
});

test('stale config revisions, replaced identities and removed APIs are rejected', async t => {
  const f = await fixture(t);
  const before = await f.manager({ action: 'list' });
  const row = before.skills.find(row => row.name === 'shared');
  await f.toggle('harness', false);
  await assert.rejects(f.manager({ action: 'setEnabled', id: row.id, enabled: false, revision: before.revision }), { code: 'conflict' });
  await writeFile(f.files.shared, markdown('renamed'));
  await assert.rejects(f.manager({ action: 'setEnabled', id: row.id, enabled: false, revision: f.state().revision }), { code: 'conflict' });
  for (const action of ['inspect', 'import', 'remove']) await assert.rejects(f.manager({ action }), { code: 'invalid' });
  await assert.rejects(f.manager({ action: 'list', workspaceId: null }), { code: 'invalid' });
});

test('moving or renaming a disabled file never transfers its policy to the new identity', async t => {
  const f = await fixture(t);
  await f.toggle('shared', false);
  await rename(join(f.agentsHome, 'skills', 'shared'), join(f.agentsHome, 'skills', 'moved'));
  f.policy.invalidate();
  assert.equal(isUserInvocable(await f.ctx.skills.get('shared')), true);
  await writeFile(join(f.agentsHome, 'skills', 'moved', 'SKILL.md'), markdown('renamed'));
  f.policy.invalidate();
  assert.equal(isUserInvocable(await f.ctx.skills.get('renamed')), true);
  assert.equal(await f.ctx.skills.get('shared'), undefined);
});

test('Windows junction display paths and case normalize to the same identity', () => {
  assert.equal(normalizeSkillPath('\\\\?\\C:\\Users\\Name\\skills\\one\\SKILL.md', 'win32'),
    normalizeSkillPath('c:/users/name/skills/one/SKILL.md', 'win32'));
});

test('native skill tool, model catalog and slash invocation all honor the local switch', async t => {
  const { apply } = await import('@deepseek-ai/dsh-tool-skill');
  const f = await fixture(t);
  await writeFile(f.files.shared, markdown('shared'));
  f.policy.invalidate();
  let tool;
  const hooks = [];
  const agent = { session: { surface: { nodes: [] }, seq: 0 } };
  apply({ skills: f.ctx.skills, workingDirectory: { ensure: async () => undefined },
    tools: { register(value) { tool = value; }, get() { return tool; } },
    on(event, callback) { if (event === 'agent/pre-step') hooks.push(callback); },
  });
  const signal = new AbortController().signal;
  const messages = [{ id: 'test-user', source: { kind: 'user' }, content: [{ type: 'text', text: '/shared' }] }];
  const step = { agent, signal, messages };
  const next = async () => ({ kind: 'continue', messages: [] });
  await f.toggle('shared', false);
  await assert.rejects(tool.execute({ name: 'shared' }, { signal }), /not available for model invocation/);
  assert.equal((await hooks[0](step, next)).messages.length, 0);
  assert.equal((await hooks[1](step, next)).messages.length, 0);
  await f.toggle('shared', true);
  assert.equal((await tool.execute({ name: 'shared' }, { signal })).name, 'shared');
  assert.equal((await hooks[0](step, next)).messages[0].source.kind, 'skill-invocation');
  assert.deepEqual((await hooks[1](step, next)).messages[0].source.entries.map(row => row.name), ['shared']);
});
