import { afterAll, describe, onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import * as sdk from '@stellar/stellar-sdk';
import type { Keypair, Transaction, rpc, xdr } from '@stellar/stellar-sdk';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  signTree,
  replaceAddress,
  corruptDelegateOrder,
  removeGLeafSignature,
  loadCheckpoint,
  saveCheckpoint,
  assertRejection,
  enforceDelegateOrder,
  runCap71,
  type Cap71Context,
  type Cap71State,
  type OrderMode,
} from './cap71.ts';
import { requireAddressCredentials } from './contracts.ts';
import { UnknownSubmission } from './submission.ts';
import {
  diagnosticEvent,
  simulationError,
  simulationRestore,
  simulationSuccess,
  withoutField,
} from './simulations.ts';
import type { Details, KeyName, TestKey, TestKeys } from './types.ts';

// Isolated mock keys. They never reach the live context or any network.
const pairs: Record<string, Keypair> = Object.fromEntries(
  ['a', 'b', 'c'].map((name, i) => [name, sdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, i + 71))]),
);
const testKey = (name: KeyName): TestKey => ({
  name,
  publicKey: pairs[name].publicKey(),
  rawPublicKey: pairs[name].rawPublicKey(),
});
const keys: TestKeys = { a: testKey('a'), b: testKey('b'), c: testKey('c') };
const contract = (n: number) => sdk.StrKey.encodeContract(Buffer.alloc(32, n));
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();
const entry = () =>
  new sdk.xdr.SorobanAuthorizationEntry({
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new sdk.xdr.SorobanAddressCredentials({
        address: new sdk.Address(contract(1)).toScAddress(),
        nonce: 71n,
        signatureExpirationLedger: 0,
        signature: sdk.xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new sdk.xdr.SorobanAuthorizedInvocation({
      function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new sdk.xdr.InvokeContractArgs({
          contractAddress: new sdk.Address(contract(2)).toScAddress(),
          functionName: 'ping',
          args: [sdk.xdr.ScVal.scvU32(1)],
        }),
      ),
      subInvocations: [],
    }),
  });
// The delegate nodes of a CAP-71 entry.
function delegatesOf(value: xdr.SorobanAuthorizationEntry) {
  const credentials = value.credentials;
  assert.ok(credentials.type === 'sorobanCredentialsAddressWithDelegates');
  return credentials.addressWithDelegates.delegates;
}
// Parts that a test does not configure fail when used.
const unavailable = (part: string) => async (): Promise<never> => {
  throw new Error(`The offline context has no ${part}`);
};
type TestContext = Cap71Context & { events: Details[] };
function context(): TestContext {
  const events: Details[] = [];
  const last = () => {
    const event = events.at(-1);
    assert.ok(event, 'A record precedes each signing request');
    return event;
  };
  return {
    sdk,
    keys,
    events,
    networkPassphrase: sdk.Networks.TESTNET,
    assertClear() {},
    record(id, status, details) {
      events.push({ id, status, ...details });
    },
    async signDigest(key, payload) {
      assert.equal(last().status, 'signing_requested');
      assert.equal(last().digest, Buffer.from(payload).toString('hex'));
      assert.equal(digest(Buffer.from(String(last().preimage_xdr), 'base64')).toString('hex'), last().digest);
      return pairs[key.name].sign(payload);
    },
    rpc: {
      getVersionInfo: unavailable('RPC'),
      getAccount: unavailable('RPC'),
      simulateTransaction: unavailable('RPC'),
    },
    sign: unavailable('envelope signer'),
    send: unavailable('submission'),
  };
}
const lastEvent = (ctx: TestContext) => {
  const event = ctx.events.at(-1);
  assert.ok(event);
  return event;
};
const voidResult = (): rpc.Api.SimulateHostFunctionResult => ({ auth: [], retval: sdk.xdr.ScVal.scvVoid() });

test('native tree signs one shared root-bound digest and records before signing', async () => {
  const ctx = context();
  const delegates = [
    { address: contract(3), nestedDelegates: [{ address: keys.a.publicKey }, { address: keys.c.publicKey }] },
    { address: keys.a.publicKey },
  ];
  const signed = await signTree(ctx, entry(), delegates, 200, 'offline', 28);
  assert.equal(signed.entry.credentials.type, 'sorobanCredentialsAddressWithDelegates');
  assert.equal(ctx.events.length, 2, 'A occurs twice but needs only one signing prompt');
  assert(
    ctx.events.every((e) => e.root_address === contract(1) && e.expiration === 200 && e.protocol === 28),
  );
  assert.equal(new Set(ctx.events.map((e) => e.digest)).size, 1);
  const inspection = sdk.inspectAuthEntry(signed.entry);
  const signers = inspection.signers.filter((s) => s.address.startsWith('G'));
  assert.equal(signers.length, 3);
  for (const signer of signers) {
    assert.ok(signer.signatures);
    assert.equal(signer.signatures.length, 1);
    assert(
      sdk.Keypair.fromPublicKey(signer.address).verify(
        Buffer.from(signed.digest, 'hex'),
        signer.signatures[0].signature,
      ),
    );
  }
  assert.equal(entry().credentials.type, 'sorobanCredentialsAddressV2');
});

test('SDK sorts tree levels and rejects duplicate delegates before signing', async () => {
  const ctx = context();
  await assert.rejects(
    signTree(
      ctx,
      entry(),
      [{ address: keys.a.publicKey }, { address: keys.a.publicKey }],
      200,
      'offline',
      28,
    ),
    /duplicate delegate/,
  );
  assert.equal(ctx.events.length, 0);
  const signed = await signTree(
    ctx,
    entry(),
    [{ address: keys.c.publicKey }, { address: keys.a.publicKey }],
    200,
    'offline',
    28,
  );
  const nodes = delegatesOf(signed.entry);
  assert(Buffer.compare(Buffer.from(nodes[0].address.toXdr()), Buffer.from(nodes[1].address.toXdr())) < 0);
});

test('gate failure prevents direct CAP71 signatures and evidence prompts', async () => {
  const ctx = context();
  ctx.assertClear = () => {
    throw new UnknownSubmission('old', 'abcd', new Error('pending'));
  };
  await assert.rejects(
    signTree(ctx, entry(), [{ address: keys.a.publicKey }], 200, 'offline', 28),
    UnknownSubmission,
  );
  assert.equal(ctx.events.length, 0);
});

test('native substitution changes the digest without changing nonce or invocation', async () => {
  const ctx = context();
  const signed = await signTree(ctx, entry(), [{ address: keys.a.publicKey }], 200, 'offline', 28);
  const replaced = replaceAddress(sdk, signed.entry, contract(4));
  assert.equal(requireAddressCredentials(replaced).nonce, 71n);
  assert.deepEqual(replaced.rootInvocation.toXdr(), signed.entry.rootInvocation.toXdr());
  const hash = digest(sdk.buildAuthorizationEntryPreimage(replaced, 200, ctx.networkPassphrase).toXdr());
  assert.notEqual(hash.toString('hex'), signed.digest);
  assert(!pairs.a.verify(hash, Buffer.from(String(signed.signatures[0].signature_hex), 'hex')));
});

test('address_v2 same-key account substitution fails cryptographic verification', async () => {
  const ctx = context();
  const signed = await sdk.authorizeEntry(
    entry(),
    async (_preimage, payload) => ({ signatureScVal: sdk.xdr.ScVal.scvBytes(pairs.a.sign(payload)) }),
    200,
    ctx.networkPassphrase,
  );
  const replaced = replaceAddress(sdk, signed, contract(5));
  assert.equal(replaced.credentials.type, 'sorobanCredentialsAddressV2');
  const originalHash = digest(
    sdk.buildAuthorizationEntryPreimage(signed, 200, ctx.networkPassphrase).toXdr(),
  );
  const otherHash = digest(sdk.buildAuthorizationEntryPreimage(replaced, 200, ctx.networkPassphrase).toXdr());
  const signature = Buffer.from(sdk.scValToNative(requireAddressCredentials(signed).signature));
  assert(pairs.a.verify(originalHash, signature));
  assert(!pairs.a.verify(otherHash, signature));
});

test('malformed order negatives preserve the signed payload at each tree level', async () => {
  const ctx = context();
  for (const nested of [false, true]) {
    const leaves = [{ address: keys.a.publicKey }, { address: keys.c.publicKey }];
    const tree = nested ? [{ address: contract(3), nestedDelegates: leaves }] : leaves;
    const signed = await signTree(ctx, entry(), tree, 200, 'offline', 28);
    for (const mode of ['duplicate', 'unordered'] as const) {
      const bad = corruptDelegateOrder(sdk, signed.entry, mode, nested);
      const nodes = nested ? delegatesOf(bad)[0].nestedDelegates : delegatesOf(bad);
      assert.equal(nodes.length, mode === 'duplicate' ? 3 : 2);
      assert.equal(
        digest(sdk.buildAuthorizationEntryPreimage(bad, 200, ctx.networkPassphrase).toXdr()).toString('hex'),
        signed.digest,
      );
    }
  }
});

test('missing G signature preserves the present delegate and every signed payload field', async () => {
  const ctx = context();
  const signed = await signTree(ctx, entry(), [{ address: keys.a.publicKey }], 200, 'offline', 28);
  const bad = removeGLeafSignature(sdk, signed.entry);
  const nodes = delegatesOf(bad);
  assert.equal(nodes.length, 1);
  assert.equal(sdk.Address.fromScAddress(nodes[0].address).toString(), keys.a.publicKey);
  const cleared = nodes[0].signature;
  assert.ok(cleared.type === 'scvVec');
  assert.equal(cleared.vec?.length, 0);
  assert.deepEqual(requireAddressCredentials(bad).toXdr(), requireAddressCredentials(signed.entry).toXdr());
  assert.deepEqual(bad.rootInvocation.toXdr(), signed.entry.rootInvocation.toXdr());
  assert.equal(
    digest(sdk.buildAuthorizationEntryPreimage(bad, 200, ctx.networkPassphrase).toXdr()).toString('hex'),
    signed.digest,
  );
  assert.equal(
    sdk.inspectAuthEntry(signed.entry).signers.find((n) => n.address === keys.a.publicKey)?.signatures
      ?.length,
    1,
  );
  assert.throws(() =>
    assertRejection(
      sdk,
      simulationError(
        'Error(Auth, InvalidAction)\nError(Contract, #5)\nsignature weight is lower than threshold',
      ),
      {
        code: 'Error(Contract, #5)',
        reason: 'no account signatures found',
      },
    ),
  );
});

test('error oracle checks exact contract code and duplicate diagnostic', () => {
  const simulation = (error: string, reason = '') =>
    simulationError(error, {
      events: [
        diagnosticEvent(
          [sdk.xdr.ScVal.scvError(sdk.xdr.ScError.sceContract(7101))],
          sdk.xdr.ScVal.scvString(reason),
        ),
      ],
    });
  assertRejection(sdk, simulation('Error(Auth, InvalidAction)'), { code: 'Error(Contract, #7101)' });
  assert.throws(() =>
    assertRejection(sdk, simulation('Error(Auth, InvalidAction)'), { code: 'Error(Contract, #7102)' }),
  );
  assert.throws(() =>
    assertRejection(sdk, simulation('Error(Auth, InvalidInput)', 'signature has expired'), {
      code: 'Error(Auth, InvalidInput)',
      reason: 'delegated signers contain duplicate address',
    }),
  );
  assertRejection(
    sdk,
    simulation('Error(Auth, InvalidInput)', 'delegated signers contain duplicate address'),
    {
      code: 'Error(Auth, InvalidInput)',
      reason: 'delegated signers contain duplicate address',
    },
  );
});

interface PairedOptions {
  mode?: OrderMode;
  nested?: boolean;
  control?: rpc.Api.SimulateTransactionResponse;
  mutated?: rpc.Api.SimulateTransactionResponse;
}
async function pairedFixture({ mode = 'duplicate', nested = false, control, mutated }: PairedOptions = {}) {
  const ctx = context();
  const leaves = [{ address: keys.a.publicKey }, { address: keys.c.publicKey }];
  const tree = nested ? [{ address: contract(3), nestedDelegates: leaves }] : leaves;
  const signed = await signTree(ctx, entry(), tree, 200, 'offline-pair', 28);
  const tx = new sdk.TransactionBuilder(new sdk.Account(keys.a.publicKey, '1'), {
    fee: '100',
    networkPassphrase: ctx.networkPassphrase,
  })
    .addOperation(
      sdk.Operation.invokeContractFunction({
        contract: contract(2),
        function: 'ping',
        args: [sdk.xdr.ScVal.scvU32(1)],
        auth: [signed.entry],
      }),
    )
    .setTimeout(120)
    .build();
  const calls: Transaction[] = [];
  const success = simulationSuccess({
    result: { auth: [], retval: sdk.xdr.ScVal.scvU32(1) },
    latestLedger: 100,
  });
  const noDebug = simulationError('HostError: Error(Auth, InvalidInput)\nDebugInfo not available', {
    latestLedger: 101,
    events: [],
  });
  ctx.rpc = {
    ...ctx.rpc,
    async simulateTransaction(received, _resource, authMode) {
      assert.equal(authMode, 'enforce');
      calls.push(received);
      return calls.length === 1 ? (control ?? success) : (mutated ?? noDebug);
    },
  };
  ctx.sign =
    ctx.send =
    ctx.signDigest =
      async () => {
        throw new Error('Paired comparisons must not sign or submit');
      };
  return {
    ctx,
    tx,
    calls,
    signed,
    run: () => enforceDelegateOrder(ctx, tx, { mode, nested, label: 'offline-pair' }),
  };
}

test('paired root and nested comparisons use a successful control and preserve signed fields', async () => {
  for (const mode of ['duplicate', 'unordered'] as const)
    for (const nested of [false, true]) {
      const f = await pairedFixture({ mode, nested });
      const result = await f.run();
      assert.equal(f.calls.length, 2);
      assert.equal(f.calls[0].toXDR(), f.tx.toXDR());
      const original = f.signed.entry;
      const altered = result.entry;
      assert.deepEqual(
        requireAddressCredentials(original).toXdr(),
        requireAddressCredentials(altered).toXdr(),
      );
      assert.deepEqual(original.rootInvocation.toXdr(), altered.rootInvocation.toXdr());
      const flatten = (nodes: xdr.SorobanDelegateSignature[]): [string, string][] =>
        nodes.flatMap((n) => [
          [sdk.Address.fromScAddress(n.address).toString(), n.signature.toXdr('base64')],
          ...flatten(n.nestedDelegates),
        ]);
      const originals = new Map(flatten(delegatesOf(original)));
      for (const [address, signature] of flatten(delegatesOf(altered)))
        assert.equal(signature, originals.get(address));
      assert.equal(result.paired.control.digest, result.paired.mutated.digest);
      assert.equal(result.paired.control.auth_xdr, original.toXdr('base64'));
      assert.equal(result.paired.mutated.auth_xdr, altered.toXdr('base64'));
      assert.equal(result.paired.control.unsigned_tx_xdr, f.calls[0].toXDR());
      assert.equal(result.paired.mutated.unsigned_tx_xdr, f.calls[1].toXDR());
      assert.equal(result.paired.control.ledger, 100);
      assert.equal(result.paired.mutated.ledger, 101);
      assert.equal(result.paired.diagnostic_available, false);
      assert.equal(result.paired.basis, 'successful_unmutated_control_and_exact_delegate_array_mutation');
      assert.equal(result.paired.control.expiration, 200);
    }
});

test('paired comparison rejects failed or incomplete controls before mutation simulation', async () => {
  for (const control of [
    simulationError('Error(Crypto, InvalidInput)', { latestLedger: 100 }),
    withoutField(simulationSuccess({ result: voidResult(), latestLedger: 100 }), 'transactionData'),
    simulationRestore(voidResult(), { latestLedger: 100 }),
  ]) {
    const f = await pairedFixture({ control });
    await assert.rejects(f.run(), /Unmutated delegate control failed/);
    assert.equal(f.calls.length, 1);
  }
});

test('paired comparison rejects wrong errors and available contradictory diagnostics', async () => {
  for (const error of [
    'HostError: Error(Auth, ExistingValue)\nDebugInfo not available',
    'HostError: Error(Auth, InvalidAction)\nError(Auth, InvalidInput)',
    'HostError: Error(Auth, InvalidInput)\nsignature has expired',
    'HostError: Error(Auth, InvalidInput)',
  ]) {
    const f = await pairedFixture({ mutated: simulationError(error, { latestLedger: 101 }) });
    await assert.rejects(f.run(), /Unexpected mutated delegate error|Expected diagnostic/);
  }
  const f = await pairedFixture({
    mutated: simulationError(
      'HostError: Error(Auth, InvalidInput)\ndelegated signers contain duplicate address',
      { latestLedger: 101 },
    ),
  });
  assert.equal((await f.run()).paired.diagnostic_available, true);
});

test('paired comparison rejects expired, nearly expired, missing, or reversed ledger evidence', async () => {
  for (const latestLedger of [200, 195, undefined, 99]) {
    const noDebug = simulationError('HostError: Error(Auth, InvalidInput)\nDebugInfo not available');
    const f = await pairedFixture({
      mutated:
        latestLedger === undefined ? withoutField(noDebug, 'latestLedger') : { ...noDebug, latestLedger },
    });
    await assert.rejects(f.run(), /expiration is not safely valid|Invalid comparison ledger/);
  }
  const f = await pairedFixture({ control: simulationSuccess({ result: voidResult(), latestLedger: 195 }) });
  await assert.rejects(f.run(), /expiration is not safely valid/);
  assert.equal(f.calls.length, 1);
});

test('checkpoint fails closed on corruption, binding change, and interrupted submission', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap71-checkpoint-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'checkpoint.json');
  const binding = { network: 'test', keys: ['A'], artifacts: { file: 'hash' } };
  const state = loadCheckpoint(file, binding);
  state.steps.old = { hash: 'original' };
  saveCheckpoint(file, state);
  assert.deepEqual(loadCheckpoint(file, binding).steps.old, { hash: 'original' });
  assert.deepEqual(readdirSync(dir), ['checkpoint.json']);
  assert.throws(() => loadCheckpoint(file, { ...binding, network: 'other' }), /mismatch|changed/);
  state.inflight = { label: 'uncertain', hash: 'original' };
  saveCheckpoint(file, state);
  assert.throws(
    () => loadCheckpoint(file, binding),
    (e) => e instanceof UnknownSubmission && e.hash === 'original',
  );
  writeFileSync(file, '{');
  assert.throws(() => loadCheckpoint(file, binding), SyntaxError);
  assert.equal(readFileSync(file, 'utf8'), '{');
});

test('interrupted rows label saved checks separately from the current protocol without repeating work', async () => {
  const files = ['cap71_delegate.wasm', 'cap71_raw_account.wasm', 'cap71_target.wasm'];
  const binding = {
    network: sdk.Networks.TESTNET,
    keys: (['a', 'b', 'c'] as const).map((name) => keys[name].publicKey),
    artifacts: Object.fromEntries(
      files.map((file) => [
        file,
        digest(
          readFileSync(new URL(`../fixtures/cap71/target/wasm32v1-none/release/${file}`, import.meta.url)),
        ).toString('hex'),
      ]),
    ),
  };
  const dir = mkdtempSync(join(tmpdir(), 'cap71-reuse-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  for (const currentProtocol of [28, 29]) {
    const ctx = context();
    const file = join(dir, `${currentProtocol}.json`);
    ctx.cap71Checkpoint = file;
    ctx.rows = ['CAP71-01'];
    const state = loadCheckpoint(file, binding);
    for (const wasm of files) state.steps[`CAP71-upload-${wasm}`] = { protocol: 28 };
    for (const [index, name] of ['target', 'any', 'both', 'weighted', 'chain', 'raw1', 'raw2'].entries()) {
      state.salts[name] = Buffer.alloc(32, index + 30).toString('hex');
      state.steps[`CAP71-deploy-${name}`] = {
        protocol: 28,
        retval_xdr: new sdk.Address(contract(index + 10)).toScVal().toXdr('base64'),
      };
    }
    state.checks['CAP71-direct-a'] = { protocol: 28, outcome: 'submitted', state_before: 0, state_after: 1 };
    state.checks['CAP71-direct-c'] = { protocol: 27, outcome: 'submitted', state_before: 1, state_after: 2 };
    state.done['CAP71-02'] = { protocol: 27, historical: true };
    saveCheckpoint(file, state);
    const blockedCalls: string[] = [];
    const deny = (name: string) => async (): Promise<never> => {
      blockedCalls.push(name);
      throw new Error(`Must not call ${name}`);
    };
    let versionCalls = 0;
    ctx.rpc = {
      async getVersionInfo() {
        versionCalls++;
        return { protocolVersion: currentProtocol };
      },
      getAccount: deny('getAccount'),
      simulateTransaction: deny('simulateTransaction'),
    };
    ctx.signDigest = deny('signDigest');
    ctx.sign = deny('sign');
    ctx.send = deny('send');
    const result = await runCap71(ctx);
    const row = ctx.events.find((event) => event.id === 'CAP71-01');
    assert.ok(row);
    assert.equal(row.status, 'passed');
    assert.equal(row.protocol, currentProtocol);
    assert.equal(row.current_environment_protocol, currentProtocol);
    assert.equal(row.reused_evidence, true);
    assert.deepEqual(row.reused_checks, [
      { label: 'CAP71-direct-a', original_protocol: 28 },
      { label: 'CAP71-direct-c', original_protocol: 27 },
    ]);
    assert.deepEqual(row.checks, { a: state.checks['CAP71-direct-a'], c: state.checks['CAP71-direct-c'] });
    const saved = loadCheckpoint(file, binding);
    assert.deepEqual(saved.done['CAP71-01'], result.done['CAP71-01']);
    for (const field of ['binding', 'salts', 'steps', 'checks'] as const)
      assert.deepEqual(saved[field], state[field]);
    assert.deepEqual(saved.done['CAP71-02'], state.done['CAP71-02']);
    ctx.events.length = 0;
    await runCap71(ctx);
    assert.deepEqual(
      ctx.events.find((event) => event.id === 'CAP71-01'),
      {
        id: 'CAP71-01',
        status: 'passed_previous_run',
        ...saved.done['CAP71-01'],
        reused_evidence: true,
      },
    );
    assert.equal(versionCalls, 2);
    assert.deepEqual(blockedCalls, []);
  }
});

test('setup performs enforce simulation and stops before any envelope signing on failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap71-enforce-'));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = context();
  ctx.cap71Checkpoint = join(dir, 'state.json');
  const modes: rpc.Api.SimulationAuthMode[] = [];
  let signCount = 0;
  ctx.rpc = {
    async getVersionInfo() {
      return { protocolVersion: 28 };
    },
    async getAccount() {
      return new sdk.Account(keys.a.publicKey, '1');
    },
    async simulateTransaction(tx, _resources, mode) {
      modes.push(mode);
      const op = tx.operations[0];
      assert.ok(op.type === 'invokeHostFunction');
      assert.equal(op.func.type, 'hostFunctionTypeUploadContractWasm');
      if (mode === 'enforce') return simulationError('offline enforced rejection');
      return simulationSuccess({ latestLedger: 100, result: voidResult() });
    },
  };
  ctx.sign = async () => {
    signCount++;
    throw new Error('Must not sign');
  };
  ctx.send = async () => {
    throw new Error('Must not send');
  };
  await assert.rejects(runCap71(ctx), /enforce failed: offline enforced rejection/);
  assert.deepEqual(modes, ['record', 'enforce']);
  assert.equal(signCount, 0);
});

test('unknown row IDs fail before RPC, signing, or checkpoint access', async () => {
  const ctx = context();
  ctx.rows = ['CAP71-1'];
  ctx.assertClear = () => {
    throw new Error('Must not check the submission gate');
  };
  ctx.record = () => {
    throw new Error('Must not record evidence');
  };
  ctx.signDigest = unavailable('digest signer');
  await assert.rejects(runCap71(ctx), /Unknown CAP71 row: CAP71-1/);
});

// node:test ran the malicious-RPC case as a subtest of the restart case. bun:test has no subtests,
// so both cases share one mocked run in this block and execute in order.
describe('mocked CAP71 run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cap71-run-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = context();
  ctx.cap71Checkpoint = join(dir, 'state.json');
  ctx.rows = ['CAP71-01'];
  // Assembly returns the enforced transaction unchanged, so signing and sending see the enforced hash.
  class Unchanged extends sdk.TransactionBuilder {
    readonly enforced: Transaction;
    constructor(enforced: Transaction) {
      super(new sdk.Account(enforced.source, '0'), {
        fee: enforced.fee,
        networkPassphrase: enforced.networkPassphrase,
      });
      this.enforced = enforced;
    }
    override build() {
      return this.enforced;
    }
  }
  ctx.sdk = {
    ...sdk,
    rpc: {
      ...sdk.rpc,
      assembleTransaction: (tx) => {
        assert.ok(tx instanceof sdk.Transaction);
        return new Unchanged(tx);
      },
    },
  };
  const enforced = new Map<string, (() => void) | undefined>();
  const counts = new Map<string, number>();
  let nonce = 1n;
  let sends = 0;
  async function simulate(
    tx: Transaction,
    _resources: undefined,
    mode: rpc.Api.SimulationAuthMode,
  ): Promise<rpc.Api.SimulateTransactionSuccessResponse> {
    const op = tx.operations[0];
    assert.ok(op.type === 'invokeHostFunction');
    const func = op.func;
    let retval: xdr.ScVal;
    let auth: xdr.SorobanAuthorizationEntry[] = [];
    let effect: (() => void) | undefined;
    if (func.type === 'hostFunctionTypeUploadContractWasm') retval = sdk.xdr.ScVal.scvBytes(Buffer.alloc(32));
    else if (func.type === 'hostFunctionTypeCreateContractV2')
      retval = new sdk.Address(sdk.StrKey.encodeContract(digest(func.toXdr()))).toScVal();
    else {
      assert.ok(func.type === 'hostFunctionTypeInvokeContract');
      const call = func.invokeContract;
      const method = call.functionName.toString();
      const who: string = sdk.scValToNative(call.args[0]);
      if (method === 'count') retval = sdk.xdr.ScVal.scvU32(counts.get(who) ?? 0);
      else {
        assert.equal(method, 'ping');
        retval = sdk.xdr.ScVal.scvU32((counts.get(who) ?? 0) + 1);
        if (mode === 'record')
          auth = [
            new sdk.xdr.SorobanAuthorizationEntry({
              credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(
                new sdk.xdr.SorobanAddressCredentials({
                  address: new sdk.Address(who).toScAddress(),
                  nonce: nonce++,
                  signatureExpirationLedger: 0,
                  signature: sdk.xdr.ScVal.scvVoid(),
                }),
              ),
              rootInvocation: new sdk.xdr.SorobanAuthorizedInvocation({
                function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                  new sdk.xdr.InvokeContractArgs({
                    contractAddress: call.contractAddress,
                    functionName: 'ping',
                    args: [sdk.xdr.ScVal.scvU32(1)],
                  }),
                ),
                subInvocations: [],
              }),
            }),
          ];
        else {
          const opAuth = op.auth ?? [];
          assert.equal(opAuth.length, 1);
          const authEntry = opAuth[0];
          assert.equal(authEntry.credentials.type, 'sorobanCredentialsAddressWithDelegates');
          const hash = digest(
            sdk
              .buildAuthorizationEntryPreimage(
                authEntry,
                requireAddressCredentials(authEntry).signatureExpirationLedger,
                ctx.networkPassphrase,
              )
              .toXdr(),
          );
          for (const node of sdk
            .inspectAuthEntry(authEntry)
            .signers.filter((n) => n.address.startsWith('G'))) {
            assert.ok(node.signatures);
            assert(sdk.Keypair.fromPublicKey(node.address).verify(hash, node.signatures[0].signature));
          }
          effect = () => counts.set(who, (counts.get(who) ?? 0) + 1);
        }
      }
    }
    if (mode === 'enforce') enforced.set(Buffer.from(tx.hash()).toString('hex'), effect);
    return simulationSuccess({ latestLedger: 100, result: { retval, auth } });
  }
  ctx.rpc = {
    async getVersionInfo() {
      return { protocolVersion: 28 };
    },
    async getAccount() {
      return new sdk.Account(keys.a.publicKey, '1');
    },
    simulateTransaction: simulate,
  };
  ctx.sign = async (tx, key) => {
    const hash = Buffer.from(tx.hash()).toString('hex');
    assert(enforced.has(hash));
    assert.equal(lastEvent(ctx).digest, hash);
    assert.equal(digest(Buffer.from(String(lastEvent(ctx).preimage_xdr), 'base64')).toString('hex'), hash);
    tx.sign(pairs[key.name]);
    return tx;
  };
  ctx.send = async (tx) => {
    const hash = Buffer.from(tx.hash()).toString('hex');
    assert(enforced.has(hash));
    enforced.get(hash)?.();
    sends++;
    return { hash, status: 'SUCCESS', ledger: 100 };
  };
  let result: Cap71State | undefined;

  test('mocked setup and native calls enforce before signing; restart reuses confirmed steps', async () => {
    result = await runCap71(ctx);
    assert.equal(sends, 12);
    assert(result.done['CAP71-01']);
    assert.equal(Object.values(result.checks).length, 2);
    assert.equal(result.done['CAP71-01'].reused_evidence, undefined);
    assert.equal(result.done['CAP71-01'].reused_checks, undefined);
    assert.equal(result.inflight, undefined);
    await runCap71(ctx);
    assert.equal(sends, 12, 'Restart must not sign or send a confirmed step again');
  });

  test('malicious RPC roots and unexpected subinvocations cause zero signing requests', async () => {
    assert.ok(result, 'The restart case produced the confirmed checkpoint');
    const checkpoint = ctx.cap71Checkpoint;
    assert.ok(checkpoint);
    const savedState = JSON.stringify(result);
    let signDigestCalls = 0;
    let envelopeCalls = 0;
    ctx.signDigest = async () => {
      signDigestCalls++;
      throw new Error('Must not sign malicious auth');
    };
    ctx.sign = async () => {
      envelopeCalls++;
      throw new Error('Must not sign an envelope');
    };
    for (const row of ['CAP71-01', 'CAP71-12']) {
      ctx.rows = [row];
      for (const mutation of ['contract', 'method', 'amount', 'extra-argument', 'subinvocation']) {
        const reset: Cap71State = JSON.parse(savedState);
        delete reset.done['CAP71-01'];
        for (const label of ['CAP71-direct-a', 'CAP71-direct-c']) {
          delete reset.steps[label];
          delete reset.checks[label];
        }
        saveCheckpoint(checkpoint, reset);
        ctx.rpc.simulateTransaction = async (tx, resources, mode) => {
          const simulation = await simulate(tx, resources, mode);
          if (mode !== 'record' || !simulation.result?.auth.length) return simulation;
          const original = simulation.result.auth[0];
          const root = original.rootInvocation;
          assert.ok(root.function.type === 'sorobanAuthorizedFunctionTypeContractFn');
          const fn = root.function.contractFn;
          const fields: ConstructorParameters<typeof sdk.xdr.InvokeContractArgs>[0] = {
            contractAddress: fn.contractAddress,
            functionName: fn.functionName,
            args: fn.args,
          };
          if (mutation === 'contract') fields.contractAddress = new sdk.Address(contract(99)).toScAddress();
          if (mutation === 'method') fields.functionName = 'drain';
          if (mutation === 'amount') fields.args = [sdk.xdr.ScVal.scvU32(999)];
          if (mutation === 'extra-argument')
            fields.args = [...fn.args, new sdk.Address(keys.a.publicKey).toScVal()];
          simulation.result.auth = [
            new sdk.xdr.SorobanAuthorizationEntry({
              credentials: original.credentials,
              rootInvocation: new sdk.xdr.SorobanAuthorizedInvocation({
                function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                  new sdk.xdr.InvokeContractArgs(fields),
                ),
                subInvocations: mutation === 'subinvocation' ? [root] : [],
              }),
            }),
          ];
          return simulation;
        };
        await assert.rejects(runCap71(ctx), /unexpected recorded authorization tree/, `${row}: ${mutation}`);
        assert.equal(signDigestCalls, 0);
        assert.equal(envelopeCalls, 0);
        assert.equal(sends, 12);
      }
    }
  });
});
