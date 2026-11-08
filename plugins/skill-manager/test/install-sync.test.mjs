import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-sync-install-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'package', 'lib', 'sync-daemon.js');
  await mkdir(dirname(source), { recursive: true });
  await writeFile(source, '/* isolated self-contained daemon artifact */\n');
  const calls = [];
  let active = false;
  const options = {
    userHome: root, platform: 'darwin', env: { DSH_HOME: '~/dsh custom', DSH_AGENTS_HOME: '~/agents custom',
      CODEX_HOME: '~/codex custom', CLAUDE_CONFIG_DIR: '~/claude custom' },
    nodeBinary: '/fixture/node', codexBinary: '/fixture/codex', daemonSource: source,
    launch: async (command, target, path) => {
      calls.push({ command, target, path });
      if (command === 'print') { if (!active) throw Error('not loaded'); }
      if (command === 'bootstrap') active = true;
      if (command === 'bootout') active = false;
    },
    ready: async () => true,
  };
  const settings = join(root, 'claude custom', 'settings.json');
  await mkdir(dirname(settings), { recursive: true });
  return { root, source, options, calls, settings, active: () => active };
}

test('deploys a standalone stable runtime with all custom homes and idempotent hooks', async t => {
  const { installSync } = await import('../src/install-sync.js');
  const f = await fixture(t);
  const unrelated = { matcher: '*', hooks: [{ type: 'command', command: 'echo keep-sync-daemon.js' }] };
  await writeFile(f.settings, JSON.stringify({ permissions: { deny: ['Bash(secret)'] }, hooks: { SessionStart: [unrelated] } }));
  const installed = await installSync(f.options);
  assert.equal(installed.runtime, join(f.root, 'dsh custom', 'skill-manager', 'shared-sync', 'runtime', 'sync-daemon.js'));
  assert.equal(await readFile(installed.runtime, 'utf8'), await readFile(f.source, 'utf8'));
  const plist = await readFile(installed.plist, 'utf8');
  for (const value of ['dsh custom', 'agents custom', 'codex custom', 'claude custom']) assert.ok(plist.includes(join(f.root, value)));
  await installSync(f.options);
  const settings = JSON.parse(await readFile(f.settings, 'utf8'));
  assert.deepEqual(settings.permissions, { deny: ['Bash(secret)'] });
  assert.deepEqual(settings.hooks.SessionStart[0], unrelated);
  assert.equal(settings.hooks.SessionStart.length, 2);
  assert.equal(settings.hooks.CwdChanged.length, 1);
  assert.ok(settings.hooks.CwdChanged[0].hooks[0].command.includes(installed.runtime));
  await rm(dirname(f.source), { recursive: true });
  assert.ok(await readFile(installed.runtime, 'utf8'));
  assert.equal(f.active(), true);
});

test('readiness failure restores previous runtime, hooks, plist, and loaded service', async t => {
  const { installSync } = await import('../src/install-sync.js');
  const f = await fixture(t);
  const first = await installSync(f.options);
  const before = await Promise.all([f.settings, first.runtime, first.plist].map(path => readFile(path, 'utf8')));
  await writeFile(f.source, '/* replacement daemon */\n');
  await assert.rejects(installSync({ ...f.options, ready: async () => { throw Error('fixture readiness failed'); } }), /readiness failed/);
  assert.deepEqual(await Promise.all([f.settings, first.runtime, first.plist].map(path => readFile(path, 'utf8'))), before);
  assert.equal(f.active(), true);
  assert.ok((await readdir(dirname(first.backup))).filter(name => name.startsWith('backup-')).length >= 2);
});

test('migrates only exact hooks proven by the previous owned launch agent', async t => {
  const { installSync } = await import('../src/install-sync.js');
  const f = await fixture(t);
  const plist = join(f.root, 'Library', 'LaunchAgents', 'local.dsh-skill-sync.plist');
  const oldDaemon = join(f.root, 'old checkout', 'plugins', 'skill-manager', 'src', 'sync-daemon.js');
  const oldHome = join(f.root, '.dsh');
  const owned = `/usr/bin/env DSH_HOME='${oldHome}' '/old/node' '${oldDaemon}' enroll`;
  const other = owned + ' --other';
  await mkdir(dirname(plist), { recursive: true });
  await writeFile(plist, `<plist><dict><key>Label</key><string>local.dsh-skill-sync</string><key>ProgramArguments</key><array><string>/old/node</string><string>${oldDaemon}</string></array><key>EnvironmentVariables</key><dict><key>DSH_HOME</key><string>${oldHome}</string></dict></dict></plist>`);
  await writeFile(f.settings, JSON.stringify({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [
    { type: 'command', command: owned }, { type: 'command', command: other },
  ] }] } }));
  await installSync(f.options);
  const hooks = JSON.parse(await readFile(f.settings, 'utf8')).hooks.SessionStart;
  assert.deepEqual(hooks[0], { matcher: 'startup', hooks: [{ type: 'command', command: other }] });
  assert.equal(hooks.length, 2);
});

test('first installation failure removes new hooks, plist and runtime without touching other settings', async t => {
  const { installSync } = await import('../src/install-sync.js');
  const f = await fixture(t);
  const original = '{"other":"keep exact formatting"}';
  await writeFile(f.settings, original);
  await assert.rejects(installSync({ ...f.options, ready: async () => { throw Error('not ready'); } }), /not ready/);
  assert.equal(await readFile(f.settings, 'utf8'), original);
  await assert.rejects(readFile(join(f.root, 'Library', 'LaunchAgents', 'local.dsh-skill-sync.plist')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(f.root, 'dsh custom', 'skill-manager', 'shared-sync', 'runtime', 'sync-daemon.js')), { code: 'ENOENT' });
  assert.equal(f.active(), false);
});

test('built installer and daemon work without the package checkout and defer sync until readiness commits', async t => {
  const { spawn } = await import('node:child_process');
  const { copyFile } = await import('node:fs/promises');
  const { pathToFileURL } = await import('node:url');
  const { once } = await import('node:events');
  const { requestSync } = await import('../src/shared-sync.js');
  const f = await fixture(t);
  const isolated = join(f.root, 'standalone');
  await mkdir(isolated);
  for (const name of ['install-sync.js', 'sync-daemon.js']) {
    await copyFile(new URL('../lib/' + name, import.meta.url), join(isolated, name));
  }
  const { installSync } = await import(pathToFileURL(join(isolated, 'install-sync.js')));
  const path = join(f.root, 'agents custom', 'skills', 'shared', 'SKILL.md');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, '---\nname: shared\ndescription: Fixture\n---\nBody');
  await mkdir(join(f.root, 'codex custom'));
  await writeFile(join(f.root, 'codex custom', 'config.toml'), '[[skills.config]]\npath = ' + JSON.stringify(path) + '\nenabled = false\n');
  await writeFile(f.settings, '{"other":"keep"}');
  let child;
  let exited;
  const stop = async () => { if (child && child.exitCode === null) { child.kill(); await exited; } child = undefined; };
  t.after(stop);
  const launch = async (command, target, plist) => {
    if (command === 'print') throw Error('not loaded');
    if (command === 'bootout') return stop();
    if (command !== 'bootstrap') throw Error('Unexpected launch operation');
    const text = await readFile(plist, 'utf8');
    const id = text.match(/<key>DSH_SKILL_SYNC_INSTALL_ID<\/key><string>([^<]+)<\/string>/)[1];
    child = spawn(process.execPath, [join(f.root, 'dsh custom', 'skill-manager', 'shared-sync', 'runtime', 'sync-daemon.js')], {
      cwd: isolated, env: { ...process.env, HOME: f.root, DSH_HOME: join(f.root, 'dsh custom'),
        DSH_AGENTS_HOME: join(f.root, 'agents custom'), CODEX_HOME: join(f.root, 'codex custom'),
        CLAUDE_CONFIG_DIR: join(f.root, 'claude custom'), DSH_SKILL_SYNC_INSTALL_ID: id }, stdio: 'ignore',
    });
    exited = once(child, 'exit');
  };
  const ready = async ({ home, installId }) => {
    const deadline = Date.now() + 5000;
    let reply;
    while (Date.now() < deadline) {
      reply = await requestSync(home, { type: 'ping' }).catch(() => null);
      if (reply?.installId === installId) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(reply?.installId, installId);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(JSON.parse(await readFile(f.settings, 'utf8')).skillOverrides, undefined,
      'a daemon pending installer readiness must not alter user skill settings');
  };
  const result = await installSync({ ...f.options, daemonSource: join(isolated, 'sync-daemon.js'), nodeBinary: process.execPath, launch, ready });
  await rm(isolated, { recursive: true });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && JSON.parse(await readFile(f.settings, 'utf8')).skillOverrides?.shared !== 'off') {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(JSON.parse(await readFile(f.settings, 'utf8')).skillOverrides?.shared, 'off');
  assert.ok(await readFile(result.runtime));
});

test('built CLI help and module import never write user state or start installation', async t => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const f = await fixture(t);
  const isolatedHome = join(f.root, 'untouched');
  await mkdir(isolatedHome);
  const env = { ...process.env, HOME: isolatedHome, DSH_HOME: join(isolatedHome, 'dsh'),
    DSH_AGENTS_HOME: join(isolatedHome, 'agents'), CODEX_HOME: join(isolatedHome, 'codex'),
    CLAUDE_CONFIG_DIR: join(isolatedHome, 'claude') };
  const entry = new URL('../lib/install-sync.js', import.meta.url);
  const help = spawnSync(process.execPath, [fileURLToPath(entry), '--help'], { env, encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: dsh-skill-sync-install/);
  const bin = join(f.root, 'dsh-skill-sync-install');
  await symlink(fileURLToPath(entry), bin);
  const binHelp = spawnSync(bin, ['--help'], { env, encoding: 'utf8' });
  assert.equal(binHelp.status, 0, binHelp.stderr);
  assert.match(binHelp.stdout, /Usage: dsh-skill-sync-install/);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(' + JSON.stringify(entry.href) + ')'], { env, encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.deepEqual(await readdir(isolatedHome), []);
});
