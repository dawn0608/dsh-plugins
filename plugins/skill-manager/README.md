# Skill Management

## Features

Open **Skills** below **Plugins** in the DeepSeek Harness sidebar. Search the global catalog, inspect rendered `SKILL.md`, and see provenance or the original repository. Built-in, Self-authored, and Third-party groups use the existing Harness controls. This plugin does not add another management page.

## Installation

In Desktop, open **Plugins → Add plugin** and enter `@dawn0608/dsh-skill-manager`, or run this command for your profile.

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

Upgrade through the Harness plugin manager and restart if prompted.

## Usage and configuration

- Manage imported copies: use the switch to enable or disable a copy and the detail action to uninstall it. Bundles are stored under `$DSH_HOME/skill-manager/bundles`, activated in `$DSH_HOME/skills`.
- Shared skill provenance lives in `$DSH_AGENTS_HOME/skills/.provenance.json` (default `~/.agents/skills/.provenance.json`). Keys are relative paths such as `my-skill/SKILL.md`; `origin` is `self` or `third-party`. An optional credential-free HTTPS `repository` is shown for third-party skills. Unconfirmed origins appear under Third-party.
- Directory skills, including `~/.agents/skills`, are discovered and loaded by Harness. This plugin displays its catalog and details; only plugin-owned imported copies can be enabled, disabled, or uninstalled here.
- `DSH_HOME` and `DSH_AGENTS_HOME` default to `~/.dsh` and `~/.agents`; absolute paths and `~/` are supported. The plugin does not manage other applications’ skills or configuration.

## Requirements and limitations

- Requires DeepSeek Harness `>=0.2.2-rc.1 <0.3.0` and Node.js 24 or later.
- Supports Windows, macOS, and Linux filesystem operations. Imported copies use directory junctions on Windows and directory symlinks elsewhere; no administrator privileges or Developer Mode are required.
- No Python, Codex, Claude Code, or background service is required. Filesystem conflicts or files held open by another process may require resolving the conflict before retrying.

## Development

From the repository root, run `npm test -w @dawn0608/dsh-skill-manager` for the plugin tests and `npm run verify` for the full repository check.
