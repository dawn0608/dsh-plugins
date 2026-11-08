# MCP Management

[中文](README.zh.md) | English

In DeepSeek Harness, open **Settings → MCP Management** to see the servers configured in the current profile's user patch. Each row shows the server name, transport (STDIO or Streamable HTTP), and whether the server is enabled.

## Manage servers

- Use the switch on an editable row to enable or disable the server. The switch updates the row's `disabled` setting, and Harness hot reloads the change.
- Add, edit, or remove servers in the profile's `cordis.patch.yml`. You can give your assistant the provider's setup instructions and ask it to edit that file. The panel refreshes while it is open.
- Rows outside a top-level `insert` list, with missing or duplicate IDs, with conditional `disabled` values, or with another unsupported shape are read-only. The panel also flags duplicate server names.

## Credentials

Store sensitive MCP values (env values, header values) with the Loader `!!js` reference Harness supports instead of plaintext:

```yaml
env:
  MCP_TOKEN: !!js 'process.env.MCP_TOKEN'
headers:
  Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

References resolve against the Harness process environment.

## Install

Requires DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`.

In Desktop, open **Plugins → Add plugin** and enter `@dawn0608/dsh-mcp-manager`. For a CLI-managed profile, run:

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-mcp-manager
```

You can also download the `.tgz` from [GitHub Releases](https://github.com/dawn0608/dsh-plugins/releases?q=mcp-manager) and install it with `dsh plugin --profile <profile> add /path/to/package.tgz`. Fully quit Harness Desktop before using the CLI to manage its profile.

To install from source, build from the repository root:

```bash
npm ci
npm run build --workspace @dawn0608/dsh-mcp-manager
```

Then select the local `plugins/mcp-manager` directory in the plugin picker. If an older installation is present, remove it before switching installation sources. Open **Settings → MCP Management** after installation and restart Harness if prompted.

## Configuration

The plugin has no required configuration. Optional:

```yaml
- id: mcp-manager
  name: '@dawn0608/dsh-mcp-manager'
  config:
    patchPath: /absolute/path/to/cordis.patch.yml
```

Use `patchPath` only for a non-standard profile layout; the default derives from `DSH_PROFILE_DIR`.

## Limitations

The panel manages the current profile's user patch. Bundle-provided services, other profiles, and the Codex and Claude Code configurations are managed separately.

## Development

```bash
npm test          # builds first; covers patch editing, validation, references, locking and atomic writes, and the state API
npm run verify    # from the repository root
```

The host bundle includes the ISC-licensed `yaml` dependency. [Upstream license](https://github.com/eemeli/yaml/blob/main/LICENSE)

## License

MIT
