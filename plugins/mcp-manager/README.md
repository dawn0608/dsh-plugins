# MCP Management

## Features

- Shows the MCP servers in the current profile under **Settings → MCP Management**, with their names, transport, and enablement switches.
- Supports local STDIO and remote Streamable HTTP. The list refreshes on opening, returning to the foreground and completing an action, with a 15-second foreground poll.
- Toggles a server by changing only its row-level `disabled` field. The plugin locks the profile and replaces the patch atomically, preserving the other configuration, references, and comments.

## Installation

Search for `@dawn0608/dsh-mcp-manager` on the Desktop Plugins page, or run this command for your profile.

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-mcp-manager
```

You can also download the `.tgz` from [GitHub Releases](https://github.com/dawn0608/dsh-plugins/releases?q=mcp-manager) and install it with `dsh plugin --profile <profile> add /path/to/package.tgz`. Fully quit Harness Desktop before using the CLI to manage its profile.

To install from source, run `npm ci` and `npm run build` from the repository root, then select `plugins/mcp-manager` in the local plugin picker. Open **Settings → MCP Management** after installation and restart Harness if prompted.

## Usage and configuration

Switches affect only the current Harness profile; they do not propagate to Codex or Claude Code. To add or change server settings, give your AI assistant the provider's setup instructions and ask it to update the profile's `cordis.patch.yml`.

The plugin normally uses the active profile's name, directory, and patch path from the Harness host. When the host does not supply this information, the plugin checks `DSH_PROFILE_DIR`, then `DSH_HOME/profiles/<DSH_PROFILE>` when both variables are set, and finally an absolute launcher argument pointing to a directory with a profile manifest and patch file. The panel reports when it cannot locate or read the patch. An explicit absolute `patchPath` takes precedence over all these sources.

```yaml
- id: mcp-manager
  name: '@dawn0608/dsh-mcp-manager'
  config:
    patchPath: /absolute/path/to/cordis.patch.yml
```

Keep sensitive env and header values in the Harness process environment and reference them with Loader `!!js`:

```yaml
env:
  MCP_TOKEN: !!js 'process.env.MCP_TOKEN'
headers:
  Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

## Requirements and limitations

- DSH `>=0.2.2-rc.1 <0.3.0` and Node.js 24 or later for local development.
- The enablement switch manages only the current profile’s user patch. Other applications manage their own MCP configuration.
- No Python, Codex, Claude Code, or background service is required.
- Bundle-provided rows and other profiles are outside the panel's scope.
- To toggle a row, it must be in a top-level `insert` list with a unique ID and either no `disabled` field or a boolean value. Rows the panel cannot safely toggle are read-only. Duplicate server names are flagged separately.
- The settings page uses the authenticated Harness connection. The list response includes server summaries and omits configuration fields such as URLs, command arguments, environment variables, and headers.

## Development

Run `npm test -w @dawn0608/dsh-mcp-manager` from the repository root for the plugin checks, or `npm run verify` for the entire repository. The build bundles the YAML parser into the host entry. The plugin is [MIT licensed](LICENSE); the bundled [YAML parser](https://github.com/eemeli/yaml) uses the ISC license.
