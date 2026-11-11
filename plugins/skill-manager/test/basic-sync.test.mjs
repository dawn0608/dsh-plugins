import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { createCoordinator } from '../src/sync-daemon.js';

test('a missing enrolled worktree does not block valid shared skills', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-basic-sync-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'dsh'), agentsHome = join(root, 'agents'), codexHome = join(root, 'codex'), claudeHome = join(root, 'claude');
  const skill = join(agentsHome, 'skills', 'fixture', 'SKILL.md');
  const state = join(home, 'skill-manager', 'shared-sync', 'state.json');
  for (const path of [dirname(skill), dirname(state), codexHome, claudeHome]) await mkdir(path, { recursive: true });
  await writeFile(skill, '---\nname: fixture\ndescription: Shared fixture\n---\nbody');
  await writeFile(join(codexHome, 'config.toml'), 'model = "fixture"');
  await writeFile(join(claudeHome, 'settings.json'), '{}');
  await writeFile(state, JSON.stringify({ version: 1, entries: {}, projects: { [join(root, 'deleted-worktree')]: {} } }));
  const sync = await createCoordinator({ home, agentsHome, codexHome, claudeHome });
  await sync();
  assert.equal(JSON.parse(await readFile(state)).health.status, 'ok');
  assert.equal(await readFile(join(claudeHome, 'skills', 'fixture', 'SKILL.md'), 'utf8'), await readFile(skill, 'utf8'));
});
