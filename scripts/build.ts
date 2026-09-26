import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = fileURLToPath(new URL('../dist/', import.meta.url));
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [
    'sdk/walleterm.ts',
    'sdk/connect.ts',
    'sdk/scan.ts',
    'demo/site/app.ts',
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
