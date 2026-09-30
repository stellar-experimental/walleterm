import { afterEach, expect, test } from 'bun:test';
import { Networks } from '@stellar/stellar-sdk';
import { WALLETERM_ID, WalletermModule } from '../../sdk/kit.ts';
import { Walleterm } from '../../sdk/walleterm.ts';
import type { AddressChange } from '../../sdk/walleterm.ts';

// The pinned Kit 2.7.0 check lives in fixtures/kit/. These tests cover the module without the Kit.
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'localStorage');
});

test('the module declares its Kit identity and answers availability at once', async () => {
  const module = new WalletermModule();
  expect(module.productId).toBe(WALLETERM_ID);
  expect(module.productName).toBe('Walleterm');
  expect(module.moduleType).toBe('BRIDGE_WALLET');
  expect(module.productIcon).toStartWith('data:image/svg+xml;base64,');
  expect(module.wallet).toBeInstanceOf(Walleterm);
  expect(await module.isAvailable()).toBe(false);
  Object.assign(globalThis, { window: globalThis, document: {} });
  const started = performance.now();
  expect(await module.isAvailable()).toBe(true);
  expect(performance.now() - started).toBeLessThan(1000);
});

test('module methods reject with the SEP-43 error object that the wallet resolves', async () => {
  const module = new WalletermModule({ wallet: new Walleterm({ storageKey: null }) });
  for (const [call, reason] of [
    // Without a session, the wallet knows no network. The tunnel names it after pairing.
    [() => module.getNetwork(), 'walleterm:not_connected'],
    [() => module.getAddress({ skipRequestAccess: true }), 'walleterm:not_connected'],
    [() => module.signMessage('hello'), 'walleterm:not_connected'],
    [() => module.signMessage('a\ud800b'), 'walleterm:invalid_request'],
    [() => module.signMessage('hello', { networkPassphrase: Networks.PUBLIC }), 'walleterm:not_connected'],
    [() => module.signTransaction('AAAA', { networkPassphrase: Networks.PUBLIC }), 'walleterm:not_connected'],
    [() => module.signAuthEntry('AAAA', { networkPassphrase: Networks.PUBLIC }), 'walleterm:not_connected'],
    [
      () => module.signTransaction('AAAA', { networkPassphrase: Networks.TESTNET }),
      'walleterm:not_connected',
    ],
  ] as const) {
    const error = await call().then(
      () => null,
      (caught) => caught,
    );
    // The Kit's parseError reads code, message, and ext from a plain object.
    expect(error).not.toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: -3, ext: [reason] });
    expect(typeof error.message).toBe('string');
  }
});

test('onChange reports switches and disconnection in the Kit event shape', () => {
  const wallet = new Walleterm({ storageKey: null });
  let publish!: (change: AddressChange) => void;
  wallet.onChange = (listener) => {
    publish = listener;
    return () => {};
  };
  const events: unknown[] = [];
  new WalletermModule({ wallet }).onChange((event) => events.push(event));
  publish({ address: 'GSECOND', network: 'TESTNET', networkPassphrase: Networks.TESTNET });
  publish({ address: null, network: '', networkPassphrase: '' });
  expect(events).toEqual([
    { address: 'GSECOND', network: 'TESTNET', networkPassphrase: Networks.TESTNET },
    {
      address: '',
      network: '',
      networkPassphrase: '',
      error: { code: -3, message: 'Walleterm disconnected. Connect again.' },
    },
  ]);
});

test('onChange confirms a restored session once, so a Kit restored on load matches Walleterm', async () => {
  const address = 'GRESTORED';
  for (const status of [200, 401]) {
    const stored = new Map([
      [
        'walleterm:session',
        JSON.stringify({ version: 4, url: 'https://bridge.example', token: 's'.repeat(43), revision: 2 }),
      ],
    ]);
    Object.assign(globalThis, {
      localStorage: {
        getItem: (name: string) => stored.get(name) ?? null,
        setItem: (name: string, value: string) => stored.set(name, value),
        removeItem: (name: string) => stored.delete(name),
      },
    });
    const paths: string[] = [];
    const wallet = new Walleterm({
      page: null,
      fetch: async (url) => {
        paths.push(new URL(String(url)).pathname);
        return status === 200
          ? Response.json({
              address,
              network: 'TESTNET',
              network_passphrase: Networks.TESTNET,
              wallet_scope: 'available',
              selection_revision: 2,
            })
          : Response.json({ error: { code: -3, message: 'Expired' } }, { status });
      },
    });
    const events: unknown[] = [];
    new WalletermModule({ wallet }).onChange((event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(paths).toEqual(['/v1/account']);
    expect(events).toEqual([
      status === 200
        ? { address, network: 'TESTNET', networkPassphrase: Networks.TESTNET }
        : {
            address: '',
            network: '',
            networkPassphrase: '',
            error: { code: -3, message: 'Walleterm disconnected. Connect again.' },
          },
    ]);
    expect(stored.has('walleterm:session')).toBe(status === 200);
  }
  // Without a saved session, nothing changed. The Kit keeps a wallet that the website selected.
  const events: unknown[] = [];
  new WalletermModule({
    wallet: new Walleterm({
      page: null,
      fetch: () => {
        throw Error('No request is expected.');
      },
    }),
  }).onChange((event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toEqual([]);
});

test('a hook connected after the restored session ended still reports one disconnection', async () => {
  const stored = new Map([
    [
      'walleterm:session',
      JSON.stringify({ version: 4, url: 'https://bridge.example', token: 's'.repeat(43), revision: 2 }),
    ],
  ]);
  Object.assign(globalThis, {
    localStorage: {
      getItem: (name: string) => stored.get(name) ?? null,
      setItem: (name: string, value: string) => stored.set(name, value),
      removeItem: (name: string) => stored.delete(name),
    },
  });
  const paths: string[] = [];
  const wallet = new Walleterm({
    page: null,
    fetch: async (url) => {
      paths.push(new URL(String(url)).pathname);
      return Response.json({ error: { code: -3, message: 'Expired' } }, { status: 401 });
    },
  });
  // Another call, such as a header health check, finds first that the session ended.
  expect((await wallet.getAddress({ skipRequestAccess: true })).error?.ext).toEqual([
    'walleterm:not_connected',
  ]);
  expect(stored.has('walleterm:session')).toBe(false);
  const events: unknown[] = [];
  new WalletermModule({ wallet }).onChange((event) => events.push(event));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(events).toEqual([
    {
      address: '',
      network: '',
      networkPassphrase: '',
      error: { code: -3, message: 'Walleterm disconnected. Connect again.' },
    },
  ]);
  expect(paths).toEqual(['/v1/account']);
});

test('disconnect never rejects and discards an unconfirmed session locally', async () => {
  const wallet = new Walleterm({ storageKey: null });
  let forgotten = 0;
  Object.assign(wallet, {
    disconnect: async () => {
      throw Error('Offline');
    },
    forgetConnection: () => forgotten++,
  });
  await new WalletermModule({ wallet }).disconnect();
  expect(forgotten).toBe(1);
});
