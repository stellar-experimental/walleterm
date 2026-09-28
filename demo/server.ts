import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '../dist');
export function createDemoSite({ port = 8788 } = {}) {
  let origin = `http://127.0.0.1:${port}`,
    closing = false;
  const files: Record<string, [string, string]> = {
    '/': [join(here, 'site/index.html'), 'text/html'],
    '/activity.js': [join(assets, 'demo/site/activity.js'), 'text/javascript'],
    '/code-view.js': [join(assets, 'demo/site/code-view.js'), 'text/javascript'],
    '/code-view.css': [join(here, 'site/code-view.css'), 'text/css'],
    '/syntax.js': [join(assets, 'demo/site/syntax.js'), 'text/javascript'],
    '/demo/site/syntax.js': [join(assets, 'demo/site/syntax.js'), 'text/javascript'],
    '/vendor/syntax.LICENSE': [join(here, 'site/vendor/syntax.LICENSE'), 'text/plain'],
    '/activity.css': [join(here, 'site/activity.css'), 'text/css'],
    '/app.js': [join(assets, 'demo/site/app.js'), 'text/javascript'],
    '/style.css': [join(here, 'site/style.css'), 'text/css'],
    '/sdk/walleterm.js': [join(assets, 'sdk/walleterm.js'), 'text/javascript'],
    '/sdk/connect.js': [join(assets, 'sdk/connect.js'), 'text/javascript'],
    '/sdk/connect.css': [join(here, '../sdk/connect.css'), 'text/css'],
    '/sdk/scan.js': [join(assets, 'sdk/scan.js'), 'text/javascript'],
    '/fixtures/walleterm_simple_account.wasm': [
      join(here, '../fixtures/wasm/walleterm_simple_account.wasm'),
      'application/wasm',
    ],
    '/fixtures/walleterm_auth_target.wasm': [
      join(here, '../fixtures/wasm/walleterm_auth_target.wasm'),
      'application/wasm',
    ],
    '/stellar-sdk.js': [
      join(here, '../node_modules/@stellar/stellar-sdk/dist/stellar-sdk.min.js'),
      'text/javascript',
    ],
  };
  for (const name of readdirSync(assets)) {
    if (/^(chunk|jsQR)-[a-z0-9]+\.js$/i.test(name))
      files[`/${name}`] = [join(assets, name), 'text/javascript'];
  }
  const server = createServer((req, res) => {
    if (
      closing ||
      ![
        new URL(origin).host,
        `127.0.0.1:${(server.address() as AddressInfo | null)?.port}`,
        `localhost:${(server.address() as AddressInfo | null)?.port}`,
      ].includes(req.headers.host || '')
    ) {
      res.writeHead(403);
      return res.end();
    }
    let path: string;
    try {
      path = new URL(req.url || '/', origin).pathname;
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (req.method !== 'GET') {
      res.writeHead(405);
      return res.end();
    }
    if (path === '/api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end('{"service":"walleterm-demo"}');
    }
    const file = files[path];
    if (!file) {
      res.writeHead(404);
      return res.end('Page not found.');
    }
    res.writeHead(200, {
      'Content-Type': `${file[1]}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src https: http://127.0.0.1:* http://localhost:*; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    res.end(readFileSync(file[0]));
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.setTimeout(15000);
  return {
    service: 'walleterm-demo',
    server,
    setPublicOrigin(value: string) {
      origin = value;
    },
    async listen() {
      if (closing) throw Error('The demo is stopping.');
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      if (closing) server.close();
    },
    async close() {
      closing = true;
      server.close();
      server.closeAllConnections();
    },
  };
}
