import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '@stellar/stellar-sdk';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { signTree, replaceAddress, corruptDelegateOrder, removeGLeafSignature, loadCheckpoint, saveCheckpoint, assertRejection, runCap71 } from './cap71.mjs';
import { addressCredentials } from './contracts.mjs';
import { UnknownSubmission } from './submission.mjs';

// Isolated mock keys. They never reach the live context or any network.
const pairs = Object.fromEntries(['a', 'b', 'c'].map((name, i) => [name, sdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, i + 71))]));
const keys = Object.fromEntries(Object.entries(pairs).map(([name, pair]) => [name, { name, publicKey: pair.publicKey(), rawPublicKey: pair.rawPublicKey() }]));
const contract = n => sdk.StrKey.encodeContract(Buffer.alloc(32, n));
const digest = bytes => createHash('sha256').update(bytes).digest();
const entry = () => new sdk.xdr.SorobanAuthorizationEntry({
  credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(new sdk.xdr.SorobanAddressCredentials({
    address: new sdk.Address(contract(1)).toScAddress(), nonce: 71n, signatureExpirationLedger: 0, signature: sdk.xdr.ScVal.scvVoid(),
  })), rootInvocation: new sdk.xdr.SorobanAuthorizedInvocation({
    function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs({
      contractAddress: new sdk.Address(contract(2)).toScAddress(), functionName: 'ping', args: [sdk.xdr.ScVal.scvU32(1)],
    })), subInvocations: [],
  }),
});
function context() {
  const events = [];
  return { sdk, keys, events, networkPassphrase: sdk.Networks.TESTNET, assertClear() {},
    record(id, status, details) { events.push({ id, status, ...details }); },
    async signDigest(key, payload) {
      assert.equal(events.at(-1).status, 'signing_requested');
      assert.equal(events.at(-1).digest, Buffer.from(payload).toString('hex'));
      assert.equal(digest(Buffer.from(events.at(-1).preimage_xdr, 'base64')).toString('hex'), events.at(-1).digest);
      return pairs[key.name].sign(payload);
    },
  };
}

test('native tree signs one shared root-bound digest and records before signing', async () => {
  const ctx = context();
  const delegates = [{ address: contract(3), nestedDelegates: [{ address: keys.a.publicKey }, { address: keys.c.publicKey }] }, { address: keys.a.publicKey }];
  const signed = await signTree(ctx, entry(), delegates, 200, 'offline', 28);
  assert.equal(signed.entry.credentials.type, 'sorobanCredentialsAddressWithDelegates');
  assert.equal(ctx.events.length, 2, 'A occurs twice but needs only one signing prompt');
  assert(ctx.events.every(e => e.root_address === contract(1) && e.expiration === 200 && e.protocol === 28));
  assert.equal(new Set(ctx.events.map(e => e.digest)).size, 1);
  const inspection = sdk.inspectAuthEntry(signed.entry);
  const signers = inspection.signers.filter(s => s.address.startsWith('G'));
  assert.equal(signers.length, 3);
  for (const signer of signers) {
    assert.equal(signer.signatures.length, 1);
    assert(sdk.Keypair.fromPublicKey(signer.address).verify(Buffer.from(signed.digest, 'hex'), signer.signatures[0].signature));
  }
  assert.equal(entry().credentials.type, 'sorobanCredentialsAddressV2');
});

test('SDK sorts tree levels and rejects duplicate delegates before signing', async () => {
  const ctx = context();
  await assert.rejects(signTree(ctx, entry(), [{ address: keys.a.publicKey }, { address: keys.a.publicKey }], 200, 'offline', 28), /duplicate delegate/);
  assert.equal(ctx.events.length, 0);
  const signed = await signTree(ctx, entry(), [{ address: keys.c.publicKey }, { address: keys.a.publicKey }], 200, 'offline', 28);
  const nodes = signed.entry.credentials.addressWithDelegates.delegates;
  assert(Buffer.compare(Buffer.from(nodes[0].address.toXdr()), Buffer.from(nodes[1].address.toXdr())) < 0);
});

test('gate failure prevents direct CAP71 signatures and evidence prompts', async () => {
  const ctx = context(); ctx.assertClear = () => { throw new UnknownSubmission('old', 'abcd', new Error('pending')); };
  await assert.rejects(signTree(ctx, entry(), [{ address: keys.a.publicKey }], 200, 'offline', 28), UnknownSubmission);
  assert.equal(ctx.events.length, 0);
});

test('native substitution changes the digest without changing nonce or invocation', async () => {
  const ctx = context();
  const signed = await signTree(ctx, entry(), [{ address: keys.a.publicKey }], 200, 'offline', 28);
  const replaced = replaceAddress(sdk, signed.entry, contract(4));
  assert.equal(addressCredentials(replaced).nonce, 71n);
  assert.deepEqual(replaced.rootInvocation.toXdr(), signed.entry.rootInvocation.toXdr());
  const hash = digest(sdk.buildAuthorizationEntryPreimage(replaced, 200, ctx.networkPassphrase).toXdr());
  assert.notEqual(hash.toString('hex'), signed.digest);
  assert(!pairs.a.verify(hash, Buffer.from(signed.signatures[0].signature_hex, 'hex')));
});

test('address_v2 same-key account substitution fails cryptographic verification', async () => {
  const ctx = context();
  const signed = await sdk.authorizeEntry(entry(), async (_preimage, payload) => ({ signatureScVal: sdk.xdr.ScVal.scvBytes(pairs.a.sign(payload)) }), 200, ctx.networkPassphrase);
  const replaced = replaceAddress(sdk, signed, contract(5));
  assert.equal(replaced.credentials.type, 'sorobanCredentialsAddressV2');
  const originalHash = digest(sdk.buildAuthorizationEntryPreimage(signed, 200, ctx.networkPassphrase).toXdr());
  const otherHash = digest(sdk.buildAuthorizationEntryPreimage(replaced, 200, ctx.networkPassphrase).toXdr());
  const signature = Buffer.from(sdk.scValToNative(addressCredentials(signed).signature));
  assert(pairs.a.verify(originalHash, signature));
  assert(!pairs.a.verify(otherHash, signature));
});

test('malformed order negatives preserve the signed payload at each tree level', async () => {
  const ctx = context();
  for (const nested of [false, true]) {
    const leaves = [{ address: keys.a.publicKey }, { address: keys.c.publicKey }];
    const tree = nested ? [{ address: contract(3), nestedDelegates: leaves }] : leaves;
    const signed = await signTree(ctx, entry(), tree, 200, 'offline', 28);
    for (const mode of ['duplicate', 'unordered']) {
      const bad = corruptDelegateOrder(sdk, signed.entry, mode, nested);
      const nodes = nested ? bad.credentials.addressWithDelegates.delegates[0].nestedDelegates : bad.credentials.addressWithDelegates.delegates;
      assert.equal(nodes.length, mode === 'duplicate' ? 3 : 2);
      assert.equal(digest(sdk.buildAuthorizationEntryPreimage(bad, 200, ctx.networkPassphrase).toXdr()).toString('hex'), signed.digest);
    }
  }
});

test('missing G signature preserves the present delegate and every signed payload field', async () => {
  const ctx = context();
  const signed = await signTree(ctx, entry(), [{ address: keys.a.publicKey }], 200, 'offline', 28);
  const bad = removeGLeafSignature(sdk, signed.entry);
  const nodes = bad.credentials.addressWithDelegates.delegates;
  assert.equal(nodes.length, 1);
  assert.equal(sdk.Address.fromScAddress(nodes[0].address).toString(), keys.a.publicKey);
  assert.equal(nodes[0].signature.type, 'scvVec');
  assert.equal(nodes[0].signature.vec.length, 0);
  assert.deepEqual(addressCredentials(bad).toXdr(), addressCredentials(signed.entry).toXdr());
  assert.deepEqual(bad.rootInvocation.toXdr(), signed.entry.rootInvocation.toXdr());
  assert.equal(digest(sdk.buildAuthorizationEntryPreimage(bad, 200, ctx.networkPassphrase).toXdr()).toString('hex'), signed.digest);
  assert.equal(sdk.inspectAuthEntry(signed.entry).signers.find(n => n.address === keys.a.publicKey).signatures.length, 1);
  assert.throws(() => assertRejection(sdk, { error: 'Error(Auth, InvalidAction)\nError(Contract, #5)\nsignature weight is lower than threshold' }, {
    code: 'Error(Contract, #5)', reason: 'no account signatures found',
  }));
});

test('error oracle checks exact contract code and duplicate diagnostic', () => {
  const simulation = (error, reason = '') => ({ error, events: [{ event: { body: { v0: {
    topics: [sdk.xdr.ScVal.scvError(sdk.xdr.ScError.sceContract(7101))], data: sdk.xdr.ScVal.scvString(reason),
  } } } }] });
  assertRejection(sdk, simulation('Error(Auth, InvalidAction)'), { code: 'Error(Contract, #7101)' });
  assert.throws(() => assertRejection(sdk, simulation('Error(Auth, InvalidAction)'), { code: 'Error(Contract, #7102)' }));
  assert.throws(() => assertRejection(sdk, simulation('Error(Auth, InvalidInput)', 'signature has expired'), {
    code: 'Error(Auth, InvalidInput)', reason: 'delegated signers contain duplicate address',
  }));
  assertRejection(sdk, simulation('Error(Auth, InvalidInput)', 'delegated signers contain duplicate address'), {
    code: 'Error(Auth, InvalidInput)', reason: 'delegated signers contain duplicate address',
  });
});

test('checkpoint fails closed on corruption, binding change, and interrupted submission', t => {
  const dir = mkdtempSync(join(tmpdir(), 'cap71-checkpoint-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'checkpoint.json'); const binding = { network: 'test', keys: ['A'], artifacts: { file: 'hash' } };
  const state = loadCheckpoint(file, binding);
  state.steps.old = { hash: 'original' };
  saveCheckpoint(file, state);
  assert.deepEqual(loadCheckpoint(file, binding).steps.old, { hash: 'original' });
  assert.deepEqual(readdirSync(dir), ['checkpoint.json']);
  assert.throws(() => loadCheckpoint(file, { ...binding, network: 'other' }), /mismatch|changed/);
  state.inflight = { label: 'uncertain', hash: 'original' }; saveCheckpoint(file, state);
  assert.throws(() => loadCheckpoint(file, binding), e => e instanceof UnknownSubmission && e.hash === 'original');
  writeFileSync(file, '{');
  assert.throws(() => loadCheckpoint(file, binding), SyntaxError);
  assert.equal(readFileSync(file, 'utf8'), '{');
});

test('setup performs enforce simulation and stops before any envelope signing on failure', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cap71-enforce-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = context();
  ctx.cap71Checkpoint = join(dir, 'state.json');
  const modes = []; let signCount = 0;
  ctx.rpc = {
    async getVersionInfo() { return { protocolVersion: 28 }; },
    async getAccount() { return new sdk.Account(keys.a.publicKey, '1'); },
    async simulateTransaction(tx, _resources, mode) {
      modes.push(mode);
      assert.equal(tx.operations[0].func.type, 'hostFunctionTypeUploadContractWasm');
      if (mode === 'enforce') return { error: 'offline enforced rejection' };
      return { latestLedger: 100, result: { auth: [], retval: sdk.xdr.ScVal.scvVoid() } };
    },
  };
  ctx.sign = async () => { signCount++; throw new Error('Must not sign'); };
  ctx.send = async () => { throw new Error('Must not send'); };
  await assert.rejects(runCap71(ctx), /enforce failed: offline enforced rejection/);
  assert.deepEqual(modes, ['record', 'enforce']);
  assert.equal(signCount, 0);
});

test('unknown row IDs fail before RPC, signing, or checkpoint access', async () => {
  const ctx = { rows: ['CAP71-1'] };
  await assert.rejects(runCap71(ctx), /Unknown CAP71 row: CAP71-1/);
});

test('mocked setup and native calls enforce before signing; restart reuses confirmed steps', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cap71-run-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx = context(); ctx.cap71Checkpoint = join(dir, 'state.json'); ctx.rows = ['CAP71-01'];
  ctx.sdk = { ...sdk, rpc: { ...sdk.rpc, assembleTransaction: tx => ({ build: () => tx }) } };
  const enforced = new Map(); const counts = new Map(); let nonce = 1n; let sends = 0;
  ctx.rpc = {
    async getVersionInfo() { return { protocolVersion: 28 }; },
    async getAccount() { return new sdk.Account(keys.a.publicKey, '1'); },
    async simulateTransaction(tx, _resources, mode) {
      const op = tx.operations[0]; const func = op.func;
      let retval; let auth = []; let effect;
      if (func.type === 'hostFunctionTypeUploadContractWasm') retval = sdk.xdr.ScVal.scvBytes(Buffer.alloc(32));
      else if (func.type === 'hostFunctionTypeCreateContractV2') retval = new sdk.Address(sdk.StrKey.encodeContract(digest(func.toXdr()))).toScVal();
      else {
        const call = func.invokeContract;
        const method = call.functionName.toString();
        const who = sdk.scValToNative(call.args[0]);
        if (method === 'count') retval = sdk.xdr.ScVal.scvU32(counts.get(who) ?? 0);
        else {
          assert.equal(method, 'ping');
          retval = sdk.xdr.ScVal.scvU32((counts.get(who) ?? 0) + 1);
          if (mode === 'record') auth = [new sdk.xdr.SorobanAuthorizationEntry({
            credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(new sdk.xdr.SorobanAddressCredentials({
              address: new sdk.Address(who).toScAddress(), nonce: nonce++, signatureExpirationLedger: 0, signature: sdk.xdr.ScVal.scvVoid(),
            })), rootInvocation: new sdk.xdr.SorobanAuthorizedInvocation({
              function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs({
                contractAddress: call.contractAddress, functionName: 'ping', args: [sdk.xdr.ScVal.scvU32(1)],
              })), subInvocations: [],
            }),
          })];
          else {
            assert.equal(op.auth.length, 1);
            const authEntry = op.auth[0];
            assert.equal(authEntry.credentials.type, 'sorobanCredentialsAddressWithDelegates');
            const hash = digest(sdk.buildAuthorizationEntryPreimage(authEntry, addressCredentials(authEntry).signatureExpirationLedger, ctx.networkPassphrase).toXdr());
            for (const node of sdk.inspectAuthEntry(authEntry).signers.filter(n => n.address.startsWith('G'))) {
              assert(sdk.Keypair.fromPublicKey(node.address).verify(hash, node.signatures[0].signature));
            }
            effect = () => counts.set(who, (counts.get(who) ?? 0) + 1);
          }
        }
      }
      if (mode === 'enforce') enforced.set(Buffer.from(tx.hash()).toString('hex'), effect);
      return { latestLedger: 100, result: { retval, auth } };
    },
  };
  ctx.sign = async (tx, key) => {
    const hash = Buffer.from(tx.hash()).toString('hex');
    assert(enforced.has(hash));
    assert.equal(ctx.events.at(-1).digest, hash);
    assert.equal(digest(Buffer.from(ctx.events.at(-1).preimage_xdr, 'base64')).toString('hex'), hash);
    tx.sign(pairs[key.name]); return tx;
  };
  ctx.send = async tx => {
    const hash = Buffer.from(tx.hash()).toString('hex');
    assert(enforced.has(hash)); enforced.get(hash)?.(); sends++;
    return { hash, status: 'SUCCESS', ledger: 100 };
  };
  const result = await runCap71(ctx);
  assert.equal(sends, 12);
  assert(result.done['CAP71-01']);
  assert.equal(Object.values(result.checks).length, 2);
  assert.equal(result.inflight, undefined);
  await runCap71(ctx);
  assert.equal(sends, 12, 'Restart must not sign or send a confirmed step again');

  await t.test('malicious RPC roots and unexpected subinvocations cause zero signing requests', async () => {
    const simulate = ctx.rpc.simulateTransaction;
    const savedState = JSON.stringify(result);
    let signDigestCalls = 0; let envelopeCalls = 0;
    ctx.signDigest = async () => { signDigestCalls++; throw new Error('Must not sign malicious auth'); };
    ctx.sign = async () => { envelopeCalls++; throw new Error('Must not sign an envelope'); };
    for (const row of ['CAP71-01', 'CAP71-12']) {
      ctx.rows = [row];
      for (const mutation of ['contract', 'method', 'amount', 'extra-argument', 'subinvocation']) {
        const reset = JSON.parse(savedState);
        delete reset.done['CAP71-01'];
        for (const label of ['CAP71-direct-a', 'CAP71-direct-c']) { delete reset.steps[label]; delete reset.checks[label]; }
        saveCheckpoint(ctx.cap71Checkpoint, reset);
        ctx.rpc.simulateTransaction = async (tx, resources, mode) => {
          const simulation = await simulate(tx, resources, mode);
          if (mode !== 'record' || !simulation.result.auth.length) return simulation;
          const original = simulation.result.auth[0];
          const root = original.rootInvocation;
          const fn = root.function.contractFn;
          const fields = { ...fn };
          if (mutation === 'contract') fields.contractAddress = new sdk.Address(contract(99)).toScAddress();
          if (mutation === 'method') fields.functionName = 'drain';
          if (mutation === 'amount') fields.args = [sdk.xdr.ScVal.scvU32(999)];
          if (mutation === 'extra-argument') fields.args = [...fn.args, new sdk.Address(keys.a.publicKey).toScVal()];
          simulation.result.auth = [new sdk.xdr.SorobanAuthorizationEntry({ credentials: original.credentials,
            rootInvocation: new sdk.xdr.SorobanAuthorizedInvocation({
              function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs(fields)),
              subInvocations: mutation === 'subinvocation' ? [root] : [],
            }),
          })];
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
