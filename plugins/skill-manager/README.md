# Skill Management

## Features

Open **Skills** below **Plugins** in the DeepSeek Harness sidebar. Search the global catalog, inspect rendered `SKILL.md`, and see provenance or the original repository. Built-in, Self-authored, and Third-party groups use the existing Harness controls. This plugin does not add another management page.

## Installation

In Desktop, open **Plugins → Add plugin** and enter `@dawn0608/dsh-skill-manager`, or run this command for your profile.

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

Upgrade through the Harness plugin manager and restart if prompted. Plugin installation does **not** install the optional background service. No postinstall script runs it.

### Install or upgrade optional macOS shared sync

Install or upgrade the service directly from npm.

```bash
npx --yes --package @dawn0608/dsh-skill-manager@0.1.7 dsh-skill-sync-install
```

## Usage and configuration

- Manage imported copies: use the switch to enable or disable a copy and the detail action to uninstall it. Bundles are stored under `$DSH_HOME/skill-manager/bundles`, activated in `$DSH_HOME/skills`.
- Shared skill provenance lives in `$DSH_AGENTS_HOME/skills/.provenance.json` (default `~/.agents/skills/.provenance.json`). Keys are relative paths such as `my-skill/SKILL.md`; `origin` is `self` or `third-party`. An optional credential-free HTTPS `repository` is shown for third-party skills. Unconfirmed origins appear under Third-party.
- Shared skills have one source: `$DSH_AGENTS_HOME/skills/<name>/SKILL.md` (default `~/.agents/skills`), with matching folder and skill names. Harness and Codex read the shared directory; the optional service supplies Claude Code links, so content edits are immediately reflected. Source deletion or renaming removes only unchanged links confirmed to have been created by this service. Same-name local skills and links of unconfirmed ownership are preserved.

### Configure shared sync

The installer honors `DSH_HOME`, `DSH_AGENTS_HOME`, and `CLAUDE_CONFIG_DIR`, including `~/`; defaults are `~/.dsh`, `~/.agents`, and `~/.claude`. Use the same variables for Harness and the installer. It deploys the self-contained daemon to `$DSH_HOME/skill-manager/shared-sync/runtime`, configures the user LaunchAgent `local.dsh-skill-sync`, and activates synchronization after checking its identity. No Codex CLI or project hooks are required; projects are not scanned.

The service runs at login and while Harness is closed. Switches are independent: Harness stores shared-skill choices in `$DSH_HOME/skill-manager/shared-policy.json` without changing Codex or Claude settings. An unreadable shared root or temporarily invalid skill preserves existing state and links; one failing entry does not block other valid skills. The Skills page reports service failure or staleness. Clients may need refreshing or restarting to reload skills.

### Stop and recover shared sync

Uninstalling the plugin does **not** stop the independent daemon. Stop it explicitly:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.dsh-skill-sync.plist"
```

Remove that plist to prevent login startup. Stopping synchronization preserves files, links, and each client’s switches. Rerun the npm installer to start the service again.

The installer creates no routine backups. If startup fails, it rolls back only its own changes and preserves and reports concurrent edits. The daemon log is `$DSH_HOME/skill-manager/shared-sync/error.log`.

## Requirements and limitations

- Requires DeepSeek Harness `>=0.2.2-rc.1 <0.3.0` and Node.js 24 or later.
- The optional background service requires macOS. File synchronization does not guarantee that a running client reloads immediately.

## Development

From the repository root, run `npm test -w @dawn0608/dsh-skill-manager` for the plugin tests and `npm run verify` for the full repository check.
