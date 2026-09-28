// Explicit live acceptance for the openzeppelin-ed25519 adapter. Uses one existing OpenZeppelin account whose
// rule 0 holds one External Ed25519 signer: the pre-existing dedicated 1Password key test-a. Deploys nothing.
// Usage: WALLETERM_BINARY=/isolated/prefix/bin/walleterm bun --no-env-file tests/openzeppelin-auth-live.ts /path/to/public-test-keys.json
// The account, verifier, and target come from live/contracts-state.json beside the metadata file.
// The runner checks their code, rule, and signer with read-only RPC calls before any signing request.
import * as StellarSdk from '@stellar/stellar-sdk';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  buildAuthorizationEntryPreimage,
  hash,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import type { Transaction } from '@stellar/stellar-sdk';
import { createBridge } from '../bridge/server.ts';
import { WalletermClient } from '../sdk/walleterm.ts';
import {
  MAX_AUTH_LEDGER_WINDOW,
  OPENZEPPELIN_AUTH_COMMIT,
  addressCredentials,
  createAuthEntry,
  inspectAuthEntry,
  setAuthEntryExpiration,
  verifyAuthEntrySignature,
} from '../sdk/authorization.ts';
import { demoRpc, hex } from '../demo/site/contracts.ts';
import { ERR, ozAuthDigest, ozAuthPayload, ozSigner, scMap } from './contracts.ts';
import { createSubmissionGuard } from './submission.ts';
import type { AuthEntryInput } from '../sdk/authorization.ts';
import type { ContractsState, Manifest } from './contracts.ts';

// The runner's read-only RPC surface. It has no submission method; the guard owns submission.
export interface OzRpc extends Pick<rpc.Server, 'getAccount' | 'getLedgerEntries' | 'simulateTransaction'> {
  getLatestLedger(): Promise<{ sequence: number }>;
}
export interface OzDeployment {
  account: string;
  verifier: string;
  target: string;
  signer: string;
  wasm: Record<Role, string>;
}
export interface OzPrepared {
  before: number;
  expiration: number;
  unsignedXdr: string;
  input: AuthEntryInput;
}
export interface OzControl {
  id: string;
  func: xdr.HostFunction;
  auth: xdr.SorobanAuthorizationEntry[];
  expect: string;
}
type Role = 'account' | 'verifier' | 'target';

// Deployments recorded by tests/contracts.ts setup() at the pinned OpenZeppelin commit.
const DEPLOYED: Record<Role, { name: string; wasm: string }> = {
  account: { name: 'oz_basic_a', wasm: 'multisig_account_example.wasm' },
  verifier: { name: 'ed25519_verifier', wasm: 'multisig_ed25519_verifier_example.wasm' },
  target: { name: 'auth_target_1', wasm: 'walleterm_auth_target.wasm' },
};
export const RULE_IDS = [0];
export const MAX_FEE_STROOPS = 1_000_000n;
const RULE_NOT_FOUND = 'Error(Contract, #3000)';

const sym = (value: string) => xdr.ScVal.scvSymbol(value);
const vec = (values: xdr.ScVal[]) => xdr.ScVal.scvVec(values);
const pingCall = (d: OzDeployment, n: number) =>
  new xdr.InvokeContractArgs({
    contractAddress: new Address(d.target).toScAddress(),
    functionName: 'ping',
    args: [new Address(d.account).toScVal(), xdr.ScVal.scvU32(n)],
  });
export const pingFunction = (d: OzDeployment, n = 1) =>
  xdr.HostFunction.hostFunctionTypeInvokeContract(pingCall(d, n));
export const pingInvocation = (d: OzDeployment, n = 1) =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(pingCall(d, n)),
    subInvocations: [],
  });
function build(source: string, sequence: string, operation: xdr.Operation) {
  return new TransactionBuilder(new Account(source, sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build();
}

/** Read the reviewed ids from the acceptance state. The live checks below remain authoritative. */
export function loadDeployment(state: ContractsState, manifest: Manifest, signer: string): OzDeployment {
  if (manifest?.oz_commit !== OPENZEPPELIN_AUTH_COMMIT || state?.oz_commit !== OPENZEPPELIN_AUTH_COMMIT)
    throw Error('The recorded OpenZeppelin deployment uses a different commit.');
  if (!StrKey.isValidEd25519PublicKey(signer)) throw Error('The dedicated signer is invalid.');
  const ids = {} as Record<Role, string>,
    wasm = {} as Record<Role, string>;
  for (const role of ['account', 'verifier', 'target'] as const) {
    const recorded = state.contracts?.[DEPLOYED[role].name];
    const sha256 = manifest.artifacts?.[DEPLOYED[role].wasm]?.sha256;
    if (
      !recorded ||
      recorded.wasm !== DEPLOYED[role].wasm ||
      !StrKey.isValidContract(recorded.id) ||
      !/^[a-f0-9]{64}$/.test(sha256 ?? '')
    )
      throw Error(`The recorded ${role} deployment is missing or invalid.`);
    ids[role] = recorded.id;
    wasm[role] = sha256;
  }
  return { ...ids, signer, wasm };
}

/** Rule 0 as the pinned constructor created it: Default, one External signer, no policy, no expiry. */
export function expectedRule(d: OzDeployment) {
  return scMap(StellarSdk, [
    [sym('context_type'), vec([sym('Default')])],
    [sym('id'), xdr.ScVal.scvU32(RULE_IDS[0])],
    [sym('name'), xdr.ScVal.scvString('multisig')],
    [sym('policies'), vec([])],
    [sym('policy_ids'), vec([])],
    [sym('signer_ids'), vec([xdr.ScVal.scvU32(0)])],
    [sym('signers'), vec([ozSigner(StellarSdk, d.verifier, StrKey.decodeEd25519PublicKey(d.signer))])],
    [sym('valid_until'), xdr.ScVal.scvVoid()],
  ]);
}

async function read(server: OzRpc, d: OzDeployment, contract: string, method: string, args: xdr.ScVal[]) {
  const source = await server.getAccount(d.signer);
  const operation = new Contract(contract).call(method, ...args);
  const result = await server.simulateTransaction(
    build(d.signer, source.sequenceNumber(), operation),
    undefined,
    'enforce',
  );
  if (rpc.Api.isSimulationError(result) || !result.result) throw Error(`The ${method} read failed.`);
  return result.result.retval;
}
export async function readCount(server: OzRpc, d: OzDeployment) {
  const value = await read(server, d, d.target, 'count', [new Address(d.account).toScVal()]);
  if (value.type !== 'scvU32') throw Error('The contract counter is invalid.');
  return value.u32;
}

/** Check live code, the complete rule, and the rule count before any signing request. */
export async function verifyDeployment(server: OzRpc, d: OzDeployment) {
  for (const role of ['account', 'verifier', 'target'] as const) {
    const result = await server.getLedgerEntries(new Contract(d[role]).getFootprint());
    const entry = result.entries.length === 1 ? result.entries[0].val : undefined;
    if (entry?.type !== 'contractData' || entry.contractData.val.type !== 'scvContractInstance')
      throw Error(`The ${role} contract instance is missing.`);
    const executable = entry.contractData.val.instance.executable;
    if (executable.type !== 'contractExecutableWasm' || hex(executable.wasmHash.toBytes()) !== d.wasm[role])
      throw Error(`The ${role} contract code differs from the pinned build.`);
  }
  const count = await read(server, d, d.account, 'get_context_rules_count', []);
  if (count.type !== 'scvU32' || count.u32 !== 1) throw Error('The account rule count changed.');
  const rule = await read(server, d, d.account, 'get_context_rule', [xdr.ScVal.scvU32(RULE_IDS[0])]);
  if (rule.toXDR('base64') !== expectedRule(d).toXDR('base64'))
    throw Error('The account rule differs from the reviewed External signer rule.');
  return { wasm: d.wasm, rule_count: count.u32, rule_xdr: rule.toXDR('base64') };
}

const requestFor = (d: OzDeployment, entryXdr: string): AuthEntryInput => ({
  auth_entry_xdr: entryXdr,
  network_passphrase: Networks.TESTNET,
  public_key: d.signer,
  address: d.account,
  adapter: { type: 'openzeppelin-ed25519', verifier: d.verifier, context_rule_ids: [...RULE_IDS] },
});

/** Record-simulate one increment. Reject any difference from the locally built entry. */
export async function prepareIncrement(server: OzRpc, d: OzDeployment): Promise<OzPrepared> {
  const before = await readCount(server, d);
  const source = await server.getAccount(d.signer);
  const template = build(
    d.signer,
    source.sequenceNumber(),
    Operation.invokeHostFunction({ func: pingFunction(d), auth: [] }),
  );
  const recorded = await server.simulateTransaction(template, undefined, 'record');
  if (rpc.Api.isSimulationError(recorded) || !recorded.result)
    throw Error('The recording simulation failed.');
  const retval = recorded.result.retval;
  if (retval?.type !== 'scvU32' || retval.u32 !== before + 1)
    throw Error('The recording simulation returned a different counter.');
  const entries = recorded.result.auth;
  if (entries?.length !== 1) throw Error('The simulation returned unexpected authorization entries.');
  if (entries[0].credentials.type !== 'sorobanCredentialsAddressV2')
    throw Error('Live acceptance requires explicit AddressV2 authorization.');
  const expiration = recorded.latestLedger + MAX_AUTH_LEDGER_WINDOW;
  const unsignedXdr = createAuthEntry({
    address: d.account,
    invocation: pingInvocation(d),
    nonce: addressCredentials(entries[0]).nonce,
    expirationLedger: expiration,
  });
  if (setAuthEntryExpiration(entries[0].toXDR('base64'), expiration) !== unsignedXdr)
    throw Error('The simulated authorization differs from the expected tree.');
  return { before, expiration, unsignedXdr, input: requestFor(d, unsignedXdr) };
}

/** Recompute the digest with the SDK preimage helper and the acceptance-suite digest rule. */
export function reviewRequest(d: OzDeployment, prepared: OzPrepared, latestLedger: number) {
  if (JSON.stringify(prepared.input) !== JSON.stringify(requestFor(d, prepared.unsignedXdr)))
    throw Error('The authorization request differs from the verified account rule.');
  const checked = inspectAuthEntry(prepared.input, d.signer, latestLedger);
  if (checked.entry.rootInvocation.toXDR('base64') !== pingInvocation(d).toXDR('base64'))
    throw Error('The authorization invocation differs from the reviewed increment.');
  const preimage = buildAuthorizationEntryPreimage(checked.entry, prepared.expiration, Networks.TESTNET);
  if (preimage.type !== 'envelopeTypeSorobanAuthorizationWithAddress')
    throw Error('The authorization preimage is not address-bound.');
  const payload = hash(preimage.toXDR());
  const digest = ozAuthDigest(StellarSdk, payload, RULE_IDS);
  if (hex(digest) !== checked.details.hash) throw Error('The independent digest differs.');
  return { digest, host_payload: hex(payload) };
}

const entryWith = (entryXdr: string, signature: xdr.ScVal, invocation?: xdr.SorobanAuthorizedInvocation) => {
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(entryXdr, 'base64');
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation ?? entry.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({ ...addressCredentials(entry), signature }),
    ),
  });
};
function signatureOf(signedXdr: string) {
  try {
    const value = addressCredentials(xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, 'base64')).signature;
    const signers = value.type === 'scvMap' ? value.map?.[1]?.val : undefined;
    const bytes = signers?.type === 'scvMap' ? signers.map?.[0]?.val : undefined;
    if (bytes?.type === 'scvBytes') return bytes.bytes.toBytes();
  } catch {}
  throw Error('The signed AuthPayload is invalid.');
}
const payloadWith = (d: OzDeployment, signature: Uint8Array, ids: number[]) =>
  ozAuthPayload(
    StellarSdk,
    [{ verifier: d.verifier, rawKey: StrKey.decodeEd25519PublicKey(d.signer), signature }],
    ids,
  );

/** Check the returned artifact with walleterm's verifier, then rebuild it independently. */
export function verifySignedEntry(d: OzDeployment, prepared: OzPrepared, signedXdr: string, latest: number) {
  verifyAuthEntrySignature(prepared.input, signedXdr, latest);
  const { digest } = reviewRequest(d, prepared, latest);
  const signature = signatureOf(signedXdr);
  if (signature.length !== 64 || !Keypair.fromPublicKey(d.signer).verify(digest, signature))
    throw Error('The returned signature does not verify over the OpenZeppelin digest.');
  const rebuilt = entryWith(prepared.unsignedXdr, payloadWith(d, signature, RULE_IDS));
  if (rebuilt.toXDR('base64') !== signedXdr)
    throw Error('The signed authorization differs from the independent AuthPayload.');
  return hex(signature);
}

export type AuthSigner = (input: AuthEntryInput, latestLedger: number) => Promise<string>;
/** One signing request, only after the complete review passes. */
export async function authorizeIncrement(
  server: OzRpc,
  d: OzDeployment,
  prepared: OzPrepared,
  sign: AuthSigner,
) {
  const latestLedger = (await server.getLatestLedger()).sequence;
  const review = reviewRequest(d, prepared, latestLedger);
  const signedXdr = await sign(structuredClone(prepared.input), latestLedger);
  const signature = verifySignedEntry(d, prepared, signedXdr, latestLedger);
  return {
    signedXdr,
    signature,
    latestLedger,
    digest: hex(review.digest),
    host_payload: review.host_payload,
  };
}

/** Enforce-simulate the signed entry and assemble resources. The authorization stays byte-identical. */
export async function assembleIncrement(server: OzRpc, d: OzDeployment, signedXdr: string) {
  const source = await server.getAccount(d.signer);
  const fresh = build(
    d.signer,
    source.sequenceNumber(),
    Operation.invokeHostFunction({
      func: pingFunction(d),
      auth: [xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, 'base64')],
    }),
  );
  const enforced = await server.simulateTransaction(fresh, undefined, 'enforce');
  if (rpc.Api.isSimulationError(enforced))
    throw Error(`The authorization simulation failed: ${enforced.error}`);
  const transaction = rpc.assembleTransaction(fresh, enforced).build();
  const envelope = transaction.toEnvelope();
  const operation = envelope.type === 'envelopeTypeTx' ? envelope.value.tx.operations : [];
  const host = operation.length === 1 ? operation[0].body : undefined;
  if (
    host?.type !== 'invokeHostFunction' ||
    host.value.hostFunction.toXDR('base64') !== pingFunction(d).toXDR('base64') ||
    host.value.auth.length !== 1 ||
    host.value.auth[0].toXDR('base64') !== signedXdr ||
    transaction.source !== d.signer ||
    transaction.sequence !== fresh.sequence
  )
    throw Error('The assembled transaction differs from the reviewed increment.');
  if (BigInt(transaction.fee) > MAX_FEE_STROOPS)
    throw Error('The assembled fee exceeds the live test limit.');
  return transaction;
}

/** Each control changes one element of the enforced increment. None requests a signature. */
export function negativeControls(d: OzDeployment, signedXdr: string): OzControl[] {
  const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedXdr, 'base64');
  const signature = signatureOf(signedXdr);
  return [
    { id: 'missing-authorization', func: pingFunction(d), auth: [], expect: ERR.auth },
    {
      id: 'wrong-context-rule-id',
      func: pingFunction(d),
      auth: [entryWith(signedXdr, payloadWith(d, signature, [RULE_IDS[0] + 1]))],
      expect: RULE_NOT_FOUND,
    },
    {
      id: 'changed-invocation',
      func: pingFunction(d, 2),
      auth: [entryWith(signedXdr, addressCredentials(signed).signature, pingInvocation(d, 2))],
      expect: ERR.crypto,
    },
  ];
}
export async function rejectControl(server: OzRpc, d: OzDeployment, control: OzControl) {
  const source = await server.getAccount(d.signer);
  const transaction = build(
    d.signer,
    source.sequenceNumber(),
    Operation.invokeHostFunction({ func: control.func, auth: control.auth }),
  );
  const simulated = await server.simulateTransaction(transaction, undefined, 'enforce');
  if (!rpc.Api.isSimulationError(simulated) || !simulated.error.includes(control.expect))
    throw Error(`${control.id}: enforcing simulation did not reject with ${control.expect}.`);
  return simulated.error;
}

export async function verifyIncrement(server: OzRpc, d: OzDeployment, before: number) {
  const after = await readCount(server, d);
  if (after !== before + 1) throw Error('The confirmed counter differs from the reviewed increment.');
  return { count_before: before, count_after: after, account: d.account, contract: d.target };
}

async function main() {
  const metadataFile = process.argv[2],
    binary = process.env.WALLETERM_BINARY;
  if (!metadataFile || !binary) throw Error('Provide dedicated public test metadata and WALLETERM_BINARY.');
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  const dedicated = metadata.keys?.find((key: { name: string }) => key.name === 'walleterm-v2-test-a');
  if (!dedicated || !/^[a-f0-9]{64}$/.test(dedicated.raw_public_key_hex))
    throw Error('The dedicated test-a public key is missing.');
  const signer = StrKey.encodeEd25519PublicKey(Buffer.from(dedicated.raw_public_key_hex, 'hex'));
  const evidence = dirname(metadataFile);
  const directory = new URL('../evidence/openzeppelin-auth-live/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  const events = new URL('events.jsonl', directory),
    resultFile = new URL('summary.json', directory);
  const lock = join(evidence, 'openzeppelin-auth-live.lock');
  for (const journal of ['live', 'contract-auth-live'])
    if (existsSync(join(evidence, journal, 'pending-submission.json')))
      throw Error(`The ${journal} submission journal requires reconciliation first.`);
  const server = demoRpc();
  const records: Record<string, unknown>[] = [];
  const json = (value: unknown, space?: number) =>
    JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item), space);
  function record(id: string, status: string, details: Record<string, unknown> = {}) {
    const row = { id, status, timestamp: new Date().toISOString(), ...details };
    records.push(row);
    appendFileSync(events, json(row) + '\n');
    console.log(json({ id, status, hash: details.hash, ledger: details.ledger, method: details.method }));
  }
  const guard = createSubmissionGuard({
    rpc: server,
    directory,
    networkPassphrase: Networks.TESTNET,
    record,
  });
  const bridge = createBridge({ port: 0, log: () => {} });
  const requests = { authorization: 0, envelope: 0 },
    controls = { rejected_by_enforcing_simulation: 0, signatures_requested: 0, submitted: 0 };
  let client: WalletermClient | undefined;
  // A signed entry stays usable until expiry if its outcome is unknown. Blocked records keep that ledger.
  let openAuthorization: number | undefined;
  const requested = (input: AuthEntryInput) => {
    requests.authorization++;
    openAuthorization = addressCredentials(
      xdr.SorobanAuthorizationEntry.fromXDR(input.auth_entry_xdr, 'base64'),
    ).signatureExpirationLedger;
  };

  const cliSign: AuthSigner = async (input, latestLedger) => {
    guard.assertClear();
    record('cli-auth-request', 'requested', { input, latest_ledger: latestLedger });
    requested(input);
    const signed = await new Promise<{
      ok: boolean;
      public_key: string;
      digest: string;
      verified: boolean;
      signed_auth_entry_xdr: string;
    }>((resolve, reject) => {
      const child = spawn(binary, ['sign-auth'], { stdio: ['pipe', 'pipe', 'inherit'] });
      let output = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), 125000);
      child.stdout.on('data', (data) => {
        output += data;
        if (output.length > 100000) child.kill('SIGTERM');
      });
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(output);
          if (code || !result.ok)
            throw Error(result.error?.message || 'The installed authorization command failed.');
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(JSON.stringify({ ...input, latest_ledger: latestLedger }));
    });
    const checked = inspectAuthEntry(input, signer, latestLedger);
    if (signed.public_key !== signer || signed.digest !== checked.details.hash || signed.verified !== true)
      throw Error('The CLI returned a different signer or digest.');
    return signed.signed_auth_entry_xdr;
  };
  const sdkSign: AuthSigner = async (input) => {
    guard.assertClear();
    record('sdk-auth-request', 'requested', { input });
    requested(input);
    const result = await client!.signAuthEntry(input.auth_entry_xdr, {
      address: input.address,
      adapter: input.adapter,
    });
    if (result.signerAddress !== signer) throw Error('The SDK returned a different signer.');
    return result.signedAuthEntryXdr;
  };

  async function submit(d: OzDeployment, prepared: OzPrepared, transaction: Transaction, method: string) {
    guard.assertClear();
    const unsignedHash = hex(transaction.hash());
    requests.envelope++;
    const signed = await client!.signTransaction(transaction.toXDR());
    const envelope = TransactionBuilder.fromXDR(signed.signedTxXdr, Networks.TESTNET);
    if (
      'innerTransaction' in envelope ||
      hex(envelope.hash()) !== unsignedHash ||
      envelope.signatures.length !== 1 ||
      !Keypair.fromPublicKey(signer).verify(envelope.hash(), envelope.signatures[0].signature.toBytes())
    )
      throw Error('The outer signature failed verification.');
    const result = await guard.send(envelope, `openzeppelin-${method}`);
    openAuthorization = undefined;
    const verification = await verifyIncrement(server, d, prepared.before);
    record(`${method}-increment`, 'passed', {
      method,
      hash: result.hash,
      ledger: result.ledger,
      fee: envelope.fee,
      verification,
      signed_envelope_xdr: envelope.toXDR(),
    });
  }

  writeFileSync(lock, JSON.stringify({ pid: process.pid, signer, time: new Date().toISOString() }), {
    flag: 'wx',
  });
  try {
    guard.assertClear();
    const state = JSON.parse(readFileSync(join(evidence, 'live/contracts-state.json'), 'utf8'));
    const manifest = JSON.parse(
      readFileSync(new URL('../fixtures/wasm/manifest.json', import.meta.url), 'utf8'),
    );
    const d = loadDeployment(state, manifest, signer);
    const verified = await verifyDeployment(server, d);
    record('deployment', 'verified', { deployment: d, ...verified, oz_commit: OPENZEPPELIN_AUTH_COMMIT });
    await bridge.listen();
    const bound = bridge.server.address();
    if (!bound || typeof bound === 'string') throw Error('The local acceptance bridge did not bind.');
    const origin = `http://127.0.0.1:${bound.port}`;
    bridge.setPublicOrigin(origin);
    client = new WalletermClient(origin, {
      page: null,
      pollInterval: 100,
      fetch: (url, options) =>
        fetch(url, { ...options, headers: { ...options?.headers, Origin: 'http://127.0.0.1:8788' } }),
    });
    await client.connect({
      code: bridge.pairing.code,
      selectWallet: async (signers) => {
        if (!signers.some((key) => key.public_key === signer))
          throw Error('The dedicated test signer is unavailable.');
        return signer;
      },
    });
    record('dedicated-signer', 'passed', {
      public_key: signer,
      name: dedicated.name,
      network: Networks.TESTNET,
    });
    for (const method of ['cli', 'sdk'] as const) {
      guard.assertClear();
      const prepared = await prepareIncrement(server, d);
      record('expected-authorization', 'matched', {
        method,
        count_before: prepared.before,
        expiration_ledger: prepared.expiration,
        unsigned_auth_entry_xdr: prepared.unsignedXdr,
      });
      const authorized = await authorizeIncrement(server, d, prepared, method === 'cli' ? cliSign : sdkSign);
      record(`${method}-auth-result`, 'passed', {
        method,
        latest_ledger: authorized.latestLedger,
        host_payload: authorized.host_payload,
        digest: authorized.digest,
        signed_auth_entry_xdr: authorized.signedXdr,
      });
      const transaction = await assembleIncrement(server, d, authorized.signedXdr);
      for (const control of negativeControls(d, authorized.signedXdr)) {
        const error = await rejectControl(server, d, control);
        controls.rejected_by_enforcing_simulation++;
        record(control.id, 'passed', {
          method,
          expect: control.expect,
          error,
          submitted: false,
          signatures_requested: 0,
        });
      }
      await submit(d, prepared, transaction, method);
    }
    writeFileSync(
      resultFile,
      json(
        {
          status: 'passed',
          network: 'testnet',
          signer,
          completed_at: new Date().toISOString(),
          signature_requests: requests,
          negative_controls: controls,
          limits: [
            'One External Ed25519 signer on rule 0 of the pinned multisig example account.',
            'One authorization context. Several contexts and several signers are not covered.',
            'The account has one rule. The wrong-rule control shows rule lookup failure, not digest binding between two live rules.',
            'The same dedicated key signs the authorization entry and the transaction envelope.',
            'The local bridge approves requests automatically. 1Password approval is the only human prompt.',
          ],
          records,
        },
        2,
      ) + '\n',
    );
  } catch (error) {
    record('acceptance', 'blocked', {
      message: error instanceof Error ? error.message : String(error),
      open_authorization_expiration: openAuthorization,
    });
    writeFileSync(
      resultFile,
      json(
        {
          status: 'blocked',
          network: 'testnet',
          signer,
          signature_requests: requests,
          negative_controls: controls,
          records,
        },
        2,
      ) + '\n',
    );
    process.exitCode = 1;
  } finally {
    await client?.disconnect().catch(() => {});
    await bridge.close();
    unlinkSync(lock);
  }
}

if (import.meta.main) await main();
