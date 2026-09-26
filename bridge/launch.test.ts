import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { launchService, publicProbe, publicReady, tunnelOrigin, waitForTunnel } from './launch.ts';
import { MockChild } from './test/support.ts';
import type { ClientRequest } from 'node:http';
import type { LaunchOptions, Service } from './launch.ts';

interface MockService extends Service {
  server: { listening: boolean };
  closed: boolean;
  origin?: string;
  pairing: NonNullable<Service['pairing']>;
}
interface MockOptions extends LaunchOptions {
  output: { write(value: string): unknown; columns?: number };
}
function fakeChild() {
  return new MockChild(0);
}
function lifecycle() {
  const controller = new AbortController(),
    child = fakeChild(),
    output: string[] = [];
  let spawned = 0,
    onPairing: (() => void) | undefined,
    spawnedArgs: Parameters<NonNullable<LaunchOptions['spawnTunnel']>> | undefined;
  const service: MockService = {
    server: { listening: false },
    closed: false,
    service: 'walleterm',
    pairing: {
      walleterm: 2,
      url: 'https://bridge-name.trycloudflare.com',
      code: '01234567',
      expires_at: '2026-09-25T00:00:00.000Z',
    },
    onPairingChanged(callback) {
      onPairing = callback;
    },
    setPublicOrigin(origin) {
      this.origin = origin;
    },
    async listen() {
      this.server.listening = true;
    },
    async close() {
      this.closed = true;
      this.server.listening = false;
    },
  };
  const options: MockOptions = {
    signal: controller.signal,
    create: () => service,
    ready: async () => {},
    environment: {
      PATH: '/bin',
      HOME: '/mock',
      TUNNEL_TOKEN: 'mock',
      TUNNEL_LOGLEVEL: 'debug',
      TUNNEL_METRICS: '0.0.0.0:1234',
    },
    output: { write: (value) => output.push(value) },
    spawnTunnel: (...args: Parameters<NonNullable<LaunchOptions['spawnTunnel']>>) => {
      spawned++;
      spawnedArgs = args;
      queueMicrotask(() => child.stderr.write('https://bridge-name.trycloudflare.com\n'));
      return child;
    },
  };
  const rotate = () => {
    assert.ok(onPairing, 'The service did not watch pairing changes.');
    onPairing();
  };
  const spawnedWith = () => {
    assert.ok(spawnedArgs, 'The tunnel did not start.');
    return spawnedArgs;
  };
  return { controller, child, output, service, options, count: () => spawned, rotate, spawned: spawnedWith };
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
  const [command, argv, options] = f.spawned();
  assert.equal(command, 'cloudflared');
  assert.equal(argv[argv.indexOf('--url') + 1], 'http://127.0.0.1:8791');
  assert.equal(argv[argv.indexOf('--metrics') + 1], '127.0.0.1:0');
  assert.equal(readFileSync(argv[argv.indexOf('--config') + 1], 'utf8'), '{}\n');
  assert.ok(options.env);
  assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH']);
  assert.equal(f.service.origin, 'https://bridge-name.trycloudflare.com');
  const text = f.output.join('');
  assert.match(text, /Walleterm tunnel is ready on Stellar testnet/);
  assert.match(text, /Connection code: 01234567/);
  assert.match(text, /Press Ctrl\+C/);
  f.service.pairing.code = '76543210';
  f.rotate();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(f.output.join(''), /Connection code: 76543210/);
  await result.stop(0);
  assert.equal(f.child.killed, true);
  assert.equal(f.service.closed, true);
  assert.ok(options.cwd);
  assert.equal(existsSync(options.cwd), false);
});
test('a narrow terminal prints the connection fields without a broken QR code', async () => {
  const f = lifecycle();
  f.options.output.columns = 19;
  const result = await launchService(config, f.options);
  const text = f.output.join('');
  assert.match(text, /Tunnel URL: https:\/\/bridge-name.trycloudflare.com/);
  assert.match(text, /Connection code: 01234567/);
  assert.match(text, /QR code needs \d+ terminal columns/);
  assert.doesNotMatch(text, /\x1b\[47m/);
  await result.stop(0);
});

test('a public readiness failure closes the listener and tunnel', async () => {
  const f = lifecycle();
  f.options.ready = async () => {
    throw Error('Invalid public response.');
  };
  await assert.rejects(launchService(config, f.options), /Invalid public response/);
  assert.equal(f.child.killed, true);
  assert.equal(f.service.closed, true);
  assert.equal(f.output.length, 0);
});

test('a public HTML error rejects the probe without an uncaught callback error', async () => {
  const request = new EventEmitter();
  const destroy = (error: Error) => {
    request.emit('error', error);
  };
  const response = new IncomingMessage(new Socket());
  response.statusCode = 530;
  await assert.rejects(
    publicProbe('https://bridge-name.trycloudflare.com', {
      resolveHost: async () => ['104.16.231.132'],
      requestGet: (_url, _options, callback) => {
        queueMicrotask(() => {
          callback(response);
          response.emit('data', '<html>Cloudflare error</html>');
          response.emit('end');
        });
        // The probe uses only `on` and `destroy` from the request. This mock supplies those members.
        return Object.assign(request, { destroy }) as ClientRequest;
      },
    }),
    SyntaxError,
  );
});

test('cancellation during listener startup cannot start a tunnel or report readiness', async () => {
  const f = lifecycle();
  const started = Promise.withResolvers<void>();
  f.service.listen = () =>
    started.promise.then(() => {
      f.service.server.listening = true;
    });
  const pending = launchService(config, f.options);
  f.controller.abort();
  started.resolve();
  await assert.rejects(pending, /stopped/);
  assert.equal(f.count(), 0);
  assert.equal(f.output.length, 0);
  assert.equal(f.service.server.listening, false);
});

test('cancellation during public readiness cannot report readiness', async () => {
  const f = lifecycle();
  const entered = Promise.withResolvers<void>();
  f.options.ready = () => {
    entered.resolve();
    return new Promise(() => {});
  };
  const pending = launchService(config, f.options);
  await entered.promise;
  f.controller.abort();
  await assert.rejects(pending, /stopped/);
  assert.equal(f.output.length, 0);
  assert.equal(f.service.server.listening, false);
});

test('an exit immediately after the tunnel URL closes the listener', async () => {
  const f = lifecycle();
  f.options.spawnTunnel = () => {
    queueMicrotask(() => {
      f.child.stderr.write('https://bridge-name.trycloudflare.com');
      f.child.exitCode = 1;
      f.child.emit('exit', 1, null);
    });
    return f.child;
  };
  await assert.rejects(launchService(config, f.options), /stopped/);
  assert.equal(f.output.length, 0);
  assert.equal(f.service.server.listening, false);
});

test('readiness requires the exact service name', async () => {
  const seen: number[] = [];
  const probe = async () => {
    seen.push(1);
    return seen.length === 1
      ? { status: 200, service: 'walleterm-demo' }
      : { status: 200, service: 'walleterm' };
  };
  await publicReady('https://bridge-name.trycloudflare.com', { service: 'walleterm', probe });
  assert.equal(seen.length, 2);
});
