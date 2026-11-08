# Example Plugin (@dawn0608/dsh-example)

A minimal DeepSeek Harness plugin template. Copy `templates/plugin/` to `plugins/<name>/`.

## Features

Includes Host and Client entries, native theme styles, bilingual text, and lifecycle tests.

## Installation

From the repository root, build and install the copied package:

```sh
npm --prefix plugins/<name> run build
dsh plugin --profile <profile> add ./plugins/<name>
```

## Usage and configuration

Replace the package name and metadata, short insert ID in `cordis.patch.yml`, client loader ID, locale namespace, CSS prefix, icon, and both README files. Reuse the host's existing component styles and layouts for plugin pages.

## Compatibility and limitations

Requires Node.js 24 and DeepSeek Harness `>=0.2.2-rc.1 <0.3.0`. The template is private; remove `"private": true` only when preparing a public release. Keep credentials on the server.

## Development

Runtime source belongs in `src/`, tests in `test/`, and translated metadata in `locale/`. `lib/` is generated and not committed. Keep the package exports and file list aligned with the template.

```sh
npm run build
npm test
```

Run `npm run verify` from the repository root before release; it checks all plugins, shared scripts, and this template.
