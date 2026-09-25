// Native CAP-71 acceptance. Importing this module never starts network or signing work.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addressCredentials, accountSignature } from './contracts.mjs';
import { UnknownSubmission } from './submission.mjs';

const STATE = new URL('../evidence/live/cap71-state.json', import.meta.url);
const WASM = new URL('../fixtures/cap71/target/wasm32v1-none/release/', import.meta.url);
const FILES = ['cap71_delegate.wasm', 'cap71_raw_account.wasm', 'cap71_target.wasm'];
const ROW_IDS = Array.from({ length: 12 }, (_, i) => `CAP71-${String(i + 1).padStart(2, '0')}`);
const sha = b => createHash('sha256').update(b).digest();
const addr = (sdk, a) => new sdk.Address(a).toScVal();
const u32 = (sdk, n) => sdk.xdr.ScVal.scvU32(n);
const clone = (sdk, e) => sdk.xdr.SorobanAuthorizationEntry.fromXdr(e.toXdr());
const stringify = x => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? String(v) : v, 2);

export function loadCheckpoint(file, binding) {
  let state;
  try { state = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { version: 1, binding, salts: {}, steps: {}, checks: {}, done: {} };
  }
  assert.equal(state.version, 1, 'CAP71 checkpoint version mismatch');
  assert.deepEqual(state.binding, binding, 'CAP71 checkpoint keys, network, or WASM changed');
  for (const k of ['salts', 'steps', 'checks', 'done']) assert(state[k] && typeof state[k] === 'object' && !Array.isArray(state[k]), `Invalid checkpoint ${k}`);
  if (state.inflight) throw new UnknownSubmission(state.inflight.label, state.inflight.hash,
    new Error('CAP71 checkpoint has an unresolved step. Reconcile its original hash and review this checkpoint before continuation.'));
  return state;
}

export function saveCheckpoint(file, state) {
  const path = file instanceof URL ? fileURLToPath(file) : file;
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, stringify(state) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path);
  const directory = openSync(dirname(path), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

// Used only by explicit negative cases. SDK XDR values are immutable.
export function replaceAddress(sdk, entry, address) {
  const old = addressCredentials(entry);
  const next = new sdk.xdr.SorobanAddressCredentials({ ...old, address: new sdk.Address(address).toScAddress() });
  const credentials = entry.credentials.type === 'sorobanCredentialsAddressWithDelegates'
    ? sdk.xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(new sdk.xdr.SorobanAddressCredentialsWithDelegates({
      addressCredentials: next, delegates: entry.credentials.addressWithDelegates.delegates,
    })) : sdk.xdr.SorobanCredentials[entry.credentials.type](next);
  return new sdk.xdr.SorobanAuthorizationEntry({ rootInvocation: entry.rootInvocation, credentials });
}

export function corruptDelegateOrder(sdk, entry, mode, nested = false) {
  const old = entry.credentials.addressWithDelegates;
  const change = nodes => mode === 'duplicate' ? [nodes[0], ...nodes] : [...nodes].reverse();
  let delegates = old.delegates;
  if (nested) {
    assert.equal(delegates.length, 1);
    delegates = [new sdk.xdr.SorobanDelegateSignature({ ...delegates[0], nestedDelegates: change(delegates[0].nestedDelegates) })];
  } else delegates = change(delegates);
  return new sdk.xdr.SorobanAuthorizationEntry({ rootInvocation: entry.rootInvocation,
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(new sdk.xdr.SorobanAddressCredentialsWithDelegates({
      addressCredentials: old.addressCredentials, delegates,
    })),
  });
}

export function removeGLeafSignature(sdk, entry) {
  const old = entry.credentials.addressWithDelegates;
  assert.equal(old.delegates.length, 1);
  const leaf = old.delegates[0];
  assert(sdk.Address.fromScAddress(leaf.address).toString().startsWith('G'));
  assert.equal(leaf.nestedDelegates.length, 0);
  return new sdk.xdr.SorobanAuthorizationEntry({ rootInvocation: entry.rootInvocation,
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(new sdk.xdr.SorobanAddressCredentialsWithDelegates({
      addressCredentials: old.addressCredentials,
      delegates: [new sdk.xdr.SorobanDelegateSignature({ ...leaf, signature: sdk.xdr.ScVal.scvVec([]) })],
    })),
  });
}

export async function signTree(ctx, entry, delegates, expiration, label, protocol) {
  const { sdk } = ctx;
  let signed = sdk.buildWithDelegatesEntry({ entry, delegates, validUntilLedgerSeq: expiration });
  const evidence = [];
  const visit = nodes => nodes.flatMap(n => [n.address, ...visit(n.nestedDelegates ?? [])]);
  // One public key can occur at different levels. SDK writes every matching node.
  for (const address of new Set(visit(delegates).filter(a => a.startsWith('G')))) {
    const key = Object.values(ctx.keys).find(k => k.publicKey === address);
    assert(key, `No dedicated public key for ${address}`);
    ctx.assertClear();
    signed = await sdk.authorizeEntry(signed, async (preimage, payload) => {
      const info = { scheme: 'CAP71-native', protocol, root_address: sdk.Address.fromScAddress(addressCredentials(signed).address).toString(),
        signer: address, credential_type: signed.credentials.type, preimage_type: preimage.type,
        nonce: String(addressCredentials(signed).nonce), expiration, preimage_xdr: preimage.toXdr('base64'), digest: Buffer.from(payload).toString('hex') };
      assert.equal(preimage.type, 'envelopeTypeSorobanAuthorizationWithAddress');
      assert.equal(Buffer.from(payload).length, 32);
      assert.equal(sha(preimage.toXdr()).toString('hex'), info.digest);
      ctx.record(`${label}:auth`, 'signing_requested', info); // Durable before the approval prompt.
      const signature = await ctx.signDigest(key, Buffer.from(payload));
      assert(sdk.Keypair.fromPublicKey(address).verify(payload, signature), 'Invalid delegate signature');
      evidence.push({ ...info, signature_hex: Buffer.from(signature).toString('hex') });
      return { signatureScVal: accountSignature(sdk, [{ rawKey: key.rawPublicKey, signature }]) };
    }, expiration, ctx.networkPassphrase, address);
  }
  // Empty delegate sets still need their unsigned, address-bound payload recorded.
  const preimage = sdk.buildAuthorizationEntryPreimage(signed, expiration, ctx.networkPassphrase);
  return { entry: signed, signatures: evidence, preimage_xdr: preimage.toXdr('base64'), digest: sha(preimage.toXdr()).toString('hex') };
}

export function errorText(sdk, simulation) {
  let text = String(simulation.error ?? '');
  const errors = value => {
    if (value?.type === 'scvError') {
      const error = value.value;
      text += error.type === 'sceContract' ? `\nError(Contract, #${error.value})`
        : `\nError(${error.type.slice(3)}, ${error.value.name.slice(4)})`;
    }
    if (value?.type === 'scvVec') (value.vec ?? []).forEach(errors);
    if (value?.type === 'scvMap') (value.map ?? []).forEach(pair => { errors(pair.key); errors(pair.val); });
  };
  for (const raw of simulation.events ?? []) {
    const event = typeof raw === 'string' ? sdk.xdr.DiagnosticEvent.fromXdr(raw, 'base64') : raw;
    // Include topics: contract error codes can occur there, not in the data.
    const body = event.event.body.v0;
    body.topics.forEach(errors); errors(body.data);
    text += '\n' + stringify({ topics: body.topics.map(x => sdk.scValToNative(x)), data: sdk.scValToNative(body.data) });
  }
  return text;
}

export function assertRejection(sdk, simulation, expected) {
  assert(sdk.rpc.Api.isSimulationError(simulation), 'Expected enforce simulation rejection');
  const text = errorText(sdk, simulation);
  assert(text.includes(expected.code), `Expected ${expected.code}, got ${text}`);
  if (expected.reason) assert(text.includes(expected.reason), `Expected diagnostic ${expected.reason}, got ${text}`);
  const top = String(simulation.error).match(/^(?:HostError: )?(Error\([^)]*\))/)?.[1];
  assert([expected.code, 'Error(Auth, InvalidAction)'].includes(top), `Unexpected top-level error ${top}`);
  return text;
}

export async function runCap71(ctx) {
  const selected = new Set((ctx.rows ?? process.env.WALLETERM_ROWS?.split(',') ?? ROW_IDS).map(s => s.trim()));
  for (const id of selected) assert(ROW_IDS.includes(id), `Unknown CAP71 row: ${id}`);
  const { sdk, rpc, keys } = ctx;
  ctx.assertClear();
  assert.equal(ctx.networkPassphrase, sdk.Networks.TESTNET, 'CAP71 accepts testnet only');
  const version = await rpc.getVersionInfo();
  assert(Number(version.protocolVersion) >= 27, 'CAP71 needs protocol 27 or later');
  const protocol = Number(version.protocolVersion);
  const artifacts = Object.fromEntries(FILES.map(file => [file, sha(readFileSync(new URL(file, WASM))).toString('hex')]));
  const binding = { network: ctx.networkPassphrase, keys: ['a', 'b', 'c'].map(k => keys[k].publicKey), artifacts };
  const checkpoint = ctx.cap71Checkpoint ?? STATE; // Offline tests use a temporary directory.
  const state = loadCheckpoint(checkpoint, binding);
  const save = () => saveCheckpoint(checkpoint, state);
  save();

  const txFor = async operation => new sdk.TransactionBuilder(await rpc.getAccount(keys.a.publicKey), {
    fee: sdk.BASE_FEE, networkPassphrase: ctx.networkPassphrase,
  }).addOperation(operation).setTimeout(120).build();
  const simFor = async (operation, mode = 'record') => {
    const tx = await txFor(operation);
    return { tx, sim: await rpc.simulateTransaction(tx, undefined, mode) };
  };
  const count = async (target, who) => {
    const { sim } = await simFor(new sdk.Contract(target).call('count', addr(sdk, who)));
    assert(!sdk.rpc.Api.isSimulationError(sim), `Count failed: ${sim.error}`);
    return Number(sdk.scValToNative(sim.result.retval));
  };

  // The separate inflight checkpoint also blocks a crash after guard clearance.
  // A human must reconcile that original hash and complete the saved step explicitly.
  async function submit(label, tx, sim, details) {
    ctx.assertClear();
    assert(!sdk.rpc.Api.isSimulationError(sim), `${label}: enforce failed: ${sim.error}`);
    const prepared = sdk.rpc.assembleTransaction(tx, sim).build();
    const hash = Buffer.from(prepared.hash()).toString('hex');
    ctx.record(`${label}:envelope`, 'signing_requested', { protocol, hash, envelope_xdr: prepared.toXDR(),
      preimage_xdr: Buffer.from(prepared.signatureBase()).toString('base64'), digest: hash });
    await ctx.sign(prepared, keys.a);
    state.inflight = { label, hash, envelope_xdr: prepared.toXDR(), ...details };
    save();
    const sent = await ctx.send(prepared, label);
    assert.equal(sent.status, 'SUCCESS');
    const receipt = { ...details, protocol, hash: sent.hash, ledger: sent.ledger, envelope_xdr: prepared.toXDR(), outcome: 'submitted' };
    state.steps[label] = receipt;
    delete state.inflight;
    save();
    return receipt;
  }

  async function sourceOnly(label, operation) {
    if (state.steps[label]) return state.steps[label];
    const { tx: recordedTx, sim: recorded } = await simFor(operation);
    assert(!sdk.rpc.Api.isSimulationError(recorded), `${label}: record failed: ${recorded.error}`);
    const auth = recorded.result?.auth ?? [];
    assert(auth.every(e => e.credentials.type === 'sorobanCredentialsSourceAccount'), `${label}: unexpected address auth`);
    const enforced = sdk.Operation.invokeHostFunction({ func: recordedTx.operations[0].func, auth });
    const { tx, sim } = await simFor(enforced, 'enforce');
    assert(!sdk.rpc.Api.isSimulationError(sim), `${label}: enforce failed: ${sim.error}`);
    return submit(label, tx, sim, { retval_xdr: sim.result.retval.toXdr('base64') });
  }

  async function deploy(name, file, constructorArgs = []) {
    const uploadLabel = `CAP71-upload-${file}`;
    await sourceOnly(uploadLabel, sdk.Operation.uploadContractWasm({ wasm: readFileSync(new URL(file, WASM)) }));
    if (!state.salts[name]) { state.salts[name] = randomBytes(32).toString('hex'); save(); }
    const receipt = await sourceOnly(`CAP71-deploy-${name}`, sdk.Operation.createCustomContract({
      address: new sdk.Address(keys.a.publicKey), wasmHash: Buffer.from(artifacts[file], 'hex'),
      salt: Buffer.from(state.salts[name], 'hex'), constructorArgs,
    }));
    return sdk.Address.fromScVal(sdk.xdr.ScVal.fromXdr(receipt.retval_xdr, 'base64')).toString();
  }
  const policy = (members, threshold) => [sdk.xdr.ScVal.scvMap(members
    .map(([address, weight]) => new sdk.xdr.ScMapEntry({ key: addr(sdk, address), val: u32(sdk, weight) }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.key.toXdr()), Buffer.from(b.key.toXdr())))), u32(sdk, threshold)];
  const c = {};
  c.target = await deploy('target', 'cap71_target.wasm');
  c.any = await deploy('any', 'cap71_delegate.wasm', policy([[keys.a.publicKey, 1], [keys.c.publicKey, 1]], 1));
  c.both = await deploy('both', 'cap71_delegate.wasm', policy([[keys.a.publicKey, 1], [keys.c.publicKey, 1]], 2));
  c.weighted = await deploy('weighted', 'cap71_delegate.wasm', policy([[keys.a.publicKey, 2], [keys.c.publicKey, 1]], 2));
  c.chain = await deploy('chain', 'cap71_delegate.wasm', policy([[c.both, 1]], 1));
  for (const name of ['raw1', 'raw2']) c[name] = await deploy(name, 'cap71_raw_account.wasm', [sdk.xdr.ScVal.scvBytes(keys.a.rawPublicKey)]);
  ctx.record('CAP71-setup', 'passed', { protocol, version, contracts: c, artifacts, immutable: true, public_keys: binding.keys });

  const tree = (...names) => names.map(name => ({ address: keys[name].publicKey }));
  const nested = () => [{ address: c.both, nestedDelegates: tree('a', 'c') }];
  const expected = code => ({ code: `Error(Contract, #${code})` });
  const crypto = { code: 'Error(Crypto, InvalidInput)' };

  async function call(label, who, { delegates = tree('a'), raw = false, presigned, mutate, expect, expired = false } = {}) {
    ctx.assertClear();
    if (state.checks[label]) return state.checks[label];
    let evidence = state.steps[label];
    if (!evidence) {
      const before = await count(c.target, who);
      const operation = new sdk.Contract(c.target).call('ping', addr(sdk, who), u32(sdk, 1));
      const { tx: recordedTx, sim: recorded } = await simFor(operation);
      assert(!sdk.rpc.Api.isSimulationError(recorded), `${label}: record failed: ${recorded.error}`);
      const entries = recorded.result?.auth ?? [];
      assert.equal(entries.length, 1, `${label}: expected one root auth entry`);
      assert.equal(sdk.Address.fromScAddress(addressCredentials(entries[0]).address).toString(), who);
      const expectedRoot = new sdk.xdr.SorobanAuthorizedInvocation({
        function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs({
          contractAddress: new sdk.Address(c.target).toScAddress(), functionName: 'ping', args: [u32(sdk, 1)],
        })), subInvocations: [],
      });
      assert.equal(entries[0].rootInvocation.toXdr('base64'), expectedRoot.toXdr('base64'), `${label}: unexpected recorded authorization tree`);
      const expiration = expired ? recorded.latestLedger - 1 : recorded.latestLedger + 120;
      let signed;
      if (presigned) signed = { entry: sdk.xdr.SorobanAuthorizationEntry.fromXdr(presigned, 'base64'), signatures: [] };
      else if (raw) {
        const entry = new sdk.xdr.SorobanAuthorizationEntry({ rootInvocation: entries[0].rootInvocation,
          credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(addressCredentials(entries[0])) });
        const signatures = [];
        const authorized = await sdk.authorizeEntry(entry, async (preimage, payload) => {
          const info = { protocol, root_address: who, signer: keys.a.publicKey, credential_type: 'sorobanCredentialsAddressV2',
            preimage_type: preimage.type, expiration, preimage_xdr: preimage.toXdr('base64'), digest: Buffer.from(payload).toString('hex') };
          assert.equal(preimage.type, 'envelopeTypeSorobanAuthorizationWithAddress');
          ctx.assertClear();
          ctx.record(`${label}:auth`, 'signing_requested', info);
          const signature = await ctx.signDigest(keys.a, Buffer.from(payload));
          assert(sdk.Keypair.fromPublicKey(keys.a.publicKey).verify(payload, signature));
          signatures.push({ ...info, signature_hex: Buffer.from(signature).toString('hex') });
          return { signatureScVal: sdk.xdr.ScVal.scvBytes(signature) };
        }, expiration, ctx.networkPassphrase, who);
        signed = { entry: authorized, signatures };
      } else signed = await signTree(ctx, entries[0], delegates, expiration, label, protocol);
      let entry = mutate ? mutate(clone(sdk, signed.entry)) : signed.entry;
      const credentials = addressCredentials(entry);
      const actualPreimage = sdk.buildAuthorizationEntryPreimage(entry, credentials.signatureExpirationLedger, ctx.networkPassphrase);
      const { tx, sim } = await simFor(sdk.Operation.invokeHostFunction({ func: recordedTx.operations[0].func, auth: [entry] }), 'enforce');
      evidence = { who, state_before: before, protocol, credential_type: entry.credentials.type,
        preimage_type: actualPreimage.type, nonce: String(credentials.nonce), expiration: credentials.signatureExpirationLedger,
        actual_preimage_xdr: actualPreimage.toXdr('base64'), actual_digest: sha(actualPreimage.toXdr()).toString('hex'),
        signatures: signed.signatures, auth_xdr: entry.toXdr('base64'), unsigned_tx_xdr: tx.toXDR(), ledger_at_enforce: sim.latestLedger };
      if (expect) {
        evidence.error = assertRejection(sdk, sim, expect);
        evidence.expected = expect;
        evidence.outcome = 'simulation_rejected';
      } else evidence = await submit(label, tx, sim, evidence);
    }
    evidence.state_after = await count(c.target, who);
    assert.equal(evidence.state_after, evidence.state_before + (expect ? 0 : 1), `${label}: unexpected counter change`);
    state.checks[label] = evidence; save();
    return evidence;
  }

  const rows = [
    ['CAP71-01', async () => ({ a: await call('CAP71-direct-a', c.any), c: await call('CAP71-direct-c', c.any, { delegates: tree('c') }) })],
    ['CAP71-02', async () => ({ both: await call('CAP71-2of2', c.both, { delegates: tree('a', 'c') }),
      insufficient: await call('CAP71-2of2-missing-c', c.both, { expect: expected(7103) }) })],
    ['CAP71-03', async () => ({ a: await call('CAP71-weighted-a', c.weighted),
      c: await call('CAP71-weighted-c', c.weighted, { delegates: tree('c'), expect: expected(7103) }) })],
    ['CAP71-04', async () => ({ nested: await call('CAP71-nested', c.chain, { delegates: nested() }),
      empty_inner: await call('CAP71-empty-inner', c.chain, { delegates: [{ address: c.both }], expect: expected(7101) }),
      underweight_inner: await call('CAP71-underweight-inner', c.chain, { delegates: [{ address: c.both, nestedDelegates: tree('a') }], expect: expected(7103) }) })],
    ['CAP71-05', async () => ({ unknown: await call('CAP71-unknown', c.any, { delegates: tree('b'), expect: expected(7102) }),
      extra: await call('CAP71-unknown-extra', c.any, { delegates: tree('a', 'b'), expect: expected(7102) }) })],
    ['CAP71-06', async () => ({
      empty: await call('CAP71-empty', c.any, { delegates: [], expect: expected(7101) }),
      missing_g_signature: await call('CAP71-missing-g-signature', c.any, {
        mutate: e => removeGLeafSignature(sdk, e),
        expect: { code: 'Error(Contract, #5)', reason: 'no account signatures found' },
      }),
    })],
    ...['duplicate', 'unordered'].map((mode, index) => [`CAP71-0${index + 7}`, async () => {
      const expect = { code: 'Error(Auth, InvalidInput)', reason: mode === 'duplicate'
        ? 'delegated signers contain duplicate address' : 'delegated signer addresses are not in sorted order' };
      return { root: await call(`CAP71-${mode}`, c.both, { delegates: tree('a', 'c'), mutate: e => corruptDelegateOrder(sdk, e, mode), expect }),
        nested: await call(`CAP71-${mode}-nested`, c.chain, { delegates: nested(), mutate: e => corruptDelegateOrder(sdk, e, mode, true), expect }) };
    }]),
    ['CAP71-09', async () => call('CAP71-expired', c.any, { expired: true, expect: { code: 'Error(Auth, InvalidInput)', reason: 'signature has expired' } })],
    ['CAP71-10', async () => {
      // Keep this positive adjacent to replay; do not reuse an expired early-row signature.
      const accepted = await call('CAP71-replay-source', c.any);
      return { accepted, replay: await call('CAP71-replay', c.any, { presigned: accepted.auth_xdr,
        expect: { code: 'Error(Auth, ExistingValue)', reason: 'nonce already exists for address' } }) };
    }],
    ['CAP71-11', async () => {
      const accepted = await call('CAP71-substitution-source', c.any);
      return { accepted, substituted: await call('CAP71-substitution', c.weighted, { presigned: accepted.auth_xdr,
        mutate: e => replaceAddress(sdk, e, c.weighted), expect: crypto }) };
    }],
    ['CAP71-12', async () => {
      const accepted = await call('CAP71-v2-source', c.raw1, { raw: true });
      const substituted = await call('CAP71-v2-same-key-replay', c.raw2, { presigned: accepted.auth_xdr,
        mutate: e => replaceAddress(sdk, e, c.raw2), expect: crypto });
      return { accepted, substituted, destination_control: await call('CAP71-v2-destination-control', c.raw2, { raw: true }), same_public_key: keys.a.publicKey };
    }],
  ];
  for (const [id, run] of rows) {
    if (!selected.has(id)) { ctx.record(id, 'not_run', { reason: 'not selected' }); continue; }
    if (state.done[id]) { ctx.record(id, 'passed_previous_run', { ...state.done[id], reused_evidence: true }); continue; }
    try {
      ctx.assertClear();
      const details = { protocol, contracts: c, checks: await run() };
      state.done[id] = details; save(); ctx.record(id, 'passed', details);
    } catch (e) {
      ctx.record(id, e instanceof UnknownSubmission ? 'blocked' : 'failed', { hash: e.hash, error: String(e.stack ?? e) });
      throw e;
    }
  }
  return state;
}
