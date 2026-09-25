import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
export function createDemoSite({ port = 8788 } = {}) {
  let origin = `http://127.0.0.1:${port}`, closing = false;
  const files = {
    '/': [join(here, 'site/index.html'), 'text/html'],
    '/app.js': [join(here, 'site/app.js'), 'text/javascript'],
    '/style.css': [join(here, 'site/style.css'), 'text/css'],
    '/sdk/walleterm.js': [join(here, '../sdk/walleterm.js'), 'text/javascript'],
    '/sdk/scan.js': [join(here, '../sdk/scan.js'), 'text/javascript'],
    '/sdk/jsqr.js': [join(here, '../node_modules/jsqr/dist/jsQR.js'), 'text/javascript'],
    '/stellar-sdk.js': [join(here, '../node_modules/@stellar/stellar-sdk/dist/stellar-sdk.min.js'), 'text/javascript'],
  };
  const server = createServer((req, res) => {
    if (closing || ![new URL(origin).host, `127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`].includes(req.headers.host)) { res.writeHead(403); return res.end(); }
    const path = new URL(req.url, origin).pathname;
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (path === '/api/session') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end('{"service":"walleterm-demo"}'); }
    const file = files[path]; if (!file) { res.writeHead(404); return res.end('Page not found.'); }
    res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src https: http://127.0.0.1:* http://localhost:*; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    res.end(readFileSync(file[0]));
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.setTimeout(15000);
  return { service: 'walleterm-demo', server, setPublicOrigin(value) { origin = value; },
    async listen() { if (closing) throw Error('The demo is stopping.'); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); if (closing) server.close(); },
    async close() { closing = true; server.close(); server.closeAllConnections(); },
  };
}
