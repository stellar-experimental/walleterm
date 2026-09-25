import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { launch, tunnelOrigin, waitForTunnel } from './launcher.mjs';

test('a split cloudflared URL selects only the tunnel origin', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const pending = waitForTunnel(child, 1000);
  child.stderr.write('Visit it at https://sample-name.trycloud');
  child.stderr.write('flare.com/pair\n');
  assert.equal(await pending, 'https://sample-name.trycloudflare.com');
  assert.equal(tunnelOrigin('https://example.com'), null);
});

test('the web command owns both processes and reports one pairing link', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  let closed = false;
  let spawned;
  const order = [];
  child.kill = () => { killed = true; };
  const chunks = [];
  const pending = launch(['--signer', 'GTEST', '--recipient', 'GDEST', '--state-dir', '/tmp/demo', '--port', '8791'], {
    spawnTunnel: (...args) => {
      order.push('tunnel');
      spawned = args;
      queueMicrotask(() => child.stderr.write('https://demo-name.trycloudflare.com\n'));
      return child;
    },
    create: config => ({
      server: { listening: true }, get pairUrl() { return `${this.origin}/pair#code=secret`; },
      setPublicOrigin(origin) { this.origin = origin; },
      pairExpiresAt: '2026-09-25T00:00:00.000Z', listen: async () => { order.push('listener'); },
      close: async () => { closed = true; },
    }),
    ready: async () => {}, output: { write: value => chunks.push(value) },
  });
  const result = await pending;
  assert.equal(spawned[0], 'cloudflared');
  assert.deepEqual(order, ['listener', 'tunnel']);
  assert.deepEqual(spawned[1], ['tunnel', '--url', 'http://127.0.0.1:8791', '--no-autoupdate', '--protocol', 'http2']);
  assert.deepEqual(JSON.parse(chunks[0]), {
    ok: true, event: 'web_ready', url: result.origin,
    pair_url: 'https://demo-name.trycloudflare.com/pair#code=secret',
    expires_at: '2026-09-25T00:00:00.000Z', state_dir: '/tmp/demo',
  });
  await result.stop(0);
  assert.equal(killed, true);
  assert.equal(closed, true);
});

test('a public readiness failure closes the listener and tunnel', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  let closed = false;
  child.kill = () => { killed = true; };
  const previousExitCode = process.exitCode;
  try {
    await assert.rejects(launch(['--signer', 'GTEST', '--recipient', 'GDEST', '--state-dir', '/tmp/demo'], {
      spawnTunnel: () => {
        queueMicrotask(() => child.stderr.write('https://demo-name.trycloudflare.com\n'));
        return child;
      },
      create: () => ({
        server: { listening: true }, setPublicOrigin: () => {},
        listen: async () => {}, close: async () => { closed = true; },
      }),
      ready: async () => { throw Error('Invalid public response.'); },
    }), /Invalid public response/);
    assert.equal(killed, true);
    assert.equal(closed, true);
  } finally { process.exitCode = previousExitCode; }
});
