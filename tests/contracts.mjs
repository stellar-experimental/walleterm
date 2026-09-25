// Contract-account acceptance lane for docs/TEST-MATRIX.md rows C01-C13.
// Exports runContracts(ctx). ctx comes from tests/live-utils.mjs.
// `node tests/contracts.mjs` runs the offline self-test: no network, no agent.
//
// Signing rules (docs/OPENZEPPELIN.md):
// - G-account entry: signature over the host payload, ScVal Vec[Map{public_key, signature}].
// - walleterm_simple_account: signature over the host payload, ScVal Bytes(64).
// - OpenZeppelin account: signature over sha256(payload || XDR(Vec<u32> rule ids)),
//   ScVal Map{context_rule_ids, signers}. Never the raw host payload.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const OZ_COMMIT = 'a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640';
const WASM_DIR = new URL('../fixtures/wasm/', import.meta.url);
const STATE_FILE = new URL('../evidence/live/contracts-state.json', import.meta.url);
const EXPIRY_LEDGERS = 60;
export const ERR = {
  crypto: 'Error(Crypto, InvalidInput)',          // ed25519_verify panic (simple account, OZ verifier)
  auth: 'Error(Auth, InvalidAction)',             // host: invocation tree or __check_auth failure
  notAllowed: 'Error(Contract, #3202)',           // simple threshold not met
  weightNotAllowed: 'Error(Contract, #3213)',     // weighted threshold not met
  unvalidatedContext: 'Error(Contract, #3002)',   // no-policy rule is missing its required signer
  ruleIdsMismatch: 'Error(Contract, #3014)',      // context_rule_ids length != auth_contexts
  duplicateSigner: 'Error(Contract, #3007)',      // OZ DuplicateSigner at rule creation
  accountSigs: 'Error(Contract, #5)',              // built-in G account: duplicate or unordered signatures (account_contract.rs 203-243)
  nonceConsumed: 'Error(Auth, ExistingValue)',    // host: nonce already used (auth.rs)
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest();
const sym = (sdk, s) => sdk.xdr.ScVal.scvSymbol(s);
const u32 = (sdk, n) => sdk.xdr.ScVal.scvU32(n);
const bytes = (sdk, b) => sdk.xdr.ScVal.scvBytes(Buffer.from(b));
const addr = (sdk, a) => sdk.nativeToScVal(a, { type: 'address' });

// ---------- ScVal builders (library schema) ----------
export const scMap = (sdk, entries) =>
  sdk.xdr.ScVal.scvMap(entries.map(([key, val]) => new sdk.xdr.ScMapEntry({ key, val })));
export const ruleIdsXdr = (sdk, ids) =>
  Buffer.from(sdk.xdr.ScVal.scvVec(ids.map((id) => u32(sdk, id))).toXdr());
export const ozAuthDigest = (sdk, payload, ids) =>
  sha256(Buffer.concat([Buffer.from(payload), ruleIdsXdr(sdk, ids)]));
export const ozSigner = (sdk, verifier, rawKey) =>
  sdk.xdr.ScVal.scvVec([sym(sdk, 'External'), addr(sdk, verifier), bytes(sdk, rawKey)]);
export const sortSigners = (sdk, list) => [...list].sort((p, q) =>
  Buffer.compare(sdk.StrKey.decodeContract(p.verifier), sdk.StrKey.decodeContract(q.verifier)) ||
  Buffer.compare(Buffer.from(p.rawKey), Buffer.from(q.rawKey)));
export function ozAuthPayload(sdk, sigs, ids, { sorted = true } = {}) {
  return scMap(sdk, [
    [sym(sdk, 'context_rule_ids'), sdk.xdr.ScVal.scvVec(ids.map((id) => u32(sdk, id)))],
    [sym(sdk, 'signers'), scMap(sdk, (sorted ? sortSigners(sdk, sigs) : sigs).map((s) =>
      [ozSigner(sdk, s.verifier, s.rawKey), bytes(sdk, s.signature)]))],
  ]);
}
export const accountSignature = (sdk, sigs) => sdk.xdr.ScVal.scvVec(sigs.map((s) =>
  scMap(sdk, [[sym(sdk, 'public_key'), bytes(sdk, s.rawKey)], [sym(sdk, 'signature'), bytes(sdk, s.signature)]])));
export const countContexts = (inv) => 1 + inv.subInvocations.reduce((n, sub) => n + countContexts(sub), 0);

// ---------- authorizers: { address, label, signatureScVal(payload, entry) } ----------
export const gAuthorizer = (ctx, key, { duplicate = false } = {}) => ({
  address: key.publicKey, label: `G:${key.name}`,
  async signatureScVal(payload, _entry, meta = {}) {
    const one = { rawKey: key.rawPublicKey, signature: await ctx.signDigest(key, payload) };
    Object.assign(meta, { scheme: 'g-account', digest: Buffer.from(payload).toString('hex'), signers: [key.name], duplicate });
    return accountSignature(ctx.sdk, duplicate ? [one, one] : [one]);
  },
});
export const simpleAuthorizer = (ctx, contractId, key) => ({
  address: contractId, label: `simple:${key.name}`,
  async signatureScVal(payload, _entry, meta = {}) {
    Object.assign(meta, { scheme: 'simple-raw-payload', digest: Buffer.from(payload).toString('hex'), signers: [key.name] });
    return bytes(ctx.sdk, await ctx.signDigest(key, payload));
  },
});
export const ozAuthorizer = (ctx, contractId, verifier, keys, { ruleId = 0, ruleIds, naive = false, duplicate = false, unsorted = false } = {}) => ({
  address: contractId, label: `oz:${keys.map((k) => k.name).join('+')}`,
  async signatureScVal(payload, entry, meta = {}) {
    const ids = ruleIds ?? Array(countContexts(entry.rootInvocation)).fill(ruleId);
    const digest = naive ? Buffer.from(payload) : ozAuthDigest(ctx.sdk, payload, ids);
    let sigs = [];
    for (const key of keys) sigs.push({ verifier, rawKey: key.rawPublicKey, signature: await ctx.signDigest(key, digest) });
    if (duplicate) sigs.push(sigs[0]);
    if (unsorted) sigs = sortSigners(ctx.sdk, sigs).reverse();
    Object.assign(meta, { scheme: naive ? 'raw-host-payload' : 'oz-auth-digest', rule_ids: ids, digest: digest.toString('hex'), signers: keys.map((k) => k.name), duplicate, unsorted });
    return ozAuthPayload(ctx.sdk, sigs, ids, { sorted: !duplicate && !unsorted });
  },
});
export const ozSignerOf = (c, key, id) => ({ id, verifier: c.verifier, rawKey: key.rawPublicKey, name: key.name });
export const signersVec = (sdk, list) => sdk.xdr.ScVal.scvVec(list.map((s) => ozSigner(sdk, s.verifier, s.rawKey)));

// A submission whose final status is unknown stops the whole run. Query the hash before any new submission.
export { UnknownSubmission } from './submission.mjs';
import { UnknownSubmission } from './submission.mjs';
async function sendOrStop(ctx, tx, label) {
  const hash = Buffer.from(tx.hash()).toString('hex');
  try { return await ctx.send(tx, label); } catch (e) {
    if (e instanceof UnknownSubmission) throw e;
    if (/submission outcome unknown|NOT_FOUND|TRY_AGAIN_LATER|timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(String(e.message))) throw new UnknownSubmission(label, hash, e);
    throw e;
  }
}

// ---------- auth entry helpers ----------
export function addressCredentials(entry) {
  const c = entry.credentials;
  if (c.type === 'sorobanCredentialsSourceAccount') return null;
  for (const [k, v] of Object.entries(c)) {
    if (k === 'type' || !v || typeof v !== 'object') continue;
    if ('nonce' in v) return v;
    if (v.addressCredentials && 'nonce' in v.addressCredentials) return v.addressCredentials;
  }
  throw new Error(`unsupported credentials ${c.type}`);
}
const entryAddress = (sdk, entry) => sdk.Address.fromScAddress(addressCredentials(entry).address).toString();
const cloneEntry = (sdk, entry) => sdk.xdr.SorobanAuthorizationEntry.fromXdr(entry.toXdr());
const normalizeAuth = (sdk, list) => (list ?? []).map((e) =>
  typeof e === 'string' ? sdk.xdr.SorobanAuthorizationEntry.fromXdr(e, 'base64') : e);
const rootArgs = (entry) => entry.rootInvocation.function.contractFn.args;
const childArgs = (entry) => entry.rootInvocation.subInvocations[0].function.contractFn.args;

function simulationText(sdk, sim) {
  let text = String(sim.error ?? '');
  for (const ev of sim.events ?? []) {
    try {
      const event = typeof ev === 'string' ? sdk.xdr.DiagnosticEvent.fromXdr(ev, 'base64') : ev;
      text += '\n' + JSON.stringify(sdk.scValToNative(event.event.body.v0.data), (_, v) => typeof v === 'bigint' ? String(v) : v);
    } catch { /* diagnostics are best effort */ }
  }
  return text;
}

// ---------- transactions ----------
async function buildTx(ctx, operation) {
  const account = await ctx.rpc.getAccount(ctx.keys.a.publicKey);
  return new ctx.sdk.TransactionBuilder(account, { fee: ctx.sdk.BASE_FEE, networkPassphrase: ctx.networkPassphrase })
    .addOperation(operation).setTimeout(120).build();
}
async function simulateCall(ctx, contractId, method, args) {
  const sim = await ctx.rpc.simulateTransaction(await buildTx(ctx, new ctx.sdk.Contract(contractId).call(method, ...args)), undefined, 'record');
  if (ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${method} read failed: ${sim.error}`);
  return sim;
}
export const readCount = async (ctx, target, who) =>
  Number(ctx.sdk.scValToNative((await simulateCall(ctx, target, 'count', [addr(ctx.sdk, who)])).result.retval));
async function readCounts(ctx, checks) {
  const out = [];
  for (const check of checks) out.push({ target: check.target, who: check.who, count: await readCount(ctx, check.target, check.who) });
  return out;
}
const readOwner = async (ctx, simple) =>
  Buffer.from(ctx.sdk.scValToNative((await simulateCall(ctx, simple, 'owner', [])).result.retval)).toString('hex');

export async function submitSourceOnly(ctx, operation, label) {
  const tx = await buildTx(ctx, operation);
  const sim = await ctx.rpc.simulateTransaction(tx, undefined, 'record');
  if (ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${label}: simulation failed: ${sim.error}`);
  const prepared = ctx.sdk.rpc.assembleTransaction(tx, sim).build();
  await ctx.sign(prepared, ctx.keys.a);
  return { sent: await sendOrStop(ctx, prepared, label), retval: sim.result?.retval };
}
async function expectSourceOnlyRejected(ctx, operation, label, expect) {
  const sim = await ctx.rpc.simulateTransaction(await buildTx(ctx, operation), undefined, 'record');
  if (!ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${label}: expected ${expect}, but simulation succeeded`);
  const text = simulationText(ctx.sdk, sim);
  if (!text.includes(expect)) throw new Error(`${label}: expected ${expect} in simulation error, got: ${text.slice(0, 800)}`);
  const top = String(sim.error).match(/^(?:HostError: )?(Error\([^)]*\))/)?.[1];
  if (![expect, 'Error(Context, InvalidAction)'].includes(top)) throw new Error(`${label}: unexpected top-level error ${top}`);
  return { outcome: 'simulation_rejected', expected: expect, error: text.slice(0, 2000) };
}

// invoke: build, record-simulate, sign each address entry, enforce-simulate, then submit.
// With `expect`, the enforce simulation must fail with that exact error text and no submission happens.
// `finalArgs` (optional) builds the submitted call with different arguments than the recorded one,
// for signature-binding negatives where both the call and the entry change after signing.
export async function invoke(ctx, { contractId, method, args = [], finalArgs, authorizers = [], label, expect, mutate, signPassphrase, presigned, state, expired = false, extraAuth }) {
  const { sdk, rpc, networkPassphrase } = ctx;
  const template = await buildTx(ctx, new sdk.Contract(contractId).call(method, ...args));
  const func = finalArgs ? (await buildTx(ctx, new sdk.Contract(contractId).call(method, ...finalArgs))).operations[0].func : template.operations[0].func;
  const checks = state ? [].concat(state) : [];
  const before = await readCounts(ctx, checks);
  const entries = [];
  let expiration;
  let auth = presigned ? normalizeAuth(sdk, presigned) : null;
  if (auth) auth.forEach((e) => entries.push({ replayed: true, variant: e.credentials.type, signed_xdr: e.toXdr('base64') }));
  if (!auth) {
    const recorded = await rpc.simulateTransaction(template, undefined, 'record');
    if (sdk.rpc.Api.isSimulationError(recorded)) throw new Error(`${label}: record simulation failed: ${recorded.error}`);
    expiration = expired ? recorded.latestLedger - 1 : recorded.latestLedger + EXPIRY_LEDGERS;
    auth = [];
    for (const raw of normalizeAuth(sdk, recorded.result?.auth)) {
      const entry = cloneEntry(sdk, raw);
      if (!addressCredentials(entry)) { auth.push(entry); continue; }
      const address = entryAddress(sdk, entry);
      const signer = authorizers.find((a) => a.address === address);
      if (!signer) throw new Error(`${label}: no authorizer for ${address}`);
      const meta = { variant: entry.credentials.type, address, signer: signer.label, nonce: String(addressCredentials(entry).nonce), expiration, unsigned_xdr: raw.toXdr('base64') };
      mutate?.beforeSign?.(entry);
      const signed = await sdk.authorizeEntry(entry, async (_preimage, payload) => {
        meta.payload = Buffer.from(payload).toString('hex');
        return { signatureScVal: await signer.signatureScVal(Buffer.from(payload), entry, meta), address };
      }, expiration, signPassphrase ?? networkPassphrase);
      mutate?.afterSign?.(signed);
      meta.signed_xdr = signed.toXdr('base64');
      entries.push(meta);
      auth.push(signed);
    }
  }
  if (extraAuth) auth.push(...await extraAuth({ auth, expiration, entries }));
  const auth_xdr = auth.map((e) => e.toXdr('base64'));
  const tx = await buildTx(ctx, sdk.Operation.invokeHostFunction({ func, auth }));
  const sim = await rpc.simulateTransaction(tx, undefined, 'enforce');
  const evidence = { call: { contract: contractId, method, args_xdr: args.map((a) => a.toXdr('base64')), final_args_xdr: finalArgs?.map((a) => a.toXdr('base64')) },
    sign_passphrase: signPassphrase ?? networkPassphrase, mutation: mutate ? Object.keys(mutate) : undefined, expired_on_purpose: expired || undefined,
    ledger_at_enforce: sim.latestLedger, credential_variants: auth.map((e) => e.credentials.type), entries, auth_xdr, unsigned_tx_xdr: tx.toXDR() };
  if (expect) {
    const expected = [].concat(expect);
    if (!sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${label}: expected ${expected.join(' or ')}, but enforce simulation succeeded`);
    const text = simulationText(sdk, sim);
    const matched = expected.find((e) => text.includes(e));
    if (!matched) throw new Error(`${label}: expected ${expected.join(' or ')} in simulation error, got: ${text.slice(0, 800)}`);
    const top = String(sim.error).match(/^(?:HostError: )?(Error\([^)]*\))/)?.[1];
    if (![matched, 'Error(Auth, InvalidAction)'].includes(top)) throw new Error(`${label}: unexpected top-level error ${top}`);
    const after = await readCounts(ctx, checks);
    after.forEach((a, i) => { if (a.count !== before[i].count) throw new Error(`${label}: state changed for ${a.who}: ${before[i].count} -> ${a.count}`); });
    return { outcome: 'simulation_rejected', expected: matched, top_level_error: top, error: text, state_before: before, state_after: after, ...evidence };
  }
  if (sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${label}: enforce simulation failed: ${sim.error}`);
  const prepared = sdk.rpc.assembleTransaction(tx, sim).build();
  await ctx.sign(prepared, ctx.keys.a);
  const sent = await sendOrStop(ctx, prepared, label);
  const after = await readCounts(ctx, checks);
  after.forEach((a, i) => { const want = before[i].count + (checks[i].delta ?? 1); if (a.count !== want) throw new Error(`${label}: expected count ${want} for ${a.who}, got ${a.count}`); });
  const retval = sdk.scValToNative(sim.result.retval);
  return { outcome: 'submitted', hash: sent.hash, ledger: sent.ledger, retval: typeof retval === 'bigint' ? String(retval) : retval, state_before: before, state_after: after, ...evidence };
}

// ---------- state and deployment ----------
function loadState() {
  return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE)) : { oz_commit: OZ_COMMIT, wasm: {}, contracts: {}, done: {} };
}
const saveState = (state) => {
  const temporary = new URL(`contracts-state.${process.pid}.tmp`, STATE_FILE);
  writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n');
  renameSync(temporary, STATE_FILE);
};

export function checkCheckpoint(state, manifest, ctx) {
  if (state.oz_commit !== OZ_COMMIT) throw new Error('Checkpoint OpenZeppelin revision mismatch');
  for (const [file, artifact] of Object.entries(manifest.artifacts)) {
    const hash = sha256(readFileSync(new URL(file, WASM_DIR))).toString('hex');
    if (hash !== artifact.sha256 || (state.wasm[file] && state.wasm[file].hash !== hash)) {
      throw new Error(`Checkpoint or artifact hash mismatch: ${file}`);
    }
  }
  const binding = { network: ctx.networkPassphrase, keys: ['a', 'b', 'c'].map(k => ctx.keys[k].publicKey) };
  if (state.binding && JSON.stringify(state.binding) !== JSON.stringify(binding)) throw new Error('Checkpoint network or public keys changed');
  if (!state.binding && Object.keys(state.contracts).length) throw new Error('Legacy checkpoint requires explicit network/key binding after evidence review');
  state.binding = binding;
  for (const contract of Object.values(state.contracts)) {
    if (!state.wasm[contract.wasm] || !manifest.artifacts[contract.wasm]) throw new Error('Checkpoint contract has no verified WASM');
  }
}

async function upload(ctx, state, file) {
  if (state.wasm[file]) return state.wasm[file];
  const wasm = readFileSync(new URL(file, WASM_DIR));
  const { sent } = await submitSourceOnly(ctx, ctx.sdk.Operation.uploadContractWasm({ wasm }), `upload-${file}`);
  state.wasm[file] = { hash: sha256(wasm).toString('hex'), tx: sent.hash };
  saveState(state);
  return state.wasm[file];
}
async function deploy(ctx, state, name, file, constructorArgs = []) {
  if (state.contracts[name]) return state.contracts[name].id;
  const wasmHash = Buffer.from((await upload(ctx, state, file)).hash, 'hex');
  const op = ctx.sdk.Operation.createCustomContract({ address: new ctx.sdk.Address(ctx.keys.a.publicKey), wasmHash, constructorArgs });
  const { sent, retval } = await submitSourceOnly(ctx, op, `deploy-${name}`);
  state.contracts[name] = { id: ctx.sdk.Address.fromScVal(retval).toString(), wasm: file, tx: sent.hash };
  saveState(state);
  return state.contracts[name].id;
}

async function setup(ctx, state) {
  const { sdk, keys } = ctx;
  const c = {};
  c.verifier = await deploy(ctx, state, 'ed25519_verifier', 'multisig_ed25519_verifier_example.wasm');
  c.threshold = await deploy(ctx, state, 'threshold_policy', 'multisig_threshold_policy_example.wasm');
  c.weighted = await deploy(ctx, state, 'weighted_policy', 'multisig_weighted_threshold_policy_example.wasm');
  c.target1 = await deploy(ctx, state, 'auth_target_1', 'walleterm_auth_target.wasm');
  c.target2 = await deploy(ctx, state, 'auth_target_2', 'walleterm_auth_target.wasm');
  c.simple = await deploy(ctx, state, 'simple_account_b', 'walleterm_simple_account.wasm', [bytes(sdk, keys.b.rawPublicKey)]);
  const all = sortSigners(sdk, [ozSignerOf(c, keys.a, 'a'), ozSignerOf(c, keys.b, 'b'), ozSignerOf(c, keys.c, 'c')]);
  c.ozBasic = await deploy(ctx, state, 'oz_basic_a', 'multisig_account_example.wasm',
    [signersVec(sdk, [ozSignerOf(c, keys.a, 'a')]), scMap(sdk, [])]);
  c.ozMulti = await deploy(ctx, state, 'oz_multisig_2of3', 'multisig_account_example.wasm',
    [signersVec(sdk, all), scMap(sdk, [[addr(sdk, c.threshold), scMap(sdk, [[sym(sdk, 'threshold'), u32(sdk, 2)]])]])]);
  const weight = { a: 2, b: 1, c: 1 };  // stable a/b/c identity, independent of key names
  c.ozWeighted = await deploy(ctx, state, 'oz_weighted_a2_b1_c1_t2', 'multisig_account_example.wasm',
    [signersVec(sdk, all), scMap(sdk, [[addr(sdk, c.weighted), scMap(sdk, [
      [sym(sdk, 'signer_weights'), scMap(sdk, all.map((s) => [ozSigner(sdk, s.verifier, s.rawKey), u32(sdk, weight[s.id])]))],
      [sym(sdk, 'threshold'), u32(sdk, 2)],
    ])]])]);
  return c;
}

// ---------- matrix rows ----------
const ROWS = [
  { id: 'C01', title: 'G-account address credentials (payer A, signer B)', async run(ctx, c) {
    const { keys } = ctx;
    return invoke(ctx, { contractId: c.target1, method: 'ping', args: [addr(ctx.sdk, keys.b.publicKey), u32(ctx.sdk, 1)],
      authorizers: [gAuthorizer(ctx, keys.b)], label: 'C01-g-address-auth', state: { target: c.target1, who: keys.b.publicKey } });
  } },
  { id: 'C02', title: 'Minimal C-account, raw payload signature', async run(ctx, c) {
    const { sdk, keys } = ctx;
    const args = [addr(sdk, c.simple), u32(sdk, 1)];
    const state = { target: c.target1, who: c.simple };
    return {
      owner_b_passes: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [simpleAuthorizer(ctx, c.simple, keys.b)], label: 'C02-simple-owner', state }),
      key_c_rejected: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [simpleAuthorizer(ctx, c.simple, keys.c)], label: 'C02-simple-wrong-key', expect: ERR.crypto, state }),
    };
  } },
  { id: 'C03', title: 'OpenZeppelin account, one signer, no policy (rule 0)', async run(ctx, c) {
    const { sdk, keys } = ctx;
    const args = [addr(sdk, c.ozBasic), u32(sdk, 1)];
    const state = { target: c.target1, who: c.ozBasic };
    return {
      digest_signature_passes: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [ozAuthorizer(ctx, c.ozBasic, c.verifier, [keys.a])], label: 'C03-oz-basic', state }),
      naive_host_payload_rejected: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [ozAuthorizer(ctx, c.ozBasic, c.verifier, [keys.a], { naive: true })], label: 'C03-oz-naive-payload', expect: ERR.crypto, state }),
    };
  } },
  { id: 'C04', title: 'OpenZeppelin 2-of-3 simple threshold', async run(ctx, c) {
    const { sdk, keys } = ctx;
    const args = [addr(sdk, c.ozMulti), u32(sdk, 1)];
    const state = { target: c.target1, who: c.ozMulti };
    return {
      a_b_pass: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.b])], label: 'C04-oz-2of3-ab', state }),
      a_alone_rejected: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a])], label: 'C04-oz-2of3-a-only', expect: ERR.notAllowed, state }),
    };
  } },
  { id: 'C05', title: 'OpenZeppelin weighted threshold a=2 b=1 c=1, threshold 2', async run(ctx, c) {
    const { sdk, keys } = ctx;
    const args = [addr(sdk, c.ozWeighted), u32(sdk, 1)];
    const state = { target: c.target1, who: c.ozWeighted };
    return {
      a_weight2_passes: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [ozAuthorizer(ctx, c.ozWeighted, c.verifier, [keys.a])], label: 'C05-weighted-a', state }),
      b_weight1_rejected: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [ozAuthorizer(ctx, c.ozWeighted, c.verifier, [keys.b])], label: 'C05-weighted-b-only', expect: ERR.weightNotAllowed, state }),
      b_c_weight2_passes: await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [ozAuthorizer(ctx, c.ozWeighted, c.verifier, [keys.b, keys.c])], label: 'C05-weighted-bc', state }),
    };
  } },
  { id: 'C06', title: 'Two C-accounts authorize one invocation', async run(ctx, c) {
    const { sdk, keys } = ctx;
    return invoke(ctx, { contractId: c.target1, method: 'ping2', args: [addr(sdk, c.ozBasic), addr(sdk, c.simple), u32(sdk, 1)],
      authorizers: [ozAuthorizer(ctx, c.ozBasic, c.verifier, [keys.a]), simpleAuthorizer(ctx, c.simple, keys.b)], label: 'C06-two-c-accounts',
      state: [{ target: c.target1, who: c.ozBasic }, { target: c.target1, who: c.simple }] });
  } },
  { id: 'C07', title: 'G-account and C-account authorize one invocation', async run(ctx, c) {
    const { sdk, keys } = ctx;
    return invoke(ctx, { contractId: c.target1, method: 'ping2', args: [addr(sdk, keys.b.publicKey), addr(sdk, c.ozMulti), u32(sdk, 1)],
      authorizers: [gAuthorizer(ctx, keys.b), ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.c])], label: 'C07-mixed-g-c',
      state: [{ target: c.target1, who: keys.b.publicKey }, { target: c.target1, who: c.ozMulti }] });
  } },
  { id: 'C08', title: 'Nested tree: outer(ozMulti, target2) -> target2.ping', async run(ctx, c) {
    const { sdk, keys } = ctx;
    const args = [addr(sdk, c.ozMulti), addr(sdk, c.target2), u32(sdk, 1)];
    const state = { target: c.target2, who: c.ozMulti };
    const oz = (opts) => [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.b], opts)];
    return {
      full_tree_passes: await invoke(ctx, { contractId: c.target1, method: 'outer', args, authorizers: oz(), label: 'C08-nested-full-tree', state }),
      altered_child_rejected: await invoke(ctx, { contractId: c.target1, method: 'outer', args, authorizers: oz(), label: 'C08-nested-altered-child', expect: ERR.auth, state,
        mutate: { beforeSign: (entry) => { childArgs(entry)[1] = u32(sdk, 2); } } }),
      one_rule_id_for_two_contexts_rejected: await invoke(ctx, { contractId: c.target1, method: 'outer', args, authorizers: oz({ ruleIds: [0] }), label: 'C08-nested-rule-ids-mismatch', expect: ERR.ruleIdsMismatch, state }),
      rebound_call_and_entry_rejected: await invoke(ctx, { contractId: c.target1, method: 'outer', args, finalArgs: [addr(sdk, c.ozMulti), addr(sdk, c.target2), u32(sdk, 2)], authorizers: oz(), label: 'C08-nested-rebound-args', expect: ERR.crypto, state,
        mutate: { afterSign: (entry) => { rootArgs(entry)[2] = u32(sdk, 2); childArgs(entry)[1] = u32(sdk, 2); } } }),
    };
  } },
  { id: 'C09', title: 'Sponsor (A) submits for independent signers', status: 'covered_by', async run(ctx, c, state) {
    if (!state.done.C01) throw new Error('C09 depends on C01');
    return { covered_by: ['C01', 'C02', 'C03', 'C04'], payer: ctx.keys.a.publicKey, note: 'Every row uses key A as envelope source and fee payer while other keys or C-accounts sign the auth entries.', c01_hash: state.done.C01.hash };
  } },
  { id: 'C10', title: 'Wrong nonce, network, signer, root args, expired signature', async run(ctx, c) {
    const { sdk, keys } = ctx;
    const simpleArgs = [addr(sdk, c.simple), u32(sdk, 1)];
    const simpleState = { target: c.target1, who: c.simple };
    const simple = [simpleAuthorizer(ctx, c.simple, keys.b)];
    return {
      wrong_nonce: await invoke(ctx, { contractId: c.target1, method: 'ping', args: simpleArgs, authorizers: simple, label: 'C10-wrong-nonce', expect: ERR.crypto, state: simpleState,
        mutate: { afterSign: (entry) => { const creds = addressCredentials(entry); creds.nonce = BigInt(creds.nonce) + 1n; } } }),
      wrong_network: await invoke(ctx, { contractId: c.target1, method: 'ping', args: simpleArgs, authorizers: simple, label: 'C10-wrong-network', expect: ERR.crypto, state: simpleState, signPassphrase: sdk.Networks.PUBLIC }),
      wrong_signer: await invoke(ctx, { contractId: c.target1, method: 'ping', args: [addr(sdk, c.ozBasic), u32(sdk, 1)], authorizers: [ozAuthorizer(ctx, c.ozBasic, c.verifier, [keys.c])], label: 'C10-wrong-signer', expect: ERR.unvalidatedContext, state: { target: c.target1, who: c.ozBasic } }),
      altered_root_args: await invoke(ctx, { contractId: c.target1, method: 'ping', args: simpleArgs, authorizers: simple, label: 'C10-altered-root-args', expect: ERR.auth, state: simpleState,
        mutate: { afterSign: (entry) => { rootArgs(entry)[1] = u32(sdk, 2); } } }),
      rebound_call_and_entry_rejected: await invoke(ctx, { contractId: c.target1, method: 'ping', args: simpleArgs, finalArgs: [addr(sdk, c.simple), u32(sdk, 2)], authorizers: simple, label: 'C10-rebound-args', expect: ERR.crypto, state: simpleState,
        mutate: { afterSign: (entry) => { rootArgs(entry)[1] = u32(sdk, 2); } } }),
      expired_signature: { ...await invoke(ctx, { contractId: c.target1, method: 'ping', args: simpleArgs, authorizers: simple, label: 'C10-expired-signature',
        expect: 'Error(Auth, InvalidInput)', state: simpleState, expired: true }) },
    };
  } },
  { id: 'C11', title: 'Replay of consumed credentials under a fresh envelope', async run(ctx, c) {
    const { sdk, keys } = ctx;
    const args = [addr(sdk, keys.b.publicKey), u32(sdk, 1)];
    const state = { target: c.target1, who: keys.b.publicKey };
    // Fresh success first, so the replay fails on the consumed nonce and not on expiry.
    const fresh = await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [gAuthorizer(ctx, keys.b)], label: 'C11-fresh-success', state });
    const replay = await invoke(ctx, { contractId: c.target1, method: 'ping', args, presigned: fresh.auth_xdr, label: 'C11-replay', expect: ERR.nonceConsumed, state });
    if (JSON.stringify(replay.auth_xdr) !== JSON.stringify(fresh.auth_xdr)) throw new Error('C11: replayed credential bytes differ from the fresh entry');
    const expiration = Math.min(...fresh.entries.map((e) => e.expiration));
    if (replay.ledger_at_enforce > expiration) throw new Error(`C11: credentials expired (ledger ${replay.ledger_at_enforce} > ${expiration}) before the replay; nonce consumption not proven`);
    return { fresh, replay, identical_credential_bytes: true, expiration, ledger_at_replay: replay.ledger_at_enforce };
  } },
  { id: 'C12', title: 'Duplicates: signature serialization versus signer registration', async run(ctx, c, state) {
    const { sdk, keys } = ctx;
    const ozArgs = [addr(sdk, c.ozMulti), u32(sdk, 1)];
    const ozState = { target: c.target1, who: c.ozMulti };
    const recorded = 'Error(Object, InvalidInput)'; // Observed live: invalid ScMap order or duplicate keys.
    return {
      g_duplicate_signature_vector: await invoke(ctx, { contractId: c.target1, method: 'ping', args: [addr(sdk, keys.b.publicKey), u32(sdk, 1)],
        authorizers: [gAuthorizer(ctx, keys.b, { duplicate: true })], label: 'C12-g-duplicate-signature', expect: ERR.accountSigs, state: { target: c.target1, who: keys.b.publicKey } }),
      oz_duplicate_map_entry: { ...await invoke(ctx, { contractId: c.target1, method: 'ping', args: ozArgs,
        authorizers: [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.b], { duplicate: true })], label: 'C12-oz-duplicate-map-entry', expect: recorded, state: ozState }) },
      oz_unsorted_map: { ...await invoke(ctx, { contractId: c.target1, method: 'ping', args: ozArgs,
        authorizers: [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.b], { unsorted: true })], label: 'C12-oz-unsorted-map', expect: recorded, state: ozState }) },
      oz_duplicate_registered_signer: await expectSourceOnlyRejected(ctx, sdk.Operation.createCustomContract({
        address: new sdk.Address(keys.a.publicKey), wasmHash: Buffer.from(state.wasm['multisig_account_example.wasm'].hash, 'hex'),
        constructorArgs: [signersVec(sdk, [ozSignerOf(c, keys.a, 'a'), ozSignerOf(c, keys.a, 'a')]), scMap(sdk, [])] }),
        'C12-oz-duplicate-signer-deploy', 'Error(Contract, #3007)'),
    };
  } },
  { id: 'C13', title: 'Simple account owner rotation b -> c -> b', async run(ctx, c) {
    const { sdk, keys } = ctx;
    const args = [addr(sdk, c.simple), u32(sdk, 1)];
    const state = { target: c.target1, who: c.simple };
    const setOwner = (to, by, label) => invoke(ctx, { contractId: c.simple, method: 'set_owner', args: [bytes(sdk, to.rawPublicKey)], authorizers: [simpleAuthorizer(ctx, c.simple, by)], label });
    const keyFor = (hex) => [keys.a, keys.b, keys.c].find((k) => k.rawPublicKey.toString('hex') === hex);
    const details = { initial_owner_hex: await readOwner(ctx, c.simple) };
    const initial = keyFor(details.initial_owner_hex);
    if (!initial) throw new Error(`C13: simple account owner ${details.initial_owner_hex} is not a test key`);
    if (initial !== keys.b) details.recovered_to_b = await setOwner(keys.b, initial, 'C13-recover-owner-b');
    details.rotate_to_c = await setOwner(keys.c, keys.b, 'C13-set-owner-c');
    let failure;
    try {
      details.old_owner_rejected = await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [simpleAuthorizer(ctx, c.simple, keys.b)], label: 'C13-old-owner', expect: ERR.crypto, state });
      details.new_owner_passes = await invoke(ctx, { contractId: c.target1, method: 'ping', args, authorizers: [simpleAuthorizer(ctx, c.simple, keys.c)], label: 'C13-new-owner', state });
    } catch (e) { failure = e; failure.details = details; }
    // An unknown submission stops here. No restoration signing until the hash is resolved.
    if (failure instanceof UnknownSubmission) throw failure;
    // Otherwise restore owner B so a rerun starts from the deployed state. The next run also self-recovers via readOwner.
    try { details.restore_to_b = await setOwner(keys.b, keys.c, 'C13-restore-owner-b'); }
    catch (e) { if (e instanceof UnknownSubmission || !failure) throw e; details.restore_error = String(e.message); }
    if (failure) throw failure;
    details.final_owner_hex = await readOwner(ctx, c.simple);
    if (details.final_owner_hex !== keys.b.rawPublicKey.toString('hex')) throw new Error('C13: owner restoration mismatch');
    return details;
  } },
];

export const NOT_IMPLEMENTED = [
  'Forced V1 credentials in this baseline runner; separate CLI usability evidence covers one legacy OZ case',
  'CAP-71 delegate credentials',
  'passkeys',
];

export async function runContracts(ctx) {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', WASM_DIR)));
  if (manifest.oz_commit !== OZ_COMMIT) throw new Error(`fixtures built from ${manifest.oz_commit}, expected ${OZ_COMMIT}`);
  const state = loadState();
  checkCheckpoint(state, manifest, ctx);
  const selected = new Set((ctx.rows ?? process.env.WALLETERM_ROWS?.split(',') ?? ROWS.map((r) => r.id)).map((s) => s.trim()));
  for (const id of selected) if (!ROWS.some(row => row.id === id)) throw new Error(`Unknown contract test row: ${id}`);
  for (const key of [ctx.keys.a, ctx.keys.b, ctx.keys.c]) await ctx.fund(key);
  let c;
  try { c = await setup(ctx, state); } catch (e) {
    ctx.record('C-setup', e instanceof UnknownSubmission ? 'blocked' : 'failed', { tx_hash: e.hash, error: String(e.message), contracts: state.contracts });
    throw e;
  }
  ctx.record('C-setup', 'passed', { oz_commit: OZ_COMMIT, wasm: manifest.artifacts, contracts: state.contracts, payer: ctx.keys.a.publicKey });
  const failures = [];
  for (const row of ROWS) {
    if (!selected.has(row.id)) { ctx.record(row.id, 'not_run', { title: row.title, reason: 'not selected' }); continue; }
    try {
      const details = await row.run(ctx, c, state);
      state.done[row.id] = details;
      saveState(state);
      ctx.record(row.id, row.status ?? 'passed', { title: row.title, ...details });
    } catch (e) {
      if (e instanceof UnknownSubmission) {
        ctx.record(row.id, 'blocked', { title: row.title, tx_hash: e.hash, error: String(e.message), action: 'query this hash before any new submission' });
        throw e;
      }
      ctx.record(row.id, 'failed', { title: row.title, error: String(e.stack ?? e), ...(e.details ? { partial: e.details } : {}) });
      failures.push(e);
      if (ctx.stopOnFailure) throw e;
    }
  }
  ctx.record('C-not-implemented', 'not_run', { items: NOT_IMPLEMENTED });
  ctx.record('C-run-scope', failures.length ? 'failed' : 'passed', { selected: [...selected], full_suite: selected.size === ROWS.length, fresh_execution: [...selected].filter(id => id !== 'C09'), coverage_reference: selected.has('C09') ? ['C09'] : [] });
  if (failures.length) throw new AggregateError(failures, 'Contract acceptance failed; inspect results-contracts.json');
  return state;
}

// ---------- offline self-test ----------
async function selfTest() {
  const sdk = await import('@stellar/stellar-sdk');
  const assert = (cond, msg) => { if (!cond) throw new Error(`self-test: ${msg}`); };
  assert(ruleIdsXdr(sdk, [0]).toString('hex') === '0000001000000001000000010000000300000000', 'rule ids [0] xdr');
  assert(ruleIdsXdr(sdk, [0, 1]).toString('hex') === '00000010000000010000000200000003000000000000000300000001', 'rule ids [0,1] xdr');
  const verifier = 'CDLDYJWEZSM6IAI4HHPEZTTV65WX4OVN3RZD3U6LQKYAVIZTEK7XYAYT';
  const exampleKey = Buffer.from('3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29', 'hex');
  const vector = ozAuthPayload(sdk, [{ verifier, rawKey: exampleKey, signature: Buffer.alloc(64) }], [0]).toXdr('base64');
  assert(vector === 'AAAAEQAAAAEAAAACAAAADwAAABBjb250ZXh0X3J1bGVfaWRzAAAAEAAAAAEAAAABAAAAAwAAAAAAAAAPAAAAB3NpZ25lcnMAAAAAEQAAAAEAAAABAAAAEAAAAAEAAAADAAAADwAAAAhFeHRlcm5hbAAAABIAAAAB1jwmxMyZ5AEcOd5MznX3bX46rdxyPdPLgrAKozMiv3wAAAANAAAAIDtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdopAAAADQAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'AuthPayload matches docs/OPENZEPPELIN.md vector');

  const kp = sdk.Keypair.random();
  const key = { name: 'mock', publicKey: kp.publicKey(), rawPublicKey: kp.rawPublicKey() };
  const ctx = { sdk, signDigest: async (k, digest) => { assert(k === key && digest.length === 32, 'signDigest args'); return Buffer.from(kp.sign(digest)); } };
  const target = sdk.Keypair.random().publicKey();
  const fn = (name, args, subs = []) => new sdk.xdr.SorobanAuthorizedInvocation({
    function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new sdk.xdr.InvokeContractArgs({
      contractAddress: new sdk.Address(verifier).toScAddress(), functionName: name, args })), subInvocations: subs });
  const tree = fn('outer', [addr(sdk, target), u32(sdk, 1)], [fn('ping', [addr(sdk, target), u32(sdk, 1)])]);
  assert(countContexts(tree) === 2, 'countContexts');
  const entryFor = (address) => new sdk.xdr.SorobanAuthorizationEntry({ credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddress(
    new sdk.xdr.SorobanAddressCredentials({ address: new sdk.Address(address).toScAddress(), nonce: 7n, signatureExpirationLedger: 0, signature: sdk.xdr.ScVal.scvVoid() })), rootInvocation: tree });
  const payloadOf = (entry, exp) => Buffer.from(sdk.hash(sdk.buildAuthorizationEntryPreimage(entry, exp, sdk.Networks.TESTNET).toXdr()));

  const ozEntry = entryFor(verifier);
  const ozSigned = await sdk.authorizeEntry(cloneEntry(sdk, ozEntry), async (_p, payload) =>
    ({ signatureScVal: await ozAuthorizer(ctx, verifier, verifier, [key]).signatureScVal(Buffer.from(payload), ozEntry), address: verifier }), 500, sdk.Networks.TESTNET);
  const ozNative = sdk.scValToNative(addressCredentials(ozSigned).signature);
  assert(JSON.stringify(ozNative.context_rule_ids) === '[0,0]', 'two rule ids for two contexts');
  const ozSig = Buffer.from(Object.values(ozNative.signers)[0]);
  assert(kp.verify(ozAuthDigest(sdk, payloadOf(ozEntry, 500), [0, 0]), ozSig), 'OZ signature over auth digest');
  assert(!kp.verify(payloadOf(ozEntry, 500), ozSig), 'OZ signature is not over the raw payload');
  assert(addressCredentials(ozSigned).signatureExpirationLedger === 500, 'expiration applied');

  const gEntry = entryFor(key.publicKey);
  const gSigned = await sdk.authorizeEntry(cloneEntry(sdk, gEntry), async (_p, payload) =>
    ({ signatureScVal: await gAuthorizer(ctx, key).signatureScVal(Buffer.from(payload)), address: key.publicKey }), 500, sdk.Networks.TESTNET);
  const gRef = await sdk.authorizeEntry(cloneEntry(sdk, gEntry), kp, 500, sdk.Networks.TESTNET);
  assert(gSigned.toXdr('base64') === gRef.toXdr('base64'), 'G signature ScVal equals the SDK keypair path');

  const simpleSigned = await sdk.authorizeEntry(cloneEntry(sdk, ozEntry), async (_p, payload) =>
    ({ signatureScVal: await simpleAuthorizer(ctx, verifier, key).signatureScVal(Buffer.from(payload)), address: verifier }), 500, sdk.Networks.TESTNET);
  assert(kp.verify(payloadOf(ozEntry, 500), Buffer.from(sdk.scValToNative(addressCredentials(simpleSigned).signature))), 'simple account signature over raw payload');

  const mutated = cloneEntry(sdk, gSigned);
  addressCredentials(mutated).nonce = 8n; rootArgs(mutated)[1] = u32(sdk, 2); childArgs(mutated)[1] = u32(sdk, 3);
  assert(String(addressCredentials(gSigned).nonce) === '7' && mutated.toXdr('base64') !== gSigned.toXdr('base64'), 'clone mutation is independent');
  const dup = await gAuthorizer(ctx, key, { duplicate: true }).signatureScVal(Buffer.alloc(32));
  assert(sdk.scValToNative(dup).length === 2, 'duplicate G signature vector');
  const two = [{ verifier, rawKey: Buffer.alloc(32, 1), signature: Buffer.alloc(64) }, { verifier, rawKey: Buffer.alloc(32, 2), signature: Buffer.alloc(64) }];
  assert(ozAuthPayload(sdk, two, [0]).toXdr('base64') === ozAuthPayload(sdk, [two[1], two[0]], [0]).toXdr('base64'), 'sorted map is order independent');
  assert(ozAuthPayload(sdk, [two[1], two[0]], [0], { sorted: false }).toXdr('base64') !== ozAuthPayload(sdk, two, [0]).toXdr('base64'), 'unsorted map differs');
  assert(new UnknownSubmission('x', 'h', new Error('got NOT_FOUND')).hash === 'h', 'unknown submission marker');
  const op = sdk.Operation.createCustomContract({ address: new sdk.Address(key.publicKey), wasmHash: Buffer.alloc(32), constructorArgs: [u32(sdk, 1)] });
  assert(op && typeof sdk.Address.fromScVal === 'function' && sdk.BASE_FEE === '100', 'deploy helpers available');
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', WASM_DIR)));
  assert(manifest.oz_commit === OZ_COMMIT && Object.keys(manifest.artifacts).length === 6, 'manifest has six artifacts at the pinned commit');
  console.log(JSON.stringify({ ok: true, self_test: 'contracts.mjs', rows: ROWS.map((r) => r.id), not_implemented: NOT_IMPLEMENTED }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest().catch((e) => { console.error(e); process.exit(1); });
}
