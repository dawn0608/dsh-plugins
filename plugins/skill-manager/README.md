# Skill Management

English | [中文](README.zh.md)

Open **Skills** below **Plugins** in the DeepSeek Harness sidebar. Search the global catalog by name or description. Open a skill to see its description and rendered `SKILL.md`, with its provenance badge or repository link beside the title.

## Manage skills

- The catalog groups skills as Built-in, Self-authored, and Third-party. Skills with unconfirmed provenance appear under Third-party.
- For shared skills, record provenance in `~/.agents/skills/.provenance.json` (or under `$DSH_AGENTS_HOME/skills`). Use the instruction file path relative to the skills root, such as `my-skill/SKILL.md`, as the key. Set `origin` to `self` or `third-party`. For a third-party skill, an optional credential-free HTTPS `repository` URL appears as a link in the detail view.
- For a copy previously imported and managed by the plugin, use the switch in the list or detail view to enable or disable it, or uninstall it from the detail view. Managed copies live under `$DSH_HOME/skill-manager/bundles` and are activated in `$DSH_HOME/skills` for profiles using that home.

## Install

Requires DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`. In Desktop, open **Plugins → Add plugin** and enter `@dawn0608/dsh-skill-manager`. You can also install it with the CLI.

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

To switch from a local checkout, remove the existing installation before adding the npm package. Restart Harness if prompted. To keep installing from source, run `npm ci` and `npm run build --workspace @dawn0608/dsh-skill-manager` at the repository root, then add the absolute path of `plugins/skill-manager` in Desktop.

## Optional shared skill sync on macOS

The optional user service synchronizes enablement for shared global skills across Harness, Codex, and Claude Code. It runs at login and can handle Codex and Claude Code changes while Harness is closed. Set it up from a persistent checkout of the matching source release, with `node` and `codex` on your PATH. [Source release](https://github.com/dawn0608/dsh-plugins/tree/skill-manager-v0.1.1)

```bash
git clone --branch skill-manager-v0.1.1 https://github.com/dawn0608/dsh-plugins.git
cd dsh-plugins
npm ci
node scripts/install-skill-sync.mjs
```

The installer configures a user LaunchAgent and Claude Code hooks, backs up existing Codex and Claude Code settings, and prints the backup path. Restart Harness and reopen Claude Code sessions to register their working directories.

Put shared skills in `~/.agents/skills/<name>/SKILL.md`, matching the folder and skill name. The service maintains the Claude Code symlink. Use Harness **Skills**, Codex **Skills**, or Claude Code’s `/skills` to toggle a shared skill. For Claude Code, synchronization covers fully enabled and disabled states. Harness reports conflicts with a matching name in another location. If an open Codex desktop window still shows the previous state, restart it to reload the settings.
