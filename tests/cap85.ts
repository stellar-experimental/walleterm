import { requestError } from '../sdk/errors.ts';
// CAP-85 externally managed contract executables: rows X01-X07. Exports runCap85(ctx).
// ctx comes from tests/live-utils.ts. `bun tests/cap85.ts` runs the offline self-test.
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
import {
  UnknownSubmission,
  addressCredentials,
  requireAddressCredentials,
  ERR,
  gAuthorizer,
  simpleAuthorizer,
  ozAuthorizer,
  accountSignature,
} from './contracts.ts';
import type { Account, Transaction, rpc, xdr } from '@stellar/stellar-sdk';
import type { RequestError } from '../sdk/errors.ts';
import type { Authorizer, CheckpointContext, EntryMeta } from './contracts.ts';
import type { Details, KeyName, LiveContext, RecordRow, Sdk } from './types.ts';

const BASE_STATE = new URL('../evidence/live/contracts-state.json', import.meta.url); // read only
const STATE_FILE = new URL('../evidence/live/cap85-state.json', import.meta.url);
const MANIFEST = new URL('../fixtures/cap85/wasm/manifest.json', import.meta.url);
const WASM_DIR = new URL('../fixtures/cap85/wasm/', import.meta.url);
const EXPIRY_LEDGERS = 60;
// The checkpoint path travels with the state object (symbol key: copied by spread, ignored by JSON).
// Offline tests bind temporary paths. saveState requires an explicit or previously bound path.
const FILE = Symbol('checkpoint-file');
export const TAG = 'target';
export const ROW_IDS = ['X01', 'X02', 'X03', 'X04', 'X05', 'X06', 'X07'];
/** An expected simulation error. A diagnostic, when given, must also appear. */
export interface Expectation {
  error: string;
  diagnostic?: string;
}
// Expected errors and host diagnostics. Sources: fixtures/cap85 unit tests on the protocol 28 test host
// (manager: unknown_wasm_hash_rejected_by_protocol; account: legacy_sdk27_decode_failure_is_value_missing_value)
// and soroban-env-host v27.0.0 builtin_contracts/account_contract.rs ("signer does not belong to account").
export const X = {
  ...ERR,
  managerStale: { error: 'Error(Contract, #2)' }, // cap85_manager StaleVersion
  accountNotExternalRef: { error: 'Error(Contract, #2)' }, // cap85_account ExecutableNotExternalRef
  unknownWasm: { error: 'Error(Storage, MissingValue)', diagnostic: 'Wasm does not exist' }, // protocol guard on executable_refs().set
  wrongSigner: { error: 'Error(Contract, #5)', diagnostic: 'signer does not belong to account' }, // built-in account, key C signing for B
  legacyDecode: { error: 'Error(Value, MissingValue)' }, // SDK 27 decoder on ContractExecutable::ExternalRef
} satisfies Record<string, string | Expectation>;
const FILES = {
  manager: 'cap85_manager.wasm',
  v1: 'cap85_target_v1.wasm',
  v2: 'cap85_target_v2.wasm',
  account28: 'cap85_account.wasm',
  legacy27: 'cap85_legacy_account.wasm',
};

// ---------- shapes ----------
/** fixtures/cap85/wasm/manifest.json. */
export interface Cap85Manifest {
  workspaces: Record<string, { soroban_sdk: string }>;
  toolchain: Record<string, string>;
  artifacts: Record<string, { sha256: string; bytes?: number; sdk?: string }>;
}
/** evidence/live/contracts-state.json. Only the baseline instance ids are read. */
export interface BaseState {
  contracts: Record<string, { id: string } | undefined>;
}
export interface Binding {
  network: string;
  keys: string[];
  cap85_artifacts: Record<string, string>;
  base_contracts: Record<string, string | undefined>;
}
export interface ExecutableDescription {
  type: string;
  owner?: string;
  tag?: string;
  wasm_hash?: string;
  live_until_ledger?: number;
}
export interface Predicted {
  contract?: string;
  salt?: string;
  wasm_hash?: string;
}
export interface CounterCheck {
  target: string;
  who: string;
  before: number;
  increment: number;
}
export interface Inflight {
  row?: string;
  label: string;
  key: string;
  hash?: string;
  predicted?: Predicted;
  envelope_xdr?: string;
  sent_at?: string;
  started_at?: string;
  counter_check?: CounterCheck;
}
/** The evidence of one finished step. Rows read only these fields back. */
export type StepResult = Details & {
  hash?: string;
  retval_address?: string;
  predicted?: Predicted;
  observed?: string;
  status?: string;
};
export interface Cap85State {
  binding?: Binding;
  contracts: Record<
    string,
    { id: string; executable: ExecutableDescription & { file?: string }; tx?: string } | undefined
  >;
  wasm: Record<string, { hash: string; tx?: string } | undefined>;
  done: Record<string, Details>;
  steps: Record<string, StepResult | undefined>;
  inflight?: Inflight;
  [FILE]?: string | URL;
}
export type Reconciled = StepResult & {
  outcome: 'reconciled';
  hash: string;
  status: string;
  note: string;
  count_before?: number;
  count_after?: number;
  cleared?: undefined;
};
export type Cleared = { cleared: true; label: string; reason: string; outcome?: undefined };
/** Row evidence. Rows add fields as they run. */
type RowDetails = Details & { title: string; reused_steps?: string[] };
/** The X04 fields that assertCreatedReference checks. */
export interface CreationDetails {
  created?: string;
  external_ref_creation_passes: { predicted?: Predicted };
  created_instance_executable?: ExecutableDescription;
  created_version?: number;
  created_resolved_wasm?: string | null;
}

/** The RPC calls that this suite makes. rpc.Server satisfies this interface. */
export interface Cap85Rpc extends Pick<rpc.Server, 'getContractData' | 'getNetwork'> {
  getAccount(address: string): Promise<Account>;
  simulateTransaction(
    tx: Transaction,
    addlResources?: undefined,
    authMode?: rpc.Api.SimulationAuthMode,
  ): Promise<rpc.Api.SimulateTransactionResponse>;
  getTransaction(hash: string): Promise<{ status: string; ledger?: number }>;
}
type PublicKeys = Record<KeyName, { publicKey: string }>;
/** Record-mode reads. Offline tests supply public keys only. */
export interface ReadContext {
  sdk: Sdk;
  networkPassphrase: string;
  keys: PublicKeys;
  rpc: Pick<Cap85Rpc, 'getAccount' | 'simulateTransaction'>;
}
export interface ReconcileContext extends ReadContext {
  rpc: Pick<Cap85Rpc, 'getAccount' | 'simulateTransaction' | 'getTransaction'>;
  record: RecordRow;
}
export interface PrepareContext extends ReconcileContext {
  reconcile(): Promise<unknown>;
  assertClear(): void;
}
/** The full context. A LiveContext satisfies it. */
export type Cap85Context = Pick<
  LiveContext,
  | 'sdk'
  | 'networkPassphrase'
  | 'keys'
  | 'signDigest'
  | 'sign'
  | 'send'
  | 'record'
  | 'fund'
  | 'assertClear'
  | 'reconcile'
  | 'rows'
> & { rpc: Cap85Rpc };

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();
const u32 = (sdk: Sdk, n: number) => sdk.xdr.ScVal.scvU32(n);
const bytes = (sdk: Sdk, b: Uint8Array) => sdk.xdr.ScVal.scvBytes(Buffer.from(b));
const addr = (sdk: Sdk, a: string) => sdk.nativeToScVal(a, { type: 'address' });
const str = (sdk: Sdk, s: string) => sdk.xdr.ScVal.scvString(s);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// ---------- CAP-85 XDR builders ----------
export const externalRef = (sdk: Sdk, owner: string, tag: string) =>
  sdk.xdr.ContractExecutable.contractExecutableExternalRef(
    new sdk.xdr.ContractExecutableExternalRef({ executableOwner: new sdk.Address(owner).toScAddress(), tag }),
  );
export const wasmExecutable = (sdk: Sdk, hashHex: string) =>
  sdk.xdr.ContractExecutable.contractExecutableWasm(Buffer.from(hashHex, 'hex'));
export function createContractOp(
  sdk: Sdk,
  {
    deployer,
    executable,
    salt,
    constructorArgs = [],
  }: {
    deployer: string;
    executable: xdr.ContractExecutable;
    salt: Uint8Array;
    constructorArgs?: xdr.ScVal[];
  },
) {
  const contractIdPreimage = sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new sdk.xdr.ContractIdPreimageFromAddress({ address: new sdk.Address(deployer).toScAddress(), salt }),
  );
  const func = sdk.xdr.HostFunction.hostFunctionTypeCreateContractV2(
    new sdk.xdr.CreateContractArgsV2({ contractIdPreimage, executable, constructorArgs }),
  );
  return sdk.Operation.invokeHostFunction({ func, auth: [] });
}
export function derivedContractId(sdk: Sdk, networkPassphrase: string, deployer: string, salt: Uint8Array) {
  const preimage = sdk.xdr.HashIdPreimage.envelopeTypeContractId(
    new sdk.xdr.HashIdPreimageContractId({
      networkId: Buffer.from(sdk.hash(networkPassphrase)),
      contractIdPreimage: sdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new sdk.xdr.ContractIdPreimageFromAddress({ address: new sdk.Address(deployer).toScAddress(), salt }),
      ),
    }),
  );
  return sdk.StrKey.encodeContract(Buffer.from(sdk.hash(preimage.toXdr())));
}
export function describeExecutable(sdk: Sdk, exe: xdr.ContractExecutable): ExecutableDescription {
  if (exe.type === 'contractExecutableExternalRef')
    return {
      type: 'external_ref',
      owner: sdk.Address.fromScAddress(exe.externalRef.executableOwner).toString(),
      tag: String(exe.externalRef.tag),
    };
  if (exe.type === 'contractExecutableWasm') return { type: 'wasm', wasm_hash: hex(exe.wasmHash.toXdr()) };
  return { type: exe.type };
}
// Expected authorization root for one local operation: the same function and arguments, no subtree.
// Every operation in this suite is a direct call, a CreateContractV2 creation, or an upload.
// Any other root is malformed, and any other host function fails here.
export function expectedInvocation(sdk: Sdk, func: xdr.HostFunction) {
  const F = sdk.xdr.SorobanAuthorizedFunction;
  let fn: xdr.SorobanAuthorizedFunction;
  if (func.type === 'hostFunctionTypeInvokeContract')
    fn = F.sorobanAuthorizedFunctionTypeContractFn(func.invokeContract);
  else if (func.type === 'hostFunctionTypeCreateContractV2')
    fn = F.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(func.createContractV2);
  else if (func.type === 'hostFunctionTypeUploadContractWasm')
    return null; // no authorization entry at all
  else throw new Error(`Unsupported host function ${func.type}`);
  return new sdk.xdr.SorobanAuthorizedInvocation({ function: fn, subInvocations: [] });
}
// Validates a recorded entry against the local operation before anything is signed.
// An address entry must be unsigned AddressV2 credentials for an address with an authorizer.
// A source-account entry authorizes key A through its envelope signature; its root must still match.
export function verifyAuthEntry(
  sdk: Sdk,
  entry: xdr.SorobanAuthorizationEntry,
  expected: xdr.SorobanAuthorizedInvocation | null,
  allowedAddresses: string[],
  label: string,
) {
  if (!expected)
    throw new Error(`${label}: RPC returned an authorization entry for an operation that needs none`);
  const root = entry.rootInvocation;
  if (root.subInvocations.length !== 0)
    throw new Error(
      `${label}: recorded auth root has ${root.subInvocations.length} sub-invocations; expected none`,
    );
  if (root.toXdr('base64') !== expected.toXdr('base64'))
    throw new Error(`${label}: recorded auth root differs from the local operation`);
  const { credentials } = entry;
  if (credentials.type === 'sorobanCredentialsSourceAccount') return;
  if (credentials.type !== 'sorobanCredentialsAddressV2')
    throw new Error(`${label}: recorded auth entry uses ${credentials.type}, not AddressV2 credentials`);
  if (credentials.addressV2.signature.type !== 'scvVoid')
    throw new Error(`${label}: recorded auth entry already holds a signature`);
  const address = sdk.Address.fromScAddress(credentials.addressV2.address).toString();
  if (!allowedAddresses.includes(address))
    throw new Error(`${label}: recorded auth entry is for unexpected address ${address}`);
}
export function authorizedExecutable(sdk: Sdk, entry: xdr.SorobanAuthorizationEntry) {
  const fn = entry.rootInvocation.function;
  return fn.type === 'sorobanAuthorizedFunctionTypeCreateContractV2HostFn'
    ? describeExecutable(sdk, fn.createContractV2HostFn.executable)
    : undefined;
}

// ---------- local transaction path ----------
async function buildTx(ctx: ReadContext, operations: xdr.Operation[]) {
  const account = await ctx.rpc.getAccount(ctx.keys.a.publicKey);
  const builder = new ctx.sdk.TransactionBuilder(account, {
    fee: String(100 * operations.length),
    networkPassphrase: ctx.networkPassphrase,
  });
  operations.forEach((op) => builder.addOperation(op));
  return builder.setTimeout(120).build();
}
// The host function of a locally built single-operation transaction.
function hostFunction(tx: Transaction) {
  const op = tx.operations[0];
  if (op?.type !== 'invokeHostFunction')
    throw new TypeError('The transaction does not invoke a host function.');
  return op.func;
}
const isUnknown = (e: RequestError): e is RequestError & { hash?: unknown } =>
  e instanceof UnknownSubmission || e.code === 'unknown_submission';
function simulationText(sdk: Sdk, sim: rpc.Api.SimulateTransactionErrorResponse) {
  let text = String(sim.error ?? '');
  for (const ev of sim.events ?? []) {
    try {
      const event = typeof ev === 'string' ? sdk.xdr.DiagnosticEvent.fromXdr(ev, 'base64') : ev;
      text +=
        '\n' +
        JSON.stringify(sdk.scValToNative(event.event.body.v0.data), (_, v) =>
          typeof v === 'bigint' ? String(v) : v,
        );
    } catch {
      /* best effort */
    }
  }
  return text;
}
function matchRejection(text: string, expect: Expectation | Expectation[], label: string) {
  const list = Array.isArray(expect) ? expect : [expect];
  const matched = list.find((e) => text.includes(e.error));
  if (!matched)
    throw new Error(
      `${label}: expected ${list.map((e) => e.error).join(' or ')} in simulation error, got: ${text.slice(0, 800)}`,
    );
  if (matched.diagnostic && !text.includes(matched.diagnostic))
    throw new Error(`${label}: expected host diagnostic "${matched.diagnostic}", got: ${text.slice(0, 800)}`);
  return { expected: matched.error, diagnostic_matched: matched.diagnostic };
}
const entryAddress = (sdk: Sdk, entry: xdr.SorobanAuthorizationEntry) =>
  sdk.Address.fromScAddress(requireAddressCredentials(entry).address).toString();
const cloneEntry = (sdk: Sdk, entry: xdr.SorobanAuthorizationEntry) =>
  sdk.xdr.SorobanAuthorizationEntry.fromXdr(entry.toXdr());
const normalizeAuth = (sdk: Sdk, list: readonly (string | xdr.SorobanAuthorizationEntry)[] | undefined) =>
  (list ?? []).map((e) =>
    typeof e === 'string' ? sdk.xdr.SorobanAuthorizationEntry.fromXdr(e, 'base64') : e,
  );

// Reads through record-mode simulation. No signing.
async function readScVal(ctx: ReadContext, contractId: string, method: string, args: xdr.ScVal[] = []) {
  const sim = await ctx.rpc.simulateTransaction(
    await buildTx(ctx, [new ctx.sdk.Contract(contractId).call(method, ...args)]),
    undefined,
    'record',
  );
  if (ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${method} read failed: ${sim.error}`);
  if (!sim.result) throw new Error(`${method} read returned no result`);
  return sim.result.retval;
}
const readU32 = async (ctx: ReadContext, id: string, method: string, args?: xdr.ScVal[]) =>
  Number(ctx.sdk.scValToNative(await readScVal(ctx, id, method, args)));
async function readOptionalHash(
  ctx: ReadContext,
  id: string,
  method: string,
  args?: xdr.ScVal[],
): Promise<string | null> {
  const v = await readScVal(ctx, id, method, args);
  return v.type === 'scvVoid' ? null : hex(ctx.sdk.scValToNative(v));
}
const contractDataVal = (entry: rpc.Api.LedgerEntryResult | undefined) => {
  const data = entry?.val;
  if (data?.type !== 'contractData') throw new Error('unexpected ledger entry shape');
  return data.contractData.val;
};
export async function readInstanceExecutable(
  ctx: Pick<Cap85Context, 'sdk'> & { rpc: Pick<Cap85Rpc, 'getContractData'> },
  contractId: string,
) {
  const entry = await ctx.rpc.getContractData(
    contractId,
    ctx.sdk.xdr.ScVal.scvLedgerKeyContractInstance(),
    ctx.sdk.rpc.Durability.Persistent,
  );
  const instance = contractDataVal(entry);
  if (instance.type !== 'scvContractInstance') throw new Error('unexpected ledger entry shape');
  return {
    ...describeExecutable(ctx.sdk, instance.instance.executable),
    live_until_ledger: entry.liveUntilLedgerSeq,
  };
}
export async function readExecutableTagEntry(
  ctx: Pick<Cap85Context, 'sdk'> & { rpc: Pick<Cap85Rpc, 'getContractData'> },
  owner: string,
  tag: string,
) {
  const entry = await ctx.rpc.getContractData(
    owner,
    ctx.sdk.xdr.ScVal.scvExecutableTag(tag),
    ctx.sdk.rpc.Durability.Persistent,
  );
  return {
    wasm_hash: hex(ctx.sdk.scValToNative(contractDataVal(entry))),
    live_until_ledger: entry.liveUntilLedgerSeq,
  };
}

// Record-mode simulation that must fail (contract logic or protocol guard). No signing.
async function expectRecordRejected(
  ctx: ReadContext,
  operation: xdr.Operation,
  label: string,
  expect: Expectation,
) {
  const sim = await ctx.rpc.simulateTransaction(await buildTx(ctx, [operation]), undefined, 'record');
  if (!ctx.sdk.rpc.Api.isSimulationError(sim))
    throw new Error(`${label}: expected ${expect.error}, but record simulation succeeded`);
  const text = simulationText(ctx.sdk, sim);
  return {
    outcome: 'simulation_rejected',
    mode: 'record',
    ...matchRejection(text, expect, label),
    error: text.slice(0, 2000),
    ledger: sim.latestLedger,
  };
}

interface InvokeInput {
  operation: xdr.Operation;
  authorizers?: Authorizer[];
  label: string;
  expect?: Expectation | Expectation[] | 'observe';
  predicted?: Predicted;
}
// Single submission path for every operation, with or without address authorizers.
// expect: undefined (must succeed), {error, diagnostic?} or a list (must be rejected at enforce), or 'observe'.
async function invokeOperation(
  ctx: Cap85Context,
  state: Cap85State,
  { operation, authorizers = [], label, expect, predicted }: InvokeInput,
) {
  const { sdk, rpc, networkPassphrase } = ctx;
  const template = await buildTx(ctx, [operation]);
  const func = hostFunction(template);
  const recorded = await rpc.simulateTransaction(template, undefined, 'record');
  if (sdk.rpc.Api.isSimulationError(recorded))
    throw new Error(`${label}: record simulation failed: ${recorded.error}`);
  const expiration = recorded.latestLedger + EXPIRY_LEDGERS;
  // Invariant: every recorded root must equal the local operation, with an empty subtree. Every address entry
  // must be unsigned AddressV2 credentials for an address with an authorizer. All entries pass before any
  // signing request is made.
  const expected = expectedInvocation(sdk, func);
  const allowed = authorizers.map((a) => a.address);
  const recordedAuth = normalizeAuth(sdk, recorded.result?.auth);
  for (const raw of recordedAuth) verifyAuthEntry(sdk, raw, expected, allowed, label);
  const entries: EntryMeta[] = [];
  const auth: xdr.SorobanAuthorizationEntry[] = [];
  for (const raw of recordedAuth) {
    const entry = cloneEntry(sdk, raw);
    const credentials = addressCredentials(entry);
    if (!credentials) {
      auth.push(entry);
      entries.push({ variant: entry.credentials.type, source_account: true, root_verified: true });
      continue;
    }
    const address = entryAddress(sdk, entry);
    const signer = authorizers.find((a) => a.address === address);
    if (!signer) throw new Error(`${label}: no authorizer for ${address}`);
    const meta: EntryMeta = {
      variant: entry.credentials.type,
      address,
      signer: signer.label,
      nonce: String(credentials.nonce),
      expiration,
      root_verified: true,
      authorized_executable: authorizedExecutable(sdk, entry),
      unsigned_xdr: raw.toXdr('base64'),
    };
    const signed = await sdk.authorizeEntry(
      entry,
      async (preimage, payload) => {
        meta.preimage_xdr = preimage.toXdr('base64');
        meta.payload = hex(payload);
        // Durable record of what is about to be signed, before the signing request.
        ctx.record(`${label}.preimage`, 'prepared', {
          address,
          signer: signer.label,
          variant: meta.variant,
          nonce: meta.nonce,
          expiration,
          preimage_xdr: meta.preimage_xdr,
          payload: meta.payload,
          authorized_executable: meta.authorized_executable,
        });
        return { signatureScVal: await signer.signatureScVal(Buffer.from(payload), entry, meta), address };
      },
      expiration,
      networkPassphrase,
    );
    meta.signed_xdr = signed.toXdr('base64');
    entries.push(meta);
    auth.push(signed);
  }
  const tx = await buildTx(ctx, [sdk.Operation.invokeHostFunction({ func, auth })]);
  const sim = await rpc.simulateTransaction(tx, undefined, 'enforce');
  const evidence = {
    entries,
    auth_xdr: auth.map((e) => e.toXdr('base64')),
    unsigned_tx_xdr: tx.toXDR(),
    ledger_at_enforce: sim.latestLedger,
    credential_variants: auth.map((e) => e.credentials.type),
  };
  const rejected = sdk.rpc.Api.isSimulationError(sim);
  if (expect === 'observe') {
    if (rejected)
      return {
        outcome: 'simulation_rejected',
        observed: 'rejected',
        error: simulationText(sdk, sim).slice(0, 2000),
        ...evidence,
      };
  } else if (expect) {
    if (!rejected)
      throw new Error(
        `${label}: expected ${(Array.isArray(expect) ? expect : [expect]).map((e) => e.error).join(' or ')}, but enforce simulation succeeded`,
      );
    const text = simulationText(sdk, sim);
    return {
      outcome: 'simulation_rejected',
      mode: 'enforce',
      ...matchRejection(text, expect, label),
      error: text.slice(0, 2000),
      ...evidence,
    };
  } else if (rejected) {
    throw new Error(`${label}: enforce simulation failed: ${sim.error}`);
  }
  // Every submission runs inside a step. Its marker keys the reconciliation of this hash.
  const marker = state.inflight;
  if (!marker) throw new Error(`${label}: no step marker before submission`);
  const prepared = sdk.rpc.assembleTransaction(tx, sim).build();
  ctx.assertClear?.();
  await ctx.sign(prepared, ctx.keys.a);
  const hash = hex(prepared.hash());
  // Persist the attempt before sending: a rerun reconciles this hash instead of signing again.
  state.inflight = {
    ...marker,
    hash,
    predicted,
    envelope_xdr: prepared.toXDR(),
    sent_at: new Date().toISOString(),
  };
  saveState(state);
  let sent;
  try {
    sent = await ctx.send(prepared, label);
  } catch (eValue) {
    const e = requestError(eValue);
    if (isUnknown(e)) throw e;
    if (
      /submission outcome (is )?unknown|NOT_FOUND|TRY_AGAIN_LATER|timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(
        String(e.message),
      )
    )
      throw new UnknownSubmission(label, hash, e);
    throw e;
  }
  const retval = sim.result?.retval;
  return {
    outcome: 'submitted',
    observed: expect === 'observe' ? 'accepted' : undefined,
    hash: sent.hash,
    ledger: sent.ledger,
    retval_native: retval ? sdk.scValToNative(retval) : undefined,
    retval_address: retval?.type === 'scvAddress' ? sdk.Address.fromScVal(retval).toString() : undefined,
    predicted,
    ...evidence,
  };
}
const submitSource = (
  ctx: Cap85Context,
  state: Cap85State,
  operation: xdr.Operation,
  label: string,
  predicted?: Predicted,
) => invokeOperation(ctx, state, { operation, label, predicted });

// ---------- checkpoint ----------
// JSON files are typed by their reader. The checkpoint binding and manifest hashes are checked after reading.
function readJson<T>(url: string | URL, { optional = false } = {}): T | null {
  try {
    return JSON.parse(readFileSync(url, 'utf8'));
  } catch (eValue) {
    const e = requestError(eValue);
    if (optional && e.code === 'ENOENT') return null;
    throw new Error(`cannot read ${url instanceof URL ? url.pathname : url}: ${e.message}`);
  }
}
function requireJson<T>(url: string | URL): T {
  const value = readJson<T>(url);
  if (value === null)
    throw new Error(`cannot read ${url instanceof URL ? url.pathname : url}: the file holds JSON null`);
  return value;
}
export function bindingFor(ctx: CheckpointContext, base: BaseState, manifest: Cap85Manifest): Binding {
  return {
    network: ctx.networkPassphrase,
    keys: (['a', 'b', 'c'] as const).map((k) => ctx.keys[k].publicKey),
    cap85_artifacts: Object.fromEntries(
      Object.entries(manifest.artifacts)
        .map(([f, a]) => [f, a.sha256])
        .sort(),
    ),
    base_contracts: Object.fromEntries(
      ['oz_basic_a', 'simple_account_b', 'ed25519_verifier'].map((n) => [n, base.contracts[n]?.id]),
    ),
  };
}
export function loadManifest(file: string | URL = MANIFEST) {
  const manifest = requireJson<Cap85Manifest>(file);
  for (const f of Object.values(FILES)) {
    const a = manifest.artifacts[f];
    if (!a) throw new Error(`manifest lacks ${f}`);
    if (hex(sha256(readFileSync(new URL(f, WASM_DIR)))) !== a.sha256)
      throw new Error(`artifact ${f} differs from the manifest`);
  }
  return manifest;
}
export function loadBase(file: string | URL = BASE_STATE) {
  const base = requireJson<BaseState>(file);
  for (const n of ['oz_basic_a', 'simple_account_b', 'ed25519_verifier'])
    if (!base.contracts[n]) throw new Error(`baseline instance ${n} missing`);
  return base;
}
export function loadState(
  ctx: CheckpointContext,
  base: BaseState,
  manifest: Cap85Manifest,
  file: string | URL = STATE_FILE,
) {
  const state: Cap85State = readJson<Cap85State>(file, { optional: true }) ?? {
    contracts: {},
    wasm: {},
    done: {},
    steps: {},
  };
  if (!state.contracts || !state.wasm || !state.done || !state.steps)
    throw new Error('cap85 checkpoint lacks contracts, wasm, done, or steps; review evidence before reuse');
  const binding = bindingFor(ctx, base, manifest);
  const populated =
    Object.keys(state.contracts).length ||
    Object.keys(state.wasm).length ||
    Object.keys(state.done).length ||
    Object.keys(state.steps).length ||
    state.inflight;
  if (state.binding) {
    if (JSON.stringify(state.binding) !== JSON.stringify(binding))
      throw new Error(
        'cap85 checkpoint binding mismatch: network, keys, artifacts, or baseline instances changed',
      );
  } else if (populated)
    throw new Error('cap85 checkpoint has no binding but holds state; review evidence before reuse');
  state.binding = binding;
  for (const [f, w] of Object.entries(state.wasm))
    if (manifest.artifacts[f]?.sha256 !== w?.hash)
      throw new Error(`cap85 checkpoint upload ${f} has no verified WASM`);
  state[FILE] = file;
  return state;
}
/** Writes a checkpoint. The path comes from the argument or from loadState. */
export function saveState(state: Partial<Cap85State>, file = state[FILE]) {
  if (!file) throw new Error('checkpoint file unknown: load the state with loadState before saving');
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
  const envRows = process.env.WALLETERM_ROWS ? process.env.WALLETERM_ROWS.split(',') : undefined;
  const requested = (ctx.rows ?? envRows ?? ROW_IDS).map((s) => String(s).trim()).filter(Boolean);
  const unknown = requested.filter((id) => !ROW_IDS.includes(id));
  if (unknown.length) throw new Error(`unknown cap85 row ids: ${unknown.join(', ')}`);
  return new Set(requested);
}

// Step cache with an inflight marker. Order on a step: mark inflight -> run (hash persisted before send) ->
// store result and clear inflight in one write. A rerun that finds a marker reconciles it or fails closed.
export async function reconcileInflight(
  ctx: ReconcileContext,
  state: Cap85State,
): Promise<Reconciled | Cleared | null> {
  const inflight = state.inflight;
  if (!inflight) return null;
  if (!inflight.hash) {
    // Interrupted before any send: nothing reached the network. Clear and rerun the step.
    delete state.inflight;
    saveState(state);
    return { cleared: true, label: inflight.label, reason: 'no submission attempted' };
  }
  const result = await ctx.rpc.getTransaction(inflight.hash);
  if (result.status === 'SUCCESS') {
    const counter = await checkCounter(ctx, inflight);
    const reconciled: Reconciled = {
      outcome: 'reconciled',
      hash: inflight.hash,
      ledger: result.ledger,
      status: result.status,
      predicted: inflight.predicted,
      retval_address: inflight.predicted?.contract,
      ...counter,
      note: 'result recovered from the network after an interrupted attempt',
    };
    state.steps[inflight.key] = reconciled;
    delete state.inflight;
    saveState(state);
    ctx.record(`${inflight.row}.${inflight.label}`, 'reconciled', reconciled);
    return reconciled;
  }
  if (result.status === 'FAILED') {
    ctx.record(`${inflight.row}.${inflight.label}`, 'failed', {
      hash: inflight.hash,
      status: result.status,
      note: 'interrupted attempt failed on chain; step will rerun',
    });
    delete state.inflight;
    saveState(state);
    return { cleared: true, label: inflight.label, reason: 'previous attempt FAILED' };
  }
  throw new UnknownSubmission(
    inflight.label,
    inflight.hash,
    new Error(`interrupted attempt has status ${result.status}; reconcile before any new signing`),
  );
}
const COUNTER_INCREMENTS: Record<string, number | undefined> = { 'X02:ping': 1, 'X03:ping': 2 };
export async function checkCounter(
  ctx: ReadContext,
  inflight: Inflight | undefined,
): Promise<{ count_before?: number; count_after?: number }> {
  if (!inflight) throw new Error('checkCounter: no inflight step');
  const increment = COUNTER_INCREMENTS[inflight.key];
  if (!increment) return {};
  const check = inflight.counter_check;
  if (
    !check ||
    !Number.isSafeInteger(check.before) ||
    check.before < 0 ||
    check.increment !== increment ||
    !check.target ||
    check.who !== ctx.keys.a.publicKey
  ) {
    throw new Error(`${inflight.key}: missing or invalid durable counter precondition`);
  }
  const after = await readU32(ctx, check.target, 'count', [addr(ctx.sdk, check.who)]);
  if (after !== check.before + increment)
    throw new Error(`${inflight.key}: counter mismatch ${check.before} -> ${after}, expected +${increment}`);
  return { count_before: check.before, count_after: after };
}
export async function prepareCap85(ctx: PrepareContext, state: Cap85State) {
  // The shared gate queries only its saved hash. Unknown outcomes stop this path.
  await ctx.reconcile();
  const result = await reconcileInflight(ctx, state);
  ctx.assertClear();
  return result;
}
export function assertCreatedReference(details: CreationDetails, manager: string, wasmHash: string) {
  const exe = details.created_instance_executable;
  if (
    !details.created ||
    details.created !== details.external_ref_creation_passes.predicted?.contract ||
    exe?.type !== 'external_ref' ||
    exe.owner !== manager ||
    exe.tag !== TAG ||
    details.created_version !== 2 ||
    details.created_resolved_wasm !== wasmHash
  ) {
    throw new Error('X04: created contract must use the expected manager, tag, and v2 executable');
  }
}
type Step = (label: string, fn: () => Promise<StepResult>, predicted?: Predicted) => Promise<StepResult>;
const stepper =
  (ctx: Cap85Context, state: Cap85State, rowId: string, details: RowDetails): Step =>
  async (label, fn, predicted) => {
    const key = `${rowId}:${label}`;
    await reconcileInflight(ctx, state);
    const previous = state.steps[key];
    if (previous) {
      ctx.record(`${rowId}.${label}`, 'passed_previous_run', { reused_evidence: true });
      (details.reused_steps ??= []).push(label);
      return { status: 'passed_previous_run', ...previous };
    }
    state.inflight = { row: rowId, label, key, predicted, started_at: new Date().toISOString() };
    saveState(state);
    const result = await fn();
    state.steps[key] = result;
    delete state.inflight;
    saveState(state);
    return result;
  };
// The saved hash of an uploaded artifact. Uploads run before any row reads them.
function wasmHash(state: Cap85State, file: string) {
  const saved = state.wasm[file];
  if (!saved) throw new Error(`${file} has no uploaded WASM in the checkpoint`);
  return saved.hash;
}
async function upload(
  ctx: Cap85Context,
  state: Cap85State,
  manifest: Cap85Manifest,
  step: Step,
  file: string,
) {
  const saved = state.wasm[file];
  if (saved) return saved.hash;
  const wasm = readFileSync(new URL(file, WASM_DIR));
  const hash = hex(sha256(wasm));
  if (hash !== manifest.artifacts[file]?.sha256) throw new Error(`${file} differs from the manifest`);
  const r = await step(
    `upload-${file}`,
    () =>
      submitSource(ctx, state, ctx.sdk.Operation.uploadContractWasm({ wasm }), `X-upload-${file}`, {
        wasm_hash: hash,
      }),
    { wasm_hash: hash },
  );
  state.wasm[file] = { hash, tx: r.hash };
  saveState(state);
  return hash;
}
// Wasm-executable deploy, deployer A (source-account credentials). The address is derived before sending.
async function deployWasm(
  ctx: Cap85Context,
  state: Cap85State,
  manifest: Cap85Manifest,
  step: Step,
  name: string,
  file: string,
  constructorArgs: xdr.ScVal[],
) {
  const existing = state.contracts[name];
  if (existing) return existing.id;
  const wasmHash = Buffer.from(await upload(ctx, state, manifest, step, file), 'hex');
  const salt = randomBytes(32);
  const predicted = {
    contract: derivedContractId(ctx.sdk, ctx.networkPassphrase, ctx.keys.a.publicKey, salt),
    salt: hex(salt),
  };
  const r = await step(
    `deploy-${name}`,
    () =>
      submitSource(
        ctx,
        state,
        ctx.sdk.Operation.createCustomContract({
          address: new ctx.sdk.Address(ctx.keys.a.publicKey),
          wasmHash,
          constructorArgs,
          salt,
        }),
        `X-deploy-${name}`,
        predicted,
      ),
    predicted,
  );
  const id = r.retval_address ?? r.predicted?.contract;
  if (!id) throw new Error(`deploy ${name}: no contract address`);
  state.contracts[name] = { id, executable: { type: 'wasm', file, wasm_hash: hex(wasmHash) }, tx: r.hash };
  saveState(state);
  return id;
}
const call = (sdk: Sdk, id: string, method: string, ...args: xdr.ScVal[]) =>
  new sdk.Contract(id).call(method, ...args);

// ---------- rows ----------
async function x01(ctx: Cap85Context, state: Cap85State, manifest: Cap85Manifest) {
  const { sdk, keys } = ctx;
  const details: RowDetails = { title: 'manager owns the executable reference; admin is key B' };
  const step = stepper(ctx, state, 'X01', details);
  for (const file of Object.values(FILES)) await upload(ctx, state, manifest, step, file);
  details.uploads = state.wasm;
  const manager = await deployWasm(ctx, state, manifest, step, 'manager', FILES.manager, [
    addr(sdk, keys.b.publicKey),
  ]);
  details.manager = manager;
  const v1 = wasmHash(state, FILES.v1),
    v2 = wasmHash(state, FILES.v2);
  const set = (hash: string, version: number) =>
    call(
      sdk,
      manager,
      'set_executable',
      str(sdk, TAG),
      bytes(sdk, Buffer.from(hash, 'hex')),
      u32(sdk, version),
    );
  details.set_v1_by_admin_b = await step('set-executable-v1', () =>
    invokeOperation(ctx, state, {
      operation: set(v1, 1),
      authorizers: [gAuthorizer(ctx, keys.b)],
      label: 'X01-set-executable-v1',
    }),
  );
  const readExecutable = (details.read_executable = await readOptionalHash(ctx, manager, 'executable', [
    str(sdk, TAG),
  ]));
  const readTagEntry = (details.read_tag_entry = await readExecutableTagEntry(ctx, manager, TAG));
  if (readExecutable !== v1 || readTagEntry.wasm_hash !== v1)
    throw new Error('X01: executable reference does not point at target v1');
  details.version_of = await readU32(ctx, manager, 'version_of', [str(sdk, TAG)]);
  details.stale_version_rejected = await step('stale-version', () =>
    expectRecordRejected(ctx, set(v2, 1), 'X01-stale-version', X.managerStale),
  );
  details.unknown_wasm_rejected_by_protocol = await step('unknown-wasm', () =>
    expectRecordRejected(
      ctx,
      call(sdk, manager, 'set_executable', str(sdk, TAG), bytes(sdk, randomBytes(32)), u32(sdk, 2)),
      'X01-unknown-wasm',
      X.unknownWasm,
    ),
  );
  // Key C signs B's admin entry: the built-in account rejects a signer that is not on the account.
  const cForB: Authorizer = {
    address: keys.b.publicKey,
    label: `G:${keys.b.name} signed by ${keys.c.name}`,
    async signatureScVal(payload, _entry, meta = {}) {
      Object.assign(meta, { scheme: 'g-account', digest: hex(payload), signers: [keys.c.name] });
      return accountSignature(sdk, [
        { rawKey: keys.c.rawPublicKey, signature: await ctx.signDigest(keys.c, payload) },
      ]);
    },
  };
  details.unauthorized_change_rejected = await step('unauthorized-signer', () =>
    invokeOperation(ctx, state, {
      operation: set(v2, 2),
      authorizers: [cForB],
      label: 'X01-unauthorized-signer',
      expect: X.wrongSigner,
    }),
  );
  return details;
}

async function x02(ctx: Cap85Context, state: Cap85State) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id;
  if (!manager) throw new Error('X02 needs X01 (manager)');
  const details: RowDetails = {
    title: 'deploy target through ExternalRef, deployer A (G-account, source credentials)',
  };
  const step = stepper(ctx, state, 'X02', details);
  const salt = randomBytes(32);
  const predicted = {
    contract: derivedContractId(sdk, ctx.networkPassphrase, keys.a.publicKey, salt),
    salt: hex(salt),
  };
  const deploy = (details.deploy = await step(
    'deploy-external-ref',
    () =>
      submitSource(
        ctx,
        state,
        createContractOp(sdk, {
          deployer: keys.a.publicKey,
          executable: externalRef(sdk, manager, TAG),
          salt,
          constructorArgs: [addr(sdk, keys.b.publicKey)],
        }),
        'X02-deploy-external-ref',
        predicted,
      ),
    predicted,
  ));
  const target = deploy.retval_address ?? deploy.predicted?.contract;
  if (!target || (deploy.retval_address && deploy.retval_address !== deploy.predicted?.contract))
    throw new Error('X02: deployed address differs from the derived address');
  state.contracts.target_ref ??= {
    id: target,
    executable: { type: 'external_ref', owner: manager, tag: TAG },
    tx: deploy.hash,
  };
  saveState(state);
  details.target = target;
  const instance = (details.instance_executable = await readInstanceExecutable(ctx, target));
  if (instance.type !== 'external_ref' || instance.owner !== manager || instance.tag !== TAG)
    throw new Error('X02: instance executable is not the expected ExternalRef');
  const version = (details.version = await readU32(ctx, target, 'version'));
  const resolved = (details.resolved_wasm = await readOptionalHash(ctx, manager, 'resolved_wasm', [
    addr(sdk, target),
  ]));
  if (version !== 1 || resolved !== wasmHash(state, FILES.v1))
    throw new Error(`X02: expected v1, got version ${version} resolved ${resolved}`);
  // Persist the precondition before submission; reconciliation repeats the same check.
  details.ping = await step('ping', async () => {
    const before = await readU32(ctx, target, 'count', [addr(sdk, keys.a.publicKey)]);
    const inflight = state.inflight;
    if (!inflight) throw new Error('X02: ping has no inflight marker');
    inflight.counter_check = { target, who: keys.a.publicKey, before, increment: 1 };
    saveState(state);
    const r = await submitSource(
      ctx,
      state,
      call(sdk, target, 'ping', addr(sdk, keys.a.publicKey), u32(sdk, 1)),
      'X02-ping',
    );
    return { ...r, ...(await checkCounter(ctx, state.inflight)) };
  });
  return details;
}

async function x03(ctx: Cap85Context, state: Cap85State) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id,
    target = state.contracts.target_ref?.id;
  if (!manager || !target) throw new Error('X03 needs X01 and X02');
  const details: RowDetails = {
    title: 'manager switches the reference to v2; same address, new behavior, state kept',
  };
  const step = stepper(ctx, state, 'X03', details);
  const v2 = wasmHash(state, FILES.v2);
  details.set_v2_by_admin_b = await step('set-executable-v2', () =>
    invokeOperation(ctx, state, {
      operation: call(
        sdk,
        manager,
        'set_executable',
        str(sdk, TAG),
        bytes(sdk, Buffer.from(v2, 'hex')),
        u32(sdk, 2),
      ),
      authorizers: [gAuthorizer(ctx, keys.b)],
      label: 'X03-set-executable-v2',
    }),
  );
  const version = (details.version = await readU32(ctx, target, 'version'));
  const resolved = (details.resolved_wasm = await readOptionalHash(ctx, manager, 'resolved_wasm', [
    addr(sdk, target),
  ]));
  const instance = (details.instance_executable = await readInstanceExecutable(ctx, target));
  if (version !== 2 || resolved !== v2 || instance.type !== 'external_ref')
    throw new Error(`X03: expected v2 behind the same reference, got version ${version}`);
  details.ping = await step('ping', async () => {
    const before = await readU32(ctx, target, 'count', [addr(sdk, keys.a.publicKey)]);
    const inflight = state.inflight;
    if (!inflight) throw new Error('X03: ping has no inflight marker');
    inflight.counter_check = { target, who: keys.a.publicKey, before, increment: 2 };
    saveState(state);
    const r = await submitSource(
      ctx,
      state,
      call(sdk, target, 'ping', addr(sdk, keys.a.publicKey), u32(sdk, 1)),
      'X03-ping',
    );
    return { ...r, ...(await checkCounter(ctx, state.inflight)) };
  });
  return details;
}

async function x04(ctx: Cap85Context, state: Cap85State, manifest: Cap85Manifest) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id;
  if (!manager || !state.done.X03) throw new Error('X04 needs X03 (v2 reference)');
  const details: RowDetails = {
    title: 'SDK 28 custom account authorizes creation only through the trusted ExternalRef',
  };
  const step = stepper(ctx, state, 'X04', details);
  const account = await deployWasm(ctx, state, manifest, step, 'account28', FILES.account28, [
    bytes(sdk, keys.c.rawPublicKey),
    addr(sdk, manager),
  ]);
  details.account = account;
  const signer = [simpleAuthorizer(ctx, account, keys.c)];
  const salt = randomBytes(32);
  const predicted = {
    contract: derivedContractId(sdk, ctx.networkPassphrase, account, salt),
    salt: hex(salt),
  };
  const passes = (details.external_ref_creation_passes = await step(
    'account-creates-external-ref',
    () =>
      invokeOperation(ctx, state, {
        operation: createContractOp(sdk, {
          deployer: account,
          executable: externalRef(sdk, manager, TAG),
          salt,
          constructorArgs: [addr(sdk, keys.b.publicKey)],
        }),
        authorizers: signer,
        label: 'X04-account-creates-external-ref',
        predicted,
      }),
    predicted,
  ));
  const created = (details.created = passes.retval_address ?? passes.predicted?.contract);
  if (!created) throw new Error('X04: the creation step returned no contract address');
  const creation: CreationDetails = {
    created,
    external_ref_creation_passes: passes,
    created_instance_executable: (details.created_instance_executable = await readInstanceExecutable(
      ctx,
      created,
    )),
    created_version: (details.created_version = await readU32(ctx, created, 'version')),
    created_resolved_wasm: (details.created_resolved_wasm = await readOptionalHash(
      ctx,
      manager,
      'resolved_wasm',
      [addr(sdk, created)],
    )),
  };
  assertCreatedReference(creation, manager, wasmHash(state, FILES.v2));
  details.wasm_creation_rejected = await step('account-rejects-wasm', () =>
    invokeOperation(ctx, state, {
      operation: createContractOp(sdk, {
        deployer: account,
        executable: wasmExecutable(sdk, wasmHash(state, FILES.v1)),
        salt: randomBytes(32),
        constructorArgs: [addr(sdk, keys.b.publicKey)],
      }),
      authorizers: signer,
      label: 'X04-account-rejects-wasm',
      expect: X.accountNotExternalRef,
    }),
  );
  return details;
}

async function x05(ctx: Cap85Context, state: Cap85State, manifest: Cap85Manifest) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id;
  if (!manager) throw new Error('X05 needs X01');
  const details: RowDetails = {
    title: 'SDK 27 context-reading account: ExternalRef fails to decode, Wasm passes',
    offline_reference: 'fixtures/cap85/contracts/account/src/test.rs legacy_sdk27_* tests',
  };
  const step = stepper(ctx, state, 'X05', details);
  const legacy = await deployWasm(ctx, state, manifest, step, 'legacy27', FILES.legacy27, [
    bytes(sdk, keys.c.rawPublicKey),
  ]);
  details.legacy_reads_contexts = legacy;
  const signer = [simpleAuthorizer(ctx, legacy, keys.c)];
  const create = (executable: xdr.ContractExecutable, salt: Uint8Array) =>
    createContractOp(sdk, {
      deployer: legacy,
      executable,
      salt,
      constructorArgs: [addr(sdk, keys.b.publicKey)],
    });
  details.external_ref_rejected = await step('legacy-reads-external-ref', () =>
    invokeOperation(ctx, state, {
      operation: create(externalRef(sdk, manager, TAG), randomBytes(32)),
      authorizers: signer,
      label: 'X05-legacy-reads-external-ref',
      expect: X.legacyDecode,
    }),
  );
  const salt = randomBytes(32);
  const predicted = {
    contract: derivedContractId(sdk, ctx.networkPassphrase, legacy, salt),
    salt: hex(salt),
  };
  details.wasm_passes = await step(
    'legacy-reads-wasm',
    () =>
      invokeOperation(ctx, state, {
        operation: create(wasmExecutable(sdk, wasmHash(state, FILES.v1)), salt),
        authorizers: signer,
        label: 'X05-legacy-reads-wasm',
        predicted,
      }),
    predicted,
  );
  return details;
}

export async function x06(ctx: Cap85Context, state: Cap85State, manifest: Cap85Manifest) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id;
  if (!manager) throw new Error('X06 needs X01');
  // No resume after an executable change: a restart cannot observe the original executable again, and
  // X06 never repeats an operation to recreate it. Startup reconciliation saves or clears any X06 marker,
  // or stops the run, so a saved adopt step is the only record of a change. Stop for manual review.
  const changed = ['adopt-ref', 'adopt-wasm'].flatMap((label) => {
    const saved = state.steps[`X06:${label}`];
    return saved ? [`${label} ${saved.hash}`] : [];
  });
  if (changed.length)
    throw Object.assign(
      new Error(
        `X06: incomplete_evidence: the checkpoint holds ${changed.join(', ')} but not done.X06. ` +
          'X06 does not resume after an executable change. Review these transactions, then recover as fixtures/cap85/README.md describes.',
      ),
      { code: 'incomplete_evidence' },
    );
  const details: RowDetails = {
    title: 'a Wasm-deployed contract adopts the reference, then a direct Wasm again',
  };
  const step = stepper(ctx, state, 'X06', details);
  const plain = await deployWasm(ctx, state, manifest, step, 'target_plain', FILES.v1, [
    addr(sdk, keys.b.publicKey),
  ]);
  details.target_plain = plain;
  const before = (details.before = {
    executable: await readInstanceExecutable(ctx, plain),
    version: await readU32(ctx, plain, 'version'),
  });
  // A partial manual recovery can keep a target that adopt-ref already moved. Stop before any signature.
  if (before.executable.type !== 'wasm' || before.version !== 1)
    throw new Error(
      'X06: the target does not start on the direct v1 executable; recover as fixtures/cap85/README.md describes',
    );
  details.adopt_ref_by_admin_b = await step('adopt-ref', () =>
    invokeOperation(ctx, state, {
      operation: call(sdk, plain, 'adopt_ref', addr(sdk, manager), str(sdk, TAG)),
      authorizers: [gAuthorizer(ctx, keys.b)],
      label: 'X06-adopt-ref',
    }),
  );
  const afterRef = (details.after_adopt_ref = {
    executable: await readInstanceExecutable(ctx, plain),
    version: await readU32(ctx, plain, 'version'),
    resolved_wasm: await readOptionalHash(ctx, manager, 'resolved_wasm', [addr(sdk, plain)]),
  });
  if (afterRef.executable.type !== 'external_ref' || afterRef.version !== 2)
    throw new Error('X06: adopt_ref did not move the contract onto the v2 reference');
  details.adopt_wasm_by_admin_b = await step('adopt-wasm', () =>
    invokeOperation(ctx, state, {
      operation: call(sdk, plain, 'adopt_wasm', bytes(sdk, Buffer.from(wasmHash(state, FILES.v1), 'hex'))),
      authorizers: [gAuthorizer(ctx, keys.b)],
      label: 'X06-adopt-wasm',
    }),
  );
  const afterWasm = (details.after_adopt_wasm = {
    executable: await readInstanceExecutable(ctx, plain),
    version: await readU32(ctx, plain, 'version'),
  });
  if (afterWasm.executable.type !== 'wasm' || afterWasm.version !== 1)
    throw new Error('X06: adopt_wasm did not restore the direct v1 executable');
  return details;
}

// Observation only: outcomes are recorded, not asserted. The row status is `observed`, never `passed`.
async function x07(ctx: Cap85Context, state: Cap85State, manifest: Cap85Manifest, base: BaseState) {
  const { sdk, keys } = ctx;
  const manager = state.contracts.manager?.id;
  if (!manager) throw new Error('X07 needs X01');
  const details: RowDetails = {
    title: 'observed: legacy accounts that ignore contexts or match them (OpenZeppelin)',
  };
  const step = stepper(ctx, state, 'X07', details);
  const create = (deployer: string) =>
    createContractOp(sdk, {
      deployer,
      executable: externalRef(sdk, manager, TAG),
      salt: randomBytes(32),
      constructorArgs: [addr(sdk, keys.b.publicKey)],
    });
  const baseId = (name: string) => {
    const id = base.contracts[name]?.id;
    if (!id) throw new Error(`baseline instance ${name} missing`);
    return id;
  };
  const simple = baseId('simple_account_b');
  const observations: Record<string, StepResult> = {};
  details.simple_ignores_contexts_external_ref = observations.simple_ignores_contexts_external_ref = {
    account: simple,
    expectation:
      'accepted: walleterm_simple_account never decodes its contexts (offline: legacy_sdk27_account_that_ignores_contexts_accepts_external_ref)',
    ...(await step('simple-ignores-external-ref', () =>
      invokeOperation(ctx, state, {
        operation: create(simple),
        authorizers: [simpleAuthorizer(ctx, simple, keys.b)],
        label: 'X07-simple-ignores-external-ref',
        expect: 'observe',
      }),
    )),
  };
  const oz = baseId('oz_basic_a');
  details.oz_sdk27_external_ref = observations.oz_sdk27_external_ref = {
    account: oz,
    expectation: 'rejected: OpenZeppelin 0.7.x (SDK 27) matches every context',
    ...(await step('oz-external-ref', () =>
      invokeOperation(ctx, state, {
        operation: create(oz),
        authorizers: [ozAuthorizer(ctx, oz, baseId('ed25519_verifier'), [keys.a])],
        label: 'X07-oz-external-ref',
        expect: 'observe',
      }),
    )),
  };
  for (const k of ['simple_ignores_contexts_external_ref', 'oz_sdk27_external_ref'])
    if (!observations[k]?.observed && observations[k]?.status !== 'passed_previous_run')
      throw new Error(`X07: no definite outcome for ${k}`);
  return details;
}

interface Row {
  id: string;
  status?: string;
  run(ctx: Cap85Context, state: Cap85State, manifest: Cap85Manifest, base: BaseState): Promise<RowDetails>;
}
const ROWS: Row[] = [
  { id: 'X01', run: x01 },
  { id: 'X02', run: x02 },
  { id: 'X03', run: x03 },
  { id: 'X04', run: x04 },
  { id: 'X05', run: x05 },
  { id: 'X06', run: x06 },
  { id: 'X07', run: x07, status: 'observed' },
];

export async function runCap85(ctx: Cap85Context) {
  const { sdk } = ctx;
  const selected = selectRows(ctx);
  if (ctx.networkPassphrase !== sdk.Networks.TESTNET) throw new Error('cap85 runs on testnet only');
  const manifest = loadManifest();
  const base = loadBase();
  const state = loadState(ctx, base, manifest);
  const network = await ctx.rpc.getNetwork();
  if (network.passphrase !== sdk.Networks.TESTNET)
    throw new Error(`cap85 runs on testnet only; RPC reports ${network.passphrase}`);
  if (!(Number(network.protocolVersion) >= 28))
    throw new Error(`cap85 needs protocol 28 or later, network reports ${network.protocolVersion}`);
  const reconciled = await prepareCap85(ctx, state);
  if (reconciled) ctx.record('X-inflight', 'reconciled', reconciled);
  for (const key of [ctx.keys.a, ctx.keys.b, ctx.keys.c]) await ctx.fund(key);
  ctx.record('X-setup', 'passed', {
    protocol_version: network.protocolVersion,
    network: network.passphrase,
    manifest: {
      soroban_sdk: manifest.workspaces,
      toolchain: manifest.toolchain,
      artifacts: manifest.artifacts,
    },
    payer: ctx.keys.a.publicKey,
  });
  for (const row of ROWS) {
    if (!selected.has(row.id)) {
      ctx.record(row.id, 'not_run', { reason: 'not selected' });
      continue;
    }
    const done = state.done[row.id];
    if (done) {
      ctx.record(row.id, row.status === 'observed' ? 'observed_previous_run' : 'passed_previous_run', {
        reused_evidence: true,
        ...done,
      });
      continue;
    }
    let details;
    try {
      details = await row.run(ctx, state, manifest, base);
    } catch (eValue) {
      const e = requestError(eValue);
      if (isUnknown(e)) {
        ctx.record(row.id, 'blocked', {
          tx_hash: e.hash,
          error: String(e.message),
          action: 'reconcile this hash before any new submission',
        });
        throw e;
      }
      ctx.record(row.id, e.code === 'incomplete_evidence' ? 'incomplete_evidence' : 'failed', {
        error: String(e.stack ?? e),
      });
      throw e; // stop immediately on the first failed row
    }
    state.done[row.id] = details;
    saveState(state);
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
  const assert = (cond: unknown, msg: string) => {
    if (!cond) throw new Error(`self-test: ${msg}`);
  };
  const throws = (fn: () => unknown, re: RegExp, msg: string) => {
    try {
      fn();
    } catch (eValue) {
      const e = requestError(eValue);
      if (re.test(String(e.message))) return;
      throw new Error(`self-test: ${msg}: ${e.message}`);
    }
    throw new Error(`self-test: ${msg}: no error`);
  };
  const rejects = async (p: Promise<unknown>, re: RegExp, msg: string) => {
    try {
      await p;
    } catch (eValue) {
      const e = requestError(eValue);
      if (re.test(String(e.message))) return;
      throw new Error(`self-test: ${msg}: ${e.message}`);
    }
    throw new Error(`self-test: ${msg}: no error`);
  };
  const liveBefore = existsSync(STATE_FILE) ? readFileSync(STATE_FILE) : null;
  const manifest = loadManifest();
  assert(
    manifest.workspaces.contracts?.soroban_sdk === '28.0.0' &&
      /^27\./.test(manifest.workspaces['contracts-sdk27']?.soroban_sdk ?? '') &&
      Object.keys(manifest.artifacts).length === 5,
    'manifest: SDK 28 and SDK 27 workspaces, five artifacts',
  );
  const C = 'CDLDYJWEZSM6IAI4HHPEZTTV65WX4OVN3RZD3U6LQKYAVIZTEK7XYAYT';
  const g = sdk.Keypair.random();
  const key = { name: 'mock', publicKey: g.publicKey(), rawPublicKey: g.rawPublicKey() };
  const records: Details[] = [];
  // No network, envelope signing, submission, or funding happens offline. Each reached call fails the self-test.
  const offline = (name: string) => async (): Promise<never> => {
    throw new Error(`self-test: unexpected ${name}`);
  };
  const offlineRpc: Cap85Rpc = {
    getAccount: offline('rpc.getAccount'),
    simulateTransaction: offline('rpc.simulateTransaction'),
    getTransaction: offline('rpc.getTransaction'),
    getContractData: offline('rpc.getContractData'),
    getNetwork: offline('rpc.getNetwork'),
  };
  const ctx: Cap85Context = {
    sdk,
    networkPassphrase: sdk.Networks.TESTNET,
    keys: { a: key, b: key, c: key },
    signDigest: async (_k, d) => Buffer.from(g.sign(d)),
    record: (id, status, d) => records.push({ id, status, ...d }),
    rpc: offlineRpc,
    sign: offline('envelope signing'),
    send: offline('submission'),
    fund: offline('funding'),
    assertClear: () => {
      throw new Error('self-test: unexpected assertClear');
    },
    reconcile: offline('reconcile'),
  };
  // XDR builders and decoding
  const exe = externalRef(sdk, C, TAG);
  assert(
    describeExecutable(sdk, sdk.xdr.ContractExecutable.fromXdr(exe.toXdr())).owner === C,
    'external ref round trip',
  );
  assert(
    describeExecutable(sdk, wasmExecutable(sdk, 'aa'.repeat(32))).wasm_hash === 'aa'.repeat(32),
    'wasm executable',
  );
  const salt = Buffer.alloc(32, 7);
  const op = createContractOp(sdk, {
    deployer: key.publicKey,
    executable: exe,
    salt,
    constructorArgs: [u32(sdk, 1)],
  });
  const tx = new sdk.TransactionBuilder(new sdk.Account(key.publicKey, '1'), {
    fee: '100',
    networkPassphrase: sdk.Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const func = hostFunction(tx);
  assert(
    func.type === 'hostFunctionTypeCreateContractV2' &&
      describeExecutable(sdk, func.createContractV2.executable).type === 'external_ref',
    'create contract op carries ExternalRef',
  );
  if (func.type !== 'hostFunctionTypeCreateContractV2')
    throw new Error('self-test: create contract op is not CreateContractV2');
  assert(
    /^C[A-Z2-7]{55}$/.test(derivedContractId(sdk, sdk.Networks.TESTNET, key.publicKey, salt)),
    'derived contract id',
  );
  const inst = sdk.xdr.ScVal.fromXdr(
    sdk.xdr.ScVal.scvContractInstance(
      new sdk.xdr.ScContractInstance({ executable: exe, storage: null }),
    ).toXdr(),
  );
  assert(
    inst.type === 'scvContractInstance' && describeExecutable(sdk, inst.instance.executable).tag === TAG,
    'instance executable decode',
  );
  assert(sdk.scValToNative(sdk.xdr.ScVal.scvExecutableTag(TAG)) === TAG, 'executable tag key');
  // Creation auth entry: SDK preimage, custom-account signature, authorized executable evidence, durable preimage record.
  const root = new sdk.xdr.SorobanAuthorizedInvocation({
    function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
      func.createContractV2,
    ),
    subInvocations: [],
  });
  const entry = new sdk.xdr.SorobanAuthorizationEntry({
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new sdk.xdr.SorobanAddressCredentials({
        address: new sdk.Address(C).toScAddress(),
        nonce: 3n,
        signatureExpirationLedger: 0,
        signature: sdk.xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: root,
  });
  assert(
    authorizedExecutable(sdk, entry)?.type === 'external_ref',
    'authorized executable from root invocation',
  );
  const meta: EntryMeta = {};
  const signer = simpleAuthorizer(ctx, C, key);
  const signed = await sdk.authorizeEntry(
    cloneEntry(sdk, entry),
    async (preimage, payload) => {
      meta.preimage_xdr = preimage.toXdr('base64');
      meta.payload = hex(payload);
      ctx.record('self.preimage', 'prepared', { payload: meta.payload });
      return { signatureScVal: await signer.signatureScVal(Buffer.from(payload), entry, meta), address: C };
    },
    100,
    sdk.Networks.TESTNET,
  );
  assert(
    records[0]?.status === 'prepared' && records[0].payload === meta.payload,
    'preimage recorded before signing',
  );
  assert(
    meta.preimage_xdr &&
      typeof meta.payload === 'string' &&
      g.verify(
        Buffer.from(meta.payload, 'hex'),
        Buffer.from(sdk.scValToNative(requireAddressCredentials(signed).signature)),
      ),
    'signature over the recorded payload',
  );
  // Rejection matching requires the error and, when given, the host diagnostic.
  assert(
    matchRejection('HostError: Error(Storage, MissingValue)\n["Wasm does not exist"]', X.unknownWasm, 't')
      .diagnostic_matched === 'Wasm does not exist',
    'diagnostic matched',
  );
  throws(
    () => matchRejection('HostError: Error(Storage, MissingValue)', X.unknownWasm, 't'),
    /expected host diagnostic/,
    'missing diagnostic rejected',
  );
  throws(
    () => matchRejection('HostError: Error(Auth, InvalidAction)', X.wrongSigner, 't'),
    /expected Error\(Contract, #5\)/,
    'unrelated error rejected',
  );
  // Checkpoint safety, inflight reconciliation, row selection.
  const dir = mkdtempSync(join(tmpdir(), 'walleterm-cap85-'));
  const base = {
    contracts: { oz_basic_a: { id: C }, simple_account_b: { id: C }, ed25519_verifier: { id: C } },
  };
  const fresh = loadState(ctx, base, manifest, pathToFileURL(join(dir, 'missing.json')));
  assert(
    Object.keys(fresh.binding?.cap85_artifacts ?? {}).length === 5 && fresh.binding?.keys.length === 3,
    'fresh binding',
  );
  const bound = pathToFileURL(join(dir, 'bound.json'));
  saveState(fresh, bound);
  assert(
    loadState(ctx, base, manifest, bound).binding?.network === sdk.Networks.TESTNET,
    'same binding loads',
  );
  throws(
    () => loadState({ ...ctx, networkPassphrase: sdk.Networks.PUBLIC }, base, manifest, bound),
    /binding mismatch/,
    'network change rejected',
  );
  const broken = pathToFileURL(join(dir, 'broken.json'));
  write(broken, '{');
  throws(() => loadState(ctx, base, manifest, broken), /cannot read/, 'parse error not defaulted');
  const partial = pathToFileURL(join(dir, 'partial.json'));
  write(partial, JSON.stringify({ contracts: {}, wasm: {}, done: {} }));
  throws(
    () => loadState(ctx, base, manifest, partial),
    /lacks contracts, wasm, done, or steps/,
    'missing checkpoint field rejected',
  );
  throws(() => loadBase(pathToFileURL(join(dir, 'nobase.json'))), /cannot read/, 'missing baseline rejected');
  throws(() => selectRows({ rows: ['X01', 'E01'] }), /unknown cap85 row ids: E01/, 'unknown row rejected');
  const h = 'ab'.repeat(32);
  const rpcOf = (status: string): Cap85Rpc => ({
    ...offlineRpc,
    getTransaction: async () => ({ status, ledger: 7 }),
  });
  const s1: Cap85State = {
    ...fresh,
    steps: {},
    inflight: { row: 'X01', label: 'ping', key: 'X01:ping', hash: h, predicted: { contract: C } },
  };
  const rec = await reconcileInflight({ ...ctx, rpc: rpcOf('SUCCESS') }, s1);
  assert(
    rec?.outcome === 'reconciled' && s1.steps['X01:ping']?.retval_address === C && !s1.inflight,
    'SUCCESS reconciles into the step',
  );
  const s2: Cap85State = {
    ...fresh,
    steps: {},
    inflight: { row: 'X01', label: 'ping', key: 'X01:ping', hash: h },
  };
  assert(
    (await reconcileInflight({ ...ctx, rpc: rpcOf('FAILED') }, s2))?.cleared && !s2.inflight,
    'FAILED clears for rerun',
  );
  const s3: Cap85State = {
    ...fresh,
    steps: {},
    inflight: { row: 'X01', label: 'ping', key: 'X01:ping', hash: h },
  };
  await rejects(
    reconcileInflight({ ...ctx, rpc: rpcOf('NOT_FOUND') }, s3),
    /submission outcome is unknown|reconcile/i,
    'NOT_FOUND fails closed',
  );
  assert(s3.inflight?.hash === h, 'NOT_FOUND keeps the inflight marker');
  const s4: Cap85State = { ...fresh, steps: {}, inflight: { row: 'X01', label: 'ping', key: 'X01:ping' } };
  assert((await reconcileInflight(ctx, s4))?.cleared && !s4.inflight, 'no-hash inflight clears');
  await rejects(
    runCap85({ ...ctx, networkPassphrase: sdk.Networks.PUBLIC, rows: [] }),
    /testnet only/,
    'non-testnet rejected before any network call',
  );
  // Malformed RPC auth: the recorded root must match the local operation before any signing request.
  let signCalls = 0;
  // Typed RPC simulation responses. Only the fields that the suite reads carry test values.
  const recordResponse = (
    auth: xdr.SorobanAuthorizationEntry[],
  ): rpc.Api.SimulateTransactionSuccessResponse => ({
    id: 'self-test',
    latestLedger: 100,
    events: [],
    _parsed: true,
    transactionData: new sdk.SorobanDataBuilder(),
    minResourceFee: '0',
    result: { auth, retval: sdk.xdr.ScVal.scvVoid() },
  });
  const errorResponse = (error: string): rpc.Api.SimulateTransactionErrorResponse => ({
    id: 'self-test',
    latestLedger: 100,
    events: [],
    _parsed: true,
    error,
  });
  const stub = (
    authEntries: xdr.SorobanAuthorizationEntry[],
    enforce: rpc.Api.SimulateTransactionResponse,
  ): Cap85Context => ({
    ...ctx,
    signDigest: async (_k, d) => {
      signCalls += 1;
      return Buffer.from(g.sign(d));
    },
    rpc: {
      ...offlineRpc,
      getAccount: async () => new sdk.Account(key.publicKey, '1'),
      simulateTransaction: async (_tx, _r, mode) =>
        mode === 'record' ? recordResponse(authEntries) : enforce,
    },
  });
  const localOp = call(sdk, C, 'set_executable', str(sdk, TAG), bytes(sdk, Buffer.alloc(32, 1)), u32(sdk, 1));
  const localFunc = hostFunction(
    new sdk.TransactionBuilder(new sdk.Account(key.publicKey, '1'), {
      fee: '100',
      networkPassphrase: sdk.Networks.TESTNET,
    })
      .addOperation(localOp)
      .setTimeout(30)
      .build(),
  );
  const goodRoot = expectedInvocation(sdk, localFunc);
  if (!goodRoot) throw new Error('self-test: a contract call needs an authorization root');
  const entryFor = (address: string, rootInvocation: xdr.SorobanAuthorizedInvocation) =>
    new sdk.xdr.SorobanAuthorizationEntry({
      credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(
        new sdk.xdr.SorobanAddressCredentials({
          address: new sdk.Address(address).toScAddress(),
          nonce: 1n,
          signatureExpirationLedger: 0,
          signature: sdk.xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation,
    });
  const other = sdk.Keypair.random().publicKey();
  const withSubtree = new sdk.xdr.SorobanAuthorizedInvocation({
    function: goodRoot.function,
    subInvocations: [
      new sdk.xdr.SorobanAuthorizedInvocation({
        function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new sdk.xdr.InvokeContractArgs({
            contractAddress: new sdk.Address(C).toScAddress(),
            functionName: 'transfer',
            args: [],
          }),
        ),
        subInvocations: [],
      }),
    ],
  });
  const wrongFn = new sdk.xdr.SorobanAuthorizedInvocation({
    function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new sdk.xdr.InvokeContractArgs({
        contractAddress: new sdk.Address(C).toScAddress(),
        functionName: 'set_executable',
        args: [str(sdk, TAG), bytes(sdk, Buffer.alloc(32, 2)), u32(sdk, 1)],
      }),
    ),
    subInvocations: [],
  });
  const state: Cap85State = { ...fresh, steps: {} };
  const credentialsOf = (address: string, signature: xdr.ScVal = sdk.xdr.ScVal.scvVoid()) =>
    new sdk.xdr.SorobanAddressCredentials({
      address: new sdk.Address(address).toScAddress(),
      nonce: 1n,
      signatureExpirationLedger: 0,
      signature,
    });
  const withCredentials = (credentials: xdr.SorobanCredentials) =>
    new sdk.xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: goodRoot });
  const v1 = withCredentials(
    sdk.xdr.SorobanCredentials.sorobanCredentialsAddress(credentialsOf(key.publicKey)),
  );
  const delegated = withCredentials(
    sdk.xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
      new sdk.xdr.SorobanAddressCredentialsWithDelegates({
        addressCredentials: credentialsOf(key.publicKey),
        delegates: [],
      }),
    ),
  );
  const presigned = withCredentials(
    sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      credentialsOf(key.publicKey, sdk.xdr.ScVal.scvBytes(Buffer.alloc(64))),
    ),
  );
  const malformed: [string, xdr.SorobanAuthorizationEntry[], RegExp][] = [
    ['subtree', [entryFor(key.publicKey, withSubtree)], /sub-invocations/],
    ['different args', [entryFor(key.publicKey, wrongFn)], /differs from the local operation/],
    ['unexpected address', [entryFor(other, goodRoot)], /unexpected address/],
    ['entry on upload', [entryFor(key.publicKey, goodRoot)], /needs none/],
    ['V1 credentials', [v1], /uses sorobanCredentialsAddress, not AddressV2/],
    ['delegated credentials', [delegated], /uses sorobanCredentialsAddressWithDelegates, not AddressV2/],
    ['existing signature', [presigned], /already holds a signature/],
    ['V1 after a valid entry', [entryFor(key.publicKey, goodRoot), v1], /not AddressV2/],
    [
      'unexpected address after a valid entry',
      [entryFor(key.publicKey, goodRoot), entryFor(other, goodRoot)],
      /unexpected address/,
    ],
  ];
  for (const [name, entries, re] of malformed) {
    signCalls = 0;
    const operation =
      name === 'entry on upload'
        ? sdk.Operation.uploadContractWasm({ wasm: Buffer.from([0, 97, 115, 109]) })
        : localOp;
    const bad = stub(entries, errorResponse('never reached'));
    await rejects(
      invokeOperation(bad, state, {
        operation,
        authorizers: [gAuthorizer(bad, key)],
        label: `malformed-${name}`,
      }),
      re,
      `malformed RPC ${name} rejected`,
    );
    assert(signCalls === 0, `malformed RPC ${name}: no signing request was made`);
  }
  // Key A signs the envelope, but an address entry for key A still needs an authorizer before any signature.
  signCalls = 0;
  const otherKey = {
    name: 'other',
    publicKey: other,
    rawPublicKey: sdk.StrKey.decodeEd25519PublicKey(other),
  };
  const keyA = stub(
    [entryFor(other, goodRoot), entryFor(key.publicKey, goodRoot)],
    errorResponse('never reached'),
  );
  await rejects(
    invokeOperation(keyA, state, {
      operation: localOp,
      authorizers: [gAuthorizer(keyA, otherKey)],
      label: 'malformed-key-a-without-authorizer',
    }),
    /unexpected address/,
    'key A address entry without an authorizer rejected',
  );
  assert(signCalls === 0, 'key A address entry without an authorizer: no signing request was made');
  signCalls = 0;
  const good = stub([entryFor(key.publicKey, goodRoot)], errorResponse('HostError: Error(Contract, #2)'));
  const ok = await invokeOperation(good, state, {
    operation: localOp,
    authorizers: [gAuthorizer(good, key)],
    label: 'well-formed',
    expect: X.managerStale,
  });
  assert(
    ok.outcome === 'simulation_rejected' &&
      signCalls === 1 &&
      ok.entries[0]?.root_verified === true &&
      ok.entries[0].preimage_xdr,
    'well-formed entry is verified, signed once, and enforce-simulated',
  );
  throws(() => saveState({ contracts: {} }), /checkpoint file unknown/, 'saveState has no default path');
  const liveAfter = existsSync(STATE_FILE) ? readFileSync(STATE_FILE) : null;
  assert(
    (liveBefore === null && liveAfter === null) ||
      (liveBefore !== null && liveAfter !== null && liveBefore.equals(liveAfter)),
    'live checkpoint untouched by the self-test',
  );
  console.log(
    JSON.stringify({
      ok: true,
      self_test: 'cap85.ts',
      rows: ROW_IDS,
      expectations: Object.fromEntries(
        Object.entries(X).filter(([k]) => /manager|account|unknown|wrong|legacy/.test(k)),
      ),
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
