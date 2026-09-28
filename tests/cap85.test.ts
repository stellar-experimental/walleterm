import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sdk from '@stellar/stellar-sdk';
import {
  loadState,
  loadManifest,
  saveState,
  reconcileInflight,
  prepareCap85,
  assertCreatedReference,
  x06,
} from './cap85.ts';
import type { Transaction, rpc } from '@stellar/stellar-sdk';
import type { Cap85Context, Inflight, PrepareContext } from './cap85.ts';

const C = sdk.StrKey.encodeContract(Buffer.alloc(32, 9));
const manager = sdk.StrKey.encodeContract(Buffer.alloc(32, 8));
const key = { publicKey: sdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7)) };
const hash = 'ab'.repeat(32);
const manifest = loadManifest();
const base = {
  contracts: Object.fromEntries(
    ['oz_basic_a', 'simple_account_b', 'ed25519_verifier'].map((n) => [n, { id: C }]),
  ),
};
// Reconciliation needs only these calls. Signing, submission, and funding fail the test when reached.
type TestContext = PrepareContext & Pick<Cap85Context, 'sign' | 'send' | 'fund'>;
// A typed record-mode simulation. Only the counter value carries test data.
const counterResponse = (count: number): rpc.Api.SimulateTransactionSuccessResponse => ({
  id: 'cap85-test',
  latestLedger: 10,
  events: [],
  _parsed: true,
  transactionData: new sdk.SorobanDataBuilder(),
  minResourceFee: '0',
  result: { auth: [], retval: sdk.xdr.ScVal.scvU32(count) },
});
const functionName = (tx: Transaction) => {
  const op = tx.operations[0];
  assert.ok(
    op?.type === 'invokeHostFunction' && op.func.type === 'hostFunctionTypeInvokeContract',
    'The read is not a contract call.',
  );
  return String(op.func.invokeContract.functionName);
};
function setup(row = 'X03', count = 12) {
  const directory = mkdtempSync(join(tmpdir(), 'cap85-regression-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const calls: string[] = [];
  const ctx: TestContext = {
    sdk,
    networkPassphrase: sdk.Networks.TESTNET,
    keys: { a: key, b: key, c: key },
    record() {},
    reconcile: async () => {
      calls.push('shared-hash');
    },
    assertClear() {
      calls.push('assert-clear');
    },
    sign() {
      assert.fail('no signature during reconciliation');
    },
    send() {
      assert.fail('no resubmission during reconciliation');
    },
    fund() {
      assert.fail('no funding during reconciliation');
    },
    rpc: {
      getTransaction: async (requested) => {
        assert.equal(requested, hash);
        calls.push('local-hash');
        return { status: 'SUCCESS', ledger: 10 };
      },
      getAccount: async () => new sdk.Account(key.publicKey, '1'),
      simulateTransaction: async (tx) => {
        assert.equal(functionName(tx), 'count');
        calls.push('counter-read');
        return counterResponse(count);
      },
    },
  };
  const state = loadState(ctx, base, manifest, file);
  state.inflight = {
    row,
    label: 'ping',
    key: `${row}:ping`,
    hash,
    counter_check: { target: C, who: key.publicKey, before: 10, increment: row === 'X02' ? 1 : 2 },
  };
  saveState(state);
  return { ctx, state, calls, file };
}
interface SavedCheckpoint {
  inflight?: { hash?: string };
  done: Record<string, unknown>;
  steps: Record<string, { count_after?: number; hash?: string } | undefined>;
}
const readCheckpoint = (file: string): SavedCheckpoint => JSON.parse(readFileSync(file, 'utf8'));

for (const [row, count] of [
  ['X02', 11],
  ['X03', 12],
] as const) {
  test(`${row}: SUCCESS recovery verifies and persists the original counter delta`, async () => {
    const { ctx, state, file } = setup(row, count);
    const result = await reconcileInflight(ctx, state);
    assert.ok(result?.outcome === 'reconciled');
    assert.equal(result.count_before, 10);
    assert.equal(result.count_after, count);
    const saved = readCheckpoint(file);
    assert.equal(saved.inflight, undefined);
    assert.equal(saved.steps[`${row}:ping`]?.count_after, count);
  });
  test(`${row}: a mismatched counter cannot become a passed cached step on restart`, async () => {
    const { ctx, state, file } = setup(row, 99);
    for (const current of [state, loadState(ctx, base, manifest, file)]) {
      await assert.rejects(reconcileInflight(ctx, current), /counter mismatch/);
      assert.equal(current.inflight?.hash, hash);
      assert.equal(current.steps[`${row}:ping`], undefined);
    }
    assert.equal(readCheckpoint(file).inflight?.hash, hash);
  });
}
test('SUCCESS without the original counter precondition fails closed', async () => {
  const { ctx, state } = setup();
  assert.ok(state.inflight);
  delete state.inflight.counter_check;
  await assert.rejects(reconcileInflight(ctx, state), /durable counter precondition/);
  assert.equal(state.inflight?.hash, hash);
  assert.deepEqual(state.steps, {});
});
test('startup queries both saved hashes and checks the counter before assertClear', async () => {
  const { ctx, state, calls } = setup();
  await prepareCap85(ctx, state);
  assert.deepEqual(calls, ['shared-hash', 'local-hash', 'counter-read', 'assert-clear']);
});
test('an unknown shared outcome stops before local recovery or assertClear', async () => {
  const { ctx, state, calls } = setup();
  ctx.reconcile = async () => {
    calls.push('shared-hash');
    throw new Error('unknown submission');
  };
  await assert.rejects(prepareCap85(ctx, state), /unknown submission/);
  assert.deepEqual(calls, ['shared-hash']);
  assert.equal(state.inflight?.hash, hash);
});
test('an unknown local outcome keeps the checkpoint and stops before assertClear', async () => {
  const { ctx, state, calls } = setup();
  ctx.rpc.getTransaction = async (requested) => {
    assert.equal(requested, hash);
    calls.push('local-hash');
    return { status: 'NOT_FOUND' };
  };
  await assert.rejects(prepareCap85(ctx, state), { code: 'unknown_submission' });
  assert.deepEqual(calls, ['shared-hash', 'local-hash']);
  assert.equal(state.inflight?.hash, hash);
});

// X06 restart boundaries. Each checkpoint is what an interruption inside X06 leaves: X01-X05 done, the
// target deployed, some adopt steps saved, and an optional marker. A restart reloads the checkpoint,
// runs startup reconciliation, then X06. Every X06 read, signature, and submission is recorded.
const X06_HASH = { 'adopt-ref': 'ab'.repeat(32), 'adopt-wasm': 'cd'.repeat(32) };
type Adopt = keyof typeof X06_HASH;
interface Marker {
  label: Adopt;
  sent: boolean;
}
async function restartX06(saved: Adopt[], marker?: Marker, status = 'SUCCESS') {
  const directory = mkdtempSync(join(tmpdir(), 'cap85-x06-'));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'state.json');
  const calls: string[] = [];
  const reached = (name: string) => async (): Promise<never> => {
    calls.push(name);
    assert.fail(`X06 reached ${name}`);
  };
  const testKey = { name: 'mock', publicKey: key.publicKey, rawPublicKey: Buffer.alloc(32, 7) };
  const ctx: Cap85Context = {
    sdk,
    networkPassphrase: sdk.Networks.TESTNET,
    keys: { a: testKey, b: testKey, c: testKey },
    record() {},
    reconcile: async () => {
      calls.push('shared-hash');
      return null;
    },
    assertClear() {
      calls.push('assert-clear');
    },
    signDigest: reached('signDigest'),
    sign: reached('sign'),
    send: reached('send'),
    fund: reached('fund'),
    rpc: {
      getTransaction: async (requested) => {
        calls.push(`lookup ${requested}`);
        return { status, ledger: 10 };
      },
      // The live read of `before`. It stops the run here so that no later X06 step starts.
      getContractData: async () => {
        calls.push('read executable');
        throw new Error('live before read');
      },
      getNetwork: reached('getNetwork'),
      getAccount: reached('getAccount'),
      simulateTransaction: reached('simulateTransaction'),
    },
  };
  const state = loadState(ctx, base, manifest, file);
  for (const id of ['X01', 'X02', 'X03', 'X04', 'X05']) state.done[id] = { title: id };
  state.contracts.manager = { id: manager, executable: { type: 'wasm' } };
  state.contracts.target_plain = { id: C, executable: { type: 'wasm' } };
  state.steps['X06:deploy-target_plain'] = { outcome: 'submitted', hash: '01'.repeat(32) };
  for (const label of saved) state.steps[`X06:${label}`] = { outcome: 'submitted', hash: X06_HASH[label] };
  if (marker) {
    const inflight: Inflight = { row: 'X06', label: marker.label, key: `X06:${marker.label}` };
    if (marker.sent) inflight.hash = X06_HASH[marker.label];
    state.inflight = inflight;
  }
  saveState(state);
  const restarted = loadState(ctx, base, manifest, file);
  await prepareCap85(ctx, restarted);
  return { ctx, restarted, file, calls, startup: [...calls] };
}
const incomplete: [string, Adopt[], Marker?, string?][] = [
  ['adopt-ref was sent and succeeded', [], { label: 'adopt-ref', sent: true }],
  ['adopt-ref was saved', ['adopt-ref']],
  ['adopt-wasm was marked but not sent', ['adopt-ref'], { label: 'adopt-wasm', sent: false }],
  ['adopt-wasm was sent and failed', ['adopt-ref'], { label: 'adopt-wasm', sent: true }, 'FAILED'],
  ['adopt-wasm was sent and succeeded', ['adopt-ref'], { label: 'adopt-wasm', sent: true }],
  ['adopt-wasm was saved', ['adopt-ref', 'adopt-wasm']],
];
for (const [name, saved, marker, status = 'SUCCESS'] of incomplete) {
  test(`X06 restart after ${name} stops with incomplete_evidence and no live read`, async () => {
    const { ctx, restarted, file, calls, startup } = await restartX06(saved, marker, status);
    const changed = marker?.sent && status === 'SUCCESS' ? [...saved, marker.label] : saved;
    const message = new RegExp(changed.map((label) => `${label} ${X06_HASH[label]}`).join(', '));
    await assert.rejects(x06(ctx, restarted, manifest), { code: 'incomplete_evidence', message });
    assert.deepEqual(calls, startup);
    const checkpoint = readCheckpoint(file);
    assert.equal(checkpoint.done.X06, undefined);
    for (const label of changed) assert.equal(checkpoint.steps[`X06:${label}`]?.hash, X06_HASH[label]);
  });
}
// Controls: no executable change reached the chain, so the live read of `before` is valid.
const unchanged: [string, Marker?, string?][] = [
  ['the target deploy'],
  ['an adopt-ref marker that was not sent', { label: 'adopt-ref', sent: false }],
  ['an adopt-ref that failed on chain', { label: 'adopt-ref', sent: true }, 'FAILED'],
];
for (const [name, marker, status] of unchanged) {
  test(`X06 restart after ${name} reads before from the unchanged target`, async () => {
    const { ctx, restarted, calls, startup } = await restartX06([], marker, status);
    await assert.rejects(x06(ctx, restarted, manifest), /live before read/);
    assert.deepEqual(calls, [...startup, 'read executable']);
  });
}
test('a checkpoint with done.X06 and saved adopt steps still loads', async () => {
  const { ctx, file } = await restartX06(['adopt-ref', 'adopt-wasm']);
  const state = loadState(ctx, base, manifest, file);
  state.done.X06 = { title: 'X06' };
  saveState(state);
  assert.deepEqual(loadState(ctx, base, manifest, file).done.X06, { title: 'X06' });
});

const validCreation = () => ({
  created: C,
  external_ref_creation_passes: { predicted: { contract: C } },
  created_instance_executable: { type: 'external_ref', owner: manager, tag: 'target' },
  created_version: 2,
  created_resolved_wasm: hash,
});
type Creation = ReturnType<typeof validCreation>;
test('X04 accepts the expected v2 executable and rejects each wrong identity or version', () => {
  assert.doesNotThrow(() => assertCreatedReference(validCreation(), manager, hash));
  const mutations: ((d: Creation) => void)[] = [
    (d) => (d.created = manager),
    (d) => (d.created_instance_executable.type = 'wasm'),
    (d) => (d.created_instance_executable.owner = C),
    (d) => (d.created_instance_executable.tag = 'other'),
    (d) => (d.created_version = 1),
    (d) => (d.created_resolved_wasm = 'cd'.repeat(32)),
  ];
  for (const mutate of mutations) {
    const details = validCreation();
    mutate(details);
    assert.throws(() => assertCreatedReference(details, manager, hash), /expected manager, tag, and v2/);
  }
});
