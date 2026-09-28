import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Packaging passes a private directory and --minify. Concurrent builds then cannot mix browser chunks.
const args = process.argv.slice(2);
const minify = args.includes('--minify');
const target = args.find((arg) => !arg.startsWith('--'));
const outdir = target ? `${resolve(target)}/` : fileURLToPath(new URL('../dist/', import.meta.url));
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [
    'sdk/walleterm.ts',
    'sdk/authorization.ts',
    'sdk/connect.ts',
    'sdk/kit.ts',
    'sdk/scan.ts',
    'demo/site/activity.ts',
    'demo/site/code-view.ts',
    'demo/site/syntax.ts',
  ].map((path) => root + path),
  root,
  outdir,
  target: 'browser',
  format: 'esm',
  splitting: true,
  minify,
});
if (!result.success) throw new AggregateError(result.logs, 'The browser build failed.');

// Keep the side-effectful demo entry out of shared library chunks.
// Bun can otherwise place SDK exports in app.js and import the demo from a library chunk.
const demo = await Bun.build({
  entrypoints: [root + 'demo/site/app.ts'],
  root,
  outdir,
  target: 'browser',
  format: 'esm',
  splitting: false,
  minify,
});
if (!demo.success) throw new AggregateError(demo.logs, 'The demo build failed.');

// The demo routes that `walleterm demo` embeds. build.rs reads routes.tsv; nothing else is served.
const routes: [route: string, file: string, type: string][] = [
  ['/', root + 'demo/site/index.html', 'text/html'],
  ['/activity.js', outdir + 'demo/site/activity.js', 'text/javascript'],
  ['/code-view.js', outdir + 'demo/site/code-view.js', 'text/javascript'],
  ['/code-view.css', root + 'demo/site/code-view.css', 'text/css'],
  ['/syntax.js', outdir + 'demo/site/syntax.js', 'text/javascript'],
  ['/demo/site/syntax.js', outdir + 'demo/site/syntax.js', 'text/javascript'],
  ['/vendor/syntax.LICENSE', root + 'demo/site/vendor/syntax.LICENSE', 'text/plain'],
  ['/activity.css', root + 'demo/site/activity.css', 'text/css'],
  ['/app.js', outdir + 'demo/site/app.js', 'text/javascript'],
  ['/style.css', root + 'demo/site/style.css', 'text/css'],
  ['/sdk/walleterm.js', outdir + 'sdk/walleterm.js', 'text/javascript'],
  ['/sdk/connect.js', outdir + 'sdk/connect.js', 'text/javascript'],
  ['/sdk/connect.css', root + 'sdk/connect.css', 'text/css'],
  ['/sdk/scan.js', outdir + 'sdk/scan.js', 'text/javascript'],
  [
    '/fixtures/walleterm_simple_account.wasm',
    root + 'fixtures/wasm/walleterm_simple_account.wasm',
    'application/wasm',
  ],
  [
    '/fixtures/walleterm_auth_target.wasm',
    root + 'fixtures/wasm/walleterm_auth_target.wasm',
    'application/wasm',
  ],
];
for (const name of readdirSync(outdir).sort())
  if (/^(chunk|jsQR)-[a-z0-9]+\.js$/i.test(name)) routes.push([`/${name}`, outdir + name, 'text/javascript']);
routes.sort(([a], [b]) => (a < b ? -1 : 1));
const lines = routes.map(([route, file, type]) => {
  const digest = createHash('sha256').update(readFileSync(file)).digest('hex');
  return [route, type, digest, resolve(file)].join('\t');
});
await writeFile(outdir + 'routes.tsv', lines.join('\n') + '\n');
