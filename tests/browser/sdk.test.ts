import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { jest, onTestFinished, spyOn, test } from 'bun:test';
import assert from 'node:assert/strict';
import { WalletermClient } from '../../sdk/walleterm.ts';
import type { RequestError } from '../../sdk/errors.ts';
import { isTunnelUrl, sep43Error } from '../../sdk/errors.ts';
import { requestSignal, requestUrl } from './support.ts';

const mockKey = Keypair.random(); // Offline mock key only.
const mockTransaction = new TransactionBuilder(new Account(mockKey.publicKey(), '1'), {
  fee: '100',
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(Operation.manageData({ name: 'test', value: 'reviewed' }))
  .setTimeout(180)
  .build();
const unsignedXdr = mockTransaction.toXDR();
mockTransaction.sign(mockKey);
const signedXdr = mockTransaction.toXDR();

test('wallet discovery can refresh without replacing the selected account', async () => {
  let keys = [{ public_key: 'GFIRST', comment: 'First' }];
  const client = new WalletermClient('https://bridge.example', {
    fetch: async (_url, options) => {
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer session');
      return Response.json({ signers: keys });
    },
  });
  await assert.rejects(client.listWallets(), /Connect the website first/);
  client.token = 'session';
  client.account = { address: 'GFIRST', network: 'TESTNET', networkPassphrase: 'testnet' };
  assert.deepEqual(await client.listWallets(), keys);
  keys = [{ public_key: 'GSECOND', comment: 'Second' }];
  assert.deepEqual(await client.listWallets(), keys);
  assert.equal(client.account.address, 'GFIRST');
});

test('discovery and selection permit slow vault lookup but keep a bounded deadline', async () => {
  jest.useFakeTimers();
  onTestFinished(() => {
    jest.useRealTimers();
  });
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(Error('Deadline reached')), milliseconds);
    return controller.signal;
  });
  onTestFinished(() => {
    timeout.mockRestore();
  });
  for (const [path, deadline] of [
    ['/v1/signers', 115000],
    ['/v1/select', 115000],
    ['/v1/account', 15000],
  ] as const) {
    let requestedSignal: AbortSignal | undefined;
    const client = new WalletermClient('https://bridge.example', {
      fetch: async (_url, options) => {
        const signal = requestSignal(options);
        requestedSignal = signal;
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      },
    });
    const request = client.request(path, path === '/v1/select' ? { public_key: 'GMOCK' } : undefined);
    const failure = assert.rejects(request, /Deadline reached/);
    jest.advanceTimersByTime(deadline - 1);
    assert.equal(requestedSignal?.aborted, false);
    jest.advanceTimersByTime(1);
    await failure;
  }
});

test('the caller can cancel discovery and selection before their long deadline', async () => {
  for (const path of ['/v1/signers', '/v1/select'] as const) {
    const controller = new AbortController();
    const client = new WalletermClient('https://bridge.example', {
      fetch: async (_url, options) =>
        new Promise((_resolve, reject) => {
          const signal = requestSignal(options);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    });
    const request = client.request(path, undefined, controller.signal);
    controller.abort(Error('The user closed the dialog'));
    await assert.rejects(request, /The user closed the dialog/);
  }
});

test('a lost or silent tunnel gets a plain message, and a caller cancellation keeps its reason', async () => {
  const failing = (failure: Error) =>
    new WalletermClient('https://bridge.example', {
      fetch: async () => {
        throw failure;
      },
    });
  await assert.rejects(failing(TypeError('Failed to fetch')).request('/v1/account'), {
    message:
      'The website could not reach the tunnel. Check the tunnel URL and that walleterm tunnel is running.',
    ext: ['walleterm:bridge_unavailable'],
    status: 503,
  });
  await assert.rejects(failing(new DOMException('signal timed out', 'TimeoutError')).request('/v1/signers'), {
    message:
      'The tunnel did not answer in time. Check that walleterm tunnel is running and 1Password is unlocked.',
    ext: ['walleterm:bridge_unavailable'],
  });
  // The caller's own deadline is not a tunnel failure. Its caller explains it.
  const controller = new AbortController();
  controller.abort(new DOMException('signal timed out', 'TimeoutError'));
  const client = new WalletermClient('https://bridge.example', {
    fetch: async (_url, options) => {
      throw requestSignal(options).reason;
    },
  });
  await assert.rejects(client.request('/v1/signers', undefined, controller.signal), {
    name: 'TimeoutError',
    message: 'signal timed out',
  });
});

test('a non-JSON answer from the tunnel host names the likely cause', async () => {
  const answering = (body: string, status: number) =>
    new WalletermClient('https://bridge.example', { fetch: async () => new Response(body, { status }) });
  // Cloudflare answers 524 with an HTML page when the bridge waits too long, often for 1Password.
  const timedOut = await answering('<html>A timeout occurred</html>', 524)
    .request('/v1/signers')
    .catch((error) => error);
  assert.deepEqual(
    { message: timedOut.message, status: timedOut.status, ext: timedOut.ext },
    {
      message: 'The tunnel connection timed out. Check for a 1Password prompt on your Mac, then try again.',
      status: 524,
      ext: ['walleterm:bridge_unavailable'],
    },
  );
  assert.deepEqual(sep43Error(timedOut), {
    code: -2,
    message: timedOut.message,
    ext: ['walleterm:bridge_unavailable'],
  });
  await assert.rejects(answering('<html>Bad gateway</html>', 502).request('/v1/account'), {
    message: 'The tunnel is unavailable (error 502). Check that walleterm tunnel is running on your Mac.',
    status: 502,
    ext: ['walleterm:bridge_unavailable'],
  });
  await assert.rejects(answering('<html>Too large</html>', 413).request('/v1/account'), {
    message: 'The tunnel returned an unreadable response (413).',
    status: 413,
  });
  await assert.rejects(answering('{}', 500).request('/v1/account'), {
    message: 'The tunnel request failed (500).',
    status: 500,
  });
});

test('one tunnel URL check accepts only an exact HTTPS or loopback origin', () => {
  for (const url of ['https://bridge.example', 'http://127.0.0.1:8787', 'http://localhost:8787'])
    assert.equal(isTunnelUrl(url), true, url);
  for (const url of [
    '',
    'bridge.example',
    'https://bridge.example/',
    'https://bridge.example/path',
    'https://bridge.example?code=1',
    'https://bridge.example#code',
    'https://user:password@bridge.example',
    // The visible start of this URL is not its host.
    'https://bridge.example@attacker.example',
    'http://bridge.example',
    'javascript:alert(1)',
  ])
    assert.equal(isTunnelUrl(url), false, url);
  assert.throws(() => new WalletermClient('https://bridge.example/path'), {
    message:
      'Use the Tunnel URL exactly as walleterm tunnel prints it. It starts with https:// and has no path.',
    ext: ['walleterm:invalid_request'],
  });
});

test('the default connection and signing deadlines give plain reasons', async () => {
  const deadlines = new Map<number, AbortController>();
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    deadlines.set(milliseconds, controller);
    return controller.signal;
  });
  onTestFinished(() => timeout.mockRestore());
  const client = new WalletermClient('https://bridge.example', {
    page: null,
    fetch: async (input) => {
      const url = requestUrl(input);
      if (url.endsWith('/v1/connect')) return Response.json({ token: 'session', wallet_scope: 'selected' });
      if (url.endsWith('/v1/signers')) return Response.json({ signers: [], grant_id: 'grant' });
      if (url.endsWith('/cancel')) return Response.json({ state: 'canceled' });
      return Response.json({ state: 'signing' });
    },
  });
  const picker = Promise.withResolvers<void>();
  const connecting = client.connect({
    code: '01234567',
    selectWallet: (_keys, { signal }) => {
      picker.resolve();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
      );
    },
  });
  // The picker is open when the connection window closes.
  await picker.promise;
  deadlines.get(300000)!.abort();
  await assert.rejects(connecting, {
    name: 'TimeoutError',
    message: 'The connection timed out after 5 minutes.',
    codeUsed: true,
  });
  deadlines.clear();
  client.token = 'session';
  client.account = { address: mockKey.publicKey(), network: 'TESTNET', networkPassphrase: Networks.TESTNET };
  const signing = client.signTransaction(unsignedXdr, {
    onProgress: () => deadlines.get(300000)?.abort(),
  });
  await assert.rejects(signing, { message: 'The signing request timed out after 5 minutes.' });
});

test('a failure after pairing reports a spent code, and a refused code does not', async () => {
  const failing = (connect: number, signers: number) =>
    new WalletermClient('https://bridge.example', {
      fetch: async (input) => {
        const url = requestUrl(input);
        if (url.endsWith('/v1/connect'))
          return connect === 201
            ? Response.json({ token: 'session', wallet_scope: 'selected' }, { status: 201 })
            : Response.json(
                { error: { code: -3, message: 'The connection code is incorrect.' } },
                { status: 403 },
              );
        if (url.endsWith('/v1/signers'))
          return Response.json(
            { error: { code: -2, message: '1Password did not allow the vault check.' } },
            { status: signers },
          );
        return Response.json({ disconnected: true });
      },
    });
  const options = { code: '01234567', selectWallet: async () => 'GMOCK' };
  await assert.rejects(failing(201, 502).connect(options), (error: RequestError) => {
    assert.equal(error.message, '1Password did not allow the vault check.');
    assert.equal(error.codeUsed, true);
    return true;
  });
  await assert.rejects(failing(403, 502).connect(options), (error: RequestError) => {
    assert.equal(error.message, 'The connection code is incorrect.');
    assert.equal(error.codeUsed, undefined);
    return true;
  });
});

test('an empty wallet picker can refresh discovery within its current connection', async () => {
  let listings = 0;
  const client = new WalletermClient('https://bridge.example', {
    fetch: async (input, options) => {
      const url = requestUrl(input);
      let value;
      if (url.endsWith('/v1/connect'))
        value = { token: 'session', wallet_scope: 'selected', selection_revision: 0 };
      if (url.endsWith('/v1/signers')) value = { signers: listings++ ? [{ public_key: 'GAVAILABLE' }] : [] };
      if (url.endsWith('/v1/select')) {
        assert.equal(JSON.parse(String(options?.body)).public_key, 'GAVAILABLE');
        value = { address: 'GAVAILABLE', network: 'TESTNET', network_passphrase: 'testnet' };
      }
      return Response.json(value);
    },
  });
  const result = await client.connect({
    code: '12345678',
    selectWallet: async (keys, { signal }) => {
      assert.deepEqual(keys, []);
      return (await client.listWallets({ signal }))[0].public_key;
    },
  });
  assert.equal(result.address, 'GAVAILABLE');
  assert.equal(listings, 2);
});

test('signing retries preserve the request ID and report network recovery', async () => {
  const bodies: string[] = [],
    states: string[] = [];
  let posts = 0;
  const client = new WalletermClient('https://bridge.example', {
    pollInterval: 1,
    page: null,
    fetch: async (input, options) => {
      if (requestUrl(input).endsWith('/v1/requests')) {
        bodies.push(String(options?.body));
        if (++posts < 3) throw TypeError('Offline');
        return Response.json({ state: 'signing', expires_at: '2026-09-26T00:00:00Z' });
      }
      return Response.json({ state: 'signed', signed_tx_xdr: signedXdr });
    },
  });
  client.token = 'session';
  client.account = { address: mockKey.publicKey(), network: 'TESTNET', networkPassphrase: Networks.TESTNET };
  const result = await client.signTransaction(unsignedXdr, {
    onProgress(progress) {
      states.push(progress.state);
      if (progress.state === 'signing') throw Error('Display failure');
    },
  });
  assert.equal(result.signedTxXdr, signedXdr);
  assert.equal(new Set(bodies).size, 1);
  assert.deepEqual(states, ['retrying', 'retrying', 'signing', 'signed']);
});

test('an unreachable bridge bounds cancellation and preserves signing uncertainty', async () => {
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeouts: number[] = [];
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    timeouts.push(milliseconds);
    return originalTimeout(milliseconds === 10000 ? 10 : milliseconds);
  });
  onTestFinished(() => timeout.mockRestore());
  const controller = new AbortController();
  let cancellations = 0;
  const client = new WalletermClient('https://bridge.example', {
    page: null,
    fetch: async (input, options) => {
      if (!requestUrl(input).endsWith('/cancel')) return Response.json({ state: 'signing' });
      cancellations++;
      const signal = requestSignal(options);
      return new Promise((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason);
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });
  client.token = 'session';
  client.account = { address: mockKey.publicKey(), network: 'TESTNET', networkPassphrase: Networks.TESTNET };
  await assert.rejects(
    client.signTransaction(unsignedXdr, {
      signal: controller.signal,
      onProgress: () => controller.abort(Error('Canceled')),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error && 'canceled' in error);
      assert.equal(error.canceled, false);
      return true;
    },
  );
  assert.ok(timeouts.includes(10000));
  assert.equal(cancellations, 1);
});

test('failed remote disconnection retains credentials until an explicit local discard', async () => {
  const client = new WalletermClient('https://bridge.example', {
    fetch: async () => {
      throw TypeError('Offline');
    },
  });
  const active = new AbortController();
  client.signings.add(active);
  client.token = 'session';
  client.account = { address: mockKey.publicKey(), network: 'TESTNET', networkPassphrase: Networks.TESTNET };
  const generation = client.generation;
  await assert.rejects(client.disconnect(), /could not reach the tunnel/);
  assert.equal(client.token, 'session');
  assert.equal(active.signal.aborted, false);
  client.forgetConnection();
  assert.equal(client.token, null);
  assert.equal(client.account, null);
  assert.equal(client.generation, generation + 1);
  assert.equal(active.signal.aborted, true);
});

test('caller cancellation still stops SDK vault discovery immediately', async () => {
  const controller = new AbortController();
  const listing = Promise.withResolvers<void>();
  const client = new WalletermClient('http://127.0.0.1:8787', {
    fetch: async (input, options) => {
      const url = requestUrl(input);
      if (url.endsWith('/v1/signers')) {
        listing.resolve();
        const signal = requestSignal(options);
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (signal.aborted) reject(signal.reason);
        });
      }
      return Response.json(url.endsWith('/v1/connect') ? { token: 'mock-token' } : { disconnected: true });
    },
  });
  const pending = client.connect({
    code: '01234567',
    selectWallet: () => {
      throw Error('The picker must not open.');
    },
    signal: controller.signal,
  });
  await listing.promise;
  controller.abort(Error('Caller canceled discovery.'));
  await assert.rejects(pending, /Caller canceled discovery/);
  assert.equal(client.token, null);
});
