import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = fileURLToPath(new URL('../dist/', import.meta.url));
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
});
if (!demo.success) throw new AggregateError(demo.logs, 'The demo build failed.');
