// Extended contract-account coverage: rows E01-E03. Exports runExtended(ctx).
// ctx comes from tests/live-utils.mjs. `node tests/extended-contracts.mjs` runs the offline self-test.
//
// E01 native G-account weighted multisig (B with signers A and C), sorted multi-signature entries.
// E02 OpenZeppelin `Signer::Delegated(G_b)`: a second auth entry rooted at oz.__check_auth([auth_digest]).
// E03 OpenZeppelin contract-specific context rule, threshold update through `execute`, rule removal.
//
// Seams from tests/contracts.mjs: invoke (with extraAuth), submitSourceOnly, checkCheckpoint, UnknownSubmission,
// addressCredentials, and the ScVal builders. Deployments use an isolated wrapper and an own checkpoint file.
// The baseline checkpoint (nine instances) is validated and read only.
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  invoke, submitSourceOnly, checkCheckpoint, UnknownSubmission, addressCredentials, ERR, OZ_COMMIT,
  scMap, ozSigner, ozSignerOf, signersVec, ozAuthDigest, countContexts, ozAuthorizer, accountSignature,
} from './contracts.mjs';

const BASE_STATE = new URL('../evidence/live/contracts-state.json', import.meta.url);   // read only
const STATE_FILE = new URL('../evidence/live/extended-state.json', import.meta.url);
const MANIFEST = new URL('../fixtures/wasm/manifest.json', import.meta.url);
const EXPIRY_LEDGERS = 60;
export const E = {
  ...ERR,
  accountAuth: 'Error(Contract, #5)',        // built-in account: unordered, duplicate, unknown signer, or weight below threshold
  ruleNotFound: 'Error(Contract, #3000)',    // OZ ContextRuleNotFound
  unvalidated: 'Error(Contract, #3002)',     // OZ UnvalidatedContext (context type mismatch, or missing signer on a no-policy rule)
};
const B_MULTISIG = { masterWeight: 1, lowThreshold: 1, medThreshold: 2, highThreshold: 2, signerWeight: 1 };
// Host diagnostics from soroban-env-host v27.0.0 builtin_contracts/account_contract.rs (lines 213 and 258).
// Both failures share Error(Contract, #5), so the message distinguishes ordering from weight.
export const ACCOUNT_DIAG = { unordered: 'public keys are not ordered', weight: 'signature weight is lower than threshold' };
export const ROW_IDS = ['E01', 'E02', 'E03'];

const sym = (sdk, s) => sdk.xdr.ScVal.scvSymbol(s);
const u32 = (sdk, n) => sdk.xdr.ScVal.scvU32(n);
const bytes = (sdk, b) => sdk.xdr.ScVal.scvBytes(Buffer.from(b));
const addr = (sdk, a) => sdk.nativeToScVal(a, { type: 'address' });
const str = (sdk, s) => sdk.xdr.ScVal.scvString(s);

// ---------- ScVal builders for OZ types not covered by contracts.mjs ----------
export const delegatedSigner = (sdk, address) => sdk.xdr.ScVal.scvVec([sym(sdk, 'Delegated'), addr(sdk, address)]);
export const contextRuleType = (sdk, kind, value) =>
  kind === 'Default' ? sdk.xdr.ScVal.scvVec([sym(sdk, 'Default')])
    : kind === 'CallContract' ? sdk.xdr.ScVal.scvVec([sym(sdk, 'CallContract'), addr(sdk, value)])
      : sdk.xdr.ScVal.scvVec([sym(sdk, 'CreateContract'), bytes(sdk, value)]);
// Host map order for Signer keys: Vec compare -> Symbol ("Delegated" < "External"), then ScAddress XDR, then key bytes.
const signerSortKey = (sdk, s) => Buffer.concat([
  Buffer.from(s.kind === 'Delegated' ? [0] : [1]),
  new sdk.Address(s.kind === 'Delegated' ? s.address : s.verifier).toScAddress().toXdr(),
  s.kind === 'Delegated' ? Buffer.alloc(0) : Buffer.from(s.rawKey),
]);
export function mixedAuthPayload(sdk, sigs, ids) {
  const sorted = [...sigs].sort((p, q) => Buffer.compare(signerSortKey(sdk, p), signerSortKey(sdk, q)));
  return scMap(sdk, [
    [sym(sdk, 'context_rule_ids'), sdk.xdr.ScVal.scvVec(ids.map((id) => u32(sdk, id)))],
    [sym(sdk, 'signers'), scMap(sdk, sorted.map((s) =>
      [s.kind === 'Delegated' ? delegatedSigner(sdk, s.address) : ozSigner(sdk, s.verifier, s.rawKey), bytes(sdk, s.signature)]))],
  ]);
}
export const contractFn = (sdk, contract, name, args, subInvocations = []) => new sdk.xdr.SorobanAuthorizedInvocation({
  function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs({
    contractAddress: new sdk.Address(contract).toScAddress(), functionName: name, args })), subInvocations });

// ---------- G-account multisig authorizer (several signers on one entry) ----------
export const gMultiAuthorizer = (ctx, address, keys, { reverse = false, duplicate = false } = {}) => ({
  address, label: `G-multi:${keys.map((k) => k.name).join('+')}`,
  async signatureScVal(payload, _entry, meta = {}) {
    const sigs = [];
    for (const key of keys) sigs.push({ rawKey: key.rawPublicKey, signature: await ctx.signDigest(key, payload) });
    if (duplicate) sigs.push(sigs[0]);
    sigs.sort((p, q) => Buffer.compare(Buffer.from(p.rawKey), Buffer.from(q.rawKey)));
    if (reverse) sigs.reverse();
    Object.assign(meta, { scheme: 'g-account-multisig', signers: keys.map((k) => k.name), order: reverse ? 'reversed' : 'sorted', duplicate, digest: Buffer.from(payload).toString('hex') });
    return accountSignature(ctx.sdk, sigs);
  },
});

// ---------- local transaction helpers ----------
async function buildTx(ctx, source, operations) {
  const account = await ctx.rpc.getAccount(source);
  const builder = new ctx.sdk.TransactionBuilder(account, { fee: String(100 * operations.length), networkPassphrase: ctx.networkPassphrase });
  operations.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(120).build();
}
async function sendOrStop(ctx, tx, label) {
  const hash = Buffer.from(tx.hash()).toString('hex');
  try { return await ctx.send(tx, label); } catch (e) {
    if (e instanceof UnknownSubmission || e?.code === 'unknown_submission') throw e;
    if (/submission outcome (is )?unknown|NOT_FOUND|TRY_AGAIN_LATER|timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(String(e.message))) throw new UnknownSubmission(label, hash, e);
    throw e;
  }
}
// Classic operations from `source`, envelope signed by each key in `signers` through walleterm.
async function submitClassic(ctx, source, operations, signers, label) {
  const tx = await buildTx(ctx, source.publicKey, operations);
  for (const key of signers) await ctx.sign(tx, key);
  const sent = await sendOrStop(ctx, tx, label);
  return { hash: sent.hash, ledger: sent.ledger, signers: signers.map((k) => k.name), envelope_xdr: tx.toXDR() };
}
async function readScVal(ctx, contractId, method, args) {
  const sim = await ctx.rpc.simulateTransaction(await buildTx(ctx, ctx.keys.a.publicKey, [new ctx.sdk.Contract(contractId).call(method, ...args)]), undefined, 'record');
  if (ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${method} read failed: ${sim.error}`);
  return sim.result.retval;
}
const entryAddress = (sdk, entry) => sdk.Address.fromScAddress(addressCredentials(entry).address).toString();
const cloneEntry = (sdk, entry) => sdk.xdr.SorobanAuthorizationEntry.fromXdr(entry.toXdr());
const isUnknown = (e) => e instanceof UnknownSubmission || e?.code === 'unknown_submission';

// ---------- checkpoint: strict load, base validation, binding ----------
function readJson(url, { optional = false } = {}) {
  try { return JSON.parse(readFileSync(url, 'utf8')); }
  catch (e) {
    if (optional && e.code === 'ENOENT') return null;
    throw new Error(`cannot read ${url instanceof URL ? url.pathname : url}: ${e.message}`);
  }
}
export function bindingFor(ctx, base) {
  return {
    network: ctx.networkPassphrase,
    keys: ['a', 'b', 'c'].map((k) => ctx.keys[k].publicKey),
    oz_commit: OZ_COMMIT,
    base_wasm: Object.fromEntries(Object.entries(base.wasm).map(([f, v]) => [f, v.hash]).sort()),
    base_contracts: Object.fromEntries(Object.entries(base.contracts).map(([n, v]) => [n, v.id]).sort()),
  };
}
export function loadBase(ctx, manifest, file = BASE_STATE) {
  const base = readJson(file);
  checkCheckpoint(base, manifest, ctx);   // in memory only; the baseline file is never written here
  for (const name of ['ed25519_verifier', 'threshold_policy', 'auth_target_1', 'auth_target_2']) {
    if (!base.contracts[name]) throw new Error(`baseline instance ${name} missing in contracts-state.json`);
  }
  if (!base.wasm['multisig_account_example.wasm']) throw new Error('baseline upload of multisig_account_example.wasm missing');
  return base;
}
// Defaults only when the file does not exist. Any other read or parse error stops the run.
export function loadState(ctx, base, manifest, file = STATE_FILE) {
  const state = readJson(file, { optional: true }) ?? { oz_commit: OZ_COMMIT, contracts: {}, done: {}, steps: {} };
  const binding = bindingFor(ctx, base);
  const populated = Object.keys(state.contracts ?? {}).length || Object.keys(state.done ?? {}).length || Object.keys(state.steps ?? {}).length || state.b_original;
  if (state.binding) {
    if (JSON.stringify(state.binding) !== JSON.stringify(binding)) throw new Error('extended checkpoint binding mismatch: network, keys, OpenZeppelin commit, or baseline artifacts changed');
  } else if (populated) {
    throw new Error('extended checkpoint has no binding but holds state; review evidence before reuse');
  }
  if (state.oz_commit !== OZ_COMMIT) throw new Error('extended checkpoint OpenZeppelin revision mismatch');
  state.binding = binding;
  state.steps ??= {};
  for (const [name, c] of Object.entries(state.contracts)) {
    if (!base.wasm[c.wasm] || c.wasm_sha256 !== base.wasm[c.wasm].hash || manifest.artifacts[c.wasm]?.sha256 !== c.wasm_sha256) {
      throw new Error(`extended checkpoint contract ${name} has no verified WASM`);
    }
  }
  return state;
}
// Atomic checkpoint write: temp sibling, fsync, rename. A crash mid-write cannot truncate b_original.
export function saveState(state, file = STATE_FILE) {
  const path = file instanceof URL ? fileURLToPath(file) : file;
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(state, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}
export function selectRows(ctx) {
  const envRows = process.env.WALLETERM_ROWS ? process.env.WALLETERM_ROWS.split(',') : undefined;   // empty means unset
  const requested = (ctx.rows ?? envRows ?? ROW_IDS).map((s) => String(s).trim()).filter(Boolean);
  const unknown = requested.filter((id) => !ROW_IDS.includes(id));
  if (unknown.length) throw new Error(`unknown extended row ids: ${unknown.join(', ')}`);
  return new Set(requested);
}
async function deployIsolated(ctx, state, base, name, file, constructorArgs) {
  if (state.contracts[name]) return state.contracts[name].id;
  const wasmHash = Buffer.from(base.wasm[file].hash, 'hex');
  const op = ctx.sdk.Operation.createCustomContract({ address: new ctx.sdk.Address(ctx.keys.a.publicKey), wasmHash, constructorArgs });
  const { sent, retval } = await submitSourceOnly(ctx, op, `E-deploy-${name}`);
  state.contracts[name] = { id: ctx.sdk.Address.fromScVal(retval).toString(), wasm: file, wasm_sha256: base.wasm[file].hash, tx: sent.hash };
  saveState(state);
  return state.contracts[name].id;
}
// Step cache: a finished step is reused on a rerun and reported as passed_previous_run.
const stepper = (ctx, state, rowId, details) => async (label, fn) => {
  const key = `${rowId}:${label}`;
  if (state.steps[key]) {
    ctx.record(`${rowId}.${label}`, 'passed_previous_run', { reused_evidence: true });
    (details.reused_steps ??= []).push(label);
    return { status: 'passed_previous_run', ...state.steps[key] };
  }
  const result = await fn();
  state.steps[key] = result;
  saveState(state);
  return result;
};

// ---------- E01: native weighted multisig on B ----------
async function snapshotAccount(ctx, publicKey) {
  const account = await ctx.horizon.loadAccount(publicKey);
  return {
    thresholds: { low: account.thresholds.low_threshold, med: account.thresholds.med_threshold, high: account.thresholds.high_threshold },
    signers: account.signers.map((s) => ({ key: s.key, weight: s.weight, type: s.type })).sort((p, q) => p.key.localeCompare(q.key)),
  };
}
const sameSettings = (p, q) => JSON.stringify(p) === JSON.stringify(q);
const signerWeight = (snap, key) => snap.signers.find((s) => s.key === key)?.weight ?? 0;

async function e01(ctx, c, state) {
  const { sdk, keys } = ctx;
  const b = keys.b;
  ctx.assertClear?.();
  const details = { account: b.publicKey, settings: B_MULTISIG };
  const step = stepper(ctx, state, 'E01', details);
  if (!state.b_original) { state.b_original = await snapshotAccount(ctx, b.publicKey); saveState(state); }
  const original = state.b_original;
  details.b_original = original;
  const current = await snapshotAccount(ctx, b.publicKey);
  const configured = current.thresholds.med === B_MULTISIG.medThreshold && current.thresholds.high === B_MULTISIG.highThreshold &&
    signerWeight(current, keys.a.publicKey) === B_MULTISIG.signerWeight && signerWeight(current, keys.c.publicKey) === B_MULTISIG.signerWeight;
  if (!configured) {
    if (!sameSettings(current, original)) throw new Error('E01: B is neither at its saved original settings nor at the test settings; review evidence');
    details.configure = await submitClassic(ctx, b, [
      sdk.Operation.setOptions({ signer: { ed25519PublicKey: keys.a.publicKey, weight: B_MULTISIG.signerWeight } }),
      sdk.Operation.setOptions({ signer: { ed25519PublicKey: keys.c.publicKey, weight: B_MULTISIG.signerWeight } }),
      sdk.Operation.setOptions({ masterWeight: B_MULTISIG.masterWeight, lowThreshold: B_MULTISIG.lowThreshold, medThreshold: B_MULTISIG.medThreshold, highThreshold: B_MULTISIG.highThreshold }),
    ], [b], 'E01-configure-b-multisig');
    state.b_modified = true; saveState(state);
  }
  details.b_configured = await snapshotAccount(ctx, b.publicKey);
  const args = [addr(sdk, b.publicKey), u32(sdk, 1)];
  const st = { target: c.target1, who: b.publicKey };
  const ping = (label, opts) => step(label, () => invoke(ctx, { contractId: c.target1, method: 'ping', args, state: st, label, ...opts }));
  const diag = (label, text) => async (opts) => {
    const result = await ping(label, opts);
    if (!String(result.error).includes(text)) throw new Error(`${label}: expected host diagnostic "${text}", got: ${String(result.error).slice(0, 600)}`);
    return { ...result, diagnostic_matched: text };
  };
  let failure;
  try {
    details.sorted_b_a_weight2_passes = await ping('E01-sorted-b-a', { authorizers: [gMultiAuthorizer(ctx, b.publicKey, [b, keys.a])] });
    details.sorted_a_c_weight2_passes = await ping('E01-sorted-a-c', { authorizers: [gMultiAuthorizer(ctx, b.publicKey, [keys.a, keys.c])] });
    details.single_a_weight1_rejected = await diag('E01-weight1-a-only', ACCOUNT_DIAG.weight)({ authorizers: [gMultiAuthorizer(ctx, b.publicKey, [keys.a])], expect: E.accountAuth });
    // Reversed and duplicate cases carry distinct weight 2, so only the ordering rule can reject them.
    details.reversed_order_rejected = await diag('E01-reversed-order', ACCOUNT_DIAG.unordered)({ authorizers: [gMultiAuthorizer(ctx, b.publicKey, [b, keys.a], { reverse: true })], expect: E.accountAuth });
    details.duplicate_rejected = await diag('E01-duplicate-b-a-b', ACCOUNT_DIAG.unordered)({ authorizers: [gMultiAuthorizer(ctx, b.publicKey, [b, keys.a], { duplicate: true })], expect: E.accountAuth });
  } catch (e) { failure = e; failure.details = details; }
  if (isUnknown(failure)) throw failure;
  // Restore only B's settings. High threshold is 2, so B and A sign the restore envelope.
  try {
    ctx.assertClear?.();
    details.restore = await submitClassic(ctx, b, [
      sdk.Operation.setOptions({ signer: { ed25519PublicKey: keys.a.publicKey, weight: signerWeight(original, keys.a.publicKey) } }),
      sdk.Operation.setOptions({ signer: { ed25519PublicKey: keys.c.publicKey, weight: signerWeight(original, keys.c.publicKey) } }),
      sdk.Operation.setOptions({ masterWeight: signerWeight(original, b.publicKey), lowThreshold: original.thresholds.low, medThreshold: original.thresholds.med, highThreshold: original.thresholds.high }),
    ], [b, keys.a], 'E01-restore-b');
    details.b_after_restore = await snapshotAccount(ctx, b.publicKey);
    if (!sameSettings(details.b_after_restore, original)) throw new Error('E01: B settings differ from the saved original after restore');
    state.b_modified = false; saveState(state);
  } catch (e) { if (isUnknown(e) || !failure) throw e; details.restore_error = String(e.message); }
  if (failure) throw failure;
  return details;
}

// ---------- E02: OZ Delegated(G_b) signer with a crafted __check_auth entry ----------
// The OZ authorizer signs nothing itself: the rule holds one Delegated(G_b) signer, so the AuthPayload
// carries an empty Bytes for that signer and binds the rule ids. It records the auth digest in `meta`.
export const ozDelegatedAuthorizer = (ctx, account, delegate, { digestIds } = {}) => ({
  address: account, label: `oz-delegated:${delegate.name}`,
  async signatureScVal(payload, entry, meta = {}) {
    const ids = Array(countContexts(entry.rootInvocation)).fill(0);
    const digest = ozAuthDigest(ctx.sdk, payload, digestIds ?? ids);
    Object.assign(meta, { scheme: 'oz-delegated', rule_ids: ids, digest_ids: digestIds ?? ids, digest: digest.toString('hex'), delegate: delegate.name });
    return mixedAuthPayload(ctx.sdk, [{ kind: 'Delegated', address: delegate.publicKey, signature: Buffer.alloc(0) }], ids);
  },
});
// extraAuth seam: crafts and signs the delegate entry after the OZ entry is signed. Inside __check_auth the OZ
// account calls delegate.require_auth_for_args((auth_digest,)), so the entry is rooted at
// oz.__check_auth([auth_digest]) and uses the same credential variant as the OZ entry.
export const delegateEntryFor = (ctx, { account, delegate, delegateRoot = 'check_auth', omit = false }) => async ({ auth, expiration, entries }) => {
  if (omit) return [];
  const { sdk, networkPassphrase } = ctx;
  const ozSigned = auth.find((e) => addressCredentials(e) && entryAddress(sdk, e) === account);
  const meta = entries.find((e) => e.address === account && e.digest);
  if (!ozSigned || !meta) throw new Error('E02: signed OZ entry or its digest not found');
  const digest = Buffer.from(meta.digest, 'hex');
  const root = delegateRoot === 'check_auth' ? contractFn(sdk, account, '__check_auth', [bytes(sdk, digest)]) : cloneEntry(sdk, ozSigned).rootInvocation;
  const nonce = BigInt('0x' + randomBytes(8).toString('hex')) & ((1n << 62n) - 1n);
  const variant = ozSigned.credentials.type;
  const credentials = new sdk.xdr.SorobanAddressCredentials({ address: new sdk.Address(delegate.publicKey).toScAddress(), nonce, signatureExpirationLedger: 0, signature: sdk.xdr.ScVal.scvVoid() });
  const entry = new sdk.xdr.SorobanAuthorizationEntry({ credentials: sdk.xdr.SorobanCredentials[variant](credentials), rootInvocation: root });
  const extra = { variant, address: delegate.publicKey, signer: `G:${delegate.name}`, scheme: 'delegate-check-auth-root', delegate_root: delegateRoot, bound_digest: meta.digest, nonce: String(nonce), expiration, unsigned_xdr: entry.toXdr('base64') };
  const signed = await sdk.authorizeEntry(entry, async (_p, payload) => {
    extra.payload = Buffer.from(payload).toString('hex');
    return { signatureScVal: accountSignature(sdk, [{ rawKey: delegate.rawPublicKey, signature: await ctx.signDigest(delegate, Buffer.from(payload)) }]), address: delegate.publicKey };
  }, expiration, networkPassphrase);
  extra.signed_xdr = signed.toXdr('base64');
  entries.push(extra);
  return [signed];
};

async function e02(ctx, c, state, base) {
  const { sdk, keys } = ctx;
  ctx.assertClear?.();
  const account = await deployIsolated(ctx, state, base, 'oz_delegated_b', 'multisig_account_example.wasm',
    [sdk.xdr.ScVal.scvVec([delegatedSigner(sdk, keys.b.publicKey)]), scMap(sdk, [])]);
  const details = { account, rule0: 'Delegated(G_b), no policy' };
  const step = stepper(ctx, state, 'E02', details);
  const args = [addr(sdk, account), u32(sdk, 1)];
  const st = { target: c.target1, who: account };
  const run = async (name, label, { delegateRoot, digestIds, omit } = {}, expect, target = c.target1, method = 'ping', callArgs = args, stateCheck = st) => {
    details[name] = await step(label, () => invoke(ctx, { contractId: target, method, args: callArgs, label, expect, state: stateCheck,
      authorizers: [ozDelegatedAuthorizer(ctx, account, keys.b, { digestIds })],
      extraAuth: delegateEntryFor(ctx, { account, delegate: keys.b, delegateRoot, omit }) }));
  };
  await run('valid_check_auth_root_passes', 'E02-delegated-valid', {});
  await run('wrong_root_rejected', 'E02-delegated-wrong-root', { delegateRoot: 'target-call' }, E.auth);
  await run('wrong_digest_rejected', 'E02-delegated-wrong-digest', { digestIds: [0, 0] }, E.auth);
  await run('missing_delegate_rejected', 'E02-delegated-missing', { omit: true }, E.auth);
  await run('nested_tree_passes', 'E02-delegated-nested', {}, undefined, c.target1, 'outer', [addr(sdk, account), addr(sdk, c.target2), u32(sdk, 1)], { target: c.target2, who: account });
  return details;
}

// ---------- E03: contract-specific context rule, threshold update, rule removal ----------
// Resumable: the phase comes from on-chain reads (rule 1 present? threshold 1 or 2?) plus the checkpoint.
async function e03(ctx, c, state, base) {
  const { sdk, keys } = ctx;
  ctx.assertClear?.();
  const account = await deployIsolated(ctx, state, base, 'oz_context_rules', 'multisig_account_example.wasm',
    [signersVec(sdk, [ozSignerOf(c, keys.a, 'a')]), scMap(sdk, [])]);
  const details = { account, rule0: 'Default [External A]', rule1: 'CallContract(target1) [External B, External C], threshold 1 then 2' };
  const step = stepper(ctx, state, 'E03', details);
  const admin = [ozAuthorizer(ctx, account, c.verifier, [keys.a])];               // rule 0: Default, A only
  const byRule1 = (ks) => [ozAuthorizer(ctx, account, c.verifier, ks, { ruleId: 1 })];
  const ping1 = [addr(sdk, account), u32(sdk, 1)];
  const st1 = { target: c.target1, who: account };
  const readRule1 = async () => {
    try { return await readScVal(ctx, account, 'get_context_rule', [u32(sdk, 1)]); }
    catch (e) { if (String(e.message).includes(E.ruleNotFound)) return null; throw e; }
  };
  const readThreshold = async () => Number(sdk.scValToNative(await readScVal(ctx, c.threshold, 'get_threshold', [u32(sdk, 1), addr(sdk, account)])));
  const e = state.e03 ??= {};
  // Step records are the source of truth. Phase markers (created_tx, removed_tx) are derived from them when a
  // marker write was interrupted after the step itself was saved.
  const have = (label) => state.steps[`E03:${label}`];
  const PRE = ['E03-rule1-b-target1', 'E03-rule1-target2', 'E03-rule0-b', 'E03-set-threshold-2'];
  const POST = ['E03-after-update-b-only', 'E03-after-update-b-c', 'E03-remove-rule-1'];
  const requireSteps = (labels, phase) => {
    const missing = labels.filter((l) => !have(l));
    if (missing.length) throw new Error(`E03: resumed at phase ${phase} but step evidence is missing: ${missing.join(', ')}; failing closed`);
    for (const label of labels) {
      (details.preserved_steps ??= {})[label] = have(label);
      ctx.record(`E03.${label}`, 'passed_previous_run', { reused_evidence: true, phase });
    }
  };
  const created = e.created_tx ?? have('E03-add-rule-target1')?.hash;
  const removed = e.removed_tx ?? have('E03-remove-rule-1')?.hash;
  let rule = await readRule1();
  if (!rule && removed) {
    requireSteps(['E03-add-rule-target1', ...PRE, ...POST], 'removed');
    e.removed_tx ??= removed; saveState(state);
    details.phase = 'removed';
  } else if (!rule && created) {
    throw new Error('E03: rule 1 is absent but the checkpoint records its creation and no removal; failing closed');
  } else if (!rule) {
    if (PRE.some(have) || POST.some(have)) throw new Error('E03: rule 1 absent with no creation record but later step evidence exists; failing closed');
    details.add_rule = await step('E03-add-rule-target1', () => invoke(ctx, { contractId: account, method: 'add_context_rule', authorizers: admin, label: 'E03-add-rule-target1',
      args: [contextRuleType(sdk, 'CallContract', c.target1), str(sdk, 'ctx-target1'), sdk.xdr.ScVal.scvVoid(),
        signersVec(sdk, [ozSignerOf(c, keys.b, 'b'), ozSignerOf(c, keys.c, 'c')]),
        scMap(sdk, [[addr(sdk, c.threshold), scMap(sdk, [[sym(sdk, 'threshold'), u32(sdk, 1)]])]])] }));
    e.created_tx = details.add_rule.hash; saveState(state);
    rule = await readRule1();
    if (!rule) throw new Error('E03: rule 1 not readable after add_context_rule');
    const id = Number(sdk.scValToNative(rule).id);
    if (id !== 1) throw new Error(`E03: expected rule id 1, got ${id}`);
  }
  if (rule) {
    const threshold = await readThreshold();
    details.threshold_at_start = threshold;
    if (threshold === 1) {
      if (have('E03-set-threshold-2')) throw new Error('E03: set_threshold step is recorded but the policy still reads threshold 1; failing closed');
      details.phase = 'pre-update';
      details.rule1_b_on_target1_passes = await step('E03-rule1-b-target1', () => invoke(ctx, { contractId: c.target1, method: 'ping', args: ping1, authorizers: byRule1([keys.b]), label: 'E03-rule1-b-target1', state: st1 }));
      details.rule1_on_target2_rejected = await step('E03-rule1-target2', () => invoke(ctx, { contractId: c.target2, method: 'ping', args: ping1, authorizers: byRule1([keys.b]), label: 'E03-rule1-target2', expect: E.unvalidated, state: { target: c.target2, who: account } }));
      // Rule 0 has no policy, so the all-signers check (#3002) fires before the unauthorized-signer check (#3016).
      details.rule0_with_b_rejected = await step('E03-rule0-b', () => invoke(ctx, { contractId: c.target1, method: 'ping', args: ping1, authorizers: [ozAuthorizer(ctx, account, c.verifier, [keys.b], { ruleId: 0 })], label: 'E03-rule0-b', expect: E.unvalidated, state: st1 }));
      // Threshold 1 -> 2 through ExecutionEntryPoint::execute, authorized by rule 0. The policy sees the account as invoker.
      details.set_threshold_2 = await step('E03-set-threshold-2', () => invoke(ctx, { contractId: account, method: 'execute', authorizers: admin, label: 'E03-set-threshold-2',
        args: [addr(sdk, c.threshold), sym(sdk, 'set_threshold'), sdk.xdr.ScVal.scvVec([u32(sdk, 2), rule, addr(sdk, account)])] }));
      details.threshold_after_update = await readThreshold();
      if (details.threshold_after_update !== 2) throw new Error(`E03: threshold is ${details.threshold_after_update}, expected 2`);
    } else if (threshold === 2) {
      requireSteps(['E03-add-rule-target1', ...PRE], 'post-update');   // pre-update coverage must already be evidenced
    } else {
      throw new Error(`E03: unexpected threshold ${threshold} on rule 1; failing closed`);
    }
    details.phase = 'post-update';
    details.old_policy_b_alone_rejected = await step('E03-after-update-b-only', () => invoke(ctx, { contractId: c.target1, method: 'ping', args: ping1, authorizers: byRule1([keys.b]), label: 'E03-after-update-b-only', expect: E.notAllowed, state: st1 }));
    details.new_policy_b_c_passes = await step('E03-after-update-b-c', () => invoke(ctx, { contractId: c.target1, method: 'ping', args: ping1, authorizers: byRule1([keys.b, keys.c]), label: 'E03-after-update-b-c', state: st1 }));
    details.remove_rule = await step('E03-remove-rule-1', () => invoke(ctx, { contractId: account, method: 'remove_context_rule', args: [u32(sdk, 1)], authorizers: admin, label: 'E03-remove-rule-1' }));
    e.removed_tx = details.remove_rule.hash; saveState(state);
    if (await readRule1()) throw new Error('E03: rule 1 still readable after remove_context_rule; failing closed');
    details.phase = 'removed';
  }
  details.removed_rule_rejected = await step('E03-removed-rule', () => invoke(ctx, { contractId: c.target1, method: 'ping', args: ping1, authorizers: byRule1([keys.b, keys.c]), label: 'E03-removed-rule', expect: E.ruleNotFound, state: st1 }));
  return details;
}

const ROWS = [
  { id: 'E01', title: 'Native G-account weighted multisig (B: A, C weight 1, med 2)', run: e01 },
  { id: 'E02', title: 'OpenZeppelin Delegated(G_b) signer with __check_auth-rooted entry', run: e02 },
  { id: 'E03', title: 'OpenZeppelin contract-specific rule, threshold update, removal', run: e03 },
];

export async function runExtended(ctx) {
  const selected = selectRows(ctx);
  const manifest = readJson(MANIFEST);
  const base = loadBase(ctx, manifest);
  const state = loadState(ctx, base, manifest);
  const c = { verifier: base.contracts.ed25519_verifier.id, threshold: base.contracts.threshold_policy.id, target1: base.contracts.auth_target_1.id, target2: base.contracts.auth_target_2.id };
  for (const key of [ctx.keys.a, ctx.keys.b, ctx.keys.c]) await ctx.fund(key);
  const outcomes = {};
  for (const row of ROWS) {
    if (!selected.has(row.id)) { ctx.record(row.id, 'not_run', { title: row.title, reason: 'not selected' }); outcomes[row.id] = 'not_run'; continue; }
    if (state.done[row.id]) { ctx.record(row.id, 'passed_previous_run', { title: row.title, reused_evidence: true, ...state.done[row.id] }); outcomes[row.id] = 'passed_previous_run'; continue; }
    try {
      const details = await row.run(ctx, c, state, base);
      state.done[row.id] = details; saveState(state);
      ctx.record(row.id, 'passed', { title: row.title, ...details }); outcomes[row.id] = 'passed';
    } catch (e) {
      if (isUnknown(e)) {
        ctx.record(row.id, 'blocked', { title: row.title, tx_hash: e.hash, error: String(e.message), action: 'reconcile this hash before any new submission', partial: e.details });
        throw e;
      }
      ctx.record(row.id, 'failed', { title: row.title, error: String(e.stack ?? e), ...(e.details ? { partial: e.details } : {}) }); outcomes[row.id] = 'failed';
      if (ctx.stopOnFailure) throw e;
    }
  }
  const failed = Object.entries(outcomes).filter(([, s]) => s === 'failed').map(([id]) => id);
  if (failed.length) throw new Error(`extended rows failed: ${failed.join(', ')}`);
  return state;
}

// ---------- offline self-test ----------
async function selfTest() {
  const sdk = await import('@stellar/stellar-sdk');
  const { mkdtempSync, writeFileSync: write, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const assert = (cond, msg) => { if (!cond) throw new Error(`self-test: ${msg}`); };
  const throws = (fn, re, msg) => { try { fn(); } catch (e) { if (re.test(String(e.message))) return; throw new Error(`self-test: ${msg}: wrong error ${e.message}`); } throw new Error(`self-test: ${msg}: no error`); };
  const verifier = 'CDLDYJWEZSM6IAI4HHPEZTTV65WX4OVN3RZD3U6LQKYAVIZTEK7XYAYT';
  const g = sdk.Keypair.random(), g2 = sdk.Keypair.random(), g3 = sdk.Keypair.random();
  const key = { name: 'mock', publicKey: g.publicKey(), rawPublicKey: g.rawPublicKey() };
  const key2 = { name: 'mock2', publicKey: g2.publicKey(), rawPublicKey: g2.rawPublicKey() };
  const key3 = { name: 'mock3', publicKey: g3.publicKey(), rawPublicKey: g3.rawPublicKey() };
  const ctx = { sdk, networkPassphrase: sdk.Networks.TESTNET, keys: { a: key, b: key2, c: key3 }, signDigest: async (k, d) => Buffer.from((k === key ? g : g2).sign(d)) };
  // Mixed AuthPayload and OZ enum encodings.
  const orderA = mixedAuthPayload(sdk, [{ kind: 'External', verifier, rawKey: Buffer.alloc(32, 1), signature: Buffer.alloc(64) }, { kind: 'Delegated', address: g.publicKey(), signature: Buffer.alloc(0) }], [0]).toXdr('base64');
  const orderB = mixedAuthPayload(sdk, [{ kind: 'Delegated', address: g.publicKey(), signature: Buffer.alloc(0) }, { kind: 'External', verifier, rawKey: Buffer.alloc(32, 1), signature: Buffer.alloc(64) }], [0]).toXdr('base64');
  assert(orderA === orderB, 'mixed map order independent');
  assert(sdk.scValToNative(contextRuleType(sdk, 'Default'))[0] === 'Default' && sdk.scValToNative(contextRuleType(sdk, 'CallContract', verifier))[0] === 'CallContract', 'ContextRuleType encoding');
  // G multisig signatures are sorted by public key and verify over the payload.
  const payload = Buffer.alloc(32, 9);
  const sorted = sdk.scValToNative(await gMultiAuthorizer(ctx, key.publicKey, [key, key2]).signatureScVal(payload));
  assert(sorted.length === 2 && Buffer.compare(Buffer.from(sorted[0].public_key), Buffer.from(sorted[1].public_key)) < 0, 'multisig sorted by public key');
  for (const s of sorted) assert(sdk.Keypair.fromPublicKey(sdk.StrKey.encodeEd25519PublicKey(Buffer.from(s.public_key))).verify(payload, Buffer.from(s.signature)), 'multisig signature verifies');
  const reversed = sdk.scValToNative(await gMultiAuthorizer(ctx, key.publicKey, [key, key2], { reverse: true }).signatureScVal(payload));
  assert(Buffer.compare(Buffer.from(reversed[0].public_key), Buffer.from(reversed[1].public_key)) > 0, 'reversed order produced');
  const dup = sdk.scValToNative(await gMultiAuthorizer(ctx, key.publicKey, [key2, key], { duplicate: true }).signatureScVal(payload));
  assert(dup.length === 3 && new Set(dup.map((s) => Buffer.from(s.public_key).toString('hex'))).size === 2, 'duplicate keeps two distinct keys plus one repeat');
  // Delegate entry: __check_auth root, both credential variants, preimage type follows the variant.
  for (const variant of ['sorobanCredentialsAddress', 'sorobanCredentialsAddressV2']) {
    const creds = new sdk.xdr.SorobanAddressCredentials({ address: new sdk.Address(g.publicKey()).toScAddress(), nonce: 5n, signatureExpirationLedger: 0, signature: sdk.xdr.ScVal.scvVoid() });
    const entry = new sdk.xdr.SorobanAuthorizationEntry({ credentials: sdk.xdr.SorobanCredentials[variant](creds), rootInvocation: contractFn(sdk, verifier, '__check_auth', [bytes(sdk, Buffer.alloc(32, 3))]) });
    const pre = sdk.buildAuthorizationEntryPreimage(entry, 100, sdk.Networks.TESTNET);
    assert(pre.type === (variant.endsWith('V2') ? 'envelopeTypeSorobanAuthorizationWithAddress' : 'envelopeTypeSorobanAuthorization'), `preimage for ${variant}`);
    const signed = await sdk.authorizeEntry(entry, async (_p, pl) => ({ signatureScVal: accountSignature(sdk, [{ rawKey: key.rawPublicKey, signature: await ctx.signDigest(key, Buffer.from(pl)) }]), address: key.publicKey }), 100, sdk.Networks.TESTNET);
    const fn = signed.rootInvocation.function.contractFn;
    assert(String(fn.functionName) === '__check_auth' && sdk.scValToNative(fn.args[0]).length === 32 && addressCredentials(signed).signatureExpirationLedger === 100, `delegate entry ${variant}`);
    assert(g.verify(Buffer.from(sdk.hash(pre.toXdr())), Buffer.from(sdk.scValToNative(addressCredentials(signed).signature)[0].signature)), `delegate signature ${variant}`);
  }
  // extraAuth flow offline: OZ entry signed by the delegated authorizer, then the delegate entry from the seam.
  const ozCreds = new sdk.xdr.SorobanAddressCredentials({ address: new sdk.Address(verifier).toScAddress(), nonce: 9n, signatureExpirationLedger: 0, signature: sdk.xdr.ScVal.scvVoid() });
  const ozEntry = new sdk.xdr.SorobanAuthorizationEntry({ credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(ozCreds), rootInvocation: contractFn(sdk, verifier, 'ping', [addr(sdk, verifier), u32(sdk, 1)]) });
  const meta = { address: verifier };
  const ozSigned = await sdk.authorizeEntry(cloneEntry(sdk, ozEntry), async (_p, pl) => ({ signatureScVal: await ozDelegatedAuthorizer(ctx, verifier, key).signatureScVal(Buffer.from(pl), ozEntry, meta), address: verifier }), 100, sdk.Networks.TESTNET);
  assert(meta.digest?.length === 64 && JSON.stringify(meta.rule_ids) === '[0]', 'delegated authorizer meta');
  const entries = [meta];
  const extra = await delegateEntryFor(ctx, { account: verifier, delegate: key })({ auth: [ozSigned], expiration: 100, entries });
  const dfn = extra[0].rootInvocation.function.contractFn;
  assert(extra.length === 1 && extra[0].credentials.type === 'sorobanCredentialsAddressV2' && String(dfn.functionName) === '__check_auth' && Buffer.from(sdk.scValToNative(dfn.args[0])).toString('hex') === meta.digest, 'delegate entry bound to the OZ digest with the same variant');
  assert(entries.length === 2 && entries[1].scheme === 'delegate-check-auth-root', 'extra entry metadata pushed');
  assert((await delegateEntryFor(ctx, { account: verifier, delegate: key, omit: true })({ auth: [ozSigned], expiration: 100, entries: [meta] })).length === 0, 'omit returns none');
  assert(typeof invoke === 'function' && typeof submitSourceOnly === 'function' && typeof checkCheckpoint === 'function' && E.accountAuth === 'Error(Contract, #5)' && invoke.toString().includes('extraAuth'), 'seams imported');
  // Checkpoint safety: ENOENT defaults, other errors throw, binding mismatch throws, unknown rows rejected.
  const manifest = readJson(MANIFEST);
  const dir = mkdtempSync(join(tmpdir(), 'walleterm-ext-'));
  const base = { oz_commit: OZ_COMMIT, wasm: Object.fromEntries(Object.entries(manifest.artifacts).map(([f, a]) => [f, { hash: a.sha256 }])), contracts: { ed25519_verifier: { id: verifier, wasm: 'multisig_ed25519_verifier_example.wasm' } }, done: {} };
  const missing = pathToFileURL(join(dir, 'missing.json'));
  const fresh = loadState(ctx, base, manifest, missing);
  assert(fresh.binding.network === sdk.Networks.TESTNET && fresh.binding.keys.length === 3 && Object.keys(fresh.binding.base_wasm).length === 6, 'fresh state binds network, keys, commit, artifacts');
  const broken = pathToFileURL(join(dir, 'broken.json')); write(broken, '{ not json');
  throws(() => loadState(ctx, base, manifest, broken), /cannot read/, 'parse error is not defaulted');
  const bound = pathToFileURL(join(dir, 'bound.json')); write(bound, JSON.stringify(fresh));
  assert(loadState(ctx, base, manifest, bound).binding.oz_commit === OZ_COMMIT, 'same binding loads');
  throws(() => loadState({ ...ctx, networkPassphrase: sdk.Networks.PUBLIC }, base, manifest, bound), /binding mismatch/, 'network change rejected');
  throws(() => loadState(ctx, { ...base, wasm: { ...base.wasm, 'multisig_account_example.wasm': { hash: '00' } } }, manifest, bound), /binding mismatch/, 'base artifact change rejected');
  const legacy = pathToFileURL(join(dir, 'legacy.json')); write(legacy, JSON.stringify({ oz_commit: OZ_COMMIT, contracts: { x: { id: verifier, wasm: 'multisig_account_example.wasm', wasm_sha256: manifest.artifacts['multisig_account_example.wasm'].sha256 } }, done: {} }));
  throws(() => loadState(ctx, base, manifest, legacy), /no binding/, 'unbound populated state rejected');
  const unreadable = pathToFileURL(join(dir, 'dir.json')); mkdirSync(unreadable);
  throws(() => loadState(ctx, base, manifest, unreadable), /cannot read/, 'EISDIR is not defaulted');
  throws(() => loadBase(ctx, manifest, missing), /cannot read/, 'missing baseline rejected');
  throws(() => selectRows({ rows: ['E01', 'C01'] }), /unknown extended row ids: C01/, 'unknown row rejected');
  const savedEnv = process.env.WALLETERM_ROWS;
  delete process.env.WALLETERM_ROWS;
  assert(selectRows({ rows: [] }).size === 0 && selectRows({}).size === 3, 'row selection defaults');
  process.env.WALLETERM_ROWS = ''; assert(selectRows({}).size === 3, 'empty env means unset');
  process.env.WALLETERM_ROWS = 'E02'; assert([...selectRows({})].join() === 'E02', 'env selects one row');
  if (savedEnv === undefined) delete process.env.WALLETERM_ROWS; else process.env.WALLETERM_ROWS = savedEnv;
  // Atomic save round-trips and leaves no temp sibling.
  const saved = pathToFileURL(join(dir, 'saved.json'));
  saveState({ ...fresh, b_original: { thresholds: { low: 0, med: 0, high: 0 }, signers: [] } }, saved);
  assert(readJson(saved).b_original.signers.length === 0 && !existsSync(`${fileURLToPath(saved)}.${process.pid}.tmp`), 'atomic save');
  // Host diagnostics pinned to soroban-env-host v27.0.0 account_contract.rs.
  assert(ACCOUNT_DIAG.weight === 'signature weight is lower than threshold' && ACCOUNT_DIAG.unordered === 'public keys are not ordered', 'account diagnostics');
  console.log(JSON.stringify({ ok: true, self_test: 'extended-contracts.mjs', rows: ROW_IDS, account_diagnostics: ACCOUNT_DIAG }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest().catch((e) => { console.error(e); process.exit(1); });
}
