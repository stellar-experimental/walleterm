// The real SDK against the Rust bridge (tests/browser/host.ts).
import { test, expect, onTestFinished } from 'bun:test';
import { Address, Keypair, Networks, StrKey, xdr } from '@stellar/stellar-sdk';
import { createHost } from './host.ts';
import { WalletermClient } from '../../sdk/walleterm.ts';
import {
  createAuthEntry,
  verifyAuthEntrySignature,
  inspectAuthEntry,
  attachAuthSignature,
} from '../../sdk/authorization.ts';
import type { HostOptions } from './host.ts';
import type { AuthAdapter, AuthEntryInput } from '../../sdk/authorization.ts';
import type { Fetch } from '../../sdk/types.ts';
const key = Keypair.random(),
  other = Keypair.random();
const contract = (n: number) => StrKey.encodeContract(new Uint8Array(32).fill(n));
const address = contract(1);
function request(
  adapter: AuthAdapter = { type: 'contract-ed25519' },
  expirationLedger = 160,
): AuthEntryInput {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract(2)).toScAddress(),
        functionName: 'ping',
        args: [],
      }),
    ),
    subInvocations: [],
  });
  return {
    public_key: key.publicKey(),
    address,
    network_passphrase: Networks.TESTNET,
    adapter,
    auth_entry_xdr: createAuthEntry({ address, invocation, nonce: 7n, expirationLedger }),
  };
}
// createAuthEntry refuses ledger 0, so write it into the XDR directly, as simulation can leave it.
function zeroExpiration(encoded: string) {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(encoded, 'base64');
  if (entry.credentials.type !== 'sorobanCredentialsAddressV2') throw Error('Use an AddressV2 entry.');
  const credentials = new xdr.SorobanAddressCredentials({
    ...entry.credentials.addressV2,
    signatureExpirationLedger: 0,
  });
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: entry.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials),
  }).toXDR('base64');
}
const pause = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await pause();
  }
  throw Error('The test timed out.');
}
async function fixture(options: HostOptions = {}) {
  let calls = 0;
  const bridge = await createHost({
    listSigners: async () => [key, other].map((k) => ({ public_key: k.publicKey() })),
    sign: async (_key, digest) => {
      calls++;
      return Buffer.from(key.sign(Buffer.from(digest, 'hex'))).toString('hex');
    },
    ...options,
  });
  onTestFinished(() => bridge.close());
  const url = bridge.origin;
  const fetcher: Fetch = (url, options) => {
    const headers = new Headers(options?.headers);
    headers.set('Origin', 'https://auth.example');
    return fetch(url, { ...options, headers });
  };
  const page = new EventTarget();
  const client = new WalletermClient(url, { fetch: fetcher, pollInterval: 1, page });
  await client.connect({
    code: await bridge.code(),
    walletScope: 'available',
    selectWallet: async () => key.publicKey(),
  });
  return { client, bridge, page, calls: () => calls };
}
test('auth lifecycle signs once, binds adapters on retries, and verifies complete results', async () => {
  const f = await fixture(),
    input = request({ type: 'openzeppelin-ed25519', verifier: contract(3), context_rule_ids: [0] });
  const body = {
    id: 'one',
    kind: 'authorization',
    auth_entry_xdr: input.auth_entry_xdr,
    auth_address: input.address,
    adapter: input.adapter,
    network_passphrase: input.network_passphrase,
    address: input.public_key,
    selection_revision: f.client.revision,
  };
  await f.client.request('/v1/requests', body);
  await until(() => f.calls() === 1);
  let reply;
  for (let i = 0; i < 100; i++) {
    reply = await f.client.request('/v1/requests/one');
    if (reply.state === 'signed') break;
    await pause();
  }
  expect(reply?.state).toBe('signed');
  expect(verifyAuthEntrySignature(input, reply!.signed_auth_entry_xdr!)).toBe(true);
  expect((await f.client.request('/v1/requests', body)).signed_auth_entry_xdr).toBe(
    reply!.signed_auth_entry_xdr,
  );
  await expect(
    f.client.request('/v1/requests', { ...body, adapter: { ...input.adapter, verifier: contract(4) } }),
  ).rejects.toThrow('different');
  await expect(f.client.request('/v1/requests', { ...body, latest_ledger: 100 })).rejects.toThrow('fields');
  await expect(f.client.request('/v1/requests', { ...body, digest: '00'.repeat(32) })).rejects.toThrow(
    'fields',
  );
  expect(f.calls()).toBe(1);
});
for (const action of ['cancel', 'pagehide', 'switch', 'revoke'] as const) {
  test(`auth ${action} withholds a late signature and preserves cancellation`, async () => {
    let started = false,
      release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture({
      sign: async (_key, digest) => {
        started = true;
        await waiting;
        return Buffer.from(key.sign(Buffer.from(digest, 'hex'))).toString('hex');
      },
    });
    const stop = new AbortController(),
      input = request();
    const promise = f.client.signAuthorization(input.auth_entry_xdr, {
      address,
      adapter: input.adapter,
      signal: stop.signal,
    });
    const rejected = promise.then(
      () => null,
      (error) => error,
    );
    await until(() => started);
    if (action === 'cancel') stop.abort();
    if (action === 'pagehide') f.page.dispatchEvent(new Event('pagehide'));
    if (action === 'switch') await f.client.selectWallet(other.publicKey());
    if (action === 'revoke') await f.client.disconnect();
    release();
    expect(await rejected).toBeInstanceOf(Error);
  });
}
test('auth has no expiry window: any set expiration signs, and ledger 0 never reaches the signer', async () => {
  const f = await fixture();
  for (const expirationLedger of [1, 0xffffffff]) {
    const input = request(undefined, expirationLedger);
    const result = await f.client.signAuthorization(input.auth_entry_xdr, {
      address,
      adapter: input.adapter,
    });
    expect(verifyAuthEntrySignature(input, result.signedAuthEntryXdr)).toBe(true);
  }
  expect(f.calls()).toBe(2);
  const unset = request();
  const zero = await fixture();
  await expect(
    zero.client.signAuthorization(zeroExpiration(unset.auth_entry_xdr), { address, adapter: unset.adapter }),
  ).rejects.toThrow('Ledger 0');
  expect(zero.calls()).toBe(0);
});
test('malformed signer output cannot produce an authorization result', async () => {
  const input = request();
  const bad = await fixture({ sign: async () => '00'.repeat(64) });
  await expect(
    bad.client.signAuthorization(input.auth_entry_xdr, { address, adapter: input.adapter }),
  ).rejects.toThrow('verification');
});
test('SDK freezes adapter options and rejects a substituted signed artifact', async () => {
  const input = request({ type: 'openzeppelin-ed25519', verifier: contract(3), context_rule_ids: [0] });
  let release!: () => void, captured: AuthEntryInput | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new WalletermClient('https://bridge.example', {
    page: null,
    fetch: async (_url, options) => {
      const wire = JSON.parse(String(options?.body));
      captured = {
        auth_entry_xdr: wire.auth_entry_xdr,
        network_passphrase: wire.network_passphrase,
        public_key: wire.address,
        address: wire.auth_address,
        adapter: wire.adapter,
      };
      await wait;
      const checked = inspectAuthEntry(captured!, key.publicKey());
      const signed = attachAuthSignature(
        captured!,
        key.publicKey(),
        Buffer.from(key.sign(checked.digest)).toString('hex'),
      );
      return Response.json({ kind: 'authorization', state: 'signed', signed_auth_entry_xdr: signed });
    },
  });
  client.token = 'token';
  client.account = { address: key.publicKey(), networkPassphrase: Networks.TESTNET };
  const promise = client.signAuthorization(input.auth_entry_xdr, { address, adapter: input.adapter });
  if (input.adapter.type !== 'openzeppelin-ed25519') throw Error();
  input.adapter.context_rule_ids[0] = 9;
  input.adapter.verifier = contract(4);
  release();
  const result = await promise;
  expect(verifyAuthEntrySignature(captured!, result.signedAuthEntryXdr)).toBe(true);
  const wrong = request();
  const fake = new WalletermClient('https://bridge.example', {
    page: null,
    fetch: async () => {
      const checked = inspectAuthEntry(wrong, key.publicKey());
      return Response.json({
        kind: 'authorization',
        state: 'signed',
        signed_auth_entry_xdr: attachAuthSignature(
          wrong,
          key.publicKey(),
          Buffer.from(key.sign(checked.digest)).toString('hex'),
        ),
      });
    },
  });
  fake.token = 'token';
  fake.account = client.account;
  await expect(
    fake.signAuthorization(input.auth_entry_xdr, { address, adapter: input.adapter }),
  ).rejects.toThrow();
});
