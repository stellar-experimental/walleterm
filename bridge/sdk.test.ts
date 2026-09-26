import { jest, onTestFinished, spyOn, test } from 'bun:test';
import assert from 'node:assert/strict';
import { WalletermClient } from '../sdk/walleterm.ts';
import { requestSignal, requestUrl } from './test/support.ts';

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
  client.account = { address: 'GFIRST', networkPassphrase: 'testnet' };
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
    ['/v1/signers', 135000],
    ['/v1/select', 135000],
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

test('an empty wallet picker can refresh discovery within its current connection', async () => {
  let listings = 0;
  const client = new WalletermClient('https://bridge.example', {
    fetch: async (input, options) => {
      const url = requestUrl(input);
      let value;
      if (url.endsWith('/v1/connect')) value = { token: 'session' };
      if (url.endsWith('/v1/signers')) value = { signers: listings++ ? [{ public_key: 'GAVAILABLE' }] : [] };
      if (url.endsWith('/v1/select')) {
        assert.equal(JSON.parse(String(options?.body)).public_key, 'GAVAILABLE');
        value = { public_key: 'GAVAILABLE', network_passphrase: 'testnet' };
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
