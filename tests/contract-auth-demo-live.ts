// Explicit live acceptance. Uses only pre-existing dedicated 1Password test keys.
// Usage: WALLETERM_BINARY=/isolated/prefix/bin/walleterm bun --no-env-file tests/contract-auth-demo-live.ts /path/to/public-test-keys.json
// The website half uses the Rust bridge with its production signer on loopback. Build it first:
// cargo build --locked --features test-host --bin walleterm-test-host
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Account,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { createHost, type Host } from './browser/host.ts';
import { WalletermClient } from '../sdk/walleterm.ts';
import { addressCredentials, inspectAuthEntry, verifyAuthEntrySignature } from '../sdk/authorization.ts';
import {
  assembleAuthorizedContract,
  demoRpc,
  hex,
  prepareContract,
  validateContractReview,
  verifyContractResult,
} from '../demo/site/contracts.ts';
import { createSubmissionGuard } from './submission.ts';
import type { AuthEntryInput } from '../sdk/authorization.ts';
import type { ContractPreparation } from '../demo/site/contracts.ts';

const metadataFile = process.argv[2],
  binary = process.env.WALLETERM_BINARY;
if (!metadataFile || !binary) throw Error('Provide dedicated public test metadata and WALLETERM_BINARY.');
const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
const dedicated = metadata.keys?.find((key: { name: string }) => key.name === 'walleterm-v2-test-a');
if (!dedicated || !/^[a-f0-9]{64}$/.test(dedicated.raw_public_key_hex))
  throw Error('The dedicated test-a public key is missing.');
const signer = StrKey.encodeEd25519PublicKey(Buffer.from(dedicated.raw_public_key_hex, 'hex'));
const directory = Bun.pathToFileURL(join(dirname(metadataFile), 'contract-auth-live/'));
mkdirSync(directory, { recursive: true });
const events = new URL('events.jsonl', directory),
  resultFile = new URL('summary.json', directory);
const lock = join(dirname(metadataFile), 'contract-auth-live.lock');
if (existsSync(join(dirname(metadataFile), 'live/pending-submission.json')))
  throw Error('The existing testnet submission journal requires reconciliation first.');
writeFileSync(lock, JSON.stringify({ pid: process.pid, signer, time: new Date().toISOString() }), {
  flag: 'wx',
});
const server = demoRpc();
const records: Record<string, unknown>[] = [];
function record(id: string, status: string, details: Record<string, unknown> = {}) {
  const row = { id, status, timestamp: new Date().toISOString(), ...details };
  records.push(row);
  appendFileSync(events, JSON.stringify(row) + '\n');
  console.log(
    JSON.stringify({ id, status, hash: details.hash, ledger: details.ledger, stage: details.stage }),
  );
}
const guard = createSubmissionGuard({ rpc: server, directory, networkPassphrase: Networks.TESTNET, record });
let bridge: Host | undefined;
let client: WalletermClient | undefined;

async function cliAuth(input: AuthEntryInput) {
  guard.assertClear();
  // The entry shape of `walleterm sign`. The CLI names the signer with public_key.
  const request = {
    public_key: input.public_key,
    network_passphrase: input.network_passphrase,
    auth_entry_xdr: input.auth_entry_xdr,
    address: input.address,
    adapter: input.adapter,
  };
  record('cli-auth-request', 'requested', { input: request });
  const signed = await new Promise<{
    ok: boolean;
    public_key: string;
    digest: string;
    verified: boolean;
    signed_auth_entry_xdr: string;
  }>((resolve, reject) => {
    const child = spawn(binary!, ['sign'], { stdio: ['pipe', 'pipe', 'inherit'] });
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
    child.stdin.end(JSON.stringify(request));
  });
  const checked = inspectAuthEntry(input, signer);
  if (signed.public_key !== signer || signed.digest !== checked.details.hash || signed.verified !== true)
    throw Error('The CLI returned a different signer or digest.');
  verifyAuthEntrySignature(input, signed.signed_auth_entry_xdr);
  record('cli-auth-result', 'passed', {
    digest: signed.digest,
    signed_auth_entry_xdr: signed.signed_auth_entry_xdr,
  });
  return signed.signed_auth_entry_xdr;
}

async function authorize(prepared: ContractPreparation, method: 'cli' | 'sdk') {
  guard.assertClear();
  validateContractReview(prepared.transaction.toXDR(), signer, prepared.review);
  for (const authorization of prepared.review.authorizations) {
    const input: AuthEntryInput = {
      auth_entry_xdr: authorization.xdr,
      public_key: signer,
      address: authorization.address,
      network_passphrase: Networks.TESTNET,
      adapter: { type: authorization.adapter },
    };
    if (
      xdr.SorobanAuthorizationEntry.fromXDR(authorization.xdr, 'base64').credentials.type !==
      'sorobanCredentialsAddressV2'
    )
      throw Error('Live acceptance requires explicit AddressV2 authorization.');
    record('explicit-auth', 'reviewed', { method, input, stage: prepared.review.stage });
    const signed =
      method === 'cli'
        ? await cliAuth(input)
        : (
            await client!.signAuthorization(authorization.xdr, {
              address: authorization.address,
              adapter: input.adapter,
            })
          ).signedAuthEntryXdr;
    verifyAuthEntrySignature(input, signed);
    authorization.xdr = signed;
    authorization.signed = true;
  }
  if (prepared.review.authorizations.length) {
    prepared.transaction = await assembleAuthorizedContract(
      server,
      prepared.transaction.toXDR(),
      prepared.review,
    );
    prepared.review.authorizationReady = true;
  }
  return prepared;
}

async function negativeControls(prepared: ContractPreparation) {
  const operation = prepared.transaction.operations[0];
  if (operation.type !== 'invokeHostFunction' || operation.func.type !== 'hostFunctionTypeInvokeContract')
    throw Error('The counter operation is missing.');
  const original = xdr.SorobanAuthorizationEntry.fromXDR(prepared.review.authorizations[0].xdr, 'base64');
  const withEntry = (entry: xdr.SorobanAuthorizationEntry, rebound = false) => {
    const fn = operation.func;
    if (fn.type !== 'hostFunctionTypeInvokeContract') throw Error();
    const func = rebound
      ? xdr.HostFunction.hostFunctionTypeInvokeContract(
          new xdr.InvokeContractArgs({
            ...fn.invokeContract,
            args: [fn.invokeContract.args[0], xdr.ScVal.scvU32(2)],
          }),
        )
      : fn;
    return Operation.invokeHostFunction({ func, auth: [entry] });
  };
  const mutatedNonce = new xdr.SorobanAuthorizationEntry({
    rootInvocation: original.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        ...addressCredentials(original),
        nonce: addressCredentials(original).nonce + 1n,
      }),
    ),
  });
  const root = original.rootInvocation.function;
  if (root.type !== 'sorobanAuthorizedFunctionTypeContractFn') throw Error();
  const mutatedCall = new xdr.SorobanAuthorizationEntry({
    credentials: original.credentials,
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      subInvocations: [],
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          ...root.contractFn,
          args: [root.contractFn.args[0], xdr.ScVal.scvU32(2)],
        }),
      ),
    }),
  });
  for (const [name, negative] of [
    ['missing-custom-authorization', Operation.invokeHostFunction({ func: operation.func, auth: [] })],
    ['changed-authorization-nonce', withEntry(mutatedNonce)],
    ['changed-call-and-authorization', withEntry(mutatedCall, true)],
  ] as const) {
    const source = await server.getAccount(signer);
    const transaction = new TransactionBuilder(new Account(signer, source.sequenceNumber()), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(negative)
      .setTimeout(120)
      .build();
    const simulated = await server.simulateTransaction(transaction, undefined, 'enforce');
    if (!rpc.Api.isSimulationError(simulated)) throw Error(`${name}: expected authorization rejection.`);
    record(name, 'passed', { error: simulated.error, submitted: false, signatures_requested: 0 });
  }
}

async function submit(prepared: ContractPreparation) {
  guard.assertClear();
  validateContractReview(prepared.transaction.toXDR(), signer, prepared.review);
  const unsignedHash = hex(prepared.transaction.hash());
  const signed = await client!.signTransaction(prepared.transaction.toXDR());
  const transaction = TransactionBuilder.fromXDR(signed.signedTxXdr, Networks.TESTNET);
  if (
    'innerTransaction' in transaction ||
    hex(transaction.hash()) !== unsignedHash ||
    transaction.signatures.length !== 1 ||
    !Keypair.fromPublicKey(signer).verify(transaction.hash(), transaction.signatures[0].signature.toBytes())
  )
    throw Error('The outer signature failed verification.');
  const result = await guard.send(transaction, `contract-demo-${prepared.review.stage}`);
  const verification = await verifyContractResult(server, signer, prepared.review);
  record(prepared.review.stage, 'passed', {
    hash: result.hash,
    ledger: result.ledger,
    stage: prepared.review.stage,
    review: prepared.review,
    verification,
    signed_envelope_xdr: transaction.toXDR(),
  });
}

try {
  guard.assertClear();
  bridge = await createHost({ production: true });
  const origin = bridge.origin;
  client = new WalletermClient(origin, {
    page: null,
    pollInterval: 100,
    fetch: (url, options) =>
      fetch(url, { ...options, headers: { ...options?.headers, Origin: 'http://127.0.0.1:8788' } }),
  });
  await client.connect({
    code: await bridge.code(),
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
  for (let step = 0; step < 4; step++) {
    let prepared: ContractPreparation;
    try {
      prepared = await prepareContract(
        server,
        signer,
        false,
        async (file) => new Uint8Array(readFileSync(new URL(`../fixtures/wasm/${file}`, import.meta.url))),
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'The contract demo is ready. Select Increment counter.')
        break;
      throw error;
    }
    await submit(await authorize(prepared, 'cli'));
  }
  for (const method of ['cli', 'sdk'] as const) {
    const prepared = await authorize(
      await prepareContract(server, signer, true, async () => {
        throw Error('No upload is expected.');
      }),
      method,
    );
    await negativeControls(prepared);
    await submit(prepared);
  }
  writeFileSync(
    resultFile,
    JSON.stringify(
      { status: 'passed', network: 'testnet', signer, completed_at: new Date().toISOString(), records },
      null,
      2,
    ) + '\n',
  );
} catch (error) {
  record('acceptance', 'blocked', { message: error instanceof Error ? error.message : String(error) });
  writeFileSync(
    resultFile,
    JSON.stringify({ status: 'blocked', network: 'testnet', signer, records }, null, 2) + '\n',
  );
  process.exitCode = 1;
} finally {
  await client?.disconnect().catch(() => {});
  await bridge?.close();
  unlinkSync(lock);
}
