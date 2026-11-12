# Skill Management

## Features

Open **Skills** below **Plugins** in the Harness sidebar to search Built-in, Self-authored and Third-party skills, preview Markdown, and open source repositories. Code blocks support copying and wrapping.

## Installation

Enter `@dawn0608/dsh-skill-manager` in **Plugins → Add plugin**, or run:

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-skill-manager
```

Restart Harness if prompted. Fully quit Desktop before changing its profile through the CLI.

## Usage and configuration

- Search by name or description and open a skill to preview it. The list uses Harness's native global catalog and source precedence.
- Shared skill provenance comes from `$DSH_AGENTS_HOME/skills/.provenance.json`; `DSH_AGENTS_HOME` defaults to `~/.agents` and supports absolute paths and `~/`. Keys are relative paths such as `my-skill/SKILL.md`; `origin` is `self` or `third-party`. An optional credential-free HTTPS `repository` supplies the source link. Unconfirmed origins appear under Third-party.
- The list refreshes on opening and returning to the foreground, with a 15-second foreground poll.

## Requirements and limitations

- Requires Harness `>=0.2.2-rc.1 <0.3.0` and Node.js 24 or later. No other AI tools or background service are required.
- Read-only: skill loading and invocation follow Harness's native rules and skill frontmatter. The plugin does not modify skills or application configurations.

## Development

Run `npm test -w @dawn0608/dsh-skill-manager` from the repository root, or `npm run verify` for all plugins. Tests use isolated files and native Harness services.
