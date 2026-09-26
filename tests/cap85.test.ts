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
} from './cap85.ts';
import type { Transaction, rpc } from '@stellar/stellar-sdk';
import type { Cap85Context, PrepareContext } from './cap85.ts';

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
  steps: Record<string, { count_after?: number } | undefined>;
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
