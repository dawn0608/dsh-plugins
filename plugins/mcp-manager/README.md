# MCP Management

View and toggle MCP servers for the current Desktop profile under **Settings → MCP Management**. The panel supports local `stdio` and remote Streamable HTTP servers.

- Each row shows the server name, transport (STDIO or Streamable HTTP), and enablement switch.
- Give the provider’s setup instructions to your AI assistant so it can update the profile’s `cordis.patch.yml`. The panel automatically picks up configuration changes while open.
- The switch updates the selected row’s `disabled` state under the profile writer lock. Harness hot reloads the change, and external synchronizers pick it up on their next poll.

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

In Desktop, open **Plugins → Add plugin** and enter `@dawn0608/dsh-mcp-manager`. For a CLI-managed profile, run:

```bash
dsh plugin --profile <profile> add @dawn0608/dsh-mcp-manager
```

You can also download the `.tgz` from [GitHub Releases](https://github.com/dawn0608/dsh-plugins/releases?q=mcp-manager) and install it with `dsh plugin --profile <profile> add /path/to/package.tgz`. Fully quit Harness Desktop before using the CLI to manage its profile.

To install from source, build from the repository root:

```bash
npm install
npm run build
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

- Only the current profile's **user patch file** is managed; bundle-provided rows, Codex/Claude configuration, and other profiles are out of scope.
- Rows must sit in a top-level `insert` list, carry a unique id, and use a boolean `disabled`; entries that cannot be safely toggled are shown as read-only.
- The list flags duplicate names in the same file.
- Rows using `!!js`, `headers`, or a non-portable environment are skipped by the three-end synchronizer by design: credentials stay local.
- `yaml` is used at build time and inlined into `lib/index.js`, so the runtime has no extra dependency; see the upstream `eemeli/yaml` repository for its ISC license.

## Development

```bash
npm test          # builds first; covers patch editing, validation, references, locking and atomic writes, and the state API
npm run verify    # from the repository root
```

## License

MIT
