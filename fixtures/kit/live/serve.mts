// Serves the SEP-43 live acceptance page on loopback. It builds the page from source at start.
// Run from the repository root after the Kit fixture install:
//   bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts
//   bun fixtures/kit/live/serve.mts [--port 8790] [--check]
// The bridge accepts a loopback HTTP website Origin. The page never builds a mainnet transaction.
import { fileURLToPath } from 'node:url';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** Build the page in memory. The map keys are the served paths. */
export async function buildPage() {
  const result = await Bun.build({
    entrypoints: [here('page.mts')],
    target: 'browser',
    format: 'esm',
    splitting: true,
    naming: { entry: 'page.js', chunk: 'chunk-[hash].js' },
  });
  if (!result.success) throw new AggregateError(result.logs, 'The acceptance page build failed.');
  return new Map(result.outputs.map((output) => [`/${output.path.replace(/^\.\//, '')}`, output]));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const files = await buildPage();
  if (args.includes('--check')) {
    console.log(JSON.stringify({ ok: true, files: [...files.keys()] }));
    process.exit(0);
  }
  const port = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8790;
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      if (pathname === '/')
        return new Response(Bun.file(here('index.html')), {
          headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
        });
      if (pathname === '/connect.css')
        return new Response(Bun.file(here('../../../sdk/connect.css')), {
          headers: { ...headers, 'Content-Type': 'text/css' },
        });
      const file = files.get(pathname);
      return file
        ? new Response(file, { headers: { ...headers, 'Content-Type': 'text/javascript' } })
        : new Response('Not found', { status: 404 });
    },
  });
  console.log(`Walleterm SEP-43 acceptance page: http://127.0.0.1:${server.port}/`);
}
