import { execFileSync } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

if (process.platform !== 'darwin') throw Error('This installer uses macOS launchd.');

const label = 'local.dsh-skill-sync';
const node = execFileSync('/usr/bin/which', ['node'], { encoding: 'utf8' }).trim();
const codex = execFileSync('/usr/bin/which', ['codex'], { encoding: 'utf8' }).trim();
const daemon = fileURLToPath(new URL('../plugins/skill-manager/src/sync-daemon.js', import.meta.url));
const user = homedir();
const home = join(user, '.dsh');
const agentsHome = join(user, '.agents');
const claudeHome = join(user, '.claude');
const codexHome = join(user, '.codex');
const state = join(home, 'skill-manager', 'shared-sync');
const plist = join(user, 'Library', 'LaunchAgents', label + '.plist');
const settings = join(claudeHome, 'settings.json');
const target = 'gui/' + process.getuid();
const missing = error => {
  if (error.code !== 'ENOENT') throw error;
};
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const xml = value => '<string>' + value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</string>';
const hookCommand = '/usr/bin/env DSH_HOME=' + quote(home) + ' ' + quote(node) + ' ' + quote(daemon) + ' enroll';

const original = await readFile(settings, 'utf8').catch(missing);
const config = original ? JSON.parse(original) : {};
if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('Invalid Claude Code settings.');
const hooks = config.hooks ?? {};
if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw Error('Invalid Claude Code hooks.');
for (const event of ['SessionStart', 'CwdChanged']) {
  const existing = hooks[event] ?? [];
  if (!Array.isArray(existing)) throw Error('Invalid Claude Code ' + event + ' hooks.');
  if (!existing.some(rule => rule.hooks?.some(hook => hook.command === hookCommand))) {
    hooks[event] = [...existing, { hooks: [{ type: 'command', command: hookCommand, timeout: 10 }] }];
  }
}
config.hooks = hooks;

const launch = (command, argument) => execFileSync('/bin/launchctl', [command, target, argument], { stdio: 'ignore' });
await mkdir(state, { recursive: true, mode: 0o700 });
const backup = join(state, 'backup-' + new Date().toISOString().replaceAll(':', '') + '-' + randomUUID().slice(0, 6));
await mkdir(backup, { mode: 0o700 });
for (const [source, name] of [[settings, 'claude-settings.json'], [join(codexHome, 'config.toml'), 'codex-config.toml'], [plist, 'launch-agent.plist']]) {
  const stat = await lstat(source).catch(missing);
  if (!stat) continue;
  if (!stat.isFile()) throw Error('Expected a regular file at ' + source);
  await copyFile(source, join(backup, name));
  await chmod(join(backup, name), 0o600);
}
const env = { DSH_HOME: home, DSH_AGENTS_HOME: agentsHome, CLAUDE_CONFIG_DIR: claudeHome, CODEX_HOME: codexHome, DSH_SKILL_SYNC_CODEX: codex };
const spec = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0"><dict>\n<key>Label</key>' + xml(label) +
  '\n<key>ProgramArguments</key><array>' + xml(node) + xml(daemon) + '</array>' +
  '\n<key>EnvironmentVariables</key><dict>' +
    Object.entries(env).map(([key, value]) => '<key>' + key + '</key>' + xml(value)).join('\n') + '</dict>' +
  '\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>' +
  '\n<key>StandardErrorPath</key>' + xml(join(state, 'error.log')) + '\n</dict></plist>\n';

async function atomicReplace(path, text) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.' + randomUUID();
  try {
    await writeFile(temp, text, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(missing);
  }
}
const previousPlist = await readFile(plist, 'utf8').catch(missing);
const updated = JSON.stringify(config, null, 2) + '\n';
if ((await readFile(settings, 'utf8').catch(missing)) !== original) throw Error('Claude Code settings changed during setup.');
try { launch('bootout', plist); } catch {}
try {
  await atomicReplace(plist, spec);
  await atomicReplace(settings, updated);
  launch('bootstrap', plist);
} catch (error) {
  try { launch('bootout', plist); } catch {}
  if ((await readFile(settings, 'utf8').catch(missing)) === updated) {
    if (original === undefined) await unlink(settings).catch(missing);
    else await atomicReplace(settings, original);
  }
  if (previousPlist === undefined) await unlink(plist).catch(missing);
  else {
    await atomicReplace(plist, previousPlist);
    try { launch('bootstrap', plist); } catch {}
  }
  throw error;
}
console.log('Installed ' + label + '. Backups: ' + backup);
