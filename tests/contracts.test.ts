// Offline C11 checks for the shared contract harness. A mocked RPC returns each recorded tree.
// invoke and submitSourceOnly must check every recorded entry before any mutation or signing request.
// Isolated mock keys only. No network, no 1Password agent.
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import * as sdk from '@stellar/stellar-sdk';
import type { FeeBumpTransaction, Transaction, xdr } from '@stellar/stellar-sdk';
import {
  contractFn,
  gAuthorizer,
  hostOperation,
  invoke,
  requireAddressCredentials,
  submitSourceOnly,
  type ExpectedAuth,
  type InvokeOptions,
} from './contracts.ts';
import { delegateEntryFor, ozDelegatedAuthorizer } from './extended-contracts.ts';
import { simulationError, simulationSuccess } from './simulations.ts';
import type { AnyTransaction, SigningContext, TestKey } from './types.ts';

const pairs = [21, 22, 23].map((n) => sdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)));
const testKey = (name: string, pair: sdk.Keypair): TestKey => ({
  name,
  publicKey: pair.publicKey(),
  rawPublicKey: pair.rawPublicKey(),
});
const keys = { a: testKey('a', pairs[0]), b: testKey('b', pairs[1]), c: testKey('c', pairs[2]) };
const B = keys.b.publicKey;
const C = keys.c.publicKey;
const contract = (byte: number) => sdk.StrKey.encodeContract(Buffer.alloc(32, byte));
const target = contract(31);
const target2 = contract(32);
const other = contract(33);
const account = contract(34);
const addr = (a: string) => sdk.nativeToScVal(a, { type: 'address' });
const u32 = (n: number) => sdk.xdr.ScVal.scvU32(n);
const EXPIRATION = 160; // mocked latest ledger 100 plus the harness window of 60 ledgers

// ---------- recorded entries ----------
const credentials = (address: string, signature: xdr.ScVal = sdk.xdr.ScVal.scvVoid()) =>
  new sdk.xdr.SorobanAddressCredentials({
    address: new sdk.Address(address).toScAddress(),
    nonce: 9n,
    signatureExpirationLedger: 0,
    signature,
  });
const v2 = (address: string, root: xdr.SorobanAuthorizedInvocation, signature?: xdr.ScVal) =>
  new sdk.xdr.SorobanAuthorizationEntry({
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials(address, signature)),
    rootInvocation: root,
  });
const v1 = (address: string, root: xdr.SorobanAuthorizedInvocation) =>
  new sdk.xdr.SorobanAuthorizationEntry({
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddress(credentials(address)),
    rootInvocation: root,
  });
const sourceEntry = (root: xdr.SorobanAuthorizedInvocation) =>
  new sdk.xdr.SorobanAuthorizationEntry({
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: root,
  });
const clone = (entry: xdr.SorobanAuthorizationEntry) =>
  sdk.xdr.SorobanAuthorizationEntry.fromXdr(entry.toXdr());
const createRoot = (func: xdr.HostFunction) => {
  assert.equal(func.type, 'hostFunctionTypeCreateContractV2');
  return new sdk.xdr.SorobanAuthorizedInvocation({
    function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
      func.createContractV2,
    ),
    subInvocations: [],
  });
};
const hostFunctionOf = (operation: xdr.Operation) => {
  const body = operation.body;
  assert.equal(body.type, 'invokeHostFunction');
  return body.value.hostFunction;
};

// ---------- mocked context ----------
type MockContext = Parameters<typeof invoke>[0] & SigningContext;
function mock(recorded: xdr.SorobanAuthorizationEntry[], { enforceError }: { enforceError?: string } = {}) {
  const calls = {
    digests: 0,
    record: 0,
    enforce: 0,
    envelopes: 0,
    sends: 0,
    enforced: [] as xdr.SorobanAuthorizationEntry[][],
  };
  let count = 0;
  const operationOf = (tx: Transaction | FeeBumpTransaction) => {
    assert.ok(!('innerTransaction' in tx), 'The harness simulates plain transactions only.');
    return hostOperation(tx);
  };
  const ctx: MockContext = {
    sdk,
    networkPassphrase: sdk.Networks.TESTNET,
    keys,
    async signDigest(key, digest) {
      calls.digests += 1;
      const pair = pairs.find((p) => p.publicKey() === key.publicKey);
      assert.ok(pair, 'The digest request names a mock key.');
      return pair.sign(Buffer.from(digest));
    },
    async sign(tx) {
      calls.envelopes += 1;
      return tx;
    },
    async send(tx: AnyTransaction) {
      calls.sends += 1;
      count += 1;
      const hash = Buffer.from(tx.hash()).toString('hex');
      const sent = { status: 'PENDING' as const, hash, latestLedger: 101, latestLedgerCloseTime: 0 };
      return { hash, status: 'SUCCESS', ledger: 101, result: sent, sent };
    },
    rpc: {
      async getAccount() {
        return new sdk.Account(keys.a.publicKey, '1');
      },
      async simulateTransaction(tx, _resources, mode) {
        const op = operationOf(tx);
        if (
          op.func.type === 'hostFunctionTypeInvokeContract' &&
          String(op.func.invokeContract.functionName) === 'count'
        )
          return simulationSuccess({ latestLedger: 100, result: { auth: [], retval: u32(count) } });
        if (mode === 'record') {
          calls.record += 1;
          return simulationSuccess({
            latestLedger: 100,
            result: { auth: recorded.map(clone), retval: sdk.xdr.ScVal.scvVoid() },
          });
        }
        calls.enforce += 1;
        calls.enforced.push(op.auth ?? []);
        return enforceError
          ? simulationError(`HostError: ${enforceError}`, { latestLedger: 100 })
          : simulationSuccess({ latestLedger: 100, result: { auth: [], retval: u32(count + 1) } });
      },
    },
  };
  return { ctx, calls };
}
// Every rejection happens before the first mutation, digest, enforcement, envelope, or submission.
function assertNothingSigned(calls: ReturnType<typeof mock>['calls'], beforeSign = 0) {
  assert.deepEqual(
    {
      digests: calls.digests,
      enforce: calls.enforce,
      envelopes: calls.envelopes,
      sends: calls.sends,
      beforeSign,
    },
    { digests: 0, enforce: 0, envelopes: 0, sends: 0, beforeSign: 0 },
  );
}
// Verifies a G-account signature over the AddressV2 preimage of the entry as sent.
function assertSignedBy(entry: xdr.SorobanAuthorizationEntry, pair: sdk.Keypair) {
  const preimage = sdk.buildAuthorizationEntryPreimage(entry, EXPIRATION, sdk.Networks.TESTNET);
  const [signature]: { signature: Uint8Array }[] = sdk.scValToNative(
    requireAddressCredentials(entry).signature,
  );
  assert.ok(pair.verify(Buffer.from(sdk.hash(preimage.toXdr())), Buffer.from(signature.signature)));
}

// ---------- rows ----------
const pingArgs = [addr(B), u32(1)];
const ping = contractFn(sdk, target, 'ping', pingArgs);
const pingRow = (ctx: MockContext, extra: Partial<InvokeOptions> = {}): InvokeOptions => ({
  contractId: target,
  method: 'ping',
  args: pingArgs,
  authorizers: [gAuthorizer(ctx, keys.b)],
  expected: [{ address: B, invocation: ping }],
  label: 'ping-row',
  ...extra,
});
const ping2Args = [addr(B), addr(C), u32(1)];
const ping2 = contractFn(sdk, target, 'ping2', ping2Args);
const ping2Row = (ctx: MockContext): InvokeOptions => ({
  contractId: target,
  method: 'ping2',
  args: ping2Args,
  authorizers: [gAuthorizer(ctx, keys.b), gAuthorizer(ctx, keys.c)],
  expected: [
    { address: B, invocation: ping2 },
    { address: C, invocation: ping2 },
  ],
  label: 'ping2-row',
});
const outerArgs = [addr(B), addr(target2), u32(1)];
const outer = (
  child = contractFn(sdk, target2, 'ping', pingArgs),
  ...more: xdr.SorobanAuthorizedInvocation[]
) => contractFn(sdk, target, 'outer', outerArgs, [child, ...more]);
const outerRow = (ctx: MockContext, extra: Partial<InvokeOptions> = {}): InvokeOptions => ({
  contractId: target,
  method: 'outer',
  args: outerArgs,
  authorizers: [gAuthorizer(ctx, keys.b)],
  expected: [{ address: B, invocation: outer() }],
  label: 'outer-row',
  ...extra,
});

test('a matching tree is checked, signed once, and submitted', async () => {
  const { ctx, calls } = mock([v2(B, ping)]);
  const result = await invoke(ctx, pingRow(ctx, { state: { target, who: B } }));
  assert.equal(result.outcome, 'submitted');
  assert.deepEqual(
    {
      record: calls.record,
      digests: calls.digests,
      enforce: calls.enforce,
      envelopes: calls.envelopes,
      sends: calls.sends,
    },
    { record: 1, digests: 1, enforce: 1, envelopes: 1, sends: 1 },
  );
  const [sent] = calls.enforced[0];
  assert.equal(sent.rootInvocation.toXdr('base64'), ping.toXdr('base64'));
  assert.equal(sent.credentials.type, 'sorobanCredentialsAddressV2');
  assertSignedBy(sent, pairs[1]);
  assert.deepEqual(result.expected_auth, [{ address: B, invocation_xdr: ping.toXdr('base64') }]);
});

const rejected: [string, xdr.SorobanAuthorizationEntry[], RegExp][] = [
  ['a changed contract', [v2(B, contractFn(sdk, other, 'ping', pingArgs))], /entry 0 .* differs/],
  ['a changed method', [v2(B, contractFn(sdk, target, 'drain', pingArgs))], /entry 0 .* differs/],
  ['a changed argument', [v2(B, contractFn(sdk, target, 'ping', [addr(B), u32(999)]))], /entry 0 .* differs/],
  [
    'an added subtree',
    [v2(B, contractFn(sdk, target, 'ping', pingArgs, [contractFn(sdk, other, 'drain', [addr(B)])]))],
    /entry 0 .* differs/,
  ],
  ['an extra entry for another address', [v2(B, ping), v2(C, ping)], /entry 1 .* differs/],
  ['a repeated entry', [v2(B, ping), v2(B, ping)], /entry 1 .* differs/],
  [
    'a source-account entry',
    [v2(B, ping), sourceEntry(ping)],
    /entry 1 uses sorobanCredentialsSourceAccount/,
  ],
  ['only a source-account entry', [sourceEntry(ping)], /entry 0 uses sorobanCredentialsSourceAccount/],
  ['only an entry for another address', [v2(C, ping)], /entry 0 .* differs/],
  ['a missing entry', [], /omitted the expected entry/],
  ['V1 credentials', [v1(B, ping)], /entry 0 uses sorobanCredentialsAddress,/],
  [
    'an existing signature',
    [v2(B, ping, sdk.xdr.ScVal.scvBytes(Buffer.alloc(64)))],
    /already holds a signature/,
  ],
];
for (const [name, recorded, message] of rejected)
  test(`a recorded tree with ${name} makes zero signing calls`, async () => {
    const { ctx, calls } = mock(recorded);
    let beforeSign = 0;
    await assert.rejects(
      invoke(ctx, pingRow(ctx, { mutate: { beforeSign: () => void (beforeSign += 1) } })),
      message,
    );
    assert.equal(calls.record, 1);
    assertNothingSigned(calls, beforeSign);
  });

// The first entry is valid. Validation must finish before its signature is requested.
const createFn = sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
  new sdk.xdr.CreateContractArgsV2({
    contractIdPreimage: sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new sdk.xdr.ContractIdPreimageFromAddress({
        address: new sdk.Address(C).toScAddress(),
        salt: Buffer.alloc(32),
      }),
    ),
    executable: sdk.xdr.ContractExecutable.contractExecutableWasm(Buffer.alloc(32, 1)),
    constructorArgs: [],
  }),
);
const malformed: [string, xdr.SorobanAuthorizationEntry, RegExp][] = [
  ['V1 credentials', v1(C, ping2), /entry 1 uses sorobanCredentialsAddress,/],
  ['source-account credentials', sourceEntry(ping2), /entry 1 uses sorobanCredentialsSourceAccount/],
  ['existing signature', v2(C, ping2, sdk.xdr.ScVal.scvBytes(Buffer.alloc(64))), /entry 1 already holds/],
  [
    'contract creation root',
    v2(C, new sdk.xdr.SorobanAuthorizedInvocation({ function: createFn, subInvocations: [] })),
    /entry 1 .* differs/,
  ],
  ['changed subtree', v2(C, contractFn(sdk, target, 'ping2', ping2Args, [ping])), /entry 1 .* differs/],
];
for (const [name, second, message] of malformed)
  test(`a malformed entry (${name}) after a valid entry makes zero signing calls`, async () => {
    const { ctx, calls } = mock([v2(B, ping2), second]);
    await assert.rejects(invoke(ctx, ping2Row(ctx)), message);
    assertNothingSigned(calls);
  });

test('two expected entries are both signed after both are checked', async () => {
  const { ctx, calls } = mock([v2(C, ping2), v2(B, ping2)], { enforceError: 'Error(Auth, InvalidAction)' });
  await invoke(ctx, { ...ping2Row(ctx), expect: 'Error(Auth, InvalidAction)' });
  assert.equal(calls.digests, 2);
  const [first, second] = calls.enforced[0];
  assertSignedBy(first, pairs[2]);
  assertSignedBy(second, pairs[1]);
});

test('an expected address without an authorizer makes zero signing calls', async () => {
  const { ctx, calls } = mock([v2(B, ping2), v2(C, ping2)]);
  await assert.rejects(
    invoke(ctx, { ...ping2Row(ctx), authorizers: [gAuthorizer(ctx, keys.b)] }),
    /no authorizer for/,
  );
  assertNothingSigned(calls);
});

test('a row without expected entries makes zero signing calls', async () => {
  const missing: (ExpectedAuth[] | undefined)[] = [undefined, []];
  for (const expected of missing) {
    const { ctx, calls } = mock([v2(B, ping)]);
    await assert.rejects(invoke(ctx, pingRow(ctx, { expected })), /declares no expected authorization/);
    assertNothingSigned(calls);
  }
});

test('a nested tree passes only with its complete expected subtree', async () => {
  const { ctx, calls } = mock([v2(B, outer())], { enforceError: 'Error(Auth, InvalidAction)' });
  await invoke(ctx, outerRow(ctx, { expect: 'Error(Auth, InvalidAction)' }));
  assert.equal(calls.digests, 1);
  assert.equal(calls.enforced[0][0].rootInvocation.toXdr('base64'), outer().toXdr('base64'));
  for (const [name, root] of [
    ['changed child argument', outer(contractFn(sdk, target2, 'ping', [addr(B), u32(2)]))],
    ['changed child contract', outer(contractFn(sdk, other, 'ping', pingArgs))],
    ['missing child', contractFn(sdk, target, 'outer', outerArgs)],
    ['extra child', outer(undefined, contractFn(sdk, other, 'drain', [addr(B)]))],
  ] as const) {
    const run = mock([v2(B, root)]);
    await assert.rejects(invoke(run.ctx, outerRow(run.ctx)), /entry 0 .* differs/, name);
    assertNothingSigned(run.calls);
  }
});

test('a deliberate mutation applies only after the original tree passes', async () => {
  const { ctx, calls } = mock([v2(B, outer())], { enforceError: 'Error(Auth, InvalidAction)' });
  let beforeSign = 0;
  await invoke(
    ctx,
    outerRow(ctx, {
      expect: 'Error(Auth, InvalidAction)',
      mutate: {
        beforeSign: (entry) => {
          beforeSign += 1;
          const child = entry.rootInvocation.subInvocations[0].function;
          assert.equal(child.type, 'sorobanAuthorizedFunctionTypeContractFn');
          child.contractFn.args[1] = u32(2);
        },
      },
    }),
  );
  assert.equal(beforeSign, 1);
  const [sent] = calls.enforced[0];
  const altered = outer(contractFn(sdk, target2, 'ping', [addr(B), u32(2)]));
  assert.equal(sent.rootInvocation.toXdr('base64'), altered.toXdr('base64'));
  assertSignedBy(sent, pairs[1]);
});

test('a mutation cannot repair a changed recorded tree', async () => {
  const { ctx, calls } = mock([v2(B, contractFn(sdk, target, 'ping', [addr(B), u32(999)]))]);
  let beforeSign = 0;
  const repair = (entry: xdr.SorobanAuthorizationEntry) => {
    beforeSign += 1;
    const root = entry.rootInvocation.function;
    assert.equal(root.type, 'sorobanAuthorizedFunctionTypeContractFn');
    root.contractFn.args[1] = u32(1);
  };
  await assert.rejects(invoke(ctx, pingRow(ctx, { mutate: { beforeSign: repair } })), /entry 0 .* differs/);
  assertNothingSigned(calls, beforeSign);
});

test('a presigned replay records nothing and requests no signature', async () => {
  const fresh = mock([v2(B, ping)]);
  const first = await invoke(fresh.ctx, pingRow(fresh.ctx));
  const { ctx, calls } = mock([], { enforceError: 'Error(Auth, ExistingValue)' });
  const replay = await invoke(ctx, {
    contractId: target,
    method: 'ping',
    args: pingArgs,
    presigned: first.auth_xdr,
    label: 'replay',
    expect: 'Error(Auth, ExistingValue)',
  });
  assert.deepEqual(
    { record: calls.record, digests: calls.digests, enforce: calls.enforce },
    { record: 0, digests: 0, enforce: 1 },
  );
  assert.deepEqual(replay.auth_xdr, first.auth_xdr);
});

test('E02 signs its delegate entry only after the OpenZeppelin tree passes', async () => {
  const accountArgs = [addr(account), u32(1)];
  const row = (ctx: MockContext): InvokeOptions => ({
    contractId: target,
    method: 'ping',
    args: accountArgs,
    authorizers: [ozDelegatedAuthorizer(ctx, account, keys.b)],
    expected: [{ address: account, invocation: contractFn(sdk, target, 'ping', accountArgs) }],
    extraAuth: delegateEntryFor(ctx, { account, delegate: keys.b }),
    label: 'E02-mock',
    expect: 'Error(Auth, InvalidAction)',
  });
  const valid = mock([v2(account, contractFn(sdk, target, 'ping', accountArgs))], {
    enforceError: 'Error(Auth, InvalidAction)',
  });
  const result = await invoke(valid.ctx, row(valid.ctx));
  assert.equal(valid.calls.digests, 1);
  const [ozEntry, delegate] = valid.calls.enforced[0];
  assert.equal(ozEntry.credentials.type, 'sorobanCredentialsAddressV2');
  assert.equal(delegate.credentials.type, 'sorobanCredentialsAddressV2');
  const digest = result.entries.find((e) => e.address === account)?.digest;
  assert.ok(digest);
  const bound = contractFn(sdk, account, '__check_auth', [
    sdk.xdr.ScVal.scvBytes(Buffer.from(digest, 'hex')),
  ]);
  assert.equal(delegate.rootInvocation.toXdr('base64'), bound.toXdr('base64'));
  assertSignedBy(delegate, pairs[1]);

  const changed = mock([v2(account, contractFn(sdk, other, 'ping', accountArgs))]);
  await assert.rejects(invoke(changed.ctx, row(changed.ctx)), /entry 0 .* differs/);
  assertNothingSigned(changed.calls);
});

test('a source-only deployment signs its envelope only for the exact local creation', async () => {
  const operation = sdk.Operation.createCustomContract({
    address: new sdk.Address(keys.a.publicKey),
    wasmHash: Buffer.alloc(32, 5),
    constructorArgs: [u32(1)],
  });
  const root = createRoot(hostFunctionOf(operation));
  const valid = mock([sourceEntry(root)]);
  await submitSourceOnly(valid.ctx, operation, 'deploy');
  assert.deepEqual(
    { envelopes: valid.calls.envelopes, sends: valid.calls.sends },
    { envelopes: 1, sends: 1 },
  );

  const otherWasm = sdk.Operation.createCustomContract({
    address: new sdk.Address(keys.a.publicKey),
    wasmHash: Buffer.alloc(32, 6),
    constructorArgs: [u32(1)],
  });
  for (const recorded of [
    [],
    [sourceEntry(createRoot(hostFunctionOf(otherWasm)))],
    [sourceEntry(root), sourceEntry(root)],
    [sourceEntry(root), v2(B, ping)],
    [v2(keys.a.publicKey, root)],
  ]) {
    const run = mock(recorded);
    await assert.rejects(submitSourceOnly(run.ctx, operation, 'deploy'), /differs from the local operation/);
    assertNothingSigned(run.calls);
  }
});

test('a source-only upload accepts no recorded entry', async () => {
  const operation = sdk.Operation.uploadContractWasm({ wasm: Buffer.from('00', 'hex') });
  const valid = mock([]);
  await submitSourceOnly(valid.ctx, operation, 'upload');
  assert.equal(valid.calls.envelopes, 1);
  const run = mock([sourceEntry(ping)]);
  await assert.rejects(submitSourceOnly(run.ctx, operation, 'upload'), /differs from the local operation/);
  assertNothingSigned(run.calls);
});
