# MCP Management

View and toggle MCP servers for the current Desktop profile under **Settings → MCP Management**. The panel supports local `stdio` and remote Streamable HTTP servers.

- Rows show the server name, transport, enablement, and discovered tool count.
- Give the provider’s setup instructions to your AI assistant so it can update the profile’s `cordis.patch.yml`. Select **Refresh** to see the latest configuration.
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

Build in the plugin repository, then install the local package through the DSH plugin entry point:

```bash
cd ~/Developer/dsh-plugins
npm install
npm run build
```

In Desktop, use **Plugins → Add plugin** and select the local `plugins/mcp-manager` directory. If you have the previous package installed, uninstall it before adding the renamed package. Open **Settings → MCP Management** after installation. Restart Harness if prompted.

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
