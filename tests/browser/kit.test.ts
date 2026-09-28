import { afterEach, expect, test } from 'bun:test';
import { Networks } from '@stellar/stellar-sdk';
import { WALLETERM_ID, WalletermModule } from '../../sdk/kit.ts';
import { Walleterm } from '../../sdk/walleterm.ts';
import type { AddressChange } from '../../sdk/walleterm.ts';

// The pinned Kit 2.7.0 check lives in fixtures/kit/. These tests cover the module without the Kit.
afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
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
  const module = new WalletermModule({ wallet: new Walleterm({ sessionStorageKey: null }) });
  expect(await module.getNetwork()).toEqual({ network: 'TESTNET', networkPassphrase: Networks.TESTNET });
  for (const [call, reason] of [
    [() => module.getAddress({ skipRequestAccess: true }), 'walleterm:not_connected'],
    [() => module.signMessage('hello'), 'walleterm:unsupported'],
    [
      () => module.signTransaction('AAAA', { networkPassphrase: Networks.PUBLIC }),
      'walleterm:network_unsupported',
    ],
    [
      () => module.signAuthEntry('AAAA', { networkPassphrase: Networks.PUBLIC }),
      'walleterm:network_unsupported',
    ],
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
  const wallet = new Walleterm({ sessionStorageKey: null });
  let publish!: (change: AddressChange) => void;
  wallet.onChange = (listener) => {
    publish = listener;
    return () => {};
  };
  const events: unknown[] = [];
  new WalletermModule({ wallet }).onChange((event) => events.push(event));
  publish({ address: 'GSECOND', network: 'TESTNET', networkPassphrase: Networks.TESTNET });
  publish({ address: null, network: 'TESTNET', networkPassphrase: Networks.TESTNET });
  expect(events).toEqual([
    { address: 'GSECOND', network: 'TESTNET', networkPassphrase: Networks.TESTNET },
    {
      address: '',
      network: 'TESTNET',
      networkPassphrase: Networks.TESTNET,
      error: { code: -3, message: 'Walleterm disconnected. Connect again.' },
    },
  ]);
});

test('disconnect never rejects and discards an unconfirmed session locally', async () => {
  const wallet = new Walleterm({ sessionStorageKey: null });
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
