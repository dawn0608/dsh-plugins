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
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] && !args[0].startsWith('--') ? args.shift() : process.cwd());
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
const extraEntries = [];
while (args.length > 0) {
  if (args.shift() !== '--entry' || !args[0]) fail('expected --entry src/<name>.js');
  const entry = resolve(dir, args.shift());
  const within = relative(join(dir, 'src'), entry);
  if (within.startsWith('..') || !/\.(?:js|ts)$/.test(entry) || !existsSync(entry)) fail('extra entry must be an existing source inside src/');
  if ([hostEntry, ...extraEntries].some(existing => basename(existing, extname(existing)) === basename(entry, extname(entry)))) fail('duplicate host entry output');
  extraEntries.push(entry);
}
rmSync(libDir, { recursive: true, force: true });
mkdirSync(libDir, { recursive: true });

// This notice covers the native controls/styles copied into published bundles.
const thirdPartyNotice = resolve(import.meta.dirname, '../THIRD_PARTY_NOTICES.md');
if (existsSync(thirdPartyNotice)) copyFileSync(thirdPartyNotice, join(libDir, 'THIRD_PARTY_NOTICES.md'));

// Bundled CommonJS dependencies call require() for Node builtins (for example
// yaml's `require('process')`). In an ES module esbuild's shim throws for those
// calls, so give the bundle a real createRequire-based require.
const hostRequireShim = [
  "import { createRequire as __dshCreateRequire } from 'node:module';",
  'const require = __dshCreateRequire(import.meta.url);',
].join('\n');

const hostBuild = await build({
  metafile: true,
  entryPoints: Object.fromEntries([hostEntry, ...extraEntries].map(entry => [basename(entry, extname(entry)), entry])),
  outdir: libDir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  banner: { js: hostRequireShim },
  logLevel: 'warning',
});

for (const entry of Object.values(typeof pkg.bin === 'object' ? pkg.bin : {})) {
  const path = resolve(dir, entry);
  if (!relative(libDir, path).startsWith('..') && existsSync(path)) chmodSync(path, 0o755);
}

let clientBuild;
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

  clientBuild = await build({
    metafile: true,
    entryPoints: [clientEntry],
    outfile: join(libDir, 'client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    external: externals,
    loader: { '.css': 'text', '.svg': 'dataurl' },
    plugins: [{
      name: 'self-contained-styles',
      setup(builder) {
        builder.onLoad({ filter: /\.css$/ }, ({ path }) => {
          const contents = readFileSync(path, 'utf8').replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, _quote, url) => {
            if (/^(?:data:|https?:|#)/i.test(url)) return match;
            const asset = resolve(dirname(path), url);
            const mime = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' }[extname(asset)];
            if (!mime) throw new Error(`Unsupported local stylesheet asset: ${asset}`);
            return `url("data:${mime};base64,${readFileSync(asset).toString('base64')}")`;
          });
          return { contents, loader: 'text' };
        });
      },
    }],
    banner: { js: banner },
    footer: { js: footer },
    sourcemap: 'linked',
    logLevel: 'warning',
  });
}

// Bundling copies dependency code: retain the license files for actual inputs,
// including transitive dependencies, alongside the native-control notice.
const dependencies = new Map();
for (const result of [hostBuild, clientBuild]) {
  for (const input of Object.keys(result?.metafile.inputs ?? {})) {
    if (!input.includes('node_modules/')) continue;
    let cursor = dirname(resolve(input));
    while (cursor !== dirname(cursor)) {
      const manifest = join(cursor, 'package.json');
      if (existsSync(manifest)) {
        const dependency = JSON.parse(readFileSync(manifest, 'utf8'));
        if (dependency.name && dependency.version) {
          dependencies.set(`${dependency.name}@${dependency.version}`, { dir: cursor, ...dependency });
          break;
        }
      }
      cursor = dirname(cursor);
    }
  }
}
let notice = existsSync(thirdPartyNotice) ? readFileSync(thirdPartyNotice, 'utf8') : '# Third-party notices\n';
for (const [name, dependency] of [...dependencies].sort(([a], [b]) => a.localeCompare(b))) {
  const files = readdirSync(dependency.dir).filter(file => /^(?:licen[sc]e|copying|notice)(?:\.|$)/i.test(file));
  if (!files.length && !['rehype-katex', 'remark-math'].includes(dependency.name)) fail(`bundled dependency ${name} has no license file`);
  notice += `\n## ${name} (${dependency.license ?? 'see license'})\n\n`;
  for (const file of files) notice += readFileSync(join(dependency.dir, file), 'utf8') + '\n';
}
writeFileSync(join(libDir, 'THIRD_PARTY_NOTICES.md'), notice);
console.log(`built ${pkg.name}`);
