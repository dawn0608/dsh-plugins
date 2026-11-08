#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { regularFile, requestSync, syncDirectory, resolveSyncHomes } from './shared-sync.js';

const label = 'local.dsh-skill-sync';
const limit = 32 * 1024 * 1024;
const missing = error => { if (error.code !== 'ENOENT') throw error; return null; };
const read = path => regularFile(path, limit).catch(missing);
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const xml = value => '<string>' + value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') + '</string>';
const decodeXml = value => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
const hookCommand = (home, node, daemon) => '/usr/bin/env DSH_HOME=' + quote(home) + ' ' + quote(node) + ' ' + quote(daemon) + ' enroll';

async function atomicReplace(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.' + randomUUID();
  try {
    await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
    await rename(temp, path);
  } finally { await unlink(temp).catch(missing); }
}

function oldHook(plist) {
  if (!plist) return undefined;
  const text = plist.toString('utf8');
  if (!/<key>Label<\/key>\s*<string>local\.dsh-skill-sync<\/string>/.test(text)) {
    throw Error('The existing LaunchAgent is not owned by skill sync.');
  }
  const args = text.match(/<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>\s*<string>([^<]*)<\/string>\s*<\/array>/);
  const home = text.match(/<key>DSH_HOME<\/key>\s*<string>([^<]*)<\/string>/);
  if (!args || !home) return undefined;
  const [, node, daemon] = args.map(decodeXml);
  if (!daemon.endsWith('/plugins/skill-manager/src/sync-daemon.js') &&
      !daemon.endsWith('/skill-manager/shared-sync/runtime/sync-daemon.js')) return undefined;
  return hookCommand(decodeXml(home[1]), node, daemon);
}

function configureHooks(original, command, legacy) {
  const config = original ? JSON.parse(original) : {};
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!record(config) || (config.hooks !== undefined && !record(config.hooks))) throw Error('Invalid Claude Code settings.');
  const hooks = { ...config.hooks };
  for (const event of ['SessionStart', 'CwdChanged']) {
    const rules = hooks[event] ?? [];
    if (!Array.isArray(rules)) throw Error('Invalid Claude Code hooks.');
    hooks[event] = rules.flatMap(rule => {
      if (!Array.isArray(rule?.hooks)) return [rule];
      const remaining = rule.hooks.filter(hook => hook.type !== 'command' || (hook.command !== command && (!legacy || hook.command !== legacy)));
      return remaining.length ? [{ ...rule, hooks: remaining }] : [];
    });
    hooks[event].push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  }
  return Buffer.from(JSON.stringify({ ...config, hooks }, null, 2) + '\n');
}

async function waitReady({ home, installId }) {
  const deadline = Date.now() + 12000;
  do {
    const reply = await requestSync(home, { type: 'ping' }).catch(() => null);
    if (reply?.installId === installId) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw Error('The background service did not become ready.');
}

// OS calls are injectable so verification never touches a real launchd domain.
export async function installSync({ env = process.env, userHome = homedir(), platform = process.platform,
  nodeBinary = process.execPath, codexBinary, daemonSource = fileURLToPath(new URL('./sync-daemon.js', import.meta.url)),
  launch = async (command, target, path) => execFileSync('/bin/launchctl', [command, target, ...(path ? [path] : [])], { stdio: 'ignore' }),
  ready = waitReady } = {}) {
  if (platform !== 'darwin') throw Error('This installer requires macOS launchd.');
  codexBinary ??= env.DSH_SKILL_SYNC_CODEX ?? execFileSync('/usr/bin/which', ['codex'], { encoding: 'utf8' }).trim();
  const homes = resolveSyncHomes(env, userHome);
  const { home, agentsHome, claudeHome, codexHome } = homes;
  const state = syncDirectory(home);
  const runtime = join(state, 'runtime', 'sync-daemon.js');
  const activation = join(state, 'runtime', 'ready.json');
  const plist = join(userHome, 'Library', 'LaunchAgents', label + '.plist');
  const settings = join(claudeHome, 'settings.json');
  const target = 'gui/' + process.getuid();
  const source = await read(daemonSource);
  if (!source) throw Error('Built sync-daemon.js is missing. Install the published npm package.');
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lock = join(state, 'install.lock');
  await mkdir(lock, { mode: 0o700 });
  try {
    const original = await read(settings);
    const oldPlist = await read(plist);
    const oldRuntime = await read(runtime);
    const oldActivation = await read(activation);
    const updated = configureHooks(original, hookCommand(home, nodeBinary, runtime), oldHook(oldPlist));
    const installId = randomUUID();
    const environment = { DSH_HOME: home, DSH_AGENTS_HOME: agentsHome, CLAUDE_CONFIG_DIR: claudeHome,
      CODEX_HOME: codexHome, DSH_SKILL_SYNC_CODEX: codexBinary, DSH_SKILL_SYNC_INSTALL_ID: installId };
    const spec = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
      '<plist version="1.0"><dict>\n<key>Label</key>' + xml(label) +
      '\n<key>ProgramArguments</key><array>' + xml(nodeBinary) + xml(runtime) + '</array>' +
      '\n<key>EnvironmentVariables</key><dict>' + Object.entries(environment)
        .map(([key, value]) => '<key>' + key + '</key>' + xml(value)).join('\n') + '</dict>' +
      '\n<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>5</integer>' +
      '\n<key>StandardErrorPath</key>' + xml(join(state, 'error.log')) + '\n</dict></plist>\n');
    const backup = join(state, 'backup-' + new Date().toISOString().replaceAll(':', '') + '-' + installId.slice(0, 8));
    await mkdir(backup, { mode: 0o700 });
    const snapshots = [[settings, 'claude-settings.json', original], [plist, 'launch-agent.plist', oldPlist],
      [runtime, 'sync-daemon.js', oldRuntime], [activation, 'ready.json', oldActivation], [join(codexHome, 'config.toml'), 'codex-config.toml', await read(join(codexHome, 'config.toml'))],
      [join(state, 'state.json'), 'state.json', await read(join(state, 'state.json'))]];
    for (const [, name, bytes] of snapshots) if (bytes) await writeFile(join(backup, name), bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(join(backup, 'manifest.json'), JSON.stringify(snapshots.map(([path, name, bytes]) => ({ path, name, existed: bytes !== null })), null, 2), { mode: 0o600 });
    const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);
    if (!same(original, await read(settings))) throw Error('Claude Code settings changed during setup.');
    const wasLoaded = await launch('print', target + '/' + label).then(() => true, () => false);
    if (wasLoaded) await launch('bootout', target, plist);
    const changes = [];
    try {
      if (!same(original, await read(settings))) throw Error('Claude Code settings changed while stopping the previous service.');
      for (const [path, bytes, before] of [[runtime, source, oldRuntime], [plist, spec, oldPlist], [settings, updated, original]]) {
        await atomicReplace(path, bytes);
        changes.push({ path, bytes, before });
      }
      await launch('bootstrap', target, plist);
      await ready({ ...homes, installId });
      // Until this atomic commit the new process serves readiness only, never configuration writes.
      await atomicReplace(activation, JSON.stringify({ installId }) + '\n');
    } catch (error) {
      const recoveryErrors = [];
      try { await launch('bootout', target, plist); } catch { /* It may never have loaded. */ }
      for (const { path, bytes, before } of changes.reverse()) {
        try {
          if (!same(bytes, await read(path))) { recoveryErrors.push('Concurrent change preserved: ' + path); continue; }
          if (before === null) await unlink(path).catch(missing);
          else await atomicReplace(path, before);
        } catch (failure) { recoveryErrors.push(failure.message); }
      }
      if (wasLoaded && oldPlist) {
        try { await launch('bootstrap', target, plist); } catch (failure) { recoveryErrors.push(failure.message); }
      }
      throw Error(error.message + ' Backups: ' + backup + (recoveryErrors.length ? ' Recovery requires attention: ' + recoveryErrors.join('; ') : ''), { cause: error });
    }
    return { runtime, plist, backup };
  } finally { await rm(lock, { recursive: true }); }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Usage: dsh-skill-sync-install\nInstall or upgrade optional macOS skill sync. Requires Node.js >=24 and codex.\nHomes: DSH_HOME, DSH_AGENTS_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR (~/ supported).');
    return;
  }
  if (args.length) throw Error('Unknown arguments. Use --help.');
  const result = await installSync();
  console.log('Installed ' + label + '. Backups: ' + result.backup);
}

let directEntry = false;
try {
  directEntry = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href;
} catch {
  // stdin and other non-file hosts may import the installer without a resolvable entry.
}
if (directEntry) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
