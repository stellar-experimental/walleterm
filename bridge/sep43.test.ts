import { afterEach, onTestFinished, test, expect } from 'bun:test';
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  buildAuthorizationEntryPreimage,
  hash,
  xdr,
} from '@stellar/stellar-sdk';
import type { contract } from '@stellar/stellar-sdk';
import { createBridge } from './server.ts';
import { listeningPort } from './test/support.ts';
import { Walleterm, WalletermClient } from '../sdk/walleterm.ts';
import type { AccessInterface } from '../sdk/walleterm.ts';
import type { BridgeOptions } from './server.ts';
import type { Fetch } from '../sdk/types.ts';

const key = Keypair.random(),
  other = Keypair.random(); // Isolated offline mock keys only.
const contractId = StrKey.encodeContract(new Uint8Array(32).fill(9));
const site = 'https://sep43.example';

async function fixture(options: BridgeOptions = {}, walletScope: 'selected' | 'available' = 'selected') {
  let calls = 0,
    requests = 0;
  const bridge = createBridge({
    port: 0,
    log() {},
    listSigners: async () => [key, other].map((k) => ({ public_key: k.publicKey() })),
    latestLedger: async () => 100,
    sign: async (publicKey, digest) => {
      calls++;
      const signer = publicKey === key.publicKey() ? key : other;
      return Buffer.from(signer.sign(Buffer.from(digest, 'hex'))).toString('hex');
    },
    ...options,
  });
  await bridge.listen();
  onTestFinished(() => bridge.close());
  const origin = `http://127.0.0.1:${listeningPort(bridge.server)}`;
  bridge.setPublicOrigin(origin);
  const fetcher: Fetch = (url, init) => {
    requests++;
    const headers = new Headers(init?.headers);
    headers.set('Origin', site);
    return fetch(url, { ...init, headers });
  };
  // The access interface stands in for the dialog: it pairs with the current code and selects a key.
  const ui: AccessInterface = {
    requestAccess: async (target) =>
      (
        await target.connect({
          url: origin,
          code: bridge.pairing.code,
          selectWallet: async () => key.publicKey(),
        })
      ).address,
  };
  const wallet = new Walleterm({ fetch: fetcher, pollInterval: 1, page: null, walletScope, ui });
  return { bridge, origin, wallet, fetcher, calls: () => calls, requests: () => requests };
}
function transaction(source = key.publicKey()) {
  return new TransactionBuilder(new Account(source, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'sep43', value: 'yes' }))
    .setTimeout(120)
    .build()
    .toXDR();
}
const invocation = new xdr.SorobanAuthorizedInvocation({
  function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(contractId).toScAddress(),
      functionName: 'increment',
      args: [],
    }),
  ),
  subInvocations: [],
});
function entry(address: string, expiration = 150) {
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: 5n,
        signatureExpirationLedger: expiration,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
  });
}
function preimage(address: string, { expiration = 150, network = Networks.TESTNET, v1 = false } = {}) {
  if (v1)
    return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(Buffer.from(network)),
        nonce: 5n,
        signatureExpirationLedger: expiration,
        invocation,
      }),
    ).toXDR('base64');
  return buildAuthorizationEntryPreimage(entry(address, expiration), expiration, network).toXDR('base64');
}

test('getNetwork and signMessage answer without a session or bridge request', async () => {
  const f = await fixture();
  expect(await f.wallet.getNetwork()).toEqual({ network: 'TESTNET', networkPassphrase: Networks.TESTNET });
  const message = await f.wallet.signMessage('Sign in to example.com');
  expect(message).toEqual({
    signedMessage: '',
    signerAddress: '',
    error: expect.objectContaining({ code: -3, ext: ['walleterm:unsupported'] }),
  });
  expect(f.requests()).toBe(0);
});

test('getAddress pairs through the access interface, then confirms the session without it', async () => {
  const f = await fixture();
  expect(await f.wallet.getAddress({ skipRequestAccess: true })).toEqual({
    address: '',
    error: expect.objectContaining({ code: -3, ext: ['walleterm:not_connected'] }),
  });
  expect(f.requests()).toBe(0);
  expect(await f.wallet.getAddress()).toEqual({ address: key.publicKey() });
  expect(f.wallet.address).toBe(key.publicKey());
  const before = f.requests();
  expect(await f.wallet.getAddress()).toEqual({ address: key.publicKey() });
  expect(f.requests()).toBe(before + 1);
  // A closed dialog is a user rejection.
  const closed = new Walleterm({
    fetch: f.fetcher,
    ui: {
      requestAccess: async () => {
        throw Object.assign(Error('The Walleterm connection was canceled.'), {
          code: -4,
          ext: ['walleterm:rejected'],
        });
      },
    },
  });
  expect((await closed.getAddress()).error).toMatchObject({ code: -4, ext: ['walleterm:rejected'] });
});

test('signTransaction returns SEP-43 fields and rejects network, address, and submission before a request', async () => {
  const f = await fixture({ review: undefined });
  expect((await f.wallet.signTransaction(transaction())).error).toMatchObject({
    code: -3,
    ext: ['walleterm:not_connected'],
  });
  await f.wallet.getAddress();
  const unsigned = transaction();
  const result = await f.wallet.signTransaction(unsigned, { networkPassphrase: Networks.TESTNET });
  expect(result.error).toBeUndefined();
  expect(result.signerAddress).toBe(key.publicKey());
  const signed = TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET);
  expect(key.verify(signed.hash(), signed.signatures[0].signature.toBytes())).toBe(true);
  const calls = f.calls(),
    requests = f.requests();
  for (const [options, reason] of [
    [{ networkPassphrase: Networks.PUBLIC }, 'walleterm:network_unsupported'],
    [{ address: other.publicKey() }, 'walleterm:address_mismatch'],
    [{ submit: true }, 'walleterm:unsupported'],
    [{ submitUrl: 'https://horizon-testnet.stellar.org' }, 'walleterm:unsupported'],
  ] as const) {
    const failure = await f.wallet.signTransaction(unsigned, options);
    expect(failure).toEqual({
      signedTxXdr: '',
      signerAddress: '',
      error: expect.objectContaining({ code: -3, ext: [reason] }),
    });
  }
  expect((await f.wallet.signTransaction(transaction(other.publicKey()))).error?.ext).toEqual([
    'walleterm:address_mismatch',
  ]);
  expect(f.calls()).toBe(calls);
  expect(f.requests()).toBe(requests);
});

test('signAuthEntry signs V2 preimages for G- and C-addresses and SDK authorizeEntry attaches them', async () => {
  const f = await fixture({ review: undefined });
  await f.wallet.getAddress();
  for (const address of [key.publicKey(), contractId]) {
    const encoded = preimage(address);
    const result = await f.wallet.signAuthEntry(encoded);
    expect(result.error).toBeUndefined();
    const signature = Buffer.from(result.signedAuthEntry, 'base64');
    expect(key.verify(hash(Buffer.from(encoded, 'base64')), signature)).toBe(true);
    // The SDK contract client makes the same call and attaches the returned bytes.
    const signed = await authorizeEntry(
      entry(address),
      async (value) => {
        const { signedAuthEntry, error } = await f.wallet.signAuthEntry(value.toXDR('base64'));
        if (error) throw Error(error.message);
        const bytes = Buffer.from(signedAuthEntry, 'base64');
        return address === contractId
          ? { signatureScVal: xdr.ScVal.scvBytes(bytes) }
          : { signature: bytes, publicKey: key.publicKey() };
      },
      150,
      Networks.TESTNET,
    );
    expect(signed.credentials.type).toBe('sorobanCredentialsAddressV2');
  }
  expect(f.calls()).toBe(4);
});

test('the wallet satisfies the Stellar SDK contract Signer shape', async () => {
  const f = await fixture();
  const signer: contract.Signer = f.wallet;
  expect(signer.address).toBe('');
  await f.wallet.getAddress();
  expect(signer.address).toBe(key.publicKey());
  expect('signTransaction' in signer && typeof signer.signAuthEntry).toBe('function');
});

test('invalid preimages and trusted-ledger failures never reach the signer', async () => {
  const f = await fixture({ review: undefined });
  await f.wallet.getAddress();
  for (const [encoded, reason] of [
    [preimage(contractId, { v1: true }), 'walleterm:unsupported'],
    [preimage(contractId, { network: Networks.PUBLIC }), 'walleterm:network_unsupported'],
    [preimage(other.publicKey()), 'walleterm:address_mismatch'],
    [transaction(), 'walleterm:invalid_request'],
  ] as const) {
    const result = await f.wallet.signAuthEntry(encoded);
    expect(result).toEqual({
      signedAuthEntry: '',
      signerAddress: '',
      error: expect.objectContaining({ code: -3, ext: [reason] }),
    });
  }
  // The trusted ledger is 100. The window is 120 ledgers.
  expect((await f.wallet.signAuthEntry(preimage(contractId, { expiration: 220 }))).error).toBeUndefined();
  const late = await f.wallet.signAuthEntry(preimage(contractId, { expiration: 221 }));
  expect(late.error).toMatchObject({ code: -3, ext: ['walleterm:invalid_request'], requestState: 'denied' });
  expect(f.calls()).toBe(1);
  const offline = await fixture({
    review: undefined,
    latestLedger: async () => {
      throw Error('Offline');
    },
  });
  await offline.wallet.getAddress();
  expect((await offline.wallet.signAuthEntry(preimage(contractId))).error).toMatchObject({
    code: -2,
    ext: ['walleterm:ledger_unavailable'],
    requestState: 'denied',
  });
  expect(offline.calls()).toBe(0);
});

test('bridge outcomes map to SEP-43 codes and keep unknown signing outcomes', async () => {
  const denied = await fixture({ review: async () => false });
  await denied.wallet.getAddress();
  expect((await denied.wallet.signTransaction(transaction())).error).toMatchObject({
    code: -4,
    ext: ['walleterm:rejected'],
    requestState: 'denied',
  });
  let started!: () => void;
  const signing = new Promise<void>((resolve) => (started = resolve));
  const slow = await fixture({
    review: undefined,
    sign: async (_key, _digest, options) => {
      started();
      await new Promise((resolve) => options?.signal?.addEventListener('abort', resolve, { once: true }));
      throw Error('Stopped');
    },
  });
  await slow.wallet.getAddress();
  const controller = new AbortController();
  const pending = slow.wallet.signTransaction(transaction(), { signal: controller.signal });
  await signing;
  controller.abort();
  expect((await pending).error).toMatchObject({
    code: -1,
    ext: ['walleterm:result_unknown'],
    requestState: 'unknown',
  });
  const queued = await fixture({
    review: (_request, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  });
  await queued.wallet.getAddress();
  const stop = new AbortController();
  const waiting = queued.wallet.signTransaction(transaction(), { signal: stop.signal });
  setTimeout(() => stop.abort(), 20);
  expect((await waiting).error).toMatchObject({ code: -4, ext: ['walleterm:rejected'] });
  expect(queued.calls()).toBe(0);
});

test('signing after session expiry returns not_connected without a cancel request', async () => {
  const f = await fixture({ review: undefined });
  const paths: string[] = [];
  let failFirstCreate = false;
  const wallet = new Walleterm({
    sessionStorageKey: null,
    page: null,
    pollInterval: 1,
    ui: f.wallet.ui,
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (failFirstCreate && path === '/v1/requests') {
        failFirstCreate = false;
        throw TypeError('Failed to fetch');
      }
      return f.fetcher(url, init);
    },
  });
  const revoke = async () => {
    await f.fetcher(`${f.origin}/v1/disconnect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wallet.client!.token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  };
  await wallet.getAddress();
  await revoke();
  paths.length = 0;
  const expired = await wallet.signTransaction(transaction());
  expect(expired.error).toMatchObject({ code: -3, ext: ['walleterm:not_connected'] });
  expect(expired.error?.requestState).toBeUndefined();
  expect(paths).toEqual(['/v1/requests']);
  expect(wallet.address).toBe('');
  // A create attempt without an HTTP response can have reached the bridge. The outcome stays unknown.
  await wallet.getAddress();
  await revoke();
  failFirstCreate = true;
  const uncertain = await wallet.signTransaction(transaction());
  expect(uncertain.error).toMatchObject({
    code: -1,
    ext: ['walleterm:result_unknown'],
    requestState: 'unknown',
  });
  expect(f.calls()).toBe(0);
});

test('a network failure is an external service error and keeps the session', async () => {
  const f = await fixture();
  await f.wallet.getAddress();
  const failing: Fetch = async () => {
    throw TypeError('Failed to fetch');
  };
  const offline = new Walleterm({ fetch: failing });
  offline.client = Object.assign(new WalletermClient(f.origin, { fetch: failing }), {
    token: f.wallet.client!.token,
  });
  expect(await offline.getAddress({ skipRequestAccess: true })).toMatchObject({
    error: { code: -2, ext: ['walleterm:bridge_unavailable'] },
  });
  expect(offline.client.token).toBe(f.wallet.client!.token);
});

test('onChange reports pairing, switching, and disconnection once each', async () => {
  const f = await fixture({}, 'available');
  const changes: (string | null)[] = [];
  const stop = f.wallet.onChange(({ address, network, networkPassphrase }) => {
    expect(network).toBe('TESTNET');
    expect(networkPassphrase).toBe(Networks.TESTNET);
    changes.push(address);
  });
  await f.wallet.getAddress();
  await f.wallet.getAddress();
  await f.wallet.selectWallet(other.publicKey());
  await f.wallet.disconnect();
  stop();
  await f.wallet.getAddress();
  expect(changes).toEqual([key.publicKey(), other.publicKey(), null]);
});

test('a change listener can read the new address at once, as a Kit fetchAddress does', async () => {
  const f = await fixture({}, 'available');
  await f.wallet.getAddress();
  const read = Promise.withResolvers<unknown>();
  f.wallet.onChange(() => void f.wallet.getAddress({ skipRequestAccess: true }).then(read.resolve));
  await f.wallet.selectWallet(other.publicKey());
  expect(await read.promise).toEqual({ address: other.publicKey() });
});

const saved = new Map<string, string>();
afterEach(() => {
  saved.clear();
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});
function storage() {
  Object.assign(globalThis, {
    sessionStorage: {
      getItem: (name: string) => saved.get(name) ?? null,
      setItem: (name: string, value: string) => saved.set(name, value),
      removeItem: (name: string) => saved.delete(name),
    },
  });
}

test('sessions survive a reload in the same tab and expire with the bridge session', async () => {
  storage();
  const f = await fixture();
  await f.wallet.getAddress();
  expect(JSON.parse(saved.get('walleterm:session')!)).toEqual({
    version: 3,
    url: f.origin,
    token: f.wallet.client!.token,
  });
  const reloaded = new Walleterm({ fetch: f.fetcher });
  expect(await reloaded.getAddress({ skipRequestAccess: true })).toEqual({ address: key.publicKey() });
  await reloaded.disconnect();
  expect(saved.has('walleterm:session')).toBe(false);
  const memory = new Walleterm({ fetch: f.fetcher, sessionStorageKey: null, ui: f.wallet.ui });
  await memory.getAddress();
  expect(saved.size).toBe(0);
});
