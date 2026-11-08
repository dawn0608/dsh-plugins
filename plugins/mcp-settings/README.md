# MCP settings

Adds an **MCP** panel to the native DeepSeek Harness Settings, for viewing, adding, editing, enabling, and deleting MCP servers in the current Desktop profile's `cordis.patch.yml`. Local `stdio` servers and remote Streamable HTTP servers are supported.

## Features

- Lists every `insert → @deepseek-ai/dsh-mcp-client` row in the profile patch with its name, transport, enablement, and currently discovered tool count.
- Adds, edits, and deletes servers, and toggles them without opening the editor.
- Validates before saving: server-name shape and length, the synchronizer's reserved name (`node_repl`), duplicates in the same file, required fields, URLs, environment names, header names, and reference variable names. Errors are attached to their fields; the Host validates again.
- Writes under the profile writer lock and replaces the file atomically. Only the target row changes; other patch blocks, comments, `!!js` expressions, and line endings are preserved.
- Saving applies through Harness hot reload; external synchronizers watching the file pick the change up on their next poll.
- The tool count comes from the live Host tool registry. Zero means no tools were discovered yet, not that the save failed.

## Credentials

Store sensitive MCP values (env values, header values) with the Loader `!!js` reference Harness supports instead of plaintext:

```yaml
env:
  MCP_TOKEN: !!js 'process.env.MCP_TOKEN'
headers:
  Authorization: !!js '`Bearer ${process.env.MCP_TOKEN}`'
```

The panel's **Environment reference** mode writes both shapes; values come from the Harness process environment. The state API returns only whether a value is configured and the variable name, never the value; logs carry only the action, server name, and error code. An existing plaintext secret renders as **Set (hidden)** and is preserved when another field is edited unless it is explicitly replaced or cleared.

## Install

Build in the plugin repository, then install the local package through the DSH plugin entry point:

```bash
cd ~/Developer/dsh-plugins
npm install
npm run build
```

Install the local directory `plugins/mcp-settings` from the Desktop Plugins page, or with the CLI:

```bash
dsh plugin --profile desktop add ./plugins/mcp-settings
```

Open **Settings → MCP** afterwards. Refresh the page once if the section does not appear immediately; replacing an installed package or editing its code requires a Harness restart to load the new plugin generation.

## Configuration

The plugin has no required configuration. Optional:

```yaml
- id: mcp-settings
  name: '@dawn0608/dsh-mcp-settings'
  config:
    patchPath: /absolute/path/to/cordis.patch.yml
```

Use `patchPath` only for a non-standard profile layout; the default derives from `DSH_PROFILE_DIR`.

## Limitations

- Only the current profile's **user patch file** is managed; bundle-provided rows, Codex/Claude configuration, and other profiles are out of scope.
- Rows must sit in a top-level `insert` list, carry a unique id, and use a boolean `disabled`; otherwise the entry is read-only (deletable, not editable).
- Duplicate names inside the file are rejected on save; duplicates between a bundle and the user patch are reported by the MCP client at load time.
- Rows using `!!js`, `headers`, or a non-portable environment are skipped by the three-end synchronizer by design: credentials stay local.
- `yaml` is used at build time and inlined into `lib/index.js`, so the runtime has no extra dependency; see the upstream `eemeli/yaml` repository for its ISC license.

## Development

```bash
npm test          # builds first; covers patch editing, validation, references, locking and atomic writes, and the state API
npm run verify    # from the repository root
```

## License

MIT
