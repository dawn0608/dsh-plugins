# Skill Management

English | [中文](README.zh.md)

## Overview

Open **Skills** below **Plugins** in the DeepSeek Harness sidebar. Search the global catalog, inspect rendered `SKILL.md`, and see provenance or the original repository. Built-in, Self-authored, and Third-party groups use the existing Harness controls. This plugin does not add another management page.

## Install and upgrade

Requires DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`. In Desktop, open **Plugins → Add plugin** and enter `@dawn0608/dsh-skill-manager`, or use:

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

Upgrade through the Harness plugin manager and restart if prompted. To switch from a checkout, remove its installation before adding the npm package. Plugin installation does **not** install the optional background service. No postinstall script runs it.

## Manage skills

- Previously imported copies remain supported: use the switch to enable or disable a copy and the detail action to uninstall it. Bundles remain under `$DSH_HOME/skill-manager/bundles`, activated in `$DSH_HOME/skills`.
- Shared skill provenance lives in `$DSH_AGENTS_HOME/skills/.provenance.json` (default `~/.agents/skills/.provenance.json`). Keys are relative paths such as `my-skill/SKILL.md`; `origin` is `self` or `third-party`. An optional credential-free HTTPS `repository` is shown for third-party skills. Unconfirmed origins appear under Third-party.
- Shared skills use `$DSH_AGENTS_HOME/skills/<name>/SKILL.md`, with matching folder and skill names. The optional service manages Claude Code links, but only deletes links it created whose stored filesystem identity still matches. Preexisting links and older ownership claims without identity are preserved.

## Optional macOS shared sync

Prerequisites: macOS, Node.js `>=24`, and an installed `codex` CLI on PATH. Install or upgrade the service explicitly from npm; no source checkout is needed:

```bash
npx --yes --package @dawn0608/dsh-skill-manager@0.1.2 dsh-skill-sync-install
```

The installer honors `DSH_HOME`, `DSH_AGENTS_HOME`, `CODEX_HOME`, and `CLAUDE_CONFIG_DIR`, including `~/`. Defaults are `~/.dsh`, `~/.agents`, `~/.codex`, and `~/.claude`. Set the same variables for Harness and the installer. `DSH_SKILL_SYNC_CODEX` can select the Codex executable. The installer copies a bundled, self-contained daemon into `$DSH_HOME/skill-manager/shared-sync/runtime`, installs `local.dsh-skill-sync` as a user LaunchAgent, and adds Claude Code `SessionStart` / `CwdChanged` hooks. It checks the new service identity before reporting success; existing unrelated hooks remain intact and only exact hooks proven by the previous owned LaunchAgent are migrated. Restart Harness and reopen Claude Code sessions to register workspaces.

The service runs at login and synchronizes even while Harness is closed. Harness **Skills**, Codex **Skills**, and Claude Code `/skills` can toggle shared skills. Claude Code synchronization covers fully on/off states. Each destination's confirmed state is saved separately; failed writes retry against that baseline. A newer opposite external choice is preserved and reported as a conflict, which remains until an explicit Harness choice resolves it. Name collisions remain conflicts. Failures retain the last disabled Harness policy. The Skills page shows service failure/staleness and the last successful synchronization time. An already open Codex window may need restarting to reload its settings.

## Stop and recover

Uninstalling the plugin does **not** stop the independent daemon. Stop it explicitly:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.dsh-skill-sync.plist"
```

Remove that plist to prevent login startup, and remove only this service's exact command from Claude Code `SessionStart` / `CwdChanged` hooks. Keep unrelated hooks. Stopping synchronization leaves current enablement settings in place; restarting the service is done by rerunning the npm installer.

Every install prints a private backup directory under `$DSH_HOME/skill-manager/shared-sync/backup-*`, with a manifest of original paths/existence, Claude and Codex settings, state, the previous runtime and plist when present. If startup/readiness fails, the installer restores its changed files and reloads the previously loaded service. Concurrent edits are preserved and reported for manual recovery. For manual recovery, stop the service first, inspect that manifest, and restore only the intended backup files; do not blindly overwrite newer settings. Existing disabled state is retained on sync failures. The daemon log is `$DSH_HOME/skill-manager/shared-sync/error.log`. Integration with your real Codex/Claude sessions and launchd must be validated in your environment.
