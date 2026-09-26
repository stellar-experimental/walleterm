import { requestError } from '../sdk/errors.ts';
// Extended contract-account coverage: rows E01-E03. Exports runExtended(ctx).
// ctx comes from tests/live-utils.ts. `bun tests/extended-contracts.ts` runs the offline self-test.
//
// E01 native G-account weighted multisig (B with signers A and C), sorted multi-signature entries.
// E02 OpenZeppelin `Signer::Delegated(G_b)`: a second auth entry rooted at oz.__check_auth([auth_digest]).
// E03 OpenZeppelin contract-specific context rule, threshold update through `execute`, rule removal.
//
// Shared helpers: invoke (with extraAuth), submitSourceOnly, checkCheckpoint, UnknownSubmission,
// addressCredentials, and the ScVal builders. Deployments use a separate checkpoint file.
// The baseline checkpoint (nine instances) is validated and read only.
import { readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import type { Transaction, xdr } from '@stellar/stellar-sdk';
import {
  invoke,
  submitSourceOnly,
  checkCheckpoint,
  UnknownSubmission,
  addressCredentials,
  ERR,
  OZ_COMMIT,
  scMap,
  ozSigner,
  ozSignerOf,
  signersVec,
  ozAuthDigest,
  countContexts,
  ozAuthorizer,
  accountSignature,
  requireAddressCredentials,
  type CheckpointContext,
  type ContractsState,
  type EntryMeta,
  type ExtraAuthInput,
  type InvokeOptions,
  type Manifest,
} from './contracts.ts';
import { errorHash } from './submission.ts';
import type { Details, LiveContext, Sdk, SigningContext, TestKey } from './types.ts';
import type { RequestError } from '../sdk/errors.ts';

const BASE_STATE = new URL('../evidence/live/contracts-state.json', import.meta.url); // read only
const STATE_FILE = new URL('../evidence/live/extended-state.json', import.meta.url);
const MANIFEST = new URL('../fixtures/wasm/manifest.json', import.meta.url);
const EXPIRY_LEDGERS = 60;
export const E = {
  ...ERR,
  accountAuth: 'Error(Contract, #5)', // built-in account: unordered, duplicate, unknown signer, or weight below threshold
  ruleNotFound: 'Error(Contract, #3000)', // OZ ContextRuleNotFound
  unvalidated: 'Error(Contract, #3002)', // OZ UnvalidatedContext (context type mismatch, or missing signer on a no-policy rule)
};
const B_MULTISIG = { masterWeight: 1, lowThreshold: 1, medThreshold: 2, highThreshold: 2, signerWeight: 1 };
// Host diagnostics from soroban-env-host v27.0.0 builtin_contracts/account_contract.rs (lines 213 and 258).
// Both failures share Error(Contract, #5), so the message distinguishes ordering from weight.
export const ACCOUNT_DIAG = {
  unordered: 'public keys are not ordered',
  weight: 'signature weight is lower than threshold',
};
export const ROW_IDS = ['E01', 'E02', 'E03'];

// ---------- shapes ----------
/** Account B thresholds and signers, as Horizon reports them. */
interface AccountSnapshot {
  thresholds: { low: number; med: number; high: number };
  signers: { key: string; weight: number; type: string }[];
}
interface Binding {
  network: string;
  keys: string[];
  oz_commit: string;
  base_wasm: Record<string, string>;
  base_contracts: Record<string, string>;
}
/** evidence/live/extended-state.json. */
export interface ExtendedState {
  oz_commit: string;
  contracts: Record<string, { id: string; wasm: string; wasm_sha256: string; tx?: string }>;
  done: Record<string, Details>;
  steps: Record<string, Details>;
  binding?: Binding;
  b_original?: AccountSnapshot;
  b_modified?: boolean;
  e03?: { created_tx?: unknown; removed_tx?: unknown };
}
type RowDetails = Details & { reused_steps?: string[]; preserved_steps?: Record<string, unknown> };
/** A row error can carry the evidence gathered before it failed. */
type RowFailure = RequestError & { details?: Details };
interface BaseContracts {
  verifier: string;
  threshold: string;
  target1: string;
  target2: string;
}
type ExtendedContext = Pick<LiveContext, 'sdk' | 'rpc' | 'networkPassphrase' | 'keys' | 'sign' | 'send'>;
export type MixedSignature =
  | { kind: 'Delegated'; address: string; signature: Uint8Array }
  | { kind: 'External'; verifier: string; rawKey: Uint8Array; signature: Uint8Array };

const sym = (sdk: Sdk, s: string) => sdk.xdr.ScVal.scvSymbol(s);
const u32 = (sdk: Sdk, n: number) => sdk.xdr.ScVal.scvU32(n);
const bytes = (sdk: Sdk, b: Uint8Array) => sdk.xdr.ScVal.scvBytes(Buffer.from(b));
const addr = (sdk: Sdk, a: string) => sdk.nativeToScVal(a, { type: 'address' });
const str = (sdk: Sdk, s: string) => sdk.xdr.ScVal.scvString(s);

// ---------- ScVal builders for OZ types not covered by contracts.ts ----------
export const delegatedSigner = (sdk: Sdk, address: string) =>
  sdk.xdr.ScVal.scvVec([sym(sdk, 'Delegated'), addr(sdk, address)]);
export function contextRuleType(sdk: Sdk, kind: 'Default'): xdr.ScVal;
export function contextRuleType(sdk: Sdk, kind: 'CallContract', value: string): xdr.ScVal;
export function contextRuleType(sdk: Sdk, kind: 'CreateContract', value: Uint8Array): xdr.ScVal;
export function contextRuleType(
  sdk: Sdk,
  kind: 'Default' | 'CallContract' | 'CreateContract',
  value?: string | Uint8Array,
) {
  if (kind === 'Default') return sdk.xdr.ScVal.scvVec([sym(sdk, 'Default')]);
  if (kind === 'CallContract' && typeof value === 'string')
    return sdk.xdr.ScVal.scvVec([sym(sdk, 'CallContract'), addr(sdk, value)]);
  if (kind === 'CreateContract' && value instanceof Uint8Array)
    return sdk.xdr.ScVal.scvVec([sym(sdk, 'CreateContract'), bytes(sdk, value)]);
  throw new TypeError(`Invalid ${kind} context rule value.`);
}
// Host map order for Signer keys: Vec compare -> Symbol ("Delegated" < "External"), then ScAddress XDR, then key bytes.
const signerSortKey = (sdk: Sdk, s: MixedSignature) =>
  Buffer.concat([
    Buffer.from(s.kind === 'Delegated' ? [0] : [1]),
    new sdk.Address(s.kind === 'Delegated' ? s.address : s.verifier).toScAddress().toXdr(),
    s.kind === 'Delegated' ? Buffer.alloc(0) : Buffer.from(s.rawKey),
  ]);
export function mixedAuthPayload(sdk: Sdk, sigs: MixedSignature[], ids: number[]) {
  const sorted = [...sigs].sort((p, q) => Buffer.compare(signerSortKey(sdk, p), signerSortKey(sdk, q)));
  return scMap(sdk, [
    [sym(sdk, 'context_rule_ids'), sdk.xdr.ScVal.scvVec(ids.map((id) => u32(sdk, id)))],
    [
      sym(sdk, 'signers'),
      scMap(
        sdk,
        sorted.map((s): [xdr.ScVal, xdr.ScVal] => [
          s.kind === 'Delegated' ? delegatedSigner(sdk, s.address) : ozSigner(sdk, s.verifier, s.rawKey),
          bytes(sdk, s.signature),
        ]),
      ),
    ],
  ]);
}
export const contractFn = (
  sdk: Sdk,
  contract: string,
  name: string,
  args: xdr.ScVal[],
  subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
) =>
  new sdk.xdr.SorobanAuthorizedInvocation({
    function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new sdk.xdr.InvokeContractArgs({
        contractAddress: new sdk.Address(contract).toScAddress(),
        functionName: name,
        args,
      }),
    ),
    subInvocations,
  });

// ---------- G-account multisig authorizer (several signers on one entry) ----------
export const gMultiAuthorizer = (
  ctx: SigningContext,
  address: string,
  keys: TestKey[],
  { reverse = false, duplicate = false } = {},
) => ({
  address,
  label: `G-multi:${keys.map((k) => k.name).join('+')}`,
  async signatureScVal(payload: Buffer, _entry?: xdr.SorobanAuthorizationEntry, meta: EntryMeta = {}) {
    const sigs = [];
    for (const key of keys)
      sigs.push({ rawKey: key.rawPublicKey, signature: await ctx.signDigest(key, payload) });
    if (duplicate) sigs.push(sigs[0]);
    sigs.sort((p, q) => Buffer.compare(Buffer.from(p.rawKey), Buffer.from(q.rawKey)));
    if (reverse) sigs.reverse();
    Object.assign(meta, {
      scheme: 'g-account-multisig',
      signers: keys.map((k) => k.name),
      order: reverse ? 'reversed' : 'sorted',
      duplicate,
      digest: Buffer.from(payload).toString('hex'),
    });
    return accountSignature(ctx.sdk, sigs);
  },
});

// ---------- local transaction helpers ----------
async function buildTx(ctx: ExtendedContext, source: string, operations: xdr.Operation[]) {
  const account = await ctx.rpc.getAccount(source);
  const builder = new ctx.sdk.TransactionBuilder(account, {
    fee: String(100 * operations.length),
    networkPassphrase: ctx.networkPassphrase,
  });
  operations.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(120).build();
}
async function sendOrStop(ctx: ExtendedContext, tx: Transaction, label: string) {
  const hash = Buffer.from(tx.hash()).toString('hex');
  try {
    return await ctx.send(tx, label);
  } catch (eValue) {
    const e = requestError(eValue);
    if (e instanceof UnknownSubmission || e?.code === 'unknown_submission') throw e;
    if (
      /submission outcome (is )?unknown|NOT_FOUND|TRY_AGAIN_LATER|timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(
        String(e.message),
      )
    )
      throw new UnknownSubmission(label, hash, e);
    throw e;
  }
}
// Classic operations from `source`, envelope signed by each key in `signers` through walleterm.
async function submitClassic(
  ctx: ExtendedContext,
  source: TestKey,
  operations: xdr.Operation[],
  signers: TestKey[],
  label: string,
) {
  const tx = await buildTx(ctx, source.publicKey, operations);
  for (const key of signers) await ctx.sign(tx, key);
  const sent = await sendOrStop(ctx, tx, label);
  return {
    hash: sent.hash,
    ledger: sent.ledger,
    signers: signers.map((k) => k.name),
    envelope_xdr: tx.toXDR(),
  };
}
async function readScVal(ctx: ExtendedContext, contractId: string, method: string, args: xdr.ScVal[]) {
  const sim = await ctx.rpc.simulateTransaction(
    await buildTx(ctx, ctx.keys.a.publicKey, [new ctx.sdk.Contract(contractId).call(method, ...args)]),
    undefined,
    'record',
  );
  if (ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${method} read failed: ${sim.error}`);
  if (!sim.result) throw new Error(`${method} read returned no result`);
  return sim.result.retval;
}
const entryAddress = (sdk: Sdk, entry: xdr.SorobanAuthorizationEntry) =>
  sdk.Address.fromScAddress(requireAddressCredentials(entry).address).toString();
const cloneEntry = (sdk: Sdk, entry: xdr.SorobanAuthorizationEntry) =>
  sdk.xdr.SorobanAuthorizationEntry.fromXdr(entry.toXdr());
// Builds address credentials of the same variant as a signed entry.
function credentialsOfVariant(
  sdk: Sdk,
  variant: xdr.SorobanCredentials['type'],
  credentials: xdr.SorobanAddressCredentials,
) {
  if (variant === 'sorobanCredentialsAddress')
    return sdk.xdr.SorobanCredentials.sorobanCredentialsAddress(credentials);
  if (variant === 'sorobanCredentialsAddressV2')
    return sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials);
  throw new TypeError(`A delegate entry cannot use ${variant} credentials.`);
}
const isUnknown = (e: RequestError | undefined) =>
  e instanceof UnknownSubmission || e?.code === 'unknown_submission';

// ---------- checkpoint: strict load, base validation, binding ----------
// Local evidence files. Callers check the fields they depend on.
function readJson<T>(url: URL, { optional = false } = {}): T | null {
  try {
    return JSON.parse(readFileSync(url, 'utf8'));
  } catch (eValue) {
    const e = requestError(eValue);
    if (optional && e.code === 'ENOENT') return null;
    throw new Error(`cannot read ${url instanceof URL ? url.pathname : url}: ${e.message}`);
  }
}
function requireJson<T>(url: URL): T {
  const value = readJson<T>(url);
  if (value === null) throw new Error(`cannot read ${url.pathname}: the file holds null`);
  return value;
}
export function bindingFor(ctx: CheckpointContext, base: ContractsState): Binding {
  return {
    network: ctx.networkPassphrase,
    keys: (['a', 'b', 'c'] as const).map((k) => ctx.keys[k].publicKey),
    oz_commit: OZ_COMMIT,
    base_wasm: Object.fromEntries(
      Object.entries(base.wasm)
        .map(([f, v]) => [f, v.hash])
        .sort(),
    ),
    base_contracts: Object.fromEntries(
      Object.entries(base.contracts)
        .map(([n, v]) => [n, v.id])
        .sort(),
    ),
  };
}
export function loadBase(ctx: CheckpointContext, manifest: Manifest, file = BASE_STATE) {
  const base = requireJson<ContractsState>(file);
  checkCheckpoint(base, manifest, ctx); // in memory only; the baseline file is never written here
  for (const name of ['ed25519_verifier', 'threshold_policy', 'auth_target_1', 'auth_target_2']) {
    if (!base.contracts[name]) throw new Error(`baseline instance ${name} missing in contracts-state.json`);
  }
  if (!base.wasm['multisig_account_example.wasm'])
    throw new Error('baseline upload of multisig_account_example.wasm missing');
  return base;
}
// Defaults only when the file does not exist. Any other read or parse error stops the run.
export function loadState(
  ctx: CheckpointContext,
  base: ContractsState,
  manifest: Manifest,
  file = STATE_FILE,
) {
  const state: ExtendedState = readJson<ExtendedState>(file, { optional: true }) ?? {
    oz_commit: OZ_COMMIT,
    contracts: {},
    done: {},
    steps: {},
  };
  const binding = bindingFor(ctx, base);
  const populated =
    Object.keys(state.contracts ?? {}).length ||
    Object.keys(state.done ?? {}).length ||
    Object.keys(state.steps ?? {}).length ||
    state.b_original;
  if (state.binding) {
    if (JSON.stringify(state.binding) !== JSON.stringify(binding))
      throw new Error(
        'extended checkpoint binding mismatch: network, keys, OpenZeppelin commit, or baseline artifacts changed',
      );
  } else if (populated) {
    throw new Error('extended checkpoint has no binding but holds state; review evidence before reuse');
  }
  if (state.oz_commit !== OZ_COMMIT) throw new Error('extended checkpoint OpenZeppelin revision mismatch');
  state.binding = binding;
  state.steps ??= {};
  for (const [name, c] of Object.entries(state.contracts)) {
    if (
      !base.wasm[c.wasm] ||
      c.wasm_sha256 !== base.wasm[c.wasm].hash ||
      manifest.artifacts[c.wasm]?.sha256 !== c.wasm_sha256
    ) {
      throw new Error(`extended checkpoint contract ${name} has no verified WASM`);
    }
  }
  return state;
}
// Atomic checkpoint write: temp sibling, fsync, rename. A crash mid-write cannot truncate b_original.
export function saveState(state: ExtendedState, file: string | URL = STATE_FILE) {
  const path = file instanceof URL ? fileURLToPath(file) : file;
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(state, null, 2) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
export function selectRows(ctx: { rows?: string[] }) {
  const envRows = process.env.WALLETERM_ROWS ? process.env.WALLETERM_ROWS.split(',') : undefined; // empty means unset
  const requested = (ctx.rows ?? envRows ?? ROW_IDS).map((s) => String(s).trim()).filter(Boolean);
  const unknown = requested.filter((id) => !ROW_IDS.includes(id));
  if (unknown.length) throw new Error(`unknown extended row ids: ${unknown.join(', ')}`);
  return new Set(requested);
}
async function deployIsolated(
  ctx: ExtendedContext,
  state: ExtendedState,
  base: ContractsState,
  name: string,
  file: string,
  constructorArgs: xdr.ScVal[],
) {
  if (state.contracts[name]) return state.contracts[name].id;
  const wasmHash = Buffer.from(base.wasm[file].hash, 'hex');
  const op = ctx.sdk.Operation.createCustomContract({
    address: new ctx.sdk.Address(ctx.keys.a.publicKey),
    wasmHash,
    constructorArgs,
  });
  const { sent, retval } = await submitSourceOnly(ctx, op, `E-deploy-${name}`);
  if (!retval) throw new Error(`E-deploy-${name}: simulation returned no contract address`);
  state.contracts[name] = {
    id: ctx.sdk.Address.fromScVal(retval).toString(),
    wasm: file,
    wasm_sha256: base.wasm[file].hash,
    tx: sent.hash,
  };
  saveState(state);
  return state.contracts[name].id;
}
// Step cache: a finished step is reused on a rerun and reported as passed_previous_run.
const stepper =
  (ctx: Pick<LiveContext, 'record'>, state: ExtendedState, rowId: string, details: RowDetails) =>
  async (label: string, fn: () => Promise<Details>): Promise<Details> => {
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
async function snapshotAccount(
  ctx: Pick<LiveContext, 'horizon'>,
  publicKey: string,
): Promise<AccountSnapshot> {
  const account = await ctx.horizon.loadAccount(publicKey);
  return {
    thresholds: {
      low: account.thresholds.low_threshold,
      med: account.thresholds.med_threshold,
      high: account.thresholds.high_threshold,
    },
    signers: account.signers
      .map((s) => ({ key: s.key, weight: s.weight, type: s.type }))
      .sort((p, q) => p.key.localeCompare(q.key)),
  };
}
const sameSettings = (p: AccountSnapshot | undefined, q: AccountSnapshot | undefined) =>
  JSON.stringify(p) === JSON.stringify(q);
const signerWeight = (snap: AccountSnapshot, key: string) =>
  snap.signers.find((s) => s.key === key)?.weight ?? 0;

async function e01(ctx: LiveContext, c: BaseContracts, state: ExtendedState): Promise<Details> {
  const { sdk, keys } = ctx;
  const b = keys.b;
  ctx.assertClear?.();
  const details: RowDetails = { account: b.publicKey, settings: B_MULTISIG };
  const step = stepper(ctx, state, 'E01', details);
  if (!state.b_original) {
    state.b_original = await snapshotAccount(ctx, b.publicKey);
    saveState(state);
  }
  const original = state.b_original;
  details.b_original = original;
  const current = await snapshotAccount(ctx, b.publicKey);
  const configured =
    current.thresholds.med === B_MULTISIG.medThreshold &&
    current.thresholds.high === B_MULTISIG.highThreshold &&
    signerWeight(current, keys.a.publicKey) === B_MULTISIG.signerWeight &&
    signerWeight(current, keys.c.publicKey) === B_MULTISIG.signerWeight;
  if (!configured) {
    if (!sameSettings(current, original))
      throw new Error(
        'E01: B is neither at its saved original settings nor at the test settings; review evidence',
      );
    details.configure = await submitClassic(
      ctx,
      b,
      [
        sdk.Operation.setOptions({
          signer: { ed25519PublicKey: keys.a.publicKey, weight: B_MULTISIG.signerWeight },
        }),
        sdk.Operation.setOptions({
          signer: { ed25519PublicKey: keys.c.publicKey, weight: B_MULTISIG.signerWeight },
        }),
        sdk.Operation.setOptions({
          masterWeight: B_MULTISIG.masterWeight,
          lowThreshold: B_MULTISIG.lowThreshold,
          medThreshold: B_MULTISIG.medThreshold,
          highThreshold: B_MULTISIG.highThreshold,
        }),
      ],
      [b],
      'E01-configure-b-multisig',
    );
    state.b_modified = true;
    saveState(state);
  }
  details.b_configured = await snapshotAccount(ctx, b.publicKey);
  const args = [addr(sdk, b.publicKey), u32(sdk, 1)];
  const st = { target: c.target1, who: b.publicKey };
  const ping = (label: string, opts: Partial<InvokeOptions>) =>
    step(label, () =>
      invoke(ctx, { contractId: c.target1, method: 'ping', args, state: st, label, ...opts }),
    );
  const diag = (label: string, text: string) => async (opts: Partial<InvokeOptions>) => {
    const result = await ping(label, opts);
    if (!String(result.error).includes(text))
      throw new Error(
        `${label}: expected host diagnostic "${text}", got: ${String(result.error).slice(0, 600)}`,
      );
    return { ...result, diagnostic_matched: text };
  };
  let failure: RowFailure | undefined;
  try {
    details.sorted_b_a_weight2_passes = await ping('E01-sorted-b-a', {
      authorizers: [gMultiAuthorizer(ctx, b.publicKey, [b, keys.a])],
    });
    details.sorted_a_c_weight2_passes = await ping('E01-sorted-a-c', {
      authorizers: [gMultiAuthorizer(ctx, b.publicKey, [keys.a, keys.c])],
    });
    details.single_a_weight1_rejected = await diag(
      'E01-weight1-a-only',
      ACCOUNT_DIAG.weight,
    )({ authorizers: [gMultiAuthorizer(ctx, b.publicKey, [keys.a])], expect: E.accountAuth });
    // Reversed and duplicate cases carry distinct weight 2, so only the ordering rule can reject them.
    details.reversed_order_rejected = await diag(
      'E01-reversed-order',
      ACCOUNT_DIAG.unordered,
    )({
      authorizers: [gMultiAuthorizer(ctx, b.publicKey, [b, keys.a], { reverse: true })],
      expect: E.accountAuth,
    });
    details.duplicate_rejected = await diag(
      'E01-duplicate-b-a-b',
      ACCOUNT_DIAG.unordered,
    )({
      authorizers: [gMultiAuthorizer(ctx, b.publicKey, [b, keys.a], { duplicate: true })],
      expect: E.accountAuth,
    });
  } catch (eValue) {
    const e = requestError(eValue);
    failure = e;
    failure.details = details;
  }
  if (isUnknown(failure)) throw failure;
  // Restore only B's settings. High threshold is 2, so B and A sign the restore envelope.
  try {
    ctx.assertClear?.();
    details.restore = await submitClassic(
      ctx,
      b,
      [
        sdk.Operation.setOptions({
          signer: { ed25519PublicKey: keys.a.publicKey, weight: signerWeight(original, keys.a.publicKey) },
        }),
        sdk.Operation.setOptions({
          signer: { ed25519PublicKey: keys.c.publicKey, weight: signerWeight(original, keys.c.publicKey) },
        }),
        sdk.Operation.setOptions({
          masterWeight: signerWeight(original, b.publicKey),
          lowThreshold: original.thresholds.low,
          medThreshold: original.thresholds.med,
          highThreshold: original.thresholds.high,
        }),
      ],
      [b, keys.a],
      'E01-restore-b',
    );
    const restored = await snapshotAccount(ctx, b.publicKey);
    details.b_after_restore = restored;
    if (!sameSettings(restored, original))
      throw new Error('E01: B settings differ from the saved original after restore');
    state.b_modified = false;
    saveState(state);
  } catch (eValue) {
    const e = requestError(eValue);
    if (isUnknown(e) || !failure) throw e;
    details.restore_error = String(e.message);
  }
  if (failure) throw failure;
  return details;
}

// ---------- E02: OZ Delegated(G_b) signer with a crafted __check_auth entry ----------
// The OZ authorizer signs nothing itself: the rule holds one Delegated(G_b) signer, so the AuthPayload
// carries an empty Bytes for that signer and binds the rule ids. It records the auth digest in `meta`.
export const ozDelegatedAuthorizer = (
  ctx: SigningContext,
  account: string,
  delegate: TestKey,
  { digestIds }: { digestIds?: number[] } = {},
) => ({
  address: account,
  label: `oz-delegated:${delegate.name}`,
  async signatureScVal(payload: Buffer, entry: xdr.SorobanAuthorizationEntry, meta: EntryMeta = {}) {
    const ids = Array<number>(countContexts(entry.rootInvocation)).fill(0);
    const digest = ozAuthDigest(ctx.sdk, payload, digestIds ?? ids);
    Object.assign(meta, {
      scheme: 'oz-delegated',
      rule_ids: ids,
      digest_ids: digestIds ?? ids,
      digest: digest.toString('hex'),
      delegate: delegate.name,
    });
    return mixedAuthPayload(
      ctx.sdk,
      [{ kind: 'Delegated', address: delegate.publicKey, signature: Buffer.alloc(0) }],
      ids,
    );
  },
});
// extraAuth seam: crafts and signs the delegate entry after the OZ entry is signed. Inside __check_auth the OZ
// account calls delegate.require_auth_for_args((auth_digest,)), so the entry is rooted at
// oz.__check_auth([auth_digest]) and uses the same credential variant as the OZ entry.
export interface DelegateEntryOptions {
  account: string;
  delegate: TestKey;
  delegateRoot?: string;
  omit?: boolean;
}
export const delegateEntryFor =
  (
    ctx: SigningContext & Pick<LiveContext, 'networkPassphrase'>,
    { account, delegate, delegateRoot = 'check_auth', omit = false }: DelegateEntryOptions,
  ) =>
  async ({ auth, expiration, entries }: ExtraAuthInput) => {
    if (omit) return [];
    const { sdk, networkPassphrase } = ctx;
    const ozSigned = auth.find((e) => addressCredentials(e) && entryAddress(sdk, e) === account);
    const meta = entries.find((e) => e.address === account && e.digest);
    if (!ozSigned || !meta?.digest) throw new Error('E02: signed OZ entry or its digest not found');
    if (expiration === undefined) throw new Error('E02: the signed OZ entry has no expiration ledger');
    const digest = Buffer.from(meta.digest, 'hex');
    const root =
      delegateRoot === 'check_auth'
        ? contractFn(sdk, account, '__check_auth', [bytes(sdk, digest)])
        : cloneEntry(sdk, ozSigned).rootInvocation;
    const nonce = BigInt('0x' + randomBytes(8).toString('hex')) & ((1n << 62n) - 1n);
    const variant = ozSigned.credentials.type;
    const credentials = new sdk.xdr.SorobanAddressCredentials({
      address: new sdk.Address(delegate.publicKey).toScAddress(),
      nonce,
      signatureExpirationLedger: 0,
      signature: sdk.xdr.ScVal.scvVoid(),
    });
    const entry = new sdk.xdr.SorobanAuthorizationEntry({
      credentials: credentialsOfVariant(sdk, variant, credentials),
      rootInvocation: root,
    });
    const extra: EntryMeta = {
      variant,
      address: delegate.publicKey,
      signer: `G:${delegate.name}`,
      scheme: 'delegate-check-auth-root',
      delegate_root: delegateRoot,
      bound_digest: meta.digest,
      nonce: String(nonce),
      expiration,
      unsigned_xdr: entry.toXdr('base64'),
    };
    const signed = await sdk.authorizeEntry(
      entry,
      async (_p, payload) => {
        extra.payload = Buffer.from(payload).toString('hex');
        return {
          signatureScVal: accountSignature(sdk, [
            {
              rawKey: delegate.rawPublicKey,
              signature: await ctx.signDigest(delegate, Buffer.from(payload)),
            },
          ]),
          address: delegate.publicKey,
        };
      },
      expiration,
      networkPassphrase,
    );
    extra.signed_xdr = signed.toXdr('base64');
    entries.push(extra);
    return [signed];
  };

async function e02(
  ctx: LiveContext,
  c: BaseContracts,
  state: ExtendedState,
  base: ContractsState,
): Promise<Details> {
  const { sdk, keys } = ctx;
  ctx.assertClear?.();
  const account = await deployIsolated(ctx, state, base, 'oz_delegated_b', 'multisig_account_example.wasm', [
    sdk.xdr.ScVal.scvVec([delegatedSigner(sdk, keys.b.publicKey)]),
    scMap(sdk, []),
  ]);
  const details: RowDetails = { account, rule0: 'Delegated(G_b), no policy' };
  const step = stepper(ctx, state, 'E02', details);
  const args = [addr(sdk, account), u32(sdk, 1)];
  const st = { target: c.target1, who: account };
  interface Variation {
    delegateRoot?: string;
    digestIds?: number[];
    omit?: boolean;
  }
  const run = async (
    name: string,
    label: string,
    { delegateRoot, digestIds, omit }: Variation = {},
    expect?: string,
    target = c.target1,
    method = 'ping',
    callArgs = args,
    stateCheck = st,
  ) => {
    details[name] = await step(label, () =>
      invoke(ctx, {
        contractId: target,
        method,
        args: callArgs,
        label,
        expect,
        state: stateCheck,
        authorizers: [ozDelegatedAuthorizer(ctx, account, keys.b, { digestIds })],
        extraAuth: delegateEntryFor(ctx, { account, delegate: keys.b, delegateRoot, omit }),
      }),
    );
  };
  await run('valid_check_auth_root_passes', 'E02-delegated-valid', {});
  await run('wrong_root_rejected', 'E02-delegated-wrong-root', { delegateRoot: 'target-call' }, E.auth);
  await run('wrong_digest_rejected', 'E02-delegated-wrong-digest', { digestIds: [0, 0] }, E.auth);
  await run('missing_delegate_rejected', 'E02-delegated-missing', { omit: true }, E.auth);
  await run(
    'nested_tree_passes',
    'E02-delegated-nested',
    {},
    undefined,
    c.target1,
    'outer',
    [addr(sdk, account), addr(sdk, c.target2), u32(sdk, 1)],
    { target: c.target2, who: account },
  );
  return details;
}

// ---------- E03: contract-specific context rule, threshold update, rule removal ----------
// Resumable: the phase comes from on-chain reads (rule 1 present? threshold 1 or 2?) plus the checkpoint.
async function e03(
  ctx: LiveContext,
  c: BaseContracts,
  state: ExtendedState,
  base: ContractsState,
): Promise<Details> {
  const { sdk, keys } = ctx;
  ctx.assertClear?.();
  const account = await deployIsolated(
    ctx,
    state,
    base,
    'oz_context_rules',
    'multisig_account_example.wasm',
    [signersVec(sdk, [ozSignerOf(c, keys.a, 'a')]), scMap(sdk, [])],
  );
  const details: RowDetails = {
    account,
    rule0: 'Default [External A]',
    rule1: 'CallContract(target1) [External B, External C], threshold 1 then 2',
  };
  const step = stepper(ctx, state, 'E03', details);
  const admin = [ozAuthorizer(ctx, account, c.verifier, [keys.a])]; // rule 0: Default, A only
  const byRule1 = (ks: TestKey[]) => [ozAuthorizer(ctx, account, c.verifier, ks, { ruleId: 1 })];
  const ping1 = [addr(sdk, account), u32(sdk, 1)];
  const st1 = { target: c.target1, who: account };
  const readRule1 = async () => {
    try {
      return await readScVal(ctx, account, 'get_context_rule', [u32(sdk, 1)]);
    } catch (eValue) {
      const e = requestError(eValue);
      if (String(e.message).includes(E.ruleNotFound)) return null;
      throw e;
    }
  };
  const readThreshold = async () =>
    Number(
      sdk.scValToNative(
        await readScVal(ctx, c.threshold, 'get_threshold', [u32(sdk, 1), addr(sdk, account)]),
      ),
    );
  const e = (state.e03 ??= {});
  // Step records are the source of truth. Phase markers (created_tx, removed_tx) are derived from them when a
  // marker write was interrupted after the step itself was saved.
  const have = (label: string): Details | undefined => state.steps[`E03:${label}`];
  const PRE = ['E03-rule1-b-target1', 'E03-rule1-target2', 'E03-rule0-b', 'E03-set-threshold-2'];
  const POST = ['E03-after-update-b-only', 'E03-after-update-b-c', 'E03-remove-rule-1'];
  const requireSteps = (labels: string[], phase: string) => {
    const missing = labels.filter((l) => !have(l));
    if (missing.length)
      throw new Error(
        `E03: resumed at phase ${phase} but step evidence is missing: ${missing.join(', ')}; failing closed`,
      );
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
    e.removed_tx ??= removed;
    saveState(state);
    details.phase = 'removed';
  } else if (!rule && created) {
    throw new Error(
      'E03: rule 1 is absent but the checkpoint records its creation and no removal; failing closed',
    );
  } else if (!rule) {
    if (PRE.some(have) || POST.some(have))
      throw new Error(
        'E03: rule 1 absent with no creation record but later step evidence exists; failing closed',
      );
    const addRule = await step('E03-add-rule-target1', () =>
      invoke(ctx, {
        contractId: account,
        method: 'add_context_rule',
        authorizers: admin,
        label: 'E03-add-rule-target1',
        args: [
          contextRuleType(sdk, 'CallContract', c.target1),
          str(sdk, 'ctx-target1'),
          sdk.xdr.ScVal.scvVoid(),
          signersVec(sdk, [ozSignerOf(c, keys.b, 'b'), ozSignerOf(c, keys.c, 'c')]),
          scMap(sdk, [[addr(sdk, c.threshold), scMap(sdk, [[sym(sdk, 'threshold'), u32(sdk, 1)]])]]),
        ],
      }),
    );
    details.add_rule = addRule;
    e.created_tx = addRule.hash;
    saveState(state);
    rule = await readRule1();
    if (!rule) throw new Error('E03: rule 1 not readable after add_context_rule');
    const native: { id: unknown } = sdk.scValToNative(rule);
    const id = Number(native.id);
    if (id !== 1) throw new Error(`E03: expected rule id 1, got ${id}`);
  }
  if (rule) {
    const threshold = await readThreshold();
    details.threshold_at_start = threshold;
    if (threshold === 1) {
      if (have('E03-set-threshold-2'))
        throw new Error(
          'E03: set_threshold step is recorded but the policy still reads threshold 1; failing closed',
        );
      details.phase = 'pre-update';
      details.rule1_b_on_target1_passes = await step('E03-rule1-b-target1', () =>
        invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args: ping1,
          authorizers: byRule1([keys.b]),
          label: 'E03-rule1-b-target1',
          state: st1,
        }),
      );
      details.rule1_on_target2_rejected = await step('E03-rule1-target2', () =>
        invoke(ctx, {
          contractId: c.target2,
          method: 'ping',
          args: ping1,
          authorizers: byRule1([keys.b]),
          label: 'E03-rule1-target2',
          expect: E.unvalidated,
          state: { target: c.target2, who: account },
        }),
      );
      // Rule 0 has no policy, so the all-signers check (#3002) fires before the unauthorized-signer check (#3016).
      details.rule0_with_b_rejected = await step('E03-rule0-b', () =>
        invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args: ping1,
          authorizers: [ozAuthorizer(ctx, account, c.verifier, [keys.b], { ruleId: 0 })],
          label: 'E03-rule0-b',
          expect: E.unvalidated,
          state: st1,
        }),
      );
      // Threshold 1 -> 2 through ExecutionEntryPoint::execute, authorized by rule 0. The policy sees the account as invoker.
      details.set_threshold_2 = await step('E03-set-threshold-2', () =>
        invoke(ctx, {
          contractId: account,
          method: 'execute',
          authorizers: admin,
          label: 'E03-set-threshold-2',
          args: [
            addr(sdk, c.threshold),
            sym(sdk, 'set_threshold'),
            sdk.xdr.ScVal.scvVec([u32(sdk, 2), rule, addr(sdk, account)]),
          ],
        }),
      );
      details.threshold_after_update = await readThreshold();
      if (details.threshold_after_update !== 2)
        throw new Error(`E03: threshold is ${details.threshold_after_update}, expected 2`);
    } else if (threshold === 2) {
      requireSteps(['E03-add-rule-target1', ...PRE], 'post-update'); // pre-update coverage must already be evidenced
    } else {
      throw new Error(`E03: unexpected threshold ${threshold} on rule 1; failing closed`);
    }
    details.phase = 'post-update';
    details.old_policy_b_alone_rejected = await step('E03-after-update-b-only', () =>
      invoke(ctx, {
        contractId: c.target1,
        method: 'ping',
        args: ping1,
        authorizers: byRule1([keys.b]),
        label: 'E03-after-update-b-only',
        expect: E.notAllowed,
        state: st1,
      }),
    );
    details.new_policy_b_c_passes = await step('E03-after-update-b-c', () =>
      invoke(ctx, {
        contractId: c.target1,
        method: 'ping',
        args: ping1,
        authorizers: byRule1([keys.b, keys.c]),
        label: 'E03-after-update-b-c',
        state: st1,
      }),
    );
    const removeRule = await step('E03-remove-rule-1', () =>
      invoke(ctx, {
        contractId: account,
        method: 'remove_context_rule',
        args: [u32(sdk, 1)],
        authorizers: admin,
        label: 'E03-remove-rule-1',
      }),
    );
    details.remove_rule = removeRule;
    e.removed_tx = removeRule.hash;
    saveState(state);
    if (await readRule1())
      throw new Error('E03: rule 1 still readable after remove_context_rule; failing closed');
    details.phase = 'removed';
  }
  details.removed_rule_rejected = await step('E03-removed-rule', () =>
    invoke(ctx, {
      contractId: c.target1,
      method: 'ping',
      args: ping1,
      authorizers: byRule1([keys.b, keys.c]),
      label: 'E03-removed-rule',
      expect: E.ruleNotFound,
      state: st1,
    }),
  );
  return details;
}

interface Row {
  id: string;
  title: string;
  run(ctx: LiveContext, c: BaseContracts, state: ExtendedState, base: ContractsState): Promise<Details>;
}
const ROWS: Row[] = [
  { id: 'E01', title: 'Native G-account weighted multisig (B: A, C weight 1, med 2)', run: e01 },
  { id: 'E02', title: 'OpenZeppelin Delegated(G_b) signer with __check_auth-rooted entry', run: e02 },
  { id: 'E03', title: 'OpenZeppelin contract-specific rule, threshold update, removal', run: e03 },
];

export async function runExtended(ctx: LiveContext) {
  const selected = selectRows(ctx);
  const manifest = requireJson<Manifest>(MANIFEST);
  const base = loadBase(ctx, manifest);
  const state = loadState(ctx, base, manifest);
  const c = {
    verifier: base.contracts.ed25519_verifier.id,
    threshold: base.contracts.threshold_policy.id,
    target1: base.contracts.auth_target_1.id,
    target2: base.contracts.auth_target_2.id,
  };
  for (const key of [ctx.keys.a, ctx.keys.b, ctx.keys.c]) await ctx.fund(key);
  const outcomes: Record<string, string> = {};
  for (const row of ROWS) {
    if (!selected.has(row.id)) {
      ctx.record(row.id, 'not_run', { title: row.title, reason: 'not selected' });
      outcomes[row.id] = 'not_run';
      continue;
    }
    if (state.done[row.id]) {
      ctx.record(row.id, 'passed_previous_run', {
        title: row.title,
        reused_evidence: true,
        ...state.done[row.id],
      });
      outcomes[row.id] = 'passed_previous_run';
      continue;
    }
    try {
      const details = await row.run(ctx, c, state, base);
      state.done[row.id] = details;
      saveState(state);
      ctx.record(row.id, 'passed', { title: row.title, ...details });
      outcomes[row.id] = 'passed';
    } catch (eValue) {
      const e: RowFailure = requestError(eValue);
      if (isUnknown(e)) {
        ctx.record(row.id, 'blocked', {
          title: row.title,
          tx_hash: errorHash(e),
          error: String(e.message),
          action: 'reconcile this hash before any new submission',
          partial: e.details,
        });
        throw e;
      }
      ctx.record(row.id, 'failed', {
        title: row.title,
        error: String(e.stack ?? e),
        ...(e.details ? { partial: e.details } : {}),
      });
      outcomes[row.id] = 'failed';
      if (ctx.stopOnFailure) throw e;
    }
  }
  const failed = Object.entries(outcomes)
    .filter(([, s]) => s === 'failed')
    .map(([id]) => id);
  if (failed.length) throw new Error(`extended rows failed: ${failed.join(', ')}`);
  return state;
}

// ---------- offline self-test ----------
async function selfTest() {
  const sdk = await import('@stellar/stellar-sdk');
  const { mkdtempSync, writeFileSync: write, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(`self-test: ${msg}`);
  }
  const throws = (fn: () => unknown, re: RegExp, msg: string) => {
    try {
      fn();
    } catch (eValue) {
      const e = requestError(eValue);
      if (re.test(String(e.message))) return;
      throw new Error(`self-test: ${msg}: wrong error ${e.message}`);
    }
    throw new Error(`self-test: ${msg}: no error`);
  };
  const verifier = 'CDLDYJWEZSM6IAI4HHPEZTTV65WX4OVN3RZD3U6LQKYAVIZTEK7XYAYT';
  const g = sdk.Keypair.random(),
    g2 = sdk.Keypair.random(),
    g3 = sdk.Keypair.random();
  const key = { name: 'mock', publicKey: g.publicKey(), rawPublicKey: g.rawPublicKey() };
  const key2 = { name: 'mock2', publicKey: g2.publicKey(), rawPublicKey: g2.rawPublicKey() };
  const key3 = { name: 'mock3', publicKey: g3.publicKey(), rawPublicKey: g3.rawPublicKey() };
  const ctx: SigningContext & CheckpointContext = {
    sdk,
    networkPassphrase: sdk.Networks.TESTNET,
    keys: { a: key, b: key2, c: key3 },
    signDigest: async (k, d) => Buffer.from((k === key ? g : g2).sign(d)),
  };
  // Native forms of the ScVals under test.
  type AccountSignatures = { public_key: Uint8Array; signature: Uint8Array }[];
  const native = (value: xdr.ScVal): unknown[] => sdk.scValToNative(value);
  const signaturesOf = (value: xdr.ScVal): AccountSignatures => sdk.scValToNative(value);
  const callOf = (entry: xdr.SorobanAuthorizationEntry) => {
    const fn = entry.rootInvocation.function;
    assert(fn.type === 'sorobanAuthorizedFunctionTypeContractFn', 'root is a contract call');
    return fn.contractFn;
  };
  const bytesOf = (value: xdr.ScVal): Uint8Array => sdk.scValToNative(value);
  // Mixed AuthPayload and OZ enum encodings.
  const orderA = mixedAuthPayload(
    sdk,
    [
      { kind: 'External', verifier, rawKey: Buffer.alloc(32, 1), signature: Buffer.alloc(64) },
      { kind: 'Delegated', address: g.publicKey(), signature: Buffer.alloc(0) },
    ],
    [0],
  ).toXdr('base64');
  const orderB = mixedAuthPayload(
    sdk,
    [
      { kind: 'Delegated', address: g.publicKey(), signature: Buffer.alloc(0) },
      { kind: 'External', verifier, rawKey: Buffer.alloc(32, 1), signature: Buffer.alloc(64) },
    ],
    [0],
  ).toXdr('base64');
  assert(orderA === orderB, 'mixed map order independent');
  assert(
    native(contextRuleType(sdk, 'Default'))[0] === 'Default' &&
      native(contextRuleType(sdk, 'CallContract', verifier))[0] === 'CallContract',
    'ContextRuleType encoding',
  );
  // G multisig signatures are sorted by public key and verify over the payload.
  const payload = Buffer.alloc(32, 9);
  const sorted = signaturesOf(
    await gMultiAuthorizer(ctx, key.publicKey, [key, key2]).signatureScVal(payload),
  );
  assert(
    sorted.length === 2 &&
      Buffer.compare(Buffer.from(sorted[0].public_key), Buffer.from(sorted[1].public_key)) < 0,
    'multisig sorted by public key',
  );
  for (const s of sorted)
    assert(
      sdk.Keypair.fromPublicKey(sdk.StrKey.encodeEd25519PublicKey(Buffer.from(s.public_key))).verify(
        payload,
        Buffer.from(s.signature),
      ),
      'multisig signature verifies',
    );
  const reversed = signaturesOf(
    await gMultiAuthorizer(ctx, key.publicKey, [key, key2], { reverse: true }).signatureScVal(payload),
  );
  assert(
    Buffer.compare(Buffer.from(reversed[0].public_key), Buffer.from(reversed[1].public_key)) > 0,
    'reversed order produced',
  );
  const dup = signaturesOf(
    await gMultiAuthorizer(ctx, key.publicKey, [key2, key], { duplicate: true }).signatureScVal(payload),
  );
  assert(
    dup.length === 3 && new Set(dup.map((s) => Buffer.from(s.public_key).toString('hex'))).size === 2,
    'duplicate keeps two distinct keys plus one repeat',
  );
  // Delegate entry: __check_auth root, both credential variants, preimage type follows the variant.
  for (const variant of ['sorobanCredentialsAddress', 'sorobanCredentialsAddressV2'] as const) {
    const creds = new sdk.xdr.SorobanAddressCredentials({
      address: new sdk.Address(g.publicKey()).toScAddress(),
      nonce: 5n,
      signatureExpirationLedger: 0,
      signature: sdk.xdr.ScVal.scvVoid(),
    });
    const entry = new sdk.xdr.SorobanAuthorizationEntry({
      credentials: credentialsOfVariant(sdk, variant, creds),
      rootInvocation: contractFn(sdk, verifier, '__check_auth', [bytes(sdk, Buffer.alloc(32, 3))]),
    });
    const pre = sdk.buildAuthorizationEntryPreimage(entry, 100, sdk.Networks.TESTNET);
    assert(
      pre.type ===
        (variant.endsWith('V2')
          ? 'envelopeTypeSorobanAuthorizationWithAddress'
          : 'envelopeTypeSorobanAuthorization'),
      `preimage for ${variant}`,
    );
    const signed = await sdk.authorizeEntry(
      entry,
      async (_p, pl) => ({
        signatureScVal: accountSignature(sdk, [
          { rawKey: key.rawPublicKey, signature: await ctx.signDigest(key, Buffer.from(pl)) },
        ]),
        address: key.publicKey,
      }),
      100,
      sdk.Networks.TESTNET,
    );
    const fn = callOf(signed);
    assert(
      String(fn.functionName) === '__check_auth' &&
        bytesOf(fn.args[0]).length === 32 &&
        requireAddressCredentials(signed).signatureExpirationLedger === 100,
      `delegate entry ${variant}`,
    );
    assert(
      g.verify(
        Buffer.from(sdk.hash(pre.toXdr())),
        Buffer.from(signaturesOf(requireAddressCredentials(signed).signature)[0].signature),
      ),
      `delegate signature ${variant}`,
    );
  }
  // extraAuth flow offline: OZ entry signed by the delegated authorizer, then the delegate entry from the seam.
  const ozCreds = new sdk.xdr.SorobanAddressCredentials({
    address: new sdk.Address(verifier).toScAddress(),
    nonce: 9n,
    signatureExpirationLedger: 0,
    signature: sdk.xdr.ScVal.scvVoid(),
  });
  const ozEntry = new sdk.xdr.SorobanAuthorizationEntry({
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(ozCreds),
    rootInvocation: contractFn(sdk, verifier, 'ping', [addr(sdk, verifier), u32(sdk, 1)]),
  });
  const meta: EntryMeta = { address: verifier };
  const ozSigned = await sdk.authorizeEntry(
    cloneEntry(sdk, ozEntry),
    async (_p, pl) => ({
      signatureScVal: await ozDelegatedAuthorizer(ctx, verifier, key).signatureScVal(
        Buffer.from(pl),
        ozEntry,
        meta,
      ),
      address: verifier,
    }),
    100,
    sdk.Networks.TESTNET,
  );
  assert(meta.digest?.length === 64 && JSON.stringify(meta.rule_ids) === '[0]', 'delegated authorizer meta');
  const entries = [meta];
  const extra = await delegateEntryFor(ctx, { account: verifier, delegate: key })({
    auth: [ozSigned],
    expiration: 100,
    entries,
  });
  const dfn = callOf(extra[0]);
  assert(
    extra.length === 1 &&
      extra[0].credentials.type === 'sorobanCredentialsAddressV2' &&
      String(dfn.functionName) === '__check_auth' &&
      Buffer.from(bytesOf(dfn.args[0])).toString('hex') === meta.digest,
    'delegate entry bound to the OZ digest with the same variant',
  );
  assert(
    entries.length === 2 && entries[1].scheme === 'delegate-check-auth-root',
    'extra entry metadata pushed',
  );
  assert(
    (
      await delegateEntryFor(ctx, { account: verifier, delegate: key, omit: true })({
        auth: [ozSigned],
        expiration: 100,
        entries: [meta],
      })
    ).length === 0,
    'omit returns none',
  );
  assert(
    typeof invoke === 'function' &&
      typeof submitSourceOnly === 'function' &&
      typeof checkCheckpoint === 'function' &&
      E.accountAuth === 'Error(Contract, #5)' &&
      invoke.toString().includes('extraAuth'),
    'seams imported',
  );
  // Checkpoint safety: ENOENT defaults, other errors throw, binding mismatch throws, unknown rows rejected.
  const manifest = requireJson<Manifest>(MANIFEST);
  const dir = mkdtempSync(join(tmpdir(), 'walleterm-ext-'));
  const base: ContractsState = {
    oz_commit: OZ_COMMIT,
    wasm: Object.fromEntries(Object.entries(manifest.artifacts).map(([f, a]) => [f, { hash: a.sha256 }])),
    contracts: { ed25519_verifier: { id: verifier, wasm: 'multisig_ed25519_verifier_example.wasm' } },
    done: {},
  };
  const missing = pathToFileURL(join(dir, 'missing.json'));
  const fresh = loadState(ctx, base, manifest, missing);
  assert(
    fresh.binding?.network === sdk.Networks.TESTNET &&
      fresh.binding.keys.length === 3 &&
      Object.keys(fresh.binding.base_wasm).length === 6,
    'fresh state binds network, keys, commit, artifacts',
  );
  const broken = pathToFileURL(join(dir, 'broken.json'));
  write(broken, '{ not json');
  throws(() => loadState(ctx, base, manifest, broken), /cannot read/, 'parse error is not defaulted');
  const bound = pathToFileURL(join(dir, 'bound.json'));
  write(bound, JSON.stringify(fresh));
  assert(loadState(ctx, base, manifest, bound).binding?.oz_commit === OZ_COMMIT, 'same binding loads');
  throws(
    () => loadState({ ...ctx, networkPassphrase: sdk.Networks.PUBLIC }, base, manifest, bound),
    /binding mismatch/,
    'network change rejected',
  );
  throws(
    () =>
      loadState(
        ctx,
        { ...base, wasm: { ...base.wasm, 'multisig_account_example.wasm': { hash: '00' } } },
        manifest,
        bound,
      ),
    /binding mismatch/,
    'base artifact change rejected',
  );
  const legacy = pathToFileURL(join(dir, 'legacy.json'));
  write(
    legacy,
    JSON.stringify({
      oz_commit: OZ_COMMIT,
      contracts: {
        x: {
          id: verifier,
          wasm: 'multisig_account_example.wasm',
          wasm_sha256: manifest.artifacts['multisig_account_example.wasm'].sha256,
        },
      },
      done: {},
    }),
  );
  throws(() => loadState(ctx, base, manifest, legacy), /no binding/, 'unbound populated state rejected');
  const unreadable = pathToFileURL(join(dir, 'dir.json'));
  mkdirSync(unreadable);
  throws(() => loadState(ctx, base, manifest, unreadable), /cannot read/, 'EISDIR is not defaulted');
  throws(() => loadBase(ctx, manifest, missing), /cannot read/, 'missing baseline rejected');
  throws(() => selectRows({ rows: ['E01', 'C01'] }), /unknown extended row ids: C01/, 'unknown row rejected');
  const savedEnv = process.env.WALLETERM_ROWS;
  delete process.env.WALLETERM_ROWS;
  assert(selectRows({ rows: [] }).size === 0 && selectRows({}).size === 3, 'row selection defaults');
  process.env.WALLETERM_ROWS = '';
  assert(selectRows({}).size === 3, 'empty env means unset');
  process.env.WALLETERM_ROWS = 'E02';
  assert([...selectRows({})].join() === 'E02', 'env selects one row');
  if (savedEnv === undefined) delete process.env.WALLETERM_ROWS;
  else process.env.WALLETERM_ROWS = savedEnv;
  // Atomic save round-trips and leaves no temp sibling.
  const saved = pathToFileURL(join(dir, 'saved.json'));
  saveState({ ...fresh, b_original: { thresholds: { low: 0, med: 0, high: 0 }, signers: [] } }, saved);
  assert(
    requireJson<ExtendedState>(saved).b_original?.signers.length === 0 &&
      !existsSync(`${fileURLToPath(saved)}.${process.pid}.tmp`),
    'atomic save',
  );
  // Host diagnostics pinned to soroban-env-host v27.0.0 account_contract.rs.
  assert(
    ACCOUNT_DIAG.weight === 'signature weight is lower than threshold' &&
      ACCOUNT_DIAG.unordered === 'public keys are not ordered',
    'account diagnostics',
  );
  console.log(
    JSON.stringify({
      ok: true,
      self_test: 'extended-contracts.ts',
      rows: ROW_IDS,
      account_diagnostics: ACCOUNT_DIAG,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
