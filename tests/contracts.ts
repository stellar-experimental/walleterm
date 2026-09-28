import { requestError } from '../sdk/errors.ts';
// Contract-account acceptance for docs/TEST-MATRIX.md rows C01-C13.
// Exports runContracts(ctx). ctx comes from tests/live-utils.ts.
// `bun tests/contracts.ts` runs the offline self-test: no network, no agent.
//
// Signing rules (docs/OPENZEPPELIN.md):
// - G-account entry: signature over the host payload, ScVal Vec[Map{public_key, signature}].
// - walleterm_simple_account: signature over the host payload, ScVal Bytes(64).
// - OpenZeppelin account: signature over sha256(payload || XDR(Vec<u32> rule ids)),
//   ScVal Map{context_rule_ids, signers}. Never the raw host payload.
// - Every signing row declares its expected entries. invoke checks each recorded entry against them
//   before any mutation or signing request. Source-only operations check their recorded entries too.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Transaction, rpc, xdr } from '@stellar/stellar-sdk';
import type { Details, KeyName, LiveContext, Sdk, SigningContext, TestKey } from './types.ts';
import type { RequestError } from '../sdk/errors.ts';

export const OZ_COMMIT = 'a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640';
const WASM_DIR = new URL('../fixtures/wasm/', import.meta.url);
const STATE_FILE = new URL('../evidence/live/contracts-state.json', import.meta.url);
const EXPIRY_LEDGERS = 60;
export const ERR = {
  crypto: 'Error(Crypto, InvalidInput)', // ed25519_verify panic (simple account, OZ verifier)
  auth: 'Error(Auth, InvalidAction)', // host: invocation tree or __check_auth failure
  notAllowed: 'Error(Contract, #3202)', // simple threshold not met
  weightNotAllowed: 'Error(Contract, #3213)', // weighted threshold not met
  unvalidatedContext: 'Error(Contract, #3002)', // no-policy rule is missing its required signer
  ruleIdsMismatch: 'Error(Contract, #3014)', // context_rule_ids length != auth_contexts
  duplicateSigner: 'Error(Contract, #3007)', // OZ DuplicateSigner at rule creation
  accountSigs: 'Error(Contract, #5)', // built-in G account: duplicate or unordered signatures (account_contract.rs 203-243)
  nonceConsumed: 'Error(Auth, ExistingValue)', // host: nonce already used (auth.rs)
};

// ---------- shapes ----------
/** fixtures/wasm/manifest.json, written by fixtures/build.sh. */
export interface Manifest {
  built_at: string;
  oz_commit: string;
  artifacts: Record<string, { sha256: string; bytes: number; repo: string; commit?: string; path: string }>;
}
/** evidence/live/contracts-state.json. Deployed ids and finished rows. */
export interface ContractsState {
  oz_commit: string;
  wasm: Record<string, { hash: string; tx?: string }>;
  contracts: Record<string, { id: string; wasm: string; tx?: string }>;
  done: Record<string, Details>;
  binding?: { network: string; keys: string[] };
}
/** Per-entry signing evidence. Authorizers add their scheme fields. */
export interface EntryMeta {
  [field: string]: unknown;
  variant?: string;
  address?: string;
  digest?: string;
  expiration?: number;
}
export interface Authorizer {
  address: string;
  label: string;
  signatureScVal(payload: Buffer, entry: xdr.SorobanAuthorizationEntry, meta?: EntryMeta): Promise<xdr.ScVal>;
}
export interface OzSignature {
  verifier: string;
  rawKey: Uint8Array;
  signature: Uint8Array;
}
export interface AccountSignature {
  rawKey: Uint8Array;
  signature: Uint8Array;
}
/** The base contract ids from setup(). */
export interface Deployed {
  verifier: string;
  threshold: string;
  weighted: string;
  target1: string;
  target2: string;
  simple: string;
  ozBasic: string;
  ozMulti: string;
  ozWeighted: string;
}
export interface CountCheck {
  target: string;
  who: string;
  delta?: number;
}
/** One entry that record simulation must return: unsigned AddressV2 credentials for `address`, rooted at `invocation`. */
export interface ExpectedAuth {
  address: string;
  invocation: xdr.SorobanAuthorizedInvocation;
}
/** A row error can carry the evidence gathered before it failed. */
type RowFailure = RequestError & { details?: Details };
type ContractsContext = Pick<LiveContext, 'sdk' | 'networkPassphrase' | 'keys' | 'sign' | 'send'> & {
  rpc: Pick<LiveContext['rpc'], 'getAccount' | 'simulateTransaction'>;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();
const sym = (sdk: Sdk, s: string) => sdk.xdr.ScVal.scvSymbol(s);
const u32 = (sdk: Sdk, n: number) => sdk.xdr.ScVal.scvU32(n);
const bytes = (sdk: Sdk, b: Uint8Array) => sdk.xdr.ScVal.scvBytes(Buffer.from(b));
const addr = (sdk: Sdk, a: string) => sdk.nativeToScVal(a, { type: 'address' });

// ---------- ScVal builders (library schema) ----------
export const scMap = (sdk: Sdk, entries: [xdr.ScVal, xdr.ScVal][]) =>
  sdk.xdr.ScVal.scvMap(entries.map(([key, val]) => new sdk.xdr.ScMapEntry({ key, val })));
export const ruleIdsXdr = (sdk: Sdk, ids: number[]) =>
  Buffer.from(sdk.xdr.ScVal.scvVec(ids.map((id) => u32(sdk, id))).toXdr());
export const ozAuthDigest = (sdk: Sdk, payload: Uint8Array, ids: number[]) =>
  sha256(Buffer.concat([Buffer.from(payload), ruleIdsXdr(sdk, ids)]));
export const ozSigner = (sdk: Sdk, verifier: string, rawKey: Uint8Array) =>
  sdk.xdr.ScVal.scvVec([sym(sdk, 'External'), addr(sdk, verifier), bytes(sdk, rawKey)]);
export const sortSigners = <T extends { verifier: string; rawKey: Uint8Array }>(
  sdk: Sdk,
  list: readonly T[],
) =>
  [...list].sort(
    (p, q) =>
      Buffer.compare(sdk.StrKey.decodeContract(p.verifier), sdk.StrKey.decodeContract(q.verifier)) ||
      Buffer.compare(Buffer.from(p.rawKey), Buffer.from(q.rawKey)),
  );
export function ozAuthPayload(sdk: Sdk, sigs: OzSignature[], ids: number[], { sorted = true } = {}) {
  return scMap(sdk, [
    [sym(sdk, 'context_rule_ids'), sdk.xdr.ScVal.scvVec(ids.map((id) => u32(sdk, id)))],
    [
      sym(sdk, 'signers'),
      scMap(
        sdk,
        (sorted ? sortSigners(sdk, sigs) : sigs).map((s) => [
          ozSigner(sdk, s.verifier, s.rawKey),
          bytes(sdk, s.signature),
        ]),
      ),
    ],
  ]);
}
export const accountSignature = (sdk: Sdk, sigs: AccountSignature[]) =>
  sdk.xdr.ScVal.scvVec(
    sigs.map((s) =>
      scMap(sdk, [
        [sym(sdk, 'public_key'), bytes(sdk, s.rawKey)],
        [sym(sdk, 'signature'), bytes(sdk, s.signature)],
      ]),
    ),
  );
export const countContexts = (inv: xdr.SorobanAuthorizedInvocation): number =>
  1 + inv.subInvocations.reduce((n, sub) => n + countContexts(sub), 0);
/** The authorized form of one contract call, with the calls that it authorizes below it. */
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

// ---------- authorizers: { address, label, signatureScVal(payload, entry) } ----------
export const gAuthorizer = (ctx: SigningContext, key: TestKey, { duplicate = false } = {}) => ({
  address: key.publicKey,
  label: `G:${key.name}`,
  async signatureScVal(payload: Buffer, _entry?: xdr.SorobanAuthorizationEntry, meta: EntryMeta = {}) {
    const one = { rawKey: key.rawPublicKey, signature: await ctx.signDigest(key, payload) };
    Object.assign(meta, {
      scheme: 'g-account',
      digest: Buffer.from(payload).toString('hex'),
      signers: [key.name],
      duplicate,
    });
    return accountSignature(ctx.sdk, duplicate ? [one, one] : [one]);
  },
});
export const simpleAuthorizer = (ctx: SigningContext, contractId: string, key: TestKey) => ({
  address: contractId,
  label: `simple:${key.name}`,
  async signatureScVal(payload: Buffer, _entry?: xdr.SorobanAuthorizationEntry, meta: EntryMeta = {}) {
    Object.assign(meta, {
      scheme: 'simple-raw-payload',
      digest: Buffer.from(payload).toString('hex'),
      signers: [key.name],
    });
    return bytes(ctx.sdk, await ctx.signDigest(key, payload));
  },
});
export interface OzAuthorizerOptions {
  ruleId?: number;
  ruleIds?: number[];
  naive?: boolean;
  duplicate?: boolean;
  unsorted?: boolean;
}
export const ozAuthorizer = (
  ctx: SigningContext,
  contractId: string,
  verifier: string,
  keys: TestKey[],
  { ruleId = 0, ruleIds, naive = false, duplicate = false, unsorted = false }: OzAuthorizerOptions = {},
) => ({
  address: contractId,
  label: `oz:${keys.map((k) => k.name).join('+')}`,
  async signatureScVal(payload: Buffer, entry: xdr.SorobanAuthorizationEntry, meta: EntryMeta = {}) {
    const ids = ruleIds ?? Array<number>(countContexts(entry.rootInvocation)).fill(ruleId);
    const digest = naive ? Buffer.from(payload) : ozAuthDigest(ctx.sdk, payload, ids);
    let sigs: OzSignature[] = [];
    for (const key of keys)
      sigs.push({ verifier, rawKey: key.rawPublicKey, signature: await ctx.signDigest(key, digest) });
    if (duplicate) sigs.push(sigs[0]);
    if (unsorted) sigs = sortSigners(ctx.sdk, sigs).reverse();
    Object.assign(meta, {
      scheme: naive ? 'raw-host-payload' : 'oz-auth-digest',
      rule_ids: ids,
      digest: digest.toString('hex'),
      signers: keys.map((k) => k.name),
      duplicate,
      unsorted,
    });
    return ozAuthPayload(ctx.sdk, sigs, ids, { sorted: !duplicate && !unsorted });
  },
});
export const ozSignerOf = (c: { verifier: string }, key: TestKey, id: KeyName) => ({
  id,
  verifier: c.verifier,
  rawKey: key.rawPublicKey,
  name: key.name,
});
export const signersVec = (sdk: Sdk, list: { verifier: string; rawKey: Uint8Array }[]) =>
  sdk.xdr.ScVal.scvVec(list.map((s) => ozSigner(sdk, s.verifier, s.rawKey)));

// A submission whose final status is unknown stops the whole run. Query the hash before any new submission.
export { UnknownSubmission } from './submission.ts';
import { UnknownSubmission, errorHash } from './submission.ts';
async function sendOrStop(ctx: Pick<LiveContext, 'send'>, tx: Transaction, label: string) {
  const hash = Buffer.from(tx.hash()).toString('hex');
  try {
    return await ctx.send(tx, label);
  } catch (eValue) {
    const e = requestError(eValue);
    if (e instanceof UnknownSubmission) throw e;
    if (
      /submission outcome unknown|NOT_FOUND|TRY_AGAIN_LATER|timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed/i.test(
        String(e.message),
      )
    )
      throw new UnknownSubmission(label, hash, e);
    throw e;
  }
}

// ---------- auth entry helpers ----------
export function addressCredentials(entry: xdr.SorobanAuthorizationEntry) {
  const c = entry.credentials;
  switch (c.type) {
    case 'sorobanCredentialsSourceAccount':
      return null;
    case 'sorobanCredentialsAddress':
      return c.address;
    case 'sorobanCredentialsAddressV2':
      return c.addressV2;
    case 'sorobanCredentialsAddressWithDelegates':
      return c.addressWithDelegates.addressCredentials;
  }
  throw new Error(`unsupported credentials ${String(Reflect.get(c, 'type'))}`);
}
// Address credentials that must exist. Source-account entries fail here.
export function requireAddressCredentials(entry: xdr.SorobanAuthorizationEntry) {
  const credentials = addressCredentials(entry);
  if (!credentials) throw new TypeError('The authorization entry has no address credentials.');
  return credentials;
}
// SDK XDR fields are readonly in the types. Negative cases change the nonce of a signed entry.
const nonceField = (credentials: { nonce: bigint }) => credentials;
const entryAddress = (sdk: Sdk, entry: xdr.SorobanAuthorizationEntry) =>
  sdk.Address.fromScAddress(requireAddressCredentials(entry).address).toString();
const cloneEntry = (sdk: Sdk, entry: xdr.SorobanAuthorizationEntry) =>
  sdk.xdr.SorobanAuthorizationEntry.fromXdr(entry.toXdr());
const normalizeAuth = (sdk: Sdk, list: readonly (string | xdr.SorobanAuthorizationEntry)[] | undefined) =>
  (list ?? []).map((e) =>
    typeof e === 'string' ? sdk.xdr.SorobanAuthorizationEntry.fromXdr(e, 'base64') : e,
  );
function contractArgs(invocation: xdr.SorobanAuthorizedInvocation | undefined) {
  const fn = invocation?.function;
  if (fn?.type !== 'sorobanAuthorizedFunctionTypeContractFn')
    throw new TypeError('The authorized invocation is not a contract call.');
  return fn.contractFn.args;
}
const rootArgs = (entry: xdr.SorobanAuthorizationEntry) => contractArgs(entry.rootInvocation);
const childArgs = (entry: xdr.SorobanAuthorizationEntry) =>
  contractArgs(entry.rootInvocation.subInvocations[0]);

// Checks every recorded entry before any mutation or signing request. Each entry must use unsigned AddressV2
// credentials and match one expected address with its complete invocation tree. Source-account, extra, and
// missing entries fail.
export function checkRecordedAuth(
  sdk: Sdk,
  recorded: readonly xdr.SorobanAuthorizationEntry[],
  expected: readonly ExpectedAuth[] | undefined,
  label: string,
) {
  if (!expected?.length) throw new Error(`${label}: the row declares no expected authorization entries`);
  const open = expected.map((e) => ({ address: e.address, root: e.invocation.toXdr('base64') }));
  recorded.forEach((entry, i) => {
    const { credentials } = entry;
    if (credentials.type !== 'sorobanCredentialsAddressV2')
      throw new Error(`${label}: recorded entry ${i} uses ${credentials.type}, not AddressV2 credentials`);
    if (credentials.addressV2.signature.type !== 'scvVoid')
      throw new Error(`${label}: recorded entry ${i} already holds a signature`);
    const address = sdk.Address.fromScAddress(credentials.addressV2.address).toString();
    const root = entry.rootInvocation.toXdr('base64');
    const match = open.findIndex((e) => e.address === address && e.root === root);
    if (match < 0)
      throw new Error(`${label}: recorded entry ${i} for ${address} differs from the expected authorization`);
    open.splice(match, 1);
  });
  if (open.length)
    throw new Error(`${label}: record simulation omitted the expected entry for ${open[0].address}`);
}
// A source-only operation authorizes through the envelope signature of key A. A deployment by key A records one
// source-account entry for the exact local creation. An upload records none. Any other entry fails before signing.
export function checkSourceAuth(
  sdk: Sdk,
  func: xdr.HostFunction,
  recorded: readonly xdr.SorobanAuthorizationEntry[],
  label: string,
) {
  const expected =
    func.type === 'hostFunctionTypeCreateContractV2'
      ? [
          new sdk.xdr.SorobanAuthorizedInvocation({
            function: sdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeCreateContractV2HostFn(
              func.createContractV2,
            ),
            subInvocations: [],
          }).toXdr('base64'),
        ]
      : [];
  const actual = recorded.map((e) =>
    e.credentials.type === 'sorobanCredentialsSourceAccount'
      ? e.rootInvocation.toXdr('base64')
      : e.credentials.type,
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${label}: recorded authorization differs from the local operation`);
}

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
      /* diagnostics are best effort */
    }
  }
  return text;
}

// ---------- transactions ----------
async function buildTx(
  ctx: Pick<ContractsContext, 'sdk' | 'rpc' | 'keys' | 'networkPassphrase'>,
  operation: xdr.Operation,
) {
  const account = await ctx.rpc.getAccount(ctx.keys.a.publicKey);
  return new ctx.sdk.TransactionBuilder(account, {
    fee: ctx.sdk.BASE_FEE,
    networkPassphrase: ctx.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(120)
    .build();
}
// The single operation of a locally built host-function transaction.
export function hostOperation(tx: Transaction) {
  const op = tx.operations[0];
  if (op?.type !== 'invokeHostFunction')
    throw new TypeError('The transaction does not invoke a host function.');
  return op;
}
// The return value of a successful simulation.
function simulatedRetval(sim: rpc.Api.SimulateTransactionSuccessResponse, label: string) {
  if (!sim.result) throw new Error(`${label}: simulation returned no result`);
  return sim.result.retval;
}
async function simulateCall(ctx: ContractsContext, contractId: string, method: string, args: xdr.ScVal[]) {
  const sim = await ctx.rpc.simulateTransaction(
    await buildTx(ctx, new ctx.sdk.Contract(contractId).call(method, ...args)),
    undefined,
    'record',
  );
  if (ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${method} read failed: ${sim.error}`);
  return sim;
}
export const readCount = async (ctx: ContractsContext, target: string, who: string) =>
  Number(
    ctx.sdk.scValToNative(
      simulatedRetval(await simulateCall(ctx, target, 'count', [addr(ctx.sdk, who)]), 'count'),
    ),
  );
async function readCounts(ctx: ContractsContext, checks: CountCheck[]) {
  const out = [];
  for (const check of checks)
    out.push({ target: check.target, who: check.who, count: await readCount(ctx, check.target, check.who) });
  return out;
}
const readOwner = async (ctx: ContractsContext, simple: string) =>
  Buffer.from(
    ctx.sdk.scValToNative(simulatedRetval(await simulateCall(ctx, simple, 'owner', []), 'owner')),
  ).toString('hex');

export async function submitSourceOnly(ctx: ContractsContext, operation: xdr.Operation, label: string) {
  const tx = await buildTx(ctx, operation);
  const sim = await ctx.rpc.simulateTransaction(tx, undefined, 'record');
  if (ctx.sdk.rpc.Api.isSimulationError(sim)) throw new Error(`${label}: simulation failed: ${sim.error}`);
  // The local operation has no entries, so assembly copies the recorded entries into the signed envelope.
  checkSourceAuth(ctx.sdk, hostOperation(tx).func, normalizeAuth(ctx.sdk, sim.result?.auth), label);
  const prepared = ctx.sdk.rpc.assembleTransaction(tx, sim).build();
  await ctx.sign(prepared, ctx.keys.a);
  return { sent: await sendOrStop(ctx, prepared, label), retval: sim.result?.retval };
}
async function expectSourceOnlyRejected(
  ctx: ContractsContext,
  operation: xdr.Operation,
  label: string,
  expect: string,
) {
  const sim = await ctx.rpc.simulateTransaction(await buildTx(ctx, operation), undefined, 'record');
  if (!ctx.sdk.rpc.Api.isSimulationError(sim))
    throw new Error(`${label}: expected ${expect}, but simulation succeeded`);
  const text = simulationText(ctx.sdk, sim);
  if (!text.includes(expect))
    throw new Error(`${label}: expected ${expect} in simulation error, got: ${text.slice(0, 800)}`);
  const top = String(sim.error).match(/^(?:HostError: )?(Error\([^)]*\))/)?.[1];
  if (![expect, 'Error(Context, InvalidAction)'].includes(String(top)))
    throw new Error(`${label}: unexpected top-level error ${top}`);
  return { outcome: 'simulation_rejected', expected: expect, error: text.slice(0, 2000) };
}

export interface ExtraAuthInput {
  auth: xdr.SorobanAuthorizationEntry[];
  expiration: number | undefined;
  entries: EntryMeta[];
}
export interface InvokeOptions {
  contractId: string;
  method: string;
  args?: xdr.ScVal[];
  finalArgs?: xdr.ScVal[];
  authorizers?: Authorizer[];
  /** Every entry that record simulation must return. A `presigned` row records nothing and must omit it. */
  expected?: ExpectedAuth[];
  label: string;
  expect?: string | string[];
  mutate?: {
    beforeSign?(entry: xdr.SorobanAuthorizationEntry): void;
    afterSign?(entry: xdr.SorobanAuthorizationEntry): void;
  };
  signPassphrase?: string;
  presigned?: string[];
  state?: CountCheck | CountCheck[];
  expired?: boolean;
  extraAuth?(input: ExtraAuthInput): Promise<xdr.SorobanAuthorizationEntry[]>;
}

// invoke: build, record-simulate, check every recorded entry, sign each entry, enforce-simulate, then submit.
// `expected` lists every entry that the recorded tree must hold. No mutation or signing request happens
// until all recorded entries match it. With `expect`, the enforce simulation must fail with that exact error
// text and no submission happens.
// `finalArgs` (optional) builds the submitted call with different arguments than the recorded one,
// for signature-binding negatives where both the call and the entry change after signing.
export async function invoke(
  ctx: ContractsContext,
  {
    contractId,
    method,
    args = [],
    finalArgs,
    authorizers = [],
    expected,
    label,
    expect,
    mutate,
    signPassphrase,
    presigned,
    state,
    expired = false,
    extraAuth,
  }: InvokeOptions,
) {
  const { sdk, rpc, networkPassphrase } = ctx;
  if (presigned && expected)
    throw new Error(`${label}: a presigned row cannot declare expected entries; it records nothing`);
  const template = await buildTx(ctx, new sdk.Contract(contractId).call(method, ...args));
  const func = hostOperation(
    finalArgs ? await buildTx(ctx, new sdk.Contract(contractId).call(method, ...finalArgs)) : template,
  ).func;
  const checks: CountCheck[] = !state ? [] : Array.isArray(state) ? [...state] : [state];
  const before = await readCounts(ctx, checks);
  const entries: EntryMeta[] = [];
  let expiration: number | undefined;
  let auth = presigned ? normalizeAuth(sdk, presigned) : null;
  if (auth)
    auth.forEach((e) =>
      entries.push({ replayed: true, variant: e.credentials.type, signed_xdr: e.toXdr('base64') }),
    );
  if (!auth) {
    const recorded = await rpc.simulateTransaction(template, undefined, 'record');
    if (sdk.rpc.Api.isSimulationError(recorded))
      throw new Error(`${label}: record simulation failed: ${recorded.error}`);
    const validUntil = expired ? recorded.latestLedger - 1 : recorded.latestLedger + EXPIRY_LEDGERS;
    expiration = validUntil;
    const recordedAuth = normalizeAuth(sdk, recorded.result?.auth);
    checkRecordedAuth(sdk, recordedAuth, expected, label);
    const signers = recordedAuth.map((raw) => {
      const address = entryAddress(sdk, raw);
      const signer = authorizers.find((a) => a.address === address);
      if (!signer) throw new Error(`${label}: no authorizer for ${address}`);
      return signer;
    });
    auth = [];
    for (const [i, raw] of recordedAuth.entries()) {
      const entry = cloneEntry(sdk, raw);
      const credentials = requireAddressCredentials(entry);
      const address = entryAddress(sdk, entry);
      const signer = signers[i];
      const meta: EntryMeta = {
        variant: entry.credentials.type,
        address,
        signer: signer.label,
        nonce: String(credentials.nonce),
        expiration,
        unsigned_xdr: raw.toXdr('base64'),
      };
      mutate?.beforeSign?.(entry);
      const signed = await sdk.authorizeEntry(
        entry,
        async (_preimage, payload) => {
          meta.payload = Buffer.from(payload).toString('hex');
          return { signatureScVal: await signer.signatureScVal(Buffer.from(payload), entry, meta), address };
        },
        validUntil,
        signPassphrase ?? networkPassphrase,
      );
      mutate?.afterSign?.(signed);
      meta.signed_xdr = signed.toXdr('base64');
      entries.push(meta);
      auth.push(signed);
    }
  }
  if (extraAuth) auth.push(...(await extraAuth({ auth, expiration, entries })));
  const auth_xdr = auth.map((e) => e.toXdr('base64'));
  const tx = await buildTx(ctx, sdk.Operation.invokeHostFunction({ func, auth }));
  const sim = await rpc.simulateTransaction(tx, undefined, 'enforce');
  const evidence = {
    call: {
      contract: contractId,
      method,
      args_xdr: args.map((a) => a.toXdr('base64')),
      final_args_xdr: finalArgs?.map((a) => a.toXdr('base64')),
    },
    expected_auth: expected?.map((e) => ({
      address: e.address,
      invocation_xdr: e.invocation.toXdr('base64'),
    })),
    sign_passphrase: signPassphrase ?? networkPassphrase,
    mutation: mutate ? Object.keys(mutate) : undefined,
    expired_on_purpose: expired || undefined,
    ledger_at_enforce: sim.latestLedger,
    credential_variants: auth.map((e) => e.credentials.type),
    entries,
    auth_xdr,
    unsigned_tx_xdr: tx.toXDR(),
  };
  if (expect) {
    const expected = Array.isArray(expect) ? [...expect] : [expect];
    if (!sdk.rpc.Api.isSimulationError(sim))
      throw new Error(`${label}: expected ${expected.join(' or ')}, but enforce simulation succeeded`);
    const text = simulationText(sdk, sim);
    const matched = expected.find((e) => text.includes(e));
    if (!matched)
      throw new Error(
        `${label}: expected ${expected.join(' or ')} in simulation error, got: ${text.slice(0, 800)}`,
      );
    const top = String(sim.error).match(/^(?:HostError: )?(Error\([^)]*\))/)?.[1];
    if (![matched, 'Error(Auth, InvalidAction)'].includes(String(top)))
      throw new Error(`${label}: unexpected top-level error ${top}`);
    const after = await readCounts(ctx, checks);
    after.forEach((a, i) => {
      if (a.count !== before[i].count)
        throw new Error(`${label}: state changed for ${a.who}: ${before[i].count} -> ${a.count}`);
    });
    return {
      outcome: 'simulation_rejected',
      expected: matched,
      top_level_error: top,
      error: text,
      state_before: before,
      state_after: after,
      ...evidence,
    };
  }
  if (sdk.rpc.Api.isSimulationError(sim))
    throw new Error(`${label}: enforce simulation failed: ${sim.error}`);
  const prepared = sdk.rpc.assembleTransaction(tx, sim).build();
  await ctx.sign(prepared, ctx.keys.a);
  const sent = await sendOrStop(ctx, prepared, label);
  const after = await readCounts(ctx, checks);
  after.forEach((a, i) => {
    const want = before[i].count + (checks[i].delta ?? 1);
    if (a.count !== want) throw new Error(`${label}: expected count ${want} for ${a.who}, got ${a.count}`);
  });
  const retval = sdk.scValToNative(simulatedRetval(sim, label));
  return {
    outcome: 'submitted',
    hash: sent.hash,
    ledger: sent.ledger,
    retval: typeof retval === 'bigint' ? String(retval) : retval,
    state_before: before,
    state_after: after,
    ...evidence,
  };
}

// ---------- state and deployment ----------
function loadState(): ContractsState {
  return existsSync(STATE_FILE)
    ? JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    : { oz_commit: OZ_COMMIT, wasm: {}, contracts: {}, done: {} };
}
const saveState = (state: ContractsState) => {
  const temporary = new URL(`contracts-state.${process.pid}.tmp`, STATE_FILE);
  writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n');
  renameSync(temporary, STATE_FILE);
};

/** The network and public keys that a checkpoint binds. */
export interface CheckpointContext {
  networkPassphrase: string;
  keys: Record<KeyName, { publicKey: string }>;
}
export function checkCheckpoint(state: ContractsState, manifest: Manifest, ctx: CheckpointContext) {
  if (state.oz_commit !== OZ_COMMIT) throw new Error('Checkpoint OpenZeppelin revision mismatch');
  for (const [file, artifact] of Object.entries(manifest.artifacts)) {
    const hash = sha256(readFileSync(new URL(file, WASM_DIR))).toString('hex');
    if (hash !== artifact.sha256 || (state.wasm[file] && state.wasm[file].hash !== hash)) {
      throw new Error(`Checkpoint or artifact hash mismatch: ${file}`);
    }
  }
  const binding = {
    network: ctx.networkPassphrase,
    keys: (['a', 'b', 'c'] as const).map((k) => ctx.keys[k].publicKey),
  };
  if (state.binding && JSON.stringify(state.binding) !== JSON.stringify(binding))
    throw new Error('Checkpoint network or public keys changed');
  if (!state.binding && Object.keys(state.contracts).length)
    throw new Error('Checkpoint holds contracts without a network/key binding; review evidence before reuse');
  state.binding = binding;
  for (const contract of Object.values(state.contracts)) {
    if (!state.wasm[contract.wasm] || !manifest.artifacts[contract.wasm])
      throw new Error('Checkpoint contract has no verified WASM');
  }
}

async function upload(ctx: ContractsContext, state: ContractsState, file: string) {
  if (state.wasm[file]) return state.wasm[file];
  const wasm = readFileSync(new URL(file, WASM_DIR));
  const { sent } = await submitSourceOnly(
    ctx,
    ctx.sdk.Operation.uploadContractWasm({ wasm }),
    `upload-${file}`,
  );
  state.wasm[file] = { hash: sha256(wasm).toString('hex'), tx: sent.hash };
  saveState(state);
  return state.wasm[file];
}
async function deploy(
  ctx: ContractsContext,
  state: ContractsState,
  name: string,
  file: string,
  constructorArgs: xdr.ScVal[] = [],
) {
  if (state.contracts[name]) return state.contracts[name].id;
  const wasmHash = Buffer.from((await upload(ctx, state, file)).hash, 'hex');
  const op = ctx.sdk.Operation.createCustomContract({
    address: new ctx.sdk.Address(ctx.keys.a.publicKey),
    wasmHash,
    constructorArgs,
  });
  const { sent, retval } = await submitSourceOnly(ctx, op, `deploy-${name}`);
  if (!retval) throw new Error(`deploy-${name}: simulation returned no contract address`);
  state.contracts[name] = { id: ctx.sdk.Address.fromScVal(retval).toString(), wasm: file, tx: sent.hash };
  saveState(state);
  return state.contracts[name].id;
}

async function setup(ctx: ContractsContext, state: ContractsState): Promise<Deployed> {
  const { sdk, keys } = ctx;
  const verifier = await deploy(ctx, state, 'ed25519_verifier', 'multisig_ed25519_verifier_example.wasm');
  const threshold = await deploy(ctx, state, 'threshold_policy', 'multisig_threshold_policy_example.wasm');
  const weighted = await deploy(
    ctx,
    state,
    'weighted_policy',
    'multisig_weighted_threshold_policy_example.wasm',
  );
  const target1 = await deploy(ctx, state, 'auth_target_1', 'walleterm_auth_target.wasm');
  const target2 = await deploy(ctx, state, 'auth_target_2', 'walleterm_auth_target.wasm');
  const simple = await deploy(ctx, state, 'simple_account_b', 'walleterm_simple_account.wasm', [
    bytes(sdk, keys.b.rawPublicKey),
  ]);
  const c = { verifier };
  const all = sortSigners(sdk, [
    ozSignerOf(c, keys.a, 'a'),
    ozSignerOf(c, keys.b, 'b'),
    ozSignerOf(c, keys.c, 'c'),
  ]);
  const ozBasic = await deploy(ctx, state, 'oz_basic_a', 'multisig_account_example.wasm', [
    signersVec(sdk, [ozSignerOf(c, keys.a, 'a')]),
    scMap(sdk, []),
  ]);
  const ozMulti = await deploy(ctx, state, 'oz_multisig_2of3', 'multisig_account_example.wasm', [
    signersVec(sdk, all),
    scMap(sdk, [[addr(sdk, threshold), scMap(sdk, [[sym(sdk, 'threshold'), u32(sdk, 2)]])]]),
  ]);
  const weight: Record<KeyName, number> = { a: 2, b: 1, c: 1 }; // stable a/b/c identity, independent of key names
  const ozWeighted = await deploy(ctx, state, 'oz_weighted_a2_b1_c1_t2', 'multisig_account_example.wasm', [
    signersVec(sdk, all),
    scMap(sdk, [
      [
        addr(sdk, weighted),
        scMap(sdk, [
          [
            sym(sdk, 'signer_weights'),
            scMap(
              sdk,
              all.map((s) => [ozSigner(sdk, s.verifier, s.rawKey), u32(sdk, weight[s.id])]),
            ),
          ],
          [sym(sdk, 'threshold'), u32(sdk, 2)],
        ]),
      ],
    ]),
  ]);
  return { verifier, threshold, weighted, target1, target2, simple, ozBasic, ozMulti, ozWeighted };
}

// ---------- matrix rows ----------
interface Row {
  id: string;
  title: string;
  status?: string;
  run(ctx: LiveContext, c: Deployed, state: ContractsState): Promise<Details>;
}
const ROWS: Row[] = [
  {
    id: 'C01',
    title: 'G-account address credentials (payer A, signer B)',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, keys.b.publicKey), u32(sdk, 1)];
      return invoke(ctx, {
        contractId: c.target1,
        method: 'ping',
        args,
        authorizers: [gAuthorizer(ctx, keys.b)],
        expected: [{ address: keys.b.publicKey, invocation: contractFn(sdk, c.target1, 'ping', args) }],
        label: 'C01-g-address-auth',
        state: { target: c.target1, who: keys.b.publicKey },
      });
    },
  },
  {
    id: 'C02',
    title: 'Minimal C-account, raw payload signature',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, c.simple), u32(sdk, 1)];
      const state = { target: c.target1, who: c.simple };
      const expected = [{ address: c.simple, invocation: contractFn(sdk, c.target1, 'ping', args) }];
      return {
        owner_b_passes: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [simpleAuthorizer(ctx, c.simple, keys.b)],
          expected,
          label: 'C02-simple-owner',
          state,
        }),
        key_c_rejected: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [simpleAuthorizer(ctx, c.simple, keys.c)],
          expected,
          label: 'C02-simple-wrong-key',
          expect: ERR.crypto,
          state,
        }),
      };
    },
  },
  {
    id: 'C03',
    title: 'OpenZeppelin account, one signer, no policy (rule 0)',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, c.ozBasic), u32(sdk, 1)];
      const state = { target: c.target1, who: c.ozBasic };
      const expected = [{ address: c.ozBasic, invocation: contractFn(sdk, c.target1, 'ping', args) }];
      return {
        digest_signature_passes: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [ozAuthorizer(ctx, c.ozBasic, c.verifier, [keys.a])],
          expected,
          label: 'C03-oz-basic',
          state,
        }),
        naive_host_payload_rejected: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [ozAuthorizer(ctx, c.ozBasic, c.verifier, [keys.a], { naive: true })],
          expected,
          label: 'C03-oz-naive-payload',
          expect: ERR.crypto,
          state,
        }),
      };
    },
  },
  {
    id: 'C04',
    title: 'OpenZeppelin 2-of-3 simple threshold',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, c.ozMulti), u32(sdk, 1)];
      const state = { target: c.target1, who: c.ozMulti };
      const expected = [{ address: c.ozMulti, invocation: contractFn(sdk, c.target1, 'ping', args) }];
      return {
        a_b_pass: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.b])],
          expected,
          label: 'C04-oz-2of3-ab',
          state,
        }),
        a_alone_rejected: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a])],
          expected,
          label: 'C04-oz-2of3-a-only',
          expect: ERR.notAllowed,
          state,
        }),
      };
    },
  },
  {
    id: 'C05',
    title: 'OpenZeppelin weighted threshold a=2 b=1 c=1, threshold 2',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, c.ozWeighted), u32(sdk, 1)];
      const state = { target: c.target1, who: c.ozWeighted };
      const expected = [{ address: c.ozWeighted, invocation: contractFn(sdk, c.target1, 'ping', args) }];
      return {
        a_weight2_passes: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [ozAuthorizer(ctx, c.ozWeighted, c.verifier, [keys.a])],
          expected,
          label: 'C05-weighted-a',
          state,
        }),
        b_weight1_rejected: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [ozAuthorizer(ctx, c.ozWeighted, c.verifier, [keys.b])],
          expected,
          label: 'C05-weighted-b-only',
          expect: ERR.weightNotAllowed,
          state,
        }),
        b_c_weight2_passes: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [ozAuthorizer(ctx, c.ozWeighted, c.verifier, [keys.b, keys.c])],
          expected,
          label: 'C05-weighted-bc',
          state,
        }),
      };
    },
  },
  {
    id: 'C06',
    title: 'Two C-accounts authorize one invocation',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, c.ozBasic), addr(sdk, c.simple), u32(sdk, 1)];
      const invocation = contractFn(sdk, c.target1, 'ping2', args);
      return invoke(ctx, {
        contractId: c.target1,
        method: 'ping2',
        args,
        authorizers: [
          ozAuthorizer(ctx, c.ozBasic, c.verifier, [keys.a]),
          simpleAuthorizer(ctx, c.simple, keys.b),
        ],
        expected: [
          { address: c.ozBasic, invocation },
          { address: c.simple, invocation },
        ],
        label: 'C06-two-c-accounts',
        state: [
          { target: c.target1, who: c.ozBasic },
          { target: c.target1, who: c.simple },
        ],
      });
    },
  },
  {
    id: 'C07',
    title: 'G-account and C-account authorize one invocation',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, keys.b.publicKey), addr(sdk, c.ozMulti), u32(sdk, 1)];
      const invocation = contractFn(sdk, c.target1, 'ping2', args);
      return invoke(ctx, {
        contractId: c.target1,
        method: 'ping2',
        args,
        authorizers: [gAuthorizer(ctx, keys.b), ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.c])],
        expected: [
          { address: keys.b.publicKey, invocation },
          { address: c.ozMulti, invocation },
        ],
        label: 'C07-mixed-g-c',
        state: [
          { target: c.target1, who: keys.b.publicKey },
          { target: c.target1, who: c.ozMulti },
        ],
      });
    },
  },
  {
    id: 'C08',
    title: 'Nested tree: outer(ozMulti, target2) -> target2.ping',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, c.ozMulti), addr(sdk, c.target2), u32(sdk, 1)];
      const state = { target: c.target2, who: c.ozMulti };
      // outer(who, inner, n) calls inner.ping(who, n), so the tree holds that call below the root.
      const expected = [
        {
          address: c.ozMulti,
          invocation: contractFn(sdk, c.target1, 'outer', args, [
            contractFn(sdk, c.target2, 'ping', [addr(sdk, c.ozMulti), u32(sdk, 1)]),
          ]),
        },
      ];
      const oz = (opts?: OzAuthorizerOptions) => [
        ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.b], opts),
      ];
      return {
        full_tree_passes: await invoke(ctx, {
          contractId: c.target1,
          method: 'outer',
          args,
          authorizers: oz(),
          expected,
          label: 'C08-nested-full-tree',
          state,
        }),
        altered_child_rejected: await invoke(ctx, {
          contractId: c.target1,
          method: 'outer',
          args,
          authorizers: oz(),
          expected,
          label: 'C08-nested-altered-child',
          expect: ERR.auth,
          state,
          mutate: {
            beforeSign: (entry) => {
              childArgs(entry)[1] = u32(sdk, 2);
            },
          },
        }),
        one_rule_id_for_two_contexts_rejected: await invoke(ctx, {
          contractId: c.target1,
          method: 'outer',
          args,
          authorizers: oz({ ruleIds: [0] }),
          expected,
          label: 'C08-nested-rule-ids-mismatch',
          expect: ERR.ruleIdsMismatch,
          state,
        }),
        rebound_call_and_entry_rejected: await invoke(ctx, {
          contractId: c.target1,
          method: 'outer',
          args,
          finalArgs: [addr(sdk, c.ozMulti), addr(sdk, c.target2), u32(sdk, 2)],
          authorizers: oz(),
          expected,
          label: 'C08-nested-rebound-args',
          expect: ERR.crypto,
          state,
          mutate: {
            afterSign: (entry) => {
              rootArgs(entry)[2] = u32(sdk, 2);
              childArgs(entry)[1] = u32(sdk, 2);
            },
          },
        }),
      };
    },
  },
  {
    id: 'C09',
    title: 'Sponsor (A) submits for independent signers',
    status: 'covered_by',
    async run(ctx, c, state) {
      if (!state.done.C01) throw new Error('C09 depends on C01');
      return {
        covered_by: ['C01', 'C02', 'C03', 'C04'],
        payer: ctx.keys.a.publicKey,
        note: 'Every row uses key A as envelope source and fee payer while other keys or C-accounts sign the auth entries.',
        c01_hash: state.done.C01.hash,
      };
    },
  },
  {
    id: 'C10',
    title: 'Wrong nonce, network, signer, root args, expired signature',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const simpleArgs = [addr(sdk, c.simple), u32(sdk, 1)];
      const simpleState = { target: c.target1, who: c.simple };
      const simple = [simpleAuthorizer(ctx, c.simple, keys.b)];
      const expected = [{ address: c.simple, invocation: contractFn(sdk, c.target1, 'ping', simpleArgs) }];
      const ozArgs = [addr(sdk, c.ozBasic), u32(sdk, 1)];
      return {
        wrong_nonce: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args: simpleArgs,
          authorizers: simple,
          expected,
          label: 'C10-wrong-nonce',
          expect: ERR.crypto,
          state: simpleState,
          mutate: {
            afterSign: (entry) => {
              const creds = requireAddressCredentials(entry);
              nonceField(creds).nonce = BigInt(creds.nonce) + 1n;
            },
          },
        }),
        wrong_network: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args: simpleArgs,
          authorizers: simple,
          expected,
          label: 'C10-wrong-network',
          expect: ERR.crypto,
          state: simpleState,
          signPassphrase: sdk.Networks.PUBLIC,
        }),
        wrong_signer: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args: ozArgs,
          authorizers: [ozAuthorizer(ctx, c.ozBasic, c.verifier, [keys.c])],
          expected: [{ address: c.ozBasic, invocation: contractFn(sdk, c.target1, 'ping', ozArgs) }],
          label: 'C10-wrong-signer',
          expect: ERR.unvalidatedContext,
          state: { target: c.target1, who: c.ozBasic },
        }),
        altered_root_args: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args: simpleArgs,
          authorizers: simple,
          expected,
          label: 'C10-altered-root-args',
          expect: ERR.auth,
          state: simpleState,
          mutate: {
            afterSign: (entry) => {
              rootArgs(entry)[1] = u32(sdk, 2);
            },
          },
        }),
        rebound_call_and_entry_rejected: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args: simpleArgs,
          finalArgs: [addr(sdk, c.simple), u32(sdk, 2)],
          authorizers: simple,
          expected,
          label: 'C10-rebound-args',
          expect: ERR.crypto,
          state: simpleState,
          mutate: {
            afterSign: (entry) => {
              rootArgs(entry)[1] = u32(sdk, 2);
            },
          },
        }),
        expired_signature: {
          ...(await invoke(ctx, {
            contractId: c.target1,
            method: 'ping',
            args: simpleArgs,
            authorizers: simple,
            expected,
            label: 'C10-expired-signature',
            expect: 'Error(Auth, InvalidInput)',
            state: simpleState,
            expired: true,
          })),
        },
      };
    },
  },
  {
    id: 'C11',
    title: 'Replay of consumed credentials under a fresh envelope',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, keys.b.publicKey), u32(sdk, 1)];
      const state = { target: c.target1, who: keys.b.publicKey };
      // Fresh success first, so the replay fails on the consumed nonce and not on expiry.
      const fresh = await invoke(ctx, {
        contractId: c.target1,
        method: 'ping',
        args,
        authorizers: [gAuthorizer(ctx, keys.b)],
        expected: [{ address: keys.b.publicKey, invocation: contractFn(sdk, c.target1, 'ping', args) }],
        label: 'C11-fresh-success',
        state,
      });
      const replay = await invoke(ctx, {
        contractId: c.target1,
        method: 'ping',
        args,
        presigned: fresh.auth_xdr,
        label: 'C11-replay',
        expect: ERR.nonceConsumed,
        state,
      });
      if (JSON.stringify(replay.auth_xdr) !== JSON.stringify(fresh.auth_xdr))
        throw new Error('C11: replayed credential bytes differ from the fresh entry');
      const expiration = Math.min(...fresh.entries.map((e) => Number(e.expiration)));
      if (replay.ledger_at_enforce > expiration)
        throw new Error(
          `C11: credentials expired (ledger ${replay.ledger_at_enforce} > ${expiration}) before the replay; nonce consumption not proven`,
        );
      return {
        fresh,
        replay,
        identical_credential_bytes: true,
        expiration,
        ledger_at_replay: replay.ledger_at_enforce,
      };
    },
  },
  {
    id: 'C12',
    title: 'Duplicates: signature serialization versus signer registration',
    async run(ctx, c, state) {
      const { sdk, keys } = ctx;
      const ozArgs = [addr(sdk, c.ozMulti), u32(sdk, 1)];
      const ozState = { target: c.target1, who: c.ozMulti };
      const ozExpected = [{ address: c.ozMulti, invocation: contractFn(sdk, c.target1, 'ping', ozArgs) }];
      const gArgs = [addr(sdk, keys.b.publicKey), u32(sdk, 1)];
      const recorded = 'Error(Object, InvalidInput)'; // Observed live: invalid ScMap order or duplicate keys.
      return {
        g_duplicate_signature_vector: await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args: gArgs,
          authorizers: [gAuthorizer(ctx, keys.b, { duplicate: true })],
          expected: [{ address: keys.b.publicKey, invocation: contractFn(sdk, c.target1, 'ping', gArgs) }],
          label: 'C12-g-duplicate-signature',
          expect: ERR.accountSigs,
          state: { target: c.target1, who: keys.b.publicKey },
        }),
        oz_duplicate_map_entry: {
          ...(await invoke(ctx, {
            contractId: c.target1,
            method: 'ping',
            args: ozArgs,
            authorizers: [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.b], { duplicate: true })],
            expected: ozExpected,
            label: 'C12-oz-duplicate-map-entry',
            expect: recorded,
            state: ozState,
          })),
        },
        oz_unsorted_map: {
          ...(await invoke(ctx, {
            contractId: c.target1,
            method: 'ping',
            args: ozArgs,
            authorizers: [ozAuthorizer(ctx, c.ozMulti, c.verifier, [keys.a, keys.b], { unsorted: true })],
            expected: ozExpected,
            label: 'C12-oz-unsorted-map',
            expect: recorded,
            state: ozState,
          })),
        },
        oz_duplicate_registered_signer: await expectSourceOnlyRejected(
          ctx,
          sdk.Operation.createCustomContract({
            address: new sdk.Address(keys.a.publicKey),
            wasmHash: Buffer.from(state.wasm['multisig_account_example.wasm'].hash, 'hex'),
            constructorArgs: [
              signersVec(sdk, [ozSignerOf(c, keys.a, 'a'), ozSignerOf(c, keys.a, 'a')]),
              scMap(sdk, []),
            ],
          }),
          'C12-oz-duplicate-signer-deploy',
          'Error(Contract, #3007)',
        ),
      };
    },
  },
  {
    id: 'C13',
    title: 'Simple account owner rotation b -> c -> b',
    async run(ctx, c) {
      const { sdk, keys } = ctx;
      const args = [addr(sdk, c.simple), u32(sdk, 1)];
      const state = { target: c.target1, who: c.simple };
      const expected = [{ address: c.simple, invocation: contractFn(sdk, c.target1, 'ping', args) }];
      const setOwner = (to: TestKey, by: TestKey, label: string) => {
        const ownerArgs = [bytes(sdk, to.rawPublicKey)];
        return invoke(ctx, {
          contractId: c.simple,
          method: 'set_owner',
          args: ownerArgs,
          authorizers: [simpleAuthorizer(ctx, c.simple, by)],
          expected: [{ address: c.simple, invocation: contractFn(sdk, c.simple, 'set_owner', ownerArgs) }],
          label,
        });
      };
      const keyFor = (hex: string) =>
        [keys.a, keys.b, keys.c].find((k) => Buffer.from(k.rawPublicKey).toString('hex') === hex);
      const details: Details & { initial_owner_hex: string; final_owner_hex?: string } = {
        initial_owner_hex: await readOwner(ctx, c.simple),
      };
      const initial = keyFor(details.initial_owner_hex);
      if (!initial)
        throw new Error(`C13: simple account owner ${details.initial_owner_hex} is not a test key`);
      if (initial !== keys.b) details.recovered_to_b = await setOwner(keys.b, initial, 'C13-recover-owner-b');
      details.rotate_to_c = await setOwner(keys.c, keys.b, 'C13-set-owner-c');
      let failure: RowFailure | undefined;
      try {
        details.old_owner_rejected = await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [simpleAuthorizer(ctx, c.simple, keys.b)],
          expected,
          label: 'C13-old-owner',
          expect: ERR.crypto,
          state,
        });
        details.new_owner_passes = await invoke(ctx, {
          contractId: c.target1,
          method: 'ping',
          args,
          authorizers: [simpleAuthorizer(ctx, c.simple, keys.c)],
          expected,
          label: 'C13-new-owner',
          state,
        });
      } catch (eValue) {
        const e = requestError(eValue);
        failure = e;
        failure.details = details;
      }
      // An unknown submission stops here. No restoration signing until the hash is resolved.
      if (failure instanceof UnknownSubmission) throw failure;
      // Otherwise restore owner B so a rerun starts from the deployed state. The next run also self-recovers via readOwner.
      try {
        details.restore_to_b = await setOwner(keys.b, keys.c, 'C13-restore-owner-b');
      } catch (eValue) {
        const e = requestError(eValue);
        if (e instanceof UnknownSubmission || !failure) throw e;
        details.restore_error = String(e.message);
      }
      if (failure) throw failure;
      details.final_owner_hex = await readOwner(ctx, c.simple);
      if (details.final_owner_hex !== Buffer.from(keys.b.rawPublicKey).toString('hex'))
        throw new Error('C13: owner restoration mismatch');
      return details;
    },
  },
];

export const NOT_IMPLEMENTED = ['CAP-71 delegate credentials', 'passkeys: out of scope and not planned'];

export async function runContracts(ctx: LiveContext) {
  const manifest: Manifest = JSON.parse(readFileSync(new URL('manifest.json', WASM_DIR), 'utf8'));
  if (manifest.oz_commit !== OZ_COMMIT)
    throw new Error(`fixtures built from ${manifest.oz_commit}, expected ${OZ_COMMIT}`);
  const state = loadState();
  checkCheckpoint(state, manifest, ctx);
  const selected = new Set(
    (ctx.rows ?? process.env.WALLETERM_ROWS?.split(',') ?? ROWS.map((r) => r.id)).map((s) => s.trim()),
  );
  for (const id of selected)
    if (!ROWS.some((row) => row.id === id)) throw new Error(`Unknown contract test row: ${id}`);
  for (const key of [ctx.keys.a, ctx.keys.b, ctx.keys.c]) await ctx.fund(key);
  let c: Deployed;
  try {
    c = await setup(ctx, state);
  } catch (eValue) {
    const e = requestError(eValue);
    ctx.record('C-setup', e instanceof UnknownSubmission ? 'blocked' : 'failed', {
      tx_hash: errorHash(e),
      error: String(e.message),
      contracts: state.contracts,
    });
    throw e;
  }
  ctx.record('C-setup', 'passed', {
    oz_commit: OZ_COMMIT,
    wasm: manifest.artifacts,
    contracts: state.contracts,
    payer: ctx.keys.a.publicKey,
  });
  const failures: RowFailure[] = [];
  for (const row of ROWS) {
    if (!selected.has(row.id)) {
      ctx.record(row.id, 'not_run', { title: row.title, reason: 'not selected' });
      continue;
    }
    try {
      const details = await row.run(ctx, c, state);
      state.done[row.id] = details;
      saveState(state);
      ctx.record(row.id, row.status ?? 'passed', { title: row.title, ...details });
    } catch (eValue) {
      const e: RowFailure = requestError(eValue);
      if (e instanceof UnknownSubmission) {
        ctx.record(row.id, 'blocked', {
          title: row.title,
          tx_hash: e.hash,
          error: String(e.message),
          action: 'query this hash before any new submission',
        });
        throw e;
      }
      ctx.record(row.id, 'failed', {
        title: row.title,
        error: String(e.stack ?? e),
        ...(e.details ? { partial: e.details } : {}),
      });
      failures.push(e);
      if (ctx.stopOnFailure) throw e;
    }
  }
  ctx.record('C-not-implemented', 'not_run', { items: NOT_IMPLEMENTED });
  ctx.record('C-run-scope', failures.length ? 'failed' : 'passed', {
    selected: [...selected],
    full_suite: selected.size === ROWS.length,
    fresh_execution: [...selected].filter((id) => id !== 'C09'),
    coverage_reference: selected.has('C09') ? ['C09'] : [],
  });
  if (failures.length)
    throw new AggregateError(failures, 'Contract acceptance failed; inspect results-contracts.json');
  return state;
}

// ---------- offline self-test ----------
async function selfTest() {
  const sdk = await import('@stellar/stellar-sdk');
  function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(`self-test: ${msg}`);
  }
  assert(
    ruleIdsXdr(sdk, [0]).toString('hex') === '0000001000000001000000010000000300000000',
    'rule ids [0] xdr',
  );
  assert(
    ruleIdsXdr(sdk, [0, 1]).toString('hex') === '00000010000000010000000200000003000000000000000300000001',
    'rule ids [0,1] xdr',
  );
  const verifier = 'CDLDYJWEZSM6IAI4HHPEZTTV65WX4OVN3RZD3U6LQKYAVIZTEK7XYAYT';
  const exampleKey = Buffer.from('3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29', 'hex');
  const vector = ozAuthPayload(
    sdk,
    [{ verifier, rawKey: exampleKey, signature: Buffer.alloc(64) }],
    [0],
  ).toXdr('base64');
  assert(
    vector ===
      'AAAAEQAAAAEAAAACAAAADwAAABBjb250ZXh0X3J1bGVfaWRzAAAAEAAAAAEAAAABAAAAAwAAAAAAAAAPAAAAB3NpZ25lcnMAAAAAEQAAAAEAAAABAAAAEAAAAAEAAAADAAAADwAAAAhFeHRlcm5hbAAAABIAAAAB1jwmxMyZ5AEcOd5MznX3bX46rdxyPdPLgrAKozMiv3wAAAANAAAAIDtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdopAAAADQAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'AuthPayload matches docs/OPENZEPPELIN.md vector',
  );

  const kp = sdk.Keypair.random();
  const key = { name: 'mock', publicKey: kp.publicKey(), rawPublicKey: kp.rawPublicKey() };
  const ctx: SigningContext = {
    sdk,
    signDigest: async (k, digest) => {
      assert(k === key && digest.length === 32, 'signDigest args');
      return Buffer.from(kp.sign(digest));
    },
  };
  const target = sdk.Keypair.random().publicKey();
  const fn = (name: string, args: xdr.ScVal[], subs: xdr.SorobanAuthorizedInvocation[] = []) =>
    contractFn(sdk, verifier, name, args, subs);
  const tree = fn('outer', [addr(sdk, target), u32(sdk, 1)], [fn('ping', [addr(sdk, target), u32(sdk, 1)])]);
  assert(countContexts(tree) === 2, 'countContexts');
  const entryFor = (address: string) =>
    new sdk.xdr.SorobanAuthorizationEntry({
      credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(
        new sdk.xdr.SorobanAddressCredentials({
          address: new sdk.Address(address).toScAddress(),
          nonce: 7n,
          signatureExpirationLedger: 0,
          signature: sdk.xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: tree,
    });
  const payloadOf = (entry: xdr.SorobanAuthorizationEntry, exp: number) =>
    Buffer.from(sdk.hash(sdk.buildAuthorizationEntryPreimage(entry, exp, sdk.Networks.TESTNET).toXdr()));

  const ozEntry = entryFor(verifier);
  const ozSigned = await sdk.authorizeEntry(
    cloneEntry(sdk, ozEntry),
    async (_p, payload) => ({
      signatureScVal: await ozAuthorizer(ctx, verifier, verifier, [key]).signatureScVal(
        Buffer.from(payload),
        ozEntry,
      ),
      address: verifier,
    }),
    500,
    sdk.Networks.TESTNET,
  );
  // Native form of the OZ AuthPayload: rule ids and one signature per signer key.
  const ozNative: { context_rule_ids: number[]; signers: Record<string, Uint8Array> } = sdk.scValToNative(
    requireAddressCredentials(ozSigned).signature,
  );
  assert(JSON.stringify(ozNative.context_rule_ids) === '[0,0]', 'two rule ids for two contexts');
  const [firstSignature] = Object.values(ozNative.signers);
  assert(firstSignature, 'OZ AuthPayload has a signer');
  const ozSig = Buffer.from(firstSignature);
  assert(
    kp.verify(ozAuthDigest(sdk, payloadOf(ozEntry, 500), [0, 0]), ozSig),
    'OZ signature over auth digest',
  );
  assert(!kp.verify(payloadOf(ozEntry, 500), ozSig), 'OZ signature is not over the raw payload');
  assert(requireAddressCredentials(ozSigned).signatureExpirationLedger === 500, 'expiration applied');

  const gEntry = entryFor(key.publicKey);
  const gSigned = await sdk.authorizeEntry(
    cloneEntry(sdk, gEntry),
    async (_p, payload) => ({
      signatureScVal: await gAuthorizer(ctx, key).signatureScVal(Buffer.from(payload)),
      address: key.publicKey,
    }),
    500,
    sdk.Networks.TESTNET,
  );
  const gRef = await sdk.authorizeEntry(cloneEntry(sdk, gEntry), kp, 500, sdk.Networks.TESTNET);
  assert(gSigned.toXdr('base64') === gRef.toXdr('base64'), 'G signature ScVal equals the SDK keypair path');

  const simpleSigned = await sdk.authorizeEntry(
    cloneEntry(sdk, ozEntry),
    async (_p, payload) => ({
      signatureScVal: await simpleAuthorizer(ctx, verifier, key).signatureScVal(Buffer.from(payload)),
      address: verifier,
    }),
    500,
    sdk.Networks.TESTNET,
  );
  assert(
    kp.verify(
      payloadOf(ozEntry, 500),
      Buffer.from(sdk.scValToNative(requireAddressCredentials(simpleSigned).signature)),
    ),
    'simple account signature over raw payload',
  );

  const mutated = cloneEntry(sdk, gSigned);
  nonceField(requireAddressCredentials(mutated)).nonce = 8n;
  rootArgs(mutated)[1] = u32(sdk, 2);
  childArgs(mutated)[1] = u32(sdk, 3);
  assert(
    String(requireAddressCredentials(gSigned).nonce) === '7' &&
      mutated.toXdr('base64') !== gSigned.toXdr('base64'),
    'clone mutation is independent',
  );
  const dup = await gAuthorizer(ctx, key, { duplicate: true }).signatureScVal(Buffer.alloc(32));
  const dupNative: unknown[] = sdk.scValToNative(dup);
  assert(dupNative.length === 2, 'duplicate G signature vector');
  const two = [
    { verifier, rawKey: Buffer.alloc(32, 1), signature: Buffer.alloc(64) },
    { verifier, rawKey: Buffer.alloc(32, 2), signature: Buffer.alloc(64) },
  ];
  assert(
    ozAuthPayload(sdk, two, [0]).toXdr('base64') ===
      ozAuthPayload(sdk, [two[1], two[0]], [0]).toXdr('base64'),
    'sorted map is order independent',
  );
  assert(
    ozAuthPayload(sdk, [two[1], two[0]], [0], { sorted: false }).toXdr('base64') !==
      ozAuthPayload(sdk, two, [0]).toXdr('base64'),
    'unsorted map differs',
  );
  assert(
    new UnknownSubmission('x', 'h', new Error('got NOT_FOUND')).hash === 'h',
    'unknown submission marker',
  );
  const op = sdk.Operation.createCustomContract({
    address: new sdk.Address(key.publicKey),
    wasmHash: Buffer.alloc(32),
    constructorArgs: [u32(sdk, 1)],
  });
  assert(
    op && typeof sdk.Address.fromScVal === 'function' && sdk.BASE_FEE === '100',
    'deploy helpers available',
  );
  const manifest: Manifest = JSON.parse(readFileSync(new URL('manifest.json', WASM_DIR), 'utf8'));
  assert(
    manifest.oz_commit === OZ_COMMIT && Object.keys(manifest.artifacts).length === 6,
    'manifest has six artifacts at the pinned commit',
  );
  console.log(
    JSON.stringify({
      ok: true,
      self_test: 'contracts.ts',
      rows: ROWS.map((r) => r.id),
      not_implemented: NOT_IMPLEMENTED,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
