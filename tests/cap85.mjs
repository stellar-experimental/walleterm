// CAP-85 externally managed contract executables: rows X01-X07. Exports runCap85(ctx).
// ctx comes from tests/live-utils.mjs. `node tests/cap85.mjs` runs the offline self-test.
//
// Fixtures: fixtures/cap85 (soroban-sdk 28 manager, target v1/v2, SDK 28 aware account;
// soroban-sdk 27 legacy context-reading account). Baseline SDK 27 instances from
// evidence/live/contracts-state.json are read only: oz_basic_a, simple_account_b, ed25519_verifier.
// Every submission goes through one local path: record simulation, entry signing through ctx.signDigest
// with the preimage recorded first, enforce simulation, envelope signature, send. Testnet only.
// No signer configuration is changed. Deployed contracts are throwaway, so nothing is restored.
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, existsSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { UnknownSubmission, addressCredentials, ERR, gAuthorizer, simpleAuthorizer, ozAuthorizer, accountSignature } from './contracts.mjs';

const BASE_STATE = new URL('../evidence/live/contracts-state.json', import.meta.url);   // read only
const STATE_FILE = new URL('../evidence/live/cap85-state.json', import.meta.url);
const MANIFEST = new URL('../fixtures/cap85/wasm/manifest.json', import.meta.url);
const WASM_DIR = new URL('../fixtures/cap85/wasm/', import.meta.url);
const EXPIRY_LEDGERS = 60;
// The checkpoint path travels with the state object (symbol key: copied by spread, ignored by JSON).
// saveState has no default path, so offline tests can never write the live checkpoint by accident.
const FILE = Symbol('checkpoint-file');
export const TAG = 'target';
export const ROW_IDS = ['X01', 'X02', 'X03', 'X04', 'X05', 'X06', 'X07'];
// Expected errors and host diagnostics. Sources: fixtures/cap85 unit tests on the protocol 28 test host
// (manager: unknown_wasm_hash_rejected_by_protocol; account: legacy_sdk27_decode_failure_is_value_missing_value)
// and soroban-env-host v27.0.0 builtin_contracts/account_contract.rs ("signer does not belong to account").
export const X = {
  ...ERR,
  managerStale: { error: 'Error(Contract, #2)' },                                         // cap85_manager StaleVersion
  accountNotExternalRef: { error: 'Error(Contract, #2)' },                                // cap85_account ExecutableNotExternalRef
  unknownWasm: { error: 'Error(Storage, MissingValue)', diagnostic: 'Wasm does not exist' }, // protocol guard on executable_refs().set
  wrongSigner: { error: 'Error(Contract, #5)', diagnostic: 'signer does not belong to account' }, // built-in account, key C signing for B
  legacyDecode: { error: 'Error(Value, MissingValue)' },                                  // SDK 27 decoder on ContractExecutable::ExternalRef
};
const FILES = { manager: 'cap85_manager.wasm', v1: 'cap85_target_v1.wasm', v2: 'cap85_target_v2.wasm', account28: 'cap85_account.wasm', legacy27: 'cap85_legacy_account.wasm' };

const sha256 = (b) => createHash('sha256').update(b).digest();
const u32 = (sdk, n) => sdk.xdr.ScVal.scvU32(n);
const bytes = (sdk, b) => sdk.xdr.ScVal.scvBytes(Buffer.from(b));
const addr = (sdk, a) => sdk.nativeToScVal(a, { type: 'address' });
const str = (sdk, s) => sdk.xdr.ScVal.scvString(s);
const hex = (b) => Buffer.from(b).toString('hex');

// ---------- CAP-85 XDR builders ----------
export const externalRef = (sdk, owner, tag) => sdk.xdr.ContractExecutable.contractExecutableExternalRef(
  new sdk.xdr.ContractExecutableExternalRef({ executableOwner: new sdk.Address(owner).toScAddress(), tag }));
export const wasmExecutable = (sdk, hashHex) => sdk.xdr.ContractExecutable.contractExecutableWasm(Buffer.from(hashHex, 'hex'));
export function createContractOp(sdk, { deployer, executable, salt, constructorArgs = [] }) {
  const contractIdPreimage = sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new sdk.xdr.ContractIdPreimageFromAddress({ address: new sdk.Address(deployer).toScAddress(), salt }));
  const func = sdk.xdr.HostFunction.hostFunctionTypeCreateContractV2(new sdk.xdr.CreateContractArgsV2({ contractIdPreimage, executable, constructorArgs }));
  return sdk.Operation.invokeHostFunction({ func, auth: [] });
}
export function derivedContractId(sdk, networkPassphrase, deployer, salt) {
  const preimage = sdk.xdr.HashIdPreimage.envelopeTypeContractId(new sdk.xdr.HashIdPreimageContractId({
    networkId: Buffer.from(sdk.hash(networkPassphrase)),
    contractIdPreimage: sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(new sdk.xdr.ContractIdPreimageFromAddress({ address: new sdk.Address(deployer).toScAddress(), salt })) }));
  return sdk.StrKey.encodeContract(Buffer.from(sdk.hash(preimage.toXdr())));
}
export function describeExecutable(sdk, exe) {
  if (exe.type === 'contractExecutableExternalRef') return { type: 'external_ref', owner: sdk.Address.fromScAddress(exe.externalRef.executableOwner).toString(), tag: String(exe.externalRef.tag) };
  if (exe.type === 'contractExecutableWasm') return { type: 'wasm', wasm_hash: hex(exe.wasmHash.toXdr()) };
  return { type: exe.type };
}
// Expected authorization root for one local operation: the same function and arguments, no subtree.
// Every operation in this suite is a direct call or a direct contract creation, so any other root is malformed.
export function expectedInvocation(sdk, func) {
  const F = sdk.xdr.SorobanAuthorizedFunction;
  let fn;
  if (func.type === 'hostFunctionTypeInvokeContract') fn = F.sorobanAuthorizedFunctionTypeContractFn(func.invokeContract);
  else if (func.type === 'hostFunctionTypeCreateContractV2') fn = F.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(func.createContractV2);
  else if (func.type === 'hostFunctionTypeCreateContract') fn = F.sorobanAuthorizedFunctionTypeCreateContractHostFn(func.createContract);
  else return null;   // upload: no authorization entry is expected at all
  return new sdk.xdr.SorobanAuthorizedInvocation({ function: fn, subInvocations: [] });
}
// Validates a recorded entry against the local operation before anything is signed.
export function verifyAuthEntry(sdk, entry, expected, allowedAddresses, label) {
  if (!expected) throw new Error(`${label}: RPC returned an authorization entry for an operation that needs none`);
  const root = entry.rootInvocation;
  if (root.subInvocations.length !== 0) throw new Error(`${label}: recorded auth root has ${root.subInvocations.length} sub-invocations; expected none`);
  if (root.toXdr('base64') !== expected.toXdr('base64')) throw new Error(`${label}: recorded auth root differs from the local operation`);
  if (addressCredentials(entry)) {
    const address = entryAddress(sdk, entry);
    if (!allowedAddresses.includes(address)) throw new Error(`${label}: recorded auth entry is for unexpected address ${address}`);
  }
}
export function authorizedExecutable(sdk, entry) {
  const fn = entry.rootInvocation.function;
  const args = fn.createContractV2HostFn ?? fn.createContractHostFn;
  return args ? describeExecutable(sdk, args.executable) : undefined;
}

// ---------- local transaction path ----------
async function buildTx(ctx, operations) {
  const account = await ctx.rpc.getAccount(ctx.keys.a.publicKey);
  const builder = new ctx.sdk.TransactionBuilder(account, { fee: String(100 * operations.length), networkPassphrase: ctx.networkPassphrase });
  operations.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(120).build();
}
const isUnknown = (e) => e instanceof UnknownSubmission || e?.code === 'unknown_submission';
function simulationText(sdk, sim) {
  let text = String(sim.error ?? '');
  for (const ev of sim.events ?? []) {
    try { const event = typeof ev === 'string' ? sdk.xdr.DiagnosticEvent.fromXdr(ev, 'base64') : ev; text += '\n' + JSON.stringify(sdk.scValToNative(event.event.body.v0.data), (_, v) => typeof v === 'bigint' ? String(v) : v); } catch { /* best effort */ }
  }
  return text;
}
function matchRejection(text, expect, label) {
  const matched = [].concat(expect).find((e) => text.includes(e.error));
  if (!matched) throw new Error(`${label}: expected ${[].concat(expect).map((e) => e.error).join(' or ')} in simulation error, got: ${text.slice(0, 800)}`);
  if (matched.diagnostic && !text.includes(matched.diagnostic)) throw new Error(`${label}: expected host diagnostic "${matched.diagnostic}", got: ${text.slice(0, 800)}`);
  return { expected: matched.error, diagnostic_matched: matched.diagnostic };
}
const entryAddress = (sdk, entry) => sdk.Address.fromScAddress(addressCredentials(entry).address).toString();
const cloneEntry = (sdk, entry) => sdk.xdr.SorobanAuthorizationEntry.fromXdr(entry.toXdr());
const normalizeAuth = (sdk, list) => (list ?? []).map((e) => typeof e === 'string' ? sdk.xdr.SorobanAuthorizationEntry.fromXdr(e, 'base64') : e);

// Reads through record-mode simulation. No signing.
async function readScVal(ctx, contractId, method, args = []) {
  const sim = await ctx.rpc.simulateTransaction(await buildTx(ctx, [new ctx.sdk.Contract(contractId).call(method, ...args)]), undefined, 'record');
  if (ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${method} read failed: ${sim.error}`);
  return sim.result.retval;
}
const readU32 = async (ctx, id, method, args) => Number(ctx.sdk.scValToNative(await readScVal(ctx, id, method, args)));
async function readOptionalHash(ctx, id, method, args) { const v = await readScVal(ctx, id, method, args); return v.type === 'scvVoid' ? null : hex(ctx.sdk.scValToNative(v)); }
const contractDataVal = (entry) => { const v = entry?.val?.contractData?.val; if (!v) throw new Error('unexpected ledger entry shape'); return v; };
export async function readInstanceExecutable(ctx, contractId) {
  const entry = await ctx.rpc.getContractData(contractId, ctx.sdk.xdr.ScVal.scvLedgerKeyContractInstance(), ctx.sdk.rpc.Durability.Persistent);
  return { ...describeExecutable(ctx.sdk, contractDataVal(entry).instance.executable), live_until_ledger: entry.liveUntilLedgerSeq };
}
export async function readExecutableTagEntry(ctx, owner, tag) {
  const entry = await ctx.rpc.getContractData(owner, ctx.sdk.xdr.ScVal.scvExecutableTag(tag), ctx.sdk.rpc.Durability.Persistent);
  return { wasm_hash: hex(ctx.sdk.scValToNative(contractDataVal(entry))), live_until_ledger: entry.liveUntilLedgerSeq };
}

// Record-mode simulation that must fail (contract logic or protocol guard). No signing.
async function expectRecordRejected(ctx, operation, label, expect) {
  const sim = await ctx.rpc.simulateTransaction(await buildTx(ctx, [operation]), undefined, 'record');
  if (!ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${label}: expected ${expect.error}, but record simulation succeeded`);
  const text = simulationText(ctx.sdk, sim);
  return { outcome: 'simulation_rejected', mode: 'record', ...matchRejection(text, expect, label), error: text.slice(0, 2000), ledger: sim.latestLedger };
}

// Single submission path for every operation, with or without address authorizers.
// expect: undefined (must succeed), {error, diagnostic?} or a list (must be rejected at enforce), or 'observe'.
async function invokeOperation(ctx, state, { operation, authorizers = [], label, expect, predicted }) {
  const { sdk, rpc, networkPassphrase } = ctx;
  const template = await buildTx(ctx, [operation]);
  const func = template.operations[0].func;
  const recorded = await rpc.simulateTransaction(template, undefined, 'record');
  if (sdk.rpc.Api.isSimulationError(recorded)) throw new Error(`${label}: record simulation failed: ${recorded.error}`);
  const expiration = recorded.latestLedger + EXPIRY_LEDGERS;
  // Invariant: every recorded root must equal the local operation, with an empty subtree and an expected address,
  // before any signing request is made.
  const expected = expectedInvocation(sdk, func);
  const allowed = [...authorizers.map((a) => a.address), ctx.keys.a.publicKey];
  const recordedAuth = normalizeAuth(sdk, recorded.result?.auth);
  for (const raw of recordedAuth) verifyAuthEntry(sdk, raw, expected, allowed, label);
  const entries = [];
  const auth = [];
  for (const raw of recordedAuth) {
    const entry = cloneEntry(sdk, raw);
    if (!addressCredentials(entry)) { auth.push(entry); entries.push({ variant: entry.credentials.type, source_account: true, root_verified: true }); continue; }
    const address = entryAddress(sdk, entry);
    const signer = authorizers.find((a) => a.address === address);
    if (!signer) throw new Error(`${label}: no authorizer for ${address}`);
    const meta = { variant: entry.credentials.type, address, signer: signer.label, nonce: String(addressCredentials(entry).nonce), expiration, root_verified: true, authorized_executable: authorizedExecutable(sdk, entry), unsigned_xdr: raw.toXdr('base64') };
    const signed = await sdk.authorizeEntry(entry, async (preimage, payload) => {
      meta.preimage_xdr = preimage.toXdr('base64');
      meta.payload = hex(payload);
      // Durable record of what is about to be signed, before the signing request.
      ctx.record(`${label}.preimage`, 'prepared', { address, signer: signer.label, variant: meta.variant, nonce: meta.nonce, expiration, preimage_xdr: meta.preimage_xdr, payload: meta.payload, authorized_executable: meta.authorized_executable });
      return { signatureScVal: await signer.signatureScVal(Buffer.from(payload), entry, meta), address };
    }, expiration, networkPassphrase);
    meta.signed_xdr = signed.toXdr('base64');
    entries.push(meta);
    auth.push(signed);
  }
  const tx = await buildTx(ctx, [sdk.Operation.invokeHostFunction({ func, auth })]);
  const sim = await rpc.simulateTransaction(tx, undefined, 'enforce');
  const evidence = { entries, auth_xdr: auth.map((e) => e.toXdr('base64')), unsigned_tx_xdr: tx.toXDR(), ledger_at_enforce: sim.latestLedger, credential_variants: auth.map((e) => e.credentials.type) };
  const rejected = sdk.rpc.Api.isSimulationError(sim);
  if (expect === 'observe') {
    if (rejected) return { outcome: 'simulation_rejected', observed: 'rejected', error: simulationText(sdk, sim).slice(0, 2000), ...evidence };
  } else if (expect) {
    if (!rejected) throw new Error(`${label}: expected ${[].concat(expect).map((e) => e.error).join(' or ')}, but enforce simulation succeeded`);
    const text = simulationText(sdk, sim);
    return { outcome: 'simulation_rejected', mode: 'enforce', ...matchRejection(text, expect, label), error: text.slice(0, 2000), ...evidence };
  } else if (rejected) {
    throw new Error(`${label}: enforce simulation failed: ${sim.error}`);
  }
  const prepared = sdk.rpc.assembleTransaction(tx, sim).build();
  ctx.assertClear?.();
  await ctx.sign(prepared, ctx.keys.a);
  const hash = hex(prepared.hash());
  // Persist the attempt before sending: a rerun reconciles this hash instead of signing again.
  state.inflight = { ...state.inflight, hash, predicted, envelope_xdr: prepared.toXDR(), sent_at: new Date().toISOString() };
  saveState(state);
  let sent;
  try { sent = await ctx.send(prepared, label); } catch (e) {
    if (isUnknown(e)) throw e;
    if (/submission outcome (is )?unknown|NOT_FOUND|TRY_AGAIN_LATER|timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(String(e.message))) throw new UnknownSubmission(label, hash, e);
    throw e;
  }
  const retval = sim.result?.retval;
  return { outcome: 'submitted', observed: expect === 'observe' ? 'accepted' : undefined, hash: sent.hash, ledger: sent.ledger, retval_native: retval ? sdk.scValToNative(retval, { }) : undefined,
    retval_address: retval?.type === 'scvAddress' ? sdk.Address.fromScVal(retval).toString() : undefined, predicted, ...evidence };
}
const submitSource = (ctx, state, operation, label, predicted) => invokeOperation(ctx, state, { operation, label, predicted });

// ---------- checkpoint ----------
function readJson(url, { optional = false } = {}) {
  try { return JSON.parse(readFileSync(url, 'utf8')); }
  catch (e) { if (optional && e.code === 'ENOENT') return null; throw new Error(`cannot read ${url instanceof URL ? url.pathname : url}: ${e.message}`); }
}
export function bindingFor(ctx, base, manifest) {
  return {
    network: ctx.networkPassphrase, keys: ['a', 'b', 'c'].map((k) => ctx.keys[k].publicKey),
    cap85_artifacts: Object.fromEntries(Object.entries(manifest.artifacts).map(([f, a]) => [f, a.sha256]).sort()),
    base_contracts: Object.fromEntries(['oz_basic_a', 'simple_account_b', 'ed25519_verifier'].map((n) => [n, base.contracts[n]?.id])),
  };
}
export function loadManifest(file = MANIFEST) {
  const manifest = readJson(file);
  for (const f of Object.values(FILES)) {
    const a = manifest.artifacts[f];
    if (!a) throw new Error(`manifest lacks ${f}`);
    if (hex(sha256(readFileSync(new URL(f, WASM_DIR)))) !== a.sha256) throw new Error(`artifact ${f} differs from the manifest`);
  }
  return manifest;
}
export function loadBase(file = BASE_STATE) {
  const base = readJson(file);
  for (const n of ['oz_basic_a', 'simple_account_b', 'ed25519_verifier']) if (!base.contracts[n]) throw new Error(`baseline instance ${n} missing`);
  return base;
}
export function loadState(ctx, base, manifest, file = STATE_FILE) {
  const state = readJson(file, { optional: true }) ?? { contracts: {}, wasm: {}, done: {}, steps: {} };
  const binding = bindingFor(ctx, base, manifest);
  const populated = Object.keys(state.contracts ?? {}).length || Object.keys(state.wasm ?? {}).length || Object.keys(state.done ?? {}).length || Object.keys(state.steps ?? {}).length || state.inflight;
  if (state.binding) { if (JSON.stringify(state.binding) !== JSON.stringify(binding)) throw new Error('cap85 checkpoint binding mismatch: network, keys, artifacts, or baseline instances changed'); }
  else if (populated) throw new Error('cap85 checkpoint has no binding but holds state; review evidence before reuse');
  state.binding = binding; state.steps ??= {}; state.wasm ??= {}; state.contracts ??= {}; state.done ??= {};
  for (const [f, w] of Object.entries(state.wasm)) if (manifest.artifacts[f]?.sha256 !== w.hash) throw new Error(`cap85 checkpoint upload ${f} has no verified WASM`);
  state[FILE] = file;
  return state;
}
export function saveState(state, file = state[FILE]) {
  if (!file) throw new Error('checkpoint file unknown: load the state with loadState before saving');
  const path = file instanceof URL ? fileURLToPath(file) : file;
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(state, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}
export function selectRows(ctx) {
  const envRows = process.env.WALLETERM_ROWS ? process.env.WALLETERM_ROWS.split(',') : undefined;
  const requested = (ctx.rows ?? envRows ?? ROW_IDS).map((s) => String(s).trim()).filter(Boolean);
  const unknown = requested.filter((id) => !ROW_IDS.includes(id));
  if (unknown.length) throw new Error(`unknown cap85 row ids: ${unknown.join(', ')}`);
  return new Set(requested);
}

// Step cache with an inflight marker. Order on a step: mark inflight -> run (hash persisted before send) ->
// store result and clear inflight in one write. A rerun that finds a marker reconciles it or fails closed.
export async function reconcileInflight(ctx, state) {
  const inflight = state.inflight;
  if (!inflight) return null;
  if (!inflight.hash) {
    // Interrupted before any send: nothing reached the network. Clear and rerun the step.
    delete state.inflight; saveState(state);
    return { cleared: true, label: inflight.label, reason: 'no submission attempted' };
  }
  const result = await ctx.rpc.getTransaction(inflight.hash);
  if (result.status === 'SUCCESS') {
    const reconciled = { outcome: 'reconciled', hash: inflight.hash, ledger: result.ledger, status: result.status, predicted: inflight.predicted, retval_address: inflight.predicted?.contract, note: 'result recovered from the network after an interrupted attempt' };
    state.steps[inflight.key] = reconciled;
    delete state.inflight; saveState(state);
    ctx.record(`${inflight.row}.${inflight.label}`, 'reconciled', reconciled);
    return reconciled;
  }
  if (result.status === 'FAILED') {
    ctx.record(`${inflight.row}.${inflight.label}`, 'failed', { hash: inflight.hash, status: result.status, note: 'interrupted attempt failed on chain; step will rerun' });
    delete state.inflight; saveState(state);
    return { cleared: true, label: inflight.label, reason: 'previous attempt FAILED' };
  }
  throw new UnknownSubmission(inflight.label, inflight.hash, new Error(`interrupted attempt has status ${result.status}; reconcile before any new signing`));
}
const stepper = (ctx, state, rowId, details) => async (label, fn, predicted) => {
  const key = `${rowId}:${label}`;
  await reconcileInflight(ctx, state);
  if (state.steps[key]) { ctx.record(`${rowId}.${label}`, 'passed_previous_run', { reused_evidence: true }); (details.reused_steps ??= []).push(label); return { status: 'passed_previous_run', ...state.steps[key] }; }
  state.inflight = { row: rowId, label, key, predicted, started_at: new Date().toISOString() };
  saveState(state);
  const result = await fn();
  state.steps[key] = result;
  delete state.inflight;
  saveState(state);
  return result;
};
async function upload(ctx, state, manifest, step, file) {
  if (state.wasm[file]) return state.wasm[file].hash;
  const wasm = readFileSync(new URL(file, WASM_DIR));
  const hash = hex(sha256(wasm));
  if (hash !== manifest.artifacts[file].sha256) throw new Error(`${file} differs from the manifest`);
  const r = await step(`upload-${file}`, () => submitSource(ctx, state, ctx.sdk.Operation.uploadContractWasm({ wasm }), `X-upload-${file}`, { wasm_hash: hash }), { wasm_hash: hash });
  state.wasm[file] = { hash, tx: r.hash }; saveState(state);
  return hash;
}
// Wasm-executable deploy, deployer A (source-account credentials). The address is derived before sending.
async function deployWasm(ctx, state, manifest, step, name, file, constructorArgs) {
  if (state.contracts[name]) return state.contracts[name].id;
  const wasmHash = Buffer.from(await upload(ctx, state, manifest, step, file), 'hex');
  const salt = randomBytes(32);
  const predicted = { contract: derivedContractId(ctx.sdk, ctx.networkPassphrase, ctx.keys.a.publicKey, salt), salt: hex(salt) };
  const r = await step(`deploy-${name}`, () => submitSource(ctx, state, ctx.sdk.Operation.createCustomContract({ address: new ctx.sdk.Address(ctx.keys.a.publicKey), wasmHash, constructorArgs, salt }), `X-deploy-${name}`, predicted), predicted);
  const id = r.retval_address ?? r.predicted?.contract;
  if (!id) throw new Error(`deploy ${name}: no contract address`);
  state.contracts[name] = { id, executable: { type: 'wasm', file, wasm_hash: hex(wasmHash) }, tx: r.hash }; saveState(state);
  return id;
}
const call = (sdk, id, method, ...args) => new sdk.Contract(id).call(method, ...args);

// ---------- rows ----------
async function x01(ctx, state, manifest) {
  const { sdk, keys } = ctx;
  const details = { title: 'manager owns the executable reference; admin is key B' };
  const step = stepper(ctx, state, 'X01', details);
  for (const file of Object.values(FILES)) await upload(ctx, state, manifest, step, file);
  details.uploads = state.wasm;
  const manager = await deployWasm(ctx, state, manifest, step, 'manager', FILES.manager, [addr(sdk, keys.b.publicKey)]);
  details.manager = manager;
  const v1 = state.wasm[FILES.v1].hash, v2 = state.wasm[FILES.v2].hash;
  const set = (hash, version) => call(sdk, manager, 'set_executable', str(sdk, TAG), bytes(sdk, Buffer.from(hash, 'hex')), u32(sdk, version));
  details.set_v1_by_admin_b = await step('set-executable-v1', () => invokeOperation(ctx, state, { operation: set(v1, 1), authorizers: [gAuthorizer(ctx, keys.b)], label: 'X01-set-executable-v1' }));
  details.read_executable = await readOptionalHash(ctx, manager, 'executable', [str(sdk, TAG)]);
  details.read_tag_entry = await readExecutableTagEntry(ctx, manager, TAG);
  if (details.read_executable !== v1 || details.read_tag_entry.wasm_hash !== v1) throw new Error('X01: executable reference does not point at target v1');
  details.version_of = await readU32(ctx, manager, 'version_of', [str(sdk, TAG)]);
  details.stale_version_rejected = await step('stale-version', () => expectRecordRejected(ctx, set(v2, 1), 'X01-stale-version', X.managerStale));
  details.unknown_wasm_rejected_by_protocol = await step('unknown-wasm', () => expectRecordRejected(ctx, call(sdk, manager, 'set_executable', str(sdk, TAG), bytes(sdk, randomBytes(32)), u32(sdk, 2)), 'X01-unknown-wasm', X.unknownWasm));
  // Key C signs B's admin entry: the built-in account rejects a signer that is not on the account.
  const cForB = { address: keys.b.publicKey, label: `G:${keys.b.name} signed by ${keys.c.name}`,
    async signatureScVal(payload, _entry, meta = {}) { Object.assign(meta, { scheme: 'g-account', digest: hex(payload), signers: [keys.c.name] }); return accountSignature(sdk, [{ rawKey: keys.c.rawPublicKey, signature: await ctx.signDigest(keys.c, payload) }]); } };
  details.unauthorized_change_rejected = await step('unauthorized-signer', () => invokeOperation(ctx, state, { operation: set(v2, 2), authorizers: [cForB], label: 'X01-unauthorized-signer', expect: X.wrongSigner }));
  return details;
}

async function x02(ctx, state) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id; if (!manager) throw new Error('X02 needs X01 (manager)');
  const details = { title: 'deploy target through ExternalRef, deployer A (G-account, source credentials)' };
  const step = stepper(ctx, state, 'X02', details);
  const salt = randomBytes(32);
  const predicted = { contract: derivedContractId(sdk, ctx.networkPassphrase, keys.a.publicKey, salt), salt: hex(salt) };
  details.deploy = await step('deploy-external-ref', () => submitSource(ctx, state, createContractOp(sdk, { deployer: keys.a.publicKey, executable: externalRef(sdk, manager, TAG), salt, constructorArgs: [addr(sdk, keys.b.publicKey)] }), 'X02-deploy-external-ref', predicted), predicted);
  const target = details.deploy.retval_address ?? details.deploy.predicted?.contract;
  if (!target || (details.deploy.retval_address && details.deploy.retval_address !== details.deploy.predicted.contract)) throw new Error('X02: deployed address differs from the derived address');
  state.contracts.target_ref ??= { id: target, executable: { type: 'external_ref', owner: manager, tag: TAG }, tx: details.deploy.hash }; saveState(state);
  details.target = target;
  details.instance_executable = await readInstanceExecutable(ctx, target);
  if (details.instance_executable.type !== 'external_ref' || details.instance_executable.owner !== manager || details.instance_executable.tag !== TAG) throw new Error('X02: instance executable is not the expected ExternalRef');
  details.version = await readU32(ctx, target, 'version');
  details.resolved_wasm = await readOptionalHash(ctx, manager, 'resolved_wasm', [addr(sdk, target)]);
  if (details.version !== 1 || details.resolved_wasm !== state.wasm[FILES.v1].hash) throw new Error(`X02: expected v1, got version ${details.version} resolved ${details.resolved_wasm}`);
  // Before and after counts live inside the step, so a resumed run keeps the original delta.
  details.ping = await step('ping', async () => {
    const before = await readU32(ctx, target, 'count', [addr(sdk, keys.a.publicKey)]);
    const r = await submitSource(ctx, state, call(sdk, target, 'ping', addr(sdk, keys.a.publicKey), u32(sdk, 1)), 'X02-ping');
    const after = await readU32(ctx, target, 'count', [addr(sdk, keys.a.publicKey)]);
    if (after !== before + 1) throw new Error(`X02: v1 should add 1, counter went ${before} -> ${after}`);
    return { ...r, count_before: before, count_after: after };
  });
  return details;
}

async function x03(ctx, state) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id, target = state.contracts.target_ref?.id;
  if (!manager || !target) throw new Error('X03 needs X01 and X02');
  const details = { title: 'manager switches the reference to v2; same address, new behavior, state kept' };
  const step = stepper(ctx, state, 'X03', details);
  const v2 = state.wasm[FILES.v2].hash;
  details.set_v2_by_admin_b = await step('set-executable-v2', () => invokeOperation(ctx, state, { operation: call(sdk, manager, 'set_executable', str(sdk, TAG), bytes(sdk, Buffer.from(v2, 'hex')), u32(sdk, 2)), authorizers: [gAuthorizer(ctx, keys.b)], label: 'X03-set-executable-v2' }));
  details.version = await readU32(ctx, target, 'version');
  details.resolved_wasm = await readOptionalHash(ctx, manager, 'resolved_wasm', [addr(sdk, target)]);
  details.instance_executable = await readInstanceExecutable(ctx, target);
  if (details.version !== 2 || details.resolved_wasm !== v2 || details.instance_executable.type !== 'external_ref') throw new Error(`X03: expected v2 behind the same reference, got version ${details.version}`);
  details.ping = await step('ping', async () => {
    const before = await readU32(ctx, target, 'count', [addr(sdk, keys.a.publicKey)]);
    const r = await submitSource(ctx, state, call(sdk, target, 'ping', addr(sdk, keys.a.publicKey), u32(sdk, 1)), 'X03-ping');
    const after = await readU32(ctx, target, 'count', [addr(sdk, keys.a.publicKey)]);
    if (after !== before + 2) throw new Error(`X03: v2 should add 2, counter went ${before} -> ${after}`);
    return { ...r, count_before: before, count_after: after };
  });
  return details;
}

async function x04(ctx, state, manifest) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id; if (!manager) throw new Error('X04 needs X01');
  const details = { title: 'SDK 28 custom account authorizes creation only through the trusted ExternalRef' };
  const step = stepper(ctx, state, 'X04', details);
  const account = await deployWasm(ctx, state, manifest, step, 'account28', FILES.account28, [bytes(sdk, keys.c.rawPublicKey), addr(sdk, manager)]);
  details.account = account;
  const signer = [simpleAuthorizer(ctx, account, keys.c)];
  const salt = randomBytes(32);
  const predicted = { contract: derivedContractId(sdk, ctx.networkPassphrase, account, salt), salt: hex(salt) };
  details.external_ref_creation_passes = await step('account-creates-external-ref', () => invokeOperation(ctx, state, { operation: createContractOp(sdk, { deployer: account, executable: externalRef(sdk, manager, TAG), salt, constructorArgs: [addr(sdk, keys.b.publicKey)] }), authorizers: signer, label: 'X04-account-creates-external-ref', predicted }), predicted);
  const created = details.external_ref_creation_passes.retval_address ?? details.external_ref_creation_passes.predicted?.contract;
  details.created = created;
  details.created_instance_executable = await readInstanceExecutable(ctx, created);
  details.created_version = await readU32(ctx, created, 'version');
  details.wasm_creation_rejected = await step('account-rejects-wasm', () => invokeOperation(ctx, state, { operation: createContractOp(sdk, { deployer: account, executable: wasmExecutable(sdk, state.wasm[FILES.v1].hash), salt: randomBytes(32), constructorArgs: [addr(sdk, keys.b.publicKey)] }), authorizers: signer, label: 'X04-account-rejects-wasm', expect: X.accountNotExternalRef }));
  return details;
}

async function x05(ctx, state, manifest) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id; if (!manager) throw new Error('X05 needs X01');
  const details = { title: 'SDK 27 context-reading account: ExternalRef fails to decode, Wasm passes', offline_reference: 'fixtures/cap85/contracts/account/src/test.rs legacy_sdk27_* tests' };
  const step = stepper(ctx, state, 'X05', details);
  const legacy = await deployWasm(ctx, state, manifest, step, 'legacy27', FILES.legacy27, [bytes(sdk, keys.c.rawPublicKey)]);
  details.legacy_reads_contexts = legacy;
  const signer = [simpleAuthorizer(ctx, legacy, keys.c)];
  const create = (executable, salt) => createContractOp(sdk, { deployer: legacy, executable, salt, constructorArgs: [addr(sdk, keys.b.publicKey)] });
  details.external_ref_rejected = await step('legacy-reads-external-ref', () => invokeOperation(ctx, state, { operation: create(externalRef(sdk, manager, TAG), randomBytes(32)), authorizers: signer, label: 'X05-legacy-reads-external-ref', expect: X.legacyDecode }));
  const salt = randomBytes(32);
  const predicted = { contract: derivedContractId(sdk, ctx.networkPassphrase, legacy, salt), salt: hex(salt) };
  details.wasm_passes = await step('legacy-reads-wasm', () => invokeOperation(ctx, state, { operation: create(wasmExecutable(sdk, state.wasm[FILES.v1].hash), salt), authorizers: signer, label: 'X05-legacy-reads-wasm', predicted }), predicted);
  return details;
}

async function x06(ctx, state, manifest) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id; if (!manager) throw new Error('X06 needs X01');
  const details = { title: 'a Wasm-deployed contract adopts the reference, then a direct Wasm again' };
  const step = stepper(ctx, state, 'X06', details);
  const plain = await deployWasm(ctx, state, manifest, step, 'target_plain', FILES.v1, [addr(sdk, keys.b.publicKey)]);
  details.target_plain = plain;
  details.before = { executable: await readInstanceExecutable(ctx, plain), version: await readU32(ctx, plain, 'version') };
  details.adopt_ref_by_admin_b = await step('adopt-ref', () => invokeOperation(ctx, state, { operation: call(sdk, plain, 'adopt_ref', addr(sdk, manager), str(sdk, TAG)), authorizers: [gAuthorizer(ctx, keys.b)], label: 'X06-adopt-ref' }));
  details.after_adopt_ref = { executable: await readInstanceExecutable(ctx, plain), version: await readU32(ctx, plain, 'version'), resolved_wasm: await readOptionalHash(ctx, manager, 'resolved_wasm', [addr(sdk, plain)]) };
  if (details.after_adopt_ref.executable.type !== 'external_ref' || details.after_adopt_ref.version !== 2) throw new Error('X06: adopt_ref did not move the contract onto the v2 reference');
  details.adopt_wasm_by_admin_b = await step('adopt-wasm', () => invokeOperation(ctx, state, { operation: call(sdk, plain, 'adopt_wasm', bytes(sdk, Buffer.from(state.wasm[FILES.v1].hash, 'hex'))), authorizers: [gAuthorizer(ctx, keys.b)], label: 'X06-adopt-wasm' }));
  details.after_adopt_wasm = { executable: await readInstanceExecutable(ctx, plain), version: await readU32(ctx, plain, 'version') };
  if (details.after_adopt_wasm.executable.type !== 'wasm' || details.after_adopt_wasm.version !== 1) throw new Error('X06: adopt_wasm did not restore the direct v1 executable');
  return details;
}

// Observation only: outcomes are recorded, not asserted. The row status is `observed`, never `passed`.
async function x07(ctx, state, manifest, base) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id; if (!manager) throw new Error('X07 needs X01');
  const details = { title: 'observed: legacy accounts that ignore contexts or match them (OpenZeppelin)' };
  const step = stepper(ctx, state, 'X07', details);
  const create = (deployer) => createContractOp(sdk, { deployer, executable: externalRef(sdk, manager, TAG), salt: randomBytes(32), constructorArgs: [addr(sdk, keys.b.publicKey)] });
  const simple = base.contracts.simple_account_b.id;
  details.simple_ignores_contexts_external_ref = { account: simple, expectation: 'accepted: walleterm_simple_account never decodes its contexts (offline: legacy_sdk27_account_that_ignores_contexts_accepts_external_ref)',
    ...await step('simple-ignores-external-ref', () => invokeOperation(ctx, state, { operation: create(simple), authorizers: [simpleAuthorizer(ctx, simple, keys.b)], label: 'X07-simple-ignores-external-ref', expect: 'observe' })) };
  const oz = base.contracts.oz_basic_a.id;
  details.oz_sdk27_external_ref = { account: oz, expectation: 'rejected: OpenZeppelin 0.7.x (SDK 27) matches every context',
    ...await step('oz-external-ref', () => invokeOperation(ctx, state, { operation: create(oz), authorizers: [ozAuthorizer(ctx, oz, base.contracts.ed25519_verifier.id, [keys.a])], label: 'X07-oz-external-ref', expect: 'observe' })) };
  for (const k of ['simple_ignores_contexts_external_ref', 'oz_sdk27_external_ref']) if (!details[k].observed && details[k].status !== 'passed_previous_run') throw new Error(`X07: no definite outcome for ${k}`);
  return details;
}

const ROWS = [
  { id: 'X01', run: x01 }, { id: 'X02', run: x02 }, { id: 'X03', run: x03 }, { id: 'X04', run: x04 }, { id: 'X05', run: x05 }, { id: 'X06', run: x06 },
  { id: 'X07', run: x07, status: 'observed' },
];

export async function runCap85(ctx) {
  const { sdk } = ctx;
  const selected = selectRows(ctx);
  if (ctx.networkPassphrase !== sdk.Networks.TESTNET) throw new Error('cap85 runs on testnet only');
  const manifest = loadManifest();
  const base = loadBase();
  const state = loadState(ctx, base, manifest);
  const network = await ctx.rpc.getNetwork();
  if (network.passphrase !== sdk.Networks.TESTNET) throw new Error(`cap85 runs on testnet only; RPC reports ${network.passphrase}`);
  if (!(network.protocolVersion >= 28)) throw new Error(`cap85 needs protocol 28 or later, network reports ${network.protocolVersion}`);
  for (const key of [ctx.keys.a, ctx.keys.b, ctx.keys.c]) await ctx.fund(key);
  ctx.record('X-setup', 'passed', { protocol_version: network.protocolVersion, network: network.passphrase, manifest: { soroban_sdk: manifest.workspaces, toolchain: manifest.toolchain, artifacts: manifest.artifacts }, payer: ctx.keys.a.publicKey });
  const reconciled = await reconcileInflight(ctx, state);
  if (reconciled) ctx.record('X-inflight', 'reconciled', reconciled);
  for (const row of ROWS) {
    if (!selected.has(row.id)) { ctx.record(row.id, 'not_run', { reason: 'not selected' }); continue; }
    if (state.done[row.id]) { ctx.record(row.id, row.status === 'observed' ? 'observed_previous_run' : 'passed_previous_run', { reused_evidence: true, ...state.done[row.id] }); continue; }
    let details;
    try {
      details = await row.run(ctx, state, manifest, base);
    } catch (e) {
      if (isUnknown(e)) { ctx.record(row.id, 'blocked', { tx_hash: e.hash, error: String(e.message), action: 'reconcile this hash before any new submission' }); throw e; }
      ctx.record(row.id, 'failed', { error: String(e.stack ?? e) });
      throw e;   // stop immediately on the first failed row
    }
    state.done[row.id] = details; saveState(state);
    ctx.record(row.id, row.status ?? 'passed', details);
  }
  return state;
}

// ---------- offline self-test ----------
async function selfTest() {
  const sdk = await import('@stellar/stellar-sdk');
  const { mkdtempSync, writeFileSync: write } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const assert = (cond, msg) => { if (!cond) throw new Error(`self-test: ${msg}`); };
  const throws = (fn, re, msg) => { try { fn(); } catch (e) { if (re.test(String(e.message))) return; throw new Error(`self-test: ${msg}: ${e.message}`); } throw new Error(`self-test: ${msg}: no error`); };
  const rejects = async (p, re, msg) => { try { await p; } catch (e) { if (re.test(String(e.message))) return; throw new Error(`self-test: ${msg}: ${e.message}`); } throw new Error(`self-test: ${msg}: no error`); };
  const liveBefore = existsSync(STATE_FILE) ? readFileSync(STATE_FILE) : null;
  const manifest = loadManifest();
  assert(manifest.workspaces.contracts.soroban_sdk === '28.0.0' && /^27\./.test(manifest.workspaces['contracts-sdk27'].soroban_sdk) && Object.keys(manifest.artifacts).length === 5, 'manifest: SDK 28 and SDK 27 workspaces, five artifacts');
  const C = 'CDLDYJWEZSM6IAI4HHPEZTTV65WX4OVN3RZD3U6LQKYAVIZTEK7XYAYT';
  const g = sdk.Keypair.random();
  const key = { name: 'mock', publicKey: g.publicKey(), rawPublicKey: g.rawPublicKey() };
  const records = [];
  const ctx = { sdk, networkPassphrase: sdk.Networks.TESTNET, keys: { a: key, b: key, c: key }, signDigest: async (_k, d) => Buffer.from(g.sign(d)), record: (id, status, d) => records.push({ id, status, ...d }) };
  // XDR builders and decoding
  const exe = externalRef(sdk, C, TAG);
  assert(describeExecutable(sdk, sdk.xdr.ContractExecutable.fromXdr(exe.toXdr())).owner === C, 'external ref round trip');
  assert(describeExecutable(sdk, wasmExecutable(sdk, 'aa'.repeat(32))).wasm_hash === 'aa'.repeat(32), 'wasm executable');
  const salt = Buffer.alloc(32, 7);
  const op = createContractOp(sdk, { deployer: key.publicKey, executable: exe, salt, constructorArgs: [u32(sdk, 1)] });
  const tx = new sdk.TransactionBuilder(new sdk.Account(key.publicKey, '1'), { fee: '100', networkPassphrase: sdk.Networks.TESTNET }).addOperation(op).setTimeout(30).build();
  const func = tx.operations[0].func;
  assert(func.type === 'hostFunctionTypeCreateContractV2' && describeExecutable(sdk, func.createContractV2.executable).type === 'external_ref', 'create contract op carries ExternalRef');
  assert(/^C[A-Z2-7]{55}$/.test(derivedContractId(sdk, sdk.Networks.TESTNET, key.publicKey, salt)), 'derived contract id');
  const inst = sdk.xdr.ScVal.fromXdr(sdk.xdr.ScVal.scvContractInstance(new sdk.xdr.ScContractInstance({ executable: exe, storage: null })).toXdr());
  assert(describeExecutable(sdk, inst.instance.executable).tag === TAG, 'instance executable decode');
  assert(sdk.scValToNative(sdk.xdr.ScVal.scvExecutableTag(TAG)) === TAG, 'executable tag key');
  // Creation auth entry: SDK preimage, custom-account signature, authorized executable evidence, durable preimage record.
  const root = new sdk.xdr.SorobanAuthorizedInvocation({ function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(func.createContractV2), subInvocations: [] });
  const entry = new sdk.xdr.SorobanAuthorizationEntry({ credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(new sdk.xdr.SorobanAddressCredentials({ address: new sdk.Address(C).toScAddress(), nonce: 3n, signatureExpirationLedger: 0, signature: sdk.xdr.ScVal.scvVoid() })), rootInvocation: root });
  assert(authorizedExecutable(sdk, entry).type === 'external_ref', 'authorized executable from root invocation');
  const meta = {};
  const signer = simpleAuthorizer(ctx, C, key);
  const signed = await sdk.authorizeEntry(cloneEntry(sdk, entry), async (preimage, payload) => { meta.preimage_xdr = preimage.toXdr('base64'); meta.payload = hex(payload); ctx.record('self.preimage', 'prepared', { payload: meta.payload }); return { signatureScVal: await signer.signatureScVal(Buffer.from(payload), entry, meta), address: C }; }, 100, sdk.Networks.TESTNET);
  assert(records[0]?.status === 'prepared' && records[0].payload === meta.payload, 'preimage recorded before signing');
  assert(meta.preimage_xdr && g.verify(Buffer.from(meta.payload, 'hex'), Buffer.from(sdk.scValToNative(addressCredentials(signed).signature))), 'signature over the recorded payload');
  // Rejection matching requires the error and, when given, the host diagnostic.
  assert(matchRejection('HostError: Error(Storage, MissingValue)\n["Wasm does not exist"]', X.unknownWasm, 't').diagnostic_matched === 'Wasm does not exist', 'diagnostic matched');
  throws(() => matchRejection('HostError: Error(Storage, MissingValue)', X.unknownWasm, 't'), /expected host diagnostic/, 'missing diagnostic rejected');
  throws(() => matchRejection('HostError: Error(Auth, InvalidAction)', X.wrongSigner, 't'), /expected Error\(Contract, #5\)/, 'unrelated error rejected');
  // Checkpoint safety, inflight reconciliation, row selection.
  const dir = mkdtempSync(join(tmpdir(), 'walleterm-cap85-'));
  const base = { contracts: { oz_basic_a: { id: C }, simple_account_b: { id: C }, ed25519_verifier: { id: C } } };
  const fresh = loadState(ctx, base, manifest, pathToFileURL(join(dir, 'missing.json')));
  assert(Object.keys(fresh.binding.cap85_artifacts).length === 5 && fresh.binding.keys.length === 3, 'fresh binding');
  const bound = pathToFileURL(join(dir, 'bound.json')); saveState(fresh, bound);
  assert(loadState(ctx, base, manifest, bound).binding.network === sdk.Networks.TESTNET, 'same binding loads');
  throws(() => loadState({ ...ctx, networkPassphrase: sdk.Networks.PUBLIC }, base, manifest, bound), /binding mismatch/, 'network change rejected');
  const broken = pathToFileURL(join(dir, 'broken.json')); write(broken, '{');
  throws(() => loadState(ctx, base, manifest, broken), /cannot read/, 'parse error not defaulted');
  throws(() => loadBase(pathToFileURL(join(dir, 'nobase.json'))), /cannot read/, 'missing baseline rejected');
  throws(() => selectRows({ rows: ['X01', 'E01'] }), /unknown cap85 row ids: E01/, 'unknown row rejected');
  const h = 'ab'.repeat(32);
  const rpcOf = (status) => ({ getTransaction: async () => ({ status, ledger: 7 }) });
  const s1 = { ...fresh, steps: {}, inflight: { row: 'X01', label: 'ping', key: 'X01:ping', hash: h, predicted: { contract: C } } };
  const rec = await reconcileInflight({ ...ctx, rpc: rpcOf('SUCCESS') }, s1);
  assert(rec.outcome === 'reconciled' && s1.steps['X01:ping'].retval_address === C && !s1.inflight, 'SUCCESS reconciles into the step');
  const s2 = { ...fresh, steps: {}, inflight: { row: 'X01', label: 'ping', key: 'X01:ping', hash: h } };
  assert((await reconcileInflight({ ...ctx, rpc: rpcOf('FAILED') }, s2)).cleared && !s2.inflight, 'FAILED clears for rerun');
  const s3 = { ...fresh, steps: {}, inflight: { row: 'X01', label: 'ping', key: 'X01:ping', hash: h } };
  await rejects(reconcileInflight({ ...ctx, rpc: rpcOf('NOT_FOUND') }, s3), /submission outcome is unknown|reconcile/i, 'NOT_FOUND fails closed');
  assert(s3.inflight?.hash === h, 'NOT_FOUND keeps the inflight marker');
  const s4 = { ...fresh, steps: {}, inflight: { row: 'X01', label: 'ping', key: 'X01:ping' } };
  assert((await reconcileInflight(ctx, s4)).cleared && !s4.inflight, 'no-hash inflight clears');
  await rejects(runCap85({ ...ctx, networkPassphrase: sdk.Networks.PUBLIC, rows: [] }), /testnet only/, 'non-testnet rejected before any network call');
  // Malformed RPC auth: the recorded root must match the local operation before any signing request.
  let signCalls = 0;
  const stub = (authEntries, enforce) => ({ ...ctx, signDigest: async (k, d) => { signCalls += 1; return Buffer.from(g.sign(d)); },
    rpc: { getAccount: async () => new sdk.Account(key.publicKey, '1'), simulateTransaction: async (_tx, _r, mode) => mode === 'record' ? { latestLedger: 100, result: { auth: authEntries.map((e) => e.toXdr('base64')) } } : enforce } });
  const localOp = call(sdk, C, 'set_executable', str(sdk, TAG), bytes(sdk, Buffer.alloc(32, 1)), u32(sdk, 1));
  const localFunc = new sdk.TransactionBuilder(new sdk.Account(key.publicKey, '1'), { fee: '100', networkPassphrase: sdk.Networks.TESTNET }).addOperation(localOp).setTimeout(30).build().operations[0].func;
  const goodRoot = expectedInvocation(sdk, localFunc);
  const entryFor = (address, rootInvocation) => new sdk.xdr.SorobanAuthorizationEntry({ credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(new sdk.xdr.SorobanAddressCredentials({ address: new sdk.Address(address).toScAddress(), nonce: 1n, signatureExpirationLedger: 0, signature: sdk.xdr.ScVal.scvVoid() })), rootInvocation });
  const other = sdk.Keypair.random().publicKey();
  const withSubtree = new sdk.xdr.SorobanAuthorizedInvocation({ function: goodRoot.function, subInvocations: [new sdk.xdr.SorobanAuthorizedInvocation({ function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs({ contractAddress: new sdk.Address(C).toScAddress(), functionName: 'transfer', args: [] })), subInvocations: [] })] });
  const wrongFn = new sdk.xdr.SorobanAuthorizedInvocation({ function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs({ contractAddress: new sdk.Address(C).toScAddress(), functionName: 'set_executable', args: [str(sdk, TAG), bytes(sdk, Buffer.alloc(32, 2)), u32(sdk, 1)] })), subInvocations: [] });
  const state = { ...fresh, steps: {} };
  for (const [name, entries, re] of [['subtree', [entryFor(key.publicKey, withSubtree)], /sub-invocations/], ['different args', [entryFor(key.publicKey, wrongFn)], /differs from the local operation/], ['unexpected address', [entryFor(other, goodRoot)], /unexpected address/], ['entry on upload', [entryFor(key.publicKey, goodRoot)], /needs none/]]) {
    signCalls = 0;
    const operation = name === 'entry on upload' ? sdk.Operation.uploadContractWasm({ wasm: Buffer.from([0, 97, 115, 109]) }) : localOp;
    const bad = stub(entries, { error: 'never reached' });
    await rejects(invokeOperation(bad, state, { operation, authorizers: [gAuthorizer(bad, key)], label: `malformed-${name}` }), re, `malformed RPC ${name} rejected`);
    assert(signCalls === 0, `malformed RPC ${name}: no signing request was made`);
  }
  signCalls = 0;
  const good = stub([entryFor(key.publicKey, goodRoot)], { error: 'HostError: Error(Contract, #2)' });
  const ok = await invokeOperation(good, state, { operation: localOp, authorizers: [gAuthorizer(good, key)], label: 'well-formed', expect: X.managerStale });
  assert(ok.outcome === 'simulation_rejected' && signCalls === 1 && ok.entries[0].root_verified === true && ok.entries[0].preimage_xdr, 'well-formed entry is verified, signed once, and enforce-simulated');
  throws(() => saveState({ contracts: {} }), /checkpoint file unknown/, 'saveState has no default path');
  const liveAfter = existsSync(STATE_FILE) ? readFileSync(STATE_FILE) : null;
  assert((liveBefore === null && liveAfter === null) || (liveBefore !== null && liveAfter !== null && liveBefore.equals(liveAfter)), 'live checkpoint untouched by the self-test');
  console.log(JSON.stringify({ ok: true, self_test: 'cap85.mjs', rows: ROW_IDS, expectations: Object.fromEntries(Object.entries(X).filter(([k]) => /manager|account|unknown|wrong|legacy/.test(k))) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest().catch((e) => { console.error(e); process.exit(1); });
}
