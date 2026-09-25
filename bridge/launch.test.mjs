import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, readFileSync } from 'node:fs';
import { launchService, publicProbe, tunnelOrigin, waitForTunnel } from './launch.mjs';

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('close', 0); };
  return child;
}
function lifecycle() {
  const controller = new AbortController(), child = fakeChild(), output = [];
  let spawned = 0, onPairing;
  const service = { server: { listening: false }, closed: false,
    pairing: { walleterm: 2, url: 'https://bridge-name.trycloudflare.com', code: '01234567', expires_at: '2026-09-25T00:00:00.000Z' },
    onPairingChanged(callback) { onPairing = callback; },
    setPublicOrigin(origin) { this.origin = origin; }, async listen() { this.server.listening = true; },
    async close() { this.closed = true; this.server.listening = false; } };
  const options = { signal: controller.signal, create: () => service, ready: async () => {},
    environment: { PATH: '/bin', HOME: '/mock', TUNNEL_TOKEN: 'mock', TUNNEL_LOGLEVEL: 'debug', TUNNEL_METRICS: '0.0.0.0:1234' },
    output: { write: value => output.push(value) },
    spawnTunnel: (...args) => { spawned++; options.spawned = args; queueMicrotask(() => child.stderr.write('https://bridge-name.trycloudflare.com\n')); return child; } };
  return { controller, child, output, service, options, count: () => spawned, rotate: () => onPairing() };
}
const config = { port: 8791, label: 'Walleterm tunnel' };

test('a split cloudflared URL selects only the tunnel origin', async () => {
  const child = fakeChild();
  const pending = waitForTunnel(child, 1000);
  child.stderr.write('Visit it at https://sample-name.trycloud');
  child.stderr.write('flare.com/path\n');
  assert.equal(await pending, 'https://sample-name.trycloudflare.com');
  assert.equal(tunnelOrigin('https://example.com'), null);
});

test('the service owns its listener and an isolated tunnel, and prints the pairing code', async () => {
  const f = lifecycle();
  const result = await launchService(config, f.options);
  const [command, argv, options] = f.options.spawned;
  assert.equal(command, 'cloudflared');
  assert.equal(argv[argv.indexOf('--url') + 1], 'http://127.0.0.1:8791');
  assert.equal(argv[argv.indexOf('--metrics') + 1], '127.0.0.1:0');
  assert.equal(readFileSync(argv[argv.indexOf('--config') + 1], 'utf8'), '{}\n');
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH']);
  assert.equal(f.service.origin, 'https://bridge-name.trycloudflare.com');
  const text = f.output.join('');
  assert.match(text, /Walleterm tunnel is ready on Stellar testnet/);
  assert.match(text, /Connection code: 01234567/);
  assert.match(text, /Press Ctrl\+C/);
  f.service.pairing.code = '76543210'; f.rotate();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(f.output.join(''), /Connection code: 76543210/);
  await result.stop(0);
  assert.equal(f.child.killed, true);
  assert.equal(f.service.closed, true);
  assert.equal(existsSync(options.cwd), false);
});

test('a public readiness failure closes the listener and tunnel', async () => {
  const f = lifecycle();
  f.options.ready = async () => { throw Error('Invalid public response.'); };
  await assert.rejects(launchService(config, f.options), /Invalid public response/);
  assert.equal(f.child.killed, true);
  assert.equal(f.service.closed, true);
  assert.equal(f.output.length, 0);
});

test('a public HTML error rejects the probe without an uncaught callback error', async () => {
  const request = new EventEmitter();
  request.destroy = error => request.emit('error', error);
  const response = new EventEmitter();
  response.statusCode = 530;
  await assert.rejects(publicProbe('https://bridge-name.trycloudflare.com', {
    resolveHost: async () => ['104.16.231.132'],
    requestGet: (_url, _options, callback) => {
      queueMicrotask(() => { callback(response); response.emit('data', '<html>Cloudflare error</html>'); response.emit('end'); });
      return request;
    },
  }), SyntaxError);
});

test('cancellation during listener startup cannot start a tunnel or report readiness', async () => {
  const f = lifecycle(); let resume;
  f.service.listen = () => new Promise(resolve => { resume = () => { f.service.server.listening = true; resolve(); }; });
  const pending = launchService(config, f.options);
  f.controller.abort(); resume();
  await assert.rejects(pending, /stopped/);
  assert.equal(f.count(), 0); assert.equal(f.output.length, 0); assert.equal(f.service.server.listening, false);
});

test('cancellation during public readiness cannot report readiness', async () => {
  const f = lifecycle(); let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  f.options.ready = () => { entered(); return new Promise(() => {}); };
  const pending = launchService(config, f.options); await waiting; f.controller.abort();
  await assert.rejects(pending, /stopped/);
  assert.equal(f.output.length, 0); assert.equal(f.service.server.listening, false);
});

test('an exit immediately after the tunnel URL closes the listener', async () => {
  const f = lifecycle();
  f.options.spawnTunnel = () => {
    queueMicrotask(() => { f.child.stderr.write('https://bridge-name.trycloudflare.com'); f.child.exitCode = 1; f.child.emit('exit', 1); });
    return f.child;
  };
  await assert.rejects(launchService(config, f.options), /stopped/);
  assert.equal(f.output.length, 0); assert.equal(f.service.server.listening, false);
});
