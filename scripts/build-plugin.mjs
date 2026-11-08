#!/usr/bin/env node
/**
 * Build one plugin package: `src/` -> `lib/`.
 *
 * - Host: `src/index.{js,ts}` -> `lib/index.js` (ESM, Node 24, bundled).
 * - Client: `src/client/index.{js,ts}` -> `lib/client.js`, wrapped in the
 *   DSH module-loader shell whose id is the package name. React (and any
 *   declared `dsh.client.inject` / `external` package) stays a runtime
 *   `require` served by the loader.
 *
 * Run from a plugin directory (`npm run build`) or pass the package directory.
 */
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? process.cwd());
const pkgPath = join(dir, 'package.json');

function fail(message) {
  console.error(`build ${dir}: ${message}`);
  process.exit(1);
}

if (!existsSync(pkgPath)) fail('missing package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
if (typeof pkg.name !== 'string' || pkg.name === '') fail('package.json has no name');

function firstExisting(paths) {
  return paths.find(path => existsSync(path));
}

const hostEntry = firstExisting([join(dir, 'src/index.ts'), join(dir, 'src/index.js')]);
const clientEntry = firstExisting([join(dir, 'src/client/index.ts'), join(dir, 'src/client/index.js')]);
const declaresClient = Boolean(pkg.dsh && pkg.dsh.client);

if (hostEntry === undefined) fail('missing src/index.js or src/index.ts');
if (clientEntry !== undefined && !declaresClient) fail('src/client exists but package.json has no dsh.client');
if (clientEntry === undefined && declaresClient) fail('dsh.client is declared but src/client/index.js is missing');

const libDir = join(dir, 'lib');
rmSync(libDir, { recursive: true, force: true });
mkdirSync(libDir, { recursive: true });

// Bundled CommonJS dependencies call require() for Node builtins (for example
// yaml's `require('process')`). In an ES module esbuild's shim throws for those
// calls, so give the bundle a real createRequire-based require.
const hostRequireShim = [
  "import { createRequire as __dshCreateRequire } from 'node:module';",
  'const require = __dshCreateRequire(import.meta.url);',
].join('\n');

await build({
  entryPoints: [hostEntry],
  outfile: join(libDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  banner: { js: hostRequireShim },
  logLevel: 'warning',
});

if (clientEntry !== undefined) {
  const externals = [...new Set([
    'react',
    'react-dom',
    'react/jsx-runtime',
    ...(pkg.dsh.client.external ?? []),
    ...(pkg.dsh.client.inject ?? []),
  ])];
  const banner = [
    'window.__ModuleLoader__.load({',
    `  id: ${JSON.stringify(pkg.name)},`,
    '  factory: (require) => {',
    '    var module = { exports: {} };',
    '    var exports = module.exports;',
  ].join('\n');
  const footer = [
    '    Object.defineProperty(module.exports, Symbol.toStringTag, { value: "Module" });',
    '    return module.exports;',
    '  },',
    '});',
  ].join('\n');

  await build({
    entryPoints: [clientEntry],
    outfile: join(libDir, 'client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: externals,
    loader: { '.css': 'text' },
    banner: { js: banner },
    footer: { js: footer },
    sourcemap: 'linked',
    logLevel: 'warning',
  });
}

console.log(`built ${pkg.name}`);
