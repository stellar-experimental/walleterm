import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  SorobanDataBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { addressCredentials, attachAuthSignature, inspectAuthEntry } from '../sdk/authorization.ts';
import {
  DEMO_WASM,
  assembleAuthorizedContract,
  deployment,
  hex,
  prepareContract,
  validateContractReview,
  verifyContractResult,
} from './site/contracts.ts';
import type { DemoRpc } from './site/contracts.ts';

// Isolated mock keys. This suite makes no network calls and requests no 1Password signatures.
function fixture({
  accountExists = true,
  targetExists = true,
  codeExists = true,
  badOwner = false,
  badRoot = false,
} = {}) {
  const key = Keypair.random(),
    signer = key.publicKey();
  const accountId = deployment(signer, 'account').id,
    targetId = deployment(signer, 'target').id;
  let sequence = '1',
    count = 4;
  const calls: { method: string; mode?: string }[] = [];
  const success = (
    retval: xdr.ScVal,
    auth: xdr.SorobanAuthorizationEntry[] = [],
  ): rpc.Api.SimulateTransactionSuccessResponse => ({
    id: '1',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: new SorobanDataBuilder().setResources(100000, 0, 1000).setResourceFee('500'),
    minResourceFee: '500',
    result: { retval, auth },
  });
  const server: DemoRpc = {
    getAccount: async () => new Account(signer, sequence),
    getLedgerEntries: async (...keys) => {
      const ledgerKey = keys[0];
      if (ledgerKey.type === 'contractCode')
        return {
          latestLedger: 100,
          entries: codeExists
            ? [
                {
                  key: ledgerKey,
                  val: xdr.LedgerEntryData.contractCode(
                    new xdr.ContractCodeEntry({
                      ext: xdr.ContractCodeEntryExt.v0(),
                      hash: ledgerKey.contractCode.hash,
                      code: new Uint8Array(),
                    }),
                  ),
                },
              ]
            : [],
        };
      assert.equal(ledgerKey.type, 'contractData');
      if (ledgerKey.type !== 'contractData') throw Error('Unexpected ledger key.');
      const id = Address.fromScAddress(ledgerKey.contractData.contract).toString();
      const exists = id === accountId ? accountExists : targetExists;
      return {
        latestLedger: 100,
        entries: exists
          ? [
              {
                key: ledgerKey,
                val: xdr.LedgerEntryData.contractData(
                  new xdr.ContractDataEntry({
                    ext: xdr.ExtensionPoint.v0(),
                    contract: ledgerKey.contractData.contract,
                    key: xdr.ScVal.scvLedgerKeyContractInstance(),
                    durability: xdr.ContractDataDurability.persistent,
                    val: xdr.ScVal.scvContractInstance(
                      new xdr.ScContractInstance({
                        storage: null,
                        executable: xdr.ContractExecutable.contractExecutableWasm(
                          Uint8Array.from(
                            (id === accountId ? DEMO_WASM.account.hash : DEMO_WASM.target.hash).match(/../g)!,
                            (pair) => parseInt(pair, 16),
                          ),
                        ),
                      }),
                    ),
                  }),
                ),
              },
            ]
          : [],
      };
    },
    simulateTransaction: async (transaction, _resources, mode) => {
      if ('innerTransaction' in transaction) throw Error('Unexpected fee bump.');
      const op = transaction.operations[0];
      if (op.type !== 'invokeHostFunction') throw Error('Unexpected operation.');
      const fn = op.func;
      if (fn.type === 'hostFunctionTypeInvokeContract') {
        const name = fn.invokeContract.functionName.toString();
        calls.push({ method: name, mode });
        if (name === 'owner')
          return success(xdr.ScVal.scvBytes((badOwner ? Keypair.random() : key).rawPublicKey()));
        if (name === 'count') return success(xdr.ScVal.scvU32(count));
        const root = new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
              ...fn.invokeContract,
              args: badRoot
                ? [nativeToScVal(accountId, { type: 'address' }), xdr.ScVal.scvU32(99)]
                : fn.invokeContract.args,
            }),
          ),
          subInvocations: [],
        });
        const auth =
          mode === 'record'
            ? [
                new xdr.SorobanAuthorizationEntry({
                  rootInvocation: root,
                  credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
                    new xdr.SorobanAddressCredentials({
                      address: new Address(accountId).toScAddress(),
                      nonce: 17n,
                      signatureExpirationLedger: 0,
                      signature: xdr.ScVal.scvVoid(),
                    }),
                  ),
                }),
              ]
            : op.auth || [];
        if (mode === 'enforce')
          assert.ok(auth.every((entry) => addressCredentials(entry).signature.type !== 'scvVoid'));
        return success(xdr.ScVal.scvU32(count + 1), auth);
      }
      calls.push({ method: fn.type, mode });
      if (fn.type === 'hostFunctionTypeCreateContractV2') {
        const root = new xdr.SorobanAuthorizedInvocation({
          function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
            fn.createContractV2,
          ),
          subInvocations: [],
        });
        return success(
          new Address(accountId).toScVal(),
          mode === 'record'
            ? [
                new xdr.SorobanAuthorizationEntry({
                  rootInvocation: root,
                  credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
                }),
              ]
            : op.auth,
        );
      }
      return success(xdr.ScVal.scvVoid());
    },
    getLatestLedger: async () => {
      throw Error('This test does not read the network.');
    },
    sendTransaction: async () => {
      throw Error('This test never submits.');
    },
    getTransaction: async () => {
      throw Error('This test never reads live transactions.');
    },
  };
  return {
    key,
    signer,
    server,
    calls,
    setSequence(value: string) {
      sequence = value;
    },
    setCount(value: number) {
      count = value;
    },
  };
}
const loadWasm = async (file: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/wasm/${file}`, import.meta.url)));

test('counter preparation requires an explicit custom account entry and does not request any signature', async () => {
  const f = fixture();
  const { review, transaction } = await prepareContract(f.server, f.signer, true, loadWasm);
  assert.equal(review.before, 4);
  assert.equal(review.authorizationReady, false);
  assert.equal(review.authorizations.length, 1);
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(review.authorizations[0].xdr, 'base64');
  assert.equal(entry.credentials.type, 'sorobanCredentialsAddressV2');
  assert.equal(Address.fromScAddress(addressCredentials(entry).address).toString(), review.accountId);
  assert.equal(addressCredentials(entry).nonce, 17n);
  assert.equal(addressCredentials(entry).signatureExpirationLedger, 160);
  assert.equal(addressCredentials(entry).signature.type, 'scvVoid');
  validateContractReview(transaction.toXDR(), f.signer, review);
  assert.ok(f.calls.some((call) => call.method === 'ping' && call.mode === 'record'));
});

test('explicit authorization signing precedes enforcing simulation and outer transaction signing', async () => {
  const f = fixture();
  const { review, transaction } = await prepareContract(f.server, f.signer, true, loadWasm);
  await assert.rejects(assembleAuthorizedContract(f.server, transaction.toXDR(), review), /Sign each/);
  const authorization = review.authorizations[0];
  const input = {
    auth_entry_xdr: authorization.xdr,
    public_key: f.signer,
    address: review.accountId,
    network_passphrase: Networks.TESTNET,
    adapter: { type: 'contract-ed25519' as const },
  };
  const checked = inspectAuthEntry(input, f.signer);
  assert.notEqual(hex(checked.digest), hex(transaction.hash()));
  authorization.xdr = attachAuthSignature(input, f.signer, hex(f.key.sign(checked.digest)));
  authorization.signed = true;
  const final = await assembleAuthorizedContract(f.server, transaction.toXDR(), review);
  review.authorizationReady = true;
  validateContractReview(final.toXDR(), f.signer, review);
  assert.equal(final.signatures.length, 0);
  assert.ok(f.calls.some((call) => call.method === 'ping' && call.mode === 'enforce'));
  final.sign(f.key);
  assert.equal(final.signatures.length, 1);
  assert.ok(f.key.verify(final.hash(), final.signatures[0].signature.toBytes()));
  f.setCount(5);
  assert.deepEqual(await verifyContractResult(f.server, f.signer, review), {
    count_before: 4,
    count_after: 5,
    account: review.accountId,
    contract: review.targetId,
  });
});

test('contract setup constructs fresh AddressV2 deployment authorization instead of signing the source optimization', async () => {
  const f = fixture({ accountExists: false, targetExists: false });
  const first = await prepareContract(f.server, f.signer, false, loadWasm);
  const second = await prepareContract(f.server, f.signer, false, loadWasm);
  assert.equal(first.review.stage, 'deploy-account');
  const a = xdr.SorobanAuthorizationEntry.fromXDR(first.review.authorizations[0].xdr, 'base64');
  const b = xdr.SorobanAuthorizationEntry.fromXDR(second.review.authorizations[0].xdr, 'base64');
  assert.equal(a.credentials.type, 'sorobanCredentialsAddressV2');
  assert.notEqual(addressCredentials(a).nonce, addressCredentials(b).nonce);
  assert.equal(Address.fromScAddress(addressCredentials(a).address).toString(), f.signer);
  validateContractReview(first.transaction.toXDR(), f.signer, first.review);
});

test('missing WASM uses a verified upload step without any contract authorization', async () => {
  const f = fixture({ accountExists: false, targetExists: false, codeExists: false });
  const prepared = await prepareContract(f.server, f.signer, false, loadWasm);
  assert.equal(prepared.review.stage, 'upload-account');
  assert.deepEqual(prepared.review.authorizations, []);
  assert.equal(prepared.review.authorizationReady, true);
  validateContractReview(prepared.transaction.toXDR(), f.signer, prepared.review);
  await assert.rejects(
    prepareContract(f.server, f.signer, false, async () => new Uint8Array([0])),
    /file failed verification/,
  );
});

test('demo rejects another owner, a different authorization tree, and changed account sequence', async () => {
  const owner = fixture({ badOwner: true });
  await assert.rejects(prepareContract(owner.server, owner.signer, true, loadWasm), /different signer/);
  const root = fixture({ badRoot: true });
  await assert.rejects(prepareContract(root.server, root.signer, true, loadWasm), /differs from/);
  const f = fixture(),
    prepared = await prepareContract(f.server, f.signer, true, loadWasm);
  prepared.review.authorizations[0].signed = true;
  f.setSequence('2');
  await assert.rejects(
    assembleAuthorizedContract(f.server, prepared.transaction.toXDR(), prepared.review),
    /sequence changed/,
  );
});

test('saved reviews reject changed signers, contract IDs, counter actions, and unsigned completed authorizations', async () => {
  const f = fixture(),
    { review, transaction } = await prepareContract(f.server, f.signer, true, loadWasm);
  assert.throws(
    () => validateContractReview(transaction.toXDR(), Keypair.random().publicKey(), review),
    /different signer/,
  );
  assert.throws(
    () => validateContractReview(transaction.toXDR(), f.signer, { ...review, targetId: review.accountId }),
    /different signer/,
  );
  assert.throws(
    () => validateContractReview(transaction.toXDR(), f.signer, { ...review, authorizationReady: true }),
    /differs/,
  );
  assert.throws(
    () => validateContractReview(transaction.toXDR(), f.signer, { ...review, before: -1 }),
    /counter action/,
  );
  f.setCount(6);
  await assert.rejects(verifyContractResult(f.server, f.signer, review), /differs from/);
});

test('unfinished reviews bind the exact authorization nonce and expiry', async () => {
  const f = fixture(),
    prepared = await prepareContract(f.server, f.signer, true, loadWasm);
  const original = xdr.SorobanAuthorizationEntry.fromXDR(prepared.review.authorizations[0].xdr, 'base64');
  for (const changes of [{ nonce: 18n }, { signatureExpirationLedger: 1 }]) {
    const review = structuredClone(prepared.review);
    review.authorizations[0].xdr = new xdr.SorobanAuthorizationEntry({
      rootInvocation: original.rootInvocation,
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
        new xdr.SorobanAddressCredentials({
          ...addressCredentials(original),
          ...changes,
        }),
      ),
    }).toXdr('base64');
    assert.throws(
      () => validateContractReview(prepared.transaction.toXDR(), f.signer, review),
      /identity differs/,
    );
  }
});

test('deployment confirmation requires the requested deployed instance', async () => {
  for (const stage of ['deploy-account', 'deploy-target'] as const) {
    const f = fixture({ accountExists: false, targetExists: false });
    await assert.rejects(
      verifyContractResult(f.server, f.signer, {
        stage,
        accountId: deployment(f.signer, 'account').id,
        targetId: deployment(f.signer, 'target').id,
        authorizations: [],
        authorizationReady: true,
      }),
      /not visible/,
    );
  }
});
