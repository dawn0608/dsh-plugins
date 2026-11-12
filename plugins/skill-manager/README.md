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

- Switches control skills in `~/.agents/skills` and the Harness user skills directory for the current profile only. Disabled skills remain available for preview but cannot be called by the model or `/skill-name`. Enabling restores the skill's own frontmatter rules.
- The native Settings service saves `disabledSkills` in the plugin's current-profile configuration, binding each record to its source, canonical file path and name. Renamed or moved skills are new entries. Skills and other applications' configurations are never modified.
- `DSH_HOME` and `DSH_AGENTS_HOME` default to `~/.dsh` and `~/.agents`; absolute paths and `~/` are supported.
- Shared skill provenance comes from `$DSH_AGENTS_HOME/skills/.provenance.json`. Keys are relative paths such as `my-skill/SKILL.md`; `origin` is `self` or `third-party`. An optional credential-free HTTPS `repository` supplies the source link. Unconfirmed origins appear under Third-party.
- The list refreshes on opening, returning to the foreground and completing an action, with a 15-second foreground poll.

## Requirements and limitations

- Requires Harness `>=0.2.2-rc.1 <0.3.0` and Node.js 24 or later. No other AI tools or background service are required.
- Built-in, plugin-provided, project and custom-provider skills have no switch. Native source precedence is preserved; a same-name project skill is unaffected.
- Only native filesystem skills within the two user roots can be toggled. Configuration conflicts require refreshing and retrying. The plugin does not import, uninstall, copy or synchronize skills.

## Development

Run `npm test -w @dawn0608/dsh-skill-manager` from the repository root, or `npm run verify` for all plugins. Tests use isolated files and the native skill registry, Settings and ConfigEditor services.
