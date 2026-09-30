// The real SDK against the Rust bridge (tests/browser/host.ts).
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
import { createHost } from './host.ts';
import { Walleterm, WalletermClient } from '../../sdk/walleterm.ts';
import type { AccessInterface } from '../../sdk/walleterm.ts';
import type { HostOptions } from './host.ts';
import type { Fetch } from '../../sdk/types.ts';

const key = Keypair.random(),
  other = Keypair.random(); // Isolated offline mock keys only.
const contractId = StrKey.encodeContract(new Uint8Array(32).fill(9));
const site = 'https://sep43.example';

async function fixture(options: HostOptions = {}, walletScope: 'selected' | 'available' = 'selected') {
  let calls = 0,
    requests = 0;
  const bridge = await createHost({
    listSigners: async () => [key, other].map((k) => ({ public_key: k.publicKey() })),
    sign: async (publicKey, digest) => {
      calls++;
      const signer = publicKey === key.publicKey() ? key : other;
      return Buffer.from(signer.sign(Buffer.from(digest, 'hex'))).toString('hex');
    },
    ...options,
  });
  onTestFinished(() => bridge.close());
  const origin = bridge.origin;
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
          code: await bridge.code(),
          selectWallet: async () => key.publicKey(),
        })
      ).address,
  };
  const wallet = new Walleterm({ fetch: fetcher, pollInterval: 1, page: null, walletScope, ui });
  return { bridge, origin, wallet, fetcher, calls: () => calls, requests: () => requests };
}
// A mock signer that acts as a declined 1Password prompt: an agent failure and no signature.
const refuse = async (): Promise<string> => {
  throw Object.assign(Error('SSH agent failure'), { ext: ['walleterm:signing_refused'] });
};
const refused = '1Password did not sign. You declined the prompt, or 1Password refused the request.';
// Wallet discovery that waits after hold() until the bridge aborts it. A signing job then stays queued.
function holdable() {
  let holding = false;
  return {
    hold: () => {
      holding = true;
    },
    listSigners: async ({ signal }: { signal: AbortSignal }) => {
      if (holding)
        await new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
        );
      return [key, other].map((k) => ({ public_key: k.publicKey() }));
    },
  };
}
// Connection lines are not about signing. These tests read only the signing lines.
const signingLines = (lines: string[]) =>
  lines.filter((line) => !/^(Connected|Selected wallet|Could not list the wallets) /.test(line));
function transaction(source = key.publicKey(), networkPassphrase: string = Networks.TESTNET) {
  return new TransactionBuilder(new Account(source, '10'), {
    fee: '100',
    networkPassphrase,
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

test('getNetwork names the tunnel network, and a wallet without a session knows no network', async () => {
  const f = await fixture();
  expect(await f.wallet.getNetwork()).toEqual({
    network: '',
    networkPassphrase: '',
    error: expect.objectContaining({ code: -3, ext: ['walleterm:not_connected'] }),
  });
  expect((await f.wallet.signMessage('Sign in to example.com')).error).toMatchObject({
    code: -3,
    ext: ['walleterm:not_connected'],
  });
  // Bad text fails before the session check, which can send a request.
  expect((await f.wallet.signMessage('a\ud800b')).error).toMatchObject({
    code: -3,
    ext: ['walleterm:invalid_request'],
  });
  expect(f.requests()).toBe(0);
  await f.wallet.getAddress();
  expect(await f.wallet.getNetwork()).toEqual({ network: 'TESTNET', networkPassphrase: Networks.TESTNET });
});

test('a futurenet tunnel names its network, and the wallet signs only for it', async () => {
  const f = await fixture({ network: 'futurenet' });
  await f.wallet.getAddress();
  expect(await f.wallet.getNetwork()).toEqual({
    network: 'FUTURENET',
    networkPassphrase: Networks.FUTURENET,
  });
  const requests = f.requests();
  // The testnet passphrase fails before any request.
  expect(
    (await f.wallet.signTransaction(transaction(), { networkPassphrase: Networks.TESTNET })).error,
  ).toMatchObject({
    code: -3,
    ext: ['walleterm:network_unsupported'],
    message: 'The tunnel signs only on FUTURENET. Use the passphrase from getNetwork().',
  });
  expect(f.requests()).toBe(requests);
  // The default passphrase is the session network. The signature covers the futurenet hash.
  const unsigned = transaction(key.publicKey(), Networks.FUTURENET);
  const result = await f.wallet.signTransaction(unsigned);
  expect(result.error).toBeUndefined();
  const signed = TransactionBuilder.fromXDR(result.signedTxXdr, Networks.FUTURENET);
  expect(key.verify(signed.hash(), signed.signatures[0].signature.toBytes())).toBe(true);
  expect(f.calls()).toBe(1);
});

test('signMessage signs SEP-53 text and the tunnel prints one escaped line', async () => {
  const lines: string[] = [];
  const f = await fixture({ log: (line) => lines.push(line) });
  await f.wallet.getAddress();
  // A newline and a bidirectional override reach the terminal only as escapes.
  const text = 'sep43.example asks for proof of key control.\nNonce: 5f1c \u202egpj.exe';
  for (const message of [text, 'a'.repeat(1024), 'é'.repeat(512)]) {
    const result = await f.wallet.signMessage(message, { networkPassphrase: Networks.TESTNET });
    expect(result.error).toBeUndefined();
    expect(result.signerAddress).toBe(key.publicKey());
    expect(key.verifyMessage(message, Buffer.from(result.signedMessage, 'base64'))).toBe(true);
  }
  const digest = Buffer.from(hash(Buffer.from(`Stellar Signed Message:\n${text}`))).toString('hex');
  // The terminal shortens a G-address as the connection dialog does.
  const signer = `${key.publicKey().slice(0, 7)}…${key.publicKey().slice(-6)}`;
  expect(signingLines(lines).slice(0, 2)).toEqual([
    `Message request from ${site} for ${signer} (67 bytes, digest ${digest}, no network, site, or expiry binding): "sep43.example asks for proof of key control.\\nNonce: 5f1c \\u202egpj.exe"\n`,
    `Signed SEP-53 message ${digest} (signer ${signer}) for ${site}.\n`,
  ]);
  expect(f.calls()).toBe(3);
});

test('signMessage refuses bad text, another network, and another signer before any request', async () => {
  const f = await fixture();
  await f.wallet.getAddress();
  const calls = f.calls(),
    requests = f.requests();
  for (const [message, options, reason] of [
    // A lone surrogate would become U+FFFD in UTF-8. The site would then get a signature for other text.
    ['a\ud800b', {}, 'walleterm:invalid_request'],
    ['\udc00', {}, 'walleterm:invalid_request'],
    ['', {}, 'walleterm:invalid_request'],
    ['a'.repeat(1025), {}, 'walleterm:invalid_request'],
    // 513 characters are 1026 UTF-8 bytes. The limit counts bytes.
    ['é'.repeat(513), {}, 'walleterm:invalid_request'],
    [42 as unknown as string, {}, 'walleterm:invalid_request'],
    ['hello', { networkPassphrase: Networks.PUBLIC }, 'walleterm:network_unsupported'],
    ['hello', { address: other.publicKey() }, 'walleterm:address_mismatch'],
  ] as const) {
    expect(await f.wallet.signMessage(message, options)).toEqual({
      signedMessage: '',
      signerAddress: '',
      error: expect.objectContaining({ code: -3, ext: [reason] }),
    });
  }
  expect(f.calls()).toBe(calls);
  expect(f.requests()).toBe(requests);
});

test('a declined 1Password prompt or a canceled message returns -4', async () => {
  const denied = await fixture({ sign: refuse });
  await denied.wallet.getAddress();
  expect((await denied.wallet.signMessage('Sign in to example.com')).error).toMatchObject({
    code: -4,
    message: refused,
    ext: ['walleterm:rejected'],
    requestState: 'denied',
  });
  const discovery = holdable();
  const queued = await fixture({ listSigners: discovery.listSigners });
  await queued.wallet.getAddress();
  discovery.hold();
  const stop = new AbortController();
  const waiting = queued.wallet.signMessage('Sign in to example.com', { signal: stop.signal });
  setTimeout(() => stop.abort(), 20);
  expect((await waiting).error).toMatchObject({ code: -4, ext: ['walleterm:rejected'] });
  expect(denied.calls() + queued.calls()).toBe(0);
});

test('signMessage returns the SEP-53 vector signatures, and the SDK verifies them', async () => {
  // The public SEP-53 test key: a mock key, never funded or used live. The mock signer returns published signatures.
  const sep53 = 'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L';
  const published: Record<string, string> = {
    d52eb59c06bb510d065997ff93077068eed0a486c20215b5e02e1ab0d2ebea5f:
      '7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04',
    '7bde4f792e336ed43df42ad66a92b44cb1bc60708e8bee63494c289dee161682':
      '083536eb95ecf32dce59b07fe7a1fd8cf814b2ce46f40d2a16e4ea1f6cecd980e04e6fbef9d21f98011c785a81edb85f3776a6e7d942b435eb0adc07da4d4604',
  };
  const bridge = await createHost({
    listSigners: async () => [{ public_key: sep53 }],
    sign: async (_publicKey, digest) => published[digest] ?? '00'.repeat(64),
  });
  onTestFinished(() => bridge.close());
  const wallet = new Walleterm({
    storageKey: null,
    page: null,
    pollInterval: 1,
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Origin', site);
      return fetch(url, { ...init, headers });
    },
    ui: {
      requestAccess: async (target) =>
        (
          await target.connect({
            url: bridge.origin,
            code: await bridge.code(),
            selectWallet: async () => sep53,
          })
        ).address,
    },
  });
  expect(await wallet.getAddress()).toEqual({ address: sep53 });
  for (const [message, signedMessage] of [
    [
      'Hello, World!',
      'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==',
    ],
    [
      'こんにちは、世界！',
      'CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==',
    ],
  ])
    expect(await wallet.signMessage(message)).toEqual({ signedMessage, signerAddress: sep53 });
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
  const f = await fixture();
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
  const f = await fixture();
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

test('invalid preimages never reach the signer, and no expiry window applies', async () => {
  const f = await fixture();
  await f.wallet.getAddress();
  for (const [encoded, reason] of [
    [preimage(contractId, { v1: true }), 'walleterm:unsupported'],
    [preimage(contractId, { network: Networks.PUBLIC }), 'walleterm:network_unsupported'],
    [preimage(other.publicKey()), 'walleterm:address_mismatch'],
    [preimage(contractId, { expiration: 0 }), 'walleterm:invalid_request'],
    [transaction(), 'walleterm:invalid_request'],
  ] as const) {
    const result = await f.wallet.signAuthEntry(encoded);
    expect(result).toEqual({
      signedAuthEntry: '',
      signerAddress: '',
      error: expect.objectContaining({ code: -3, ext: [reason] }),
    });
  }
  // No request reads a ledger. The network enforces expiry.
  for (const expiration of [1, 221, 0xffffffff])
    expect((await f.wallet.signAuthEntry(preimage(contractId, { expiration }))).error).toBeUndefined();
  expect(f.calls()).toBe(3);
});

test('bridge outcomes map to SEP-43 codes and keep unknown signing outcomes', async () => {
  const denied = await fixture({ sign: refuse });
  await denied.wallet.getAddress();
  expect((await denied.wallet.signTransaction(transaction())).error).toMatchObject({
    code: -4,
    message: refused,
    ext: ['walleterm:rejected'],
    requestState: 'denied',
  });
  let started!: () => void;
  const signing = new Promise<void>((resolve) => (started = resolve));
  const slow = await fixture({
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
  const discovery = holdable();
  const queued = await fixture({ listSigners: discovery.listSigners });
  await queued.wallet.getAddress();
  discovery.hold();
  const stop = new AbortController();
  const waiting = queued.wallet.signTransaction(transaction(), { signal: stop.signal });
  setTimeout(() => stop.abort(), 20);
  expect((await waiting).error).toMatchObject({ code: -4, ext: ['walleterm:rejected'] });
  expect(queued.calls()).toBe(0);
});

test('signing after session expiry returns not_connected without a cancel request', async () => {
  const f = await fixture();
  const paths: string[] = [];
  let failFirstCreate = false;
  const wallet = new Walleterm({
    storageKey: null,
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
  const changes: [string | null, string, string][] = [];
  const stop = f.wallet.onChange(({ address, network, networkPassphrase }) =>
    changes.push([address, network, networkPassphrase]),
  );
  await f.wallet.getAddress();
  await f.wallet.getAddress();
  await f.wallet.selectWallet(other.publicKey());
  await f.wallet.disconnect();
  stop();
  await f.wallet.getAddress();
  expect(changes).toEqual([
    [key.publicKey(), 'TESTNET', Networks.TESTNET],
    [other.publicKey(), 'TESTNET', Networks.TESTNET],
    [null, '', ''],
  ]);
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
  Reflect.deleteProperty(globalThis, 'localStorage');
});
function storage() {
  Object.assign(globalThis, {
    localStorage: {
      getItem: (name: string) => saved.get(name) ?? null,
      setItem: (name: string, value: string) => saved.set(name, value),
      removeItem: (name: string) => saved.delete(name),
    },
  });
}

test('sessions survive a reload and expire with the bridge session', async () => {
  storage();
  const f = await fixture();
  await f.wallet.getAddress();
  expect(JSON.parse(saved.get('walleterm:session')!)).toEqual({
    version: 3,
    url: f.origin,
    token: f.wallet.client!.token,
    revision: 1,
  });
  const reloaded = new Walleterm({ fetch: f.fetcher });
  expect(await reloaded.getAddress({ skipRequestAccess: true })).toEqual({ address: key.publicKey() });
  await reloaded.disconnect();
  expect(saved.has('walleterm:session')).toBe(false);
  const memory = new Walleterm({ fetch: f.fetcher, storageKey: null, ui: f.wallet.ui });
  await memory.getAddress();
  expect(saved.size).toBe(0);
});
