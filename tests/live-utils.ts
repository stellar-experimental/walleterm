import { requestError } from '../sdk/errors.ts';
import * as sdk from '@stellar/stellar-sdk';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createSubmissionGuard } from './submission.ts';
import type { AuthAdapter } from '../sdk/authorization.ts';
import type { AnyTransaction, Details, KeyName, LiveContext, TestKey } from './types.ts';

const networkPassphrase = sdk.Networks.TESTNET;
// Output of `walleterm sign`. docs/INTERFACE.md defines it.
interface SignResponse {
  ok: boolean;
  public_key: string;
  digest: string;
  signature: string;
  signed_transaction_xdr?: string;
  signed_auth_entry_xdr?: string;
  verified?: boolean;
}
const rpc = new sdk.rpc.Server('https://soroban-testnet.stellar.org');
const horizon = new sdk.Horizon.Server('https://horizon-testnet.stellar.org');
// Public signer metadata only. The file holds no private key fields.
interface KeyMetadata {
  name: string;
  ssh_public_key: string;
  raw_public_key_hex: string;
  fingerprint: string;
}
const metadata: { keys: KeyMetadata[] } = JSON.parse(
  readFileSync(new URL('../evidence/public-test-keys.json', import.meta.url), 'utf8'),
);
if (metadata.keys.length !== 3)
  throw new Error('The live suite requires exactly three dedicated public test keys');
const liveKey = (key: KeyMetadata) => {
  const rawPublicKey = Buffer.from(key.raw_public_key_hex, 'hex');
  return { ...key, rawPublicKey, publicKey: sdk.StrKey.encodeEd25519PublicKey(rawPublicKey) };
};
const [keyA, keyB, keyC] = metadata.keys.map(liveKey);
if (!keyA || !keyB || !keyC)
  throw new Error('The live suite requires exactly three dedicated public test keys');
const keys: Record<KeyName, TestKey> = { a: keyA, b: keyB, c: keyC };
mkdirSync(new URL('../evidence/live/', import.meta.url), { recursive: true });
const resultFile = new URL(`../evidence/live/results-${process.argv[2] ?? 'classic'}.json`, import.meta.url);
const results: Details[] = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : [];
const journal = new URL('../evidence/live/signatures.jsonl', import.meta.url);

function record(id: string, status: string, details: Details = {}) {
  const row = { id, status, timestamp: new Date().toISOString(), ...details };
  results.push(row);
  writeFileSync(resultFile, JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(row));
  return row;
}

/** One `walleterm sign` call. Walleterm computes the digest; this checks the signature independently. */
async function walletermSign(key: TestKey, request: Record<string, unknown>) {
  assertClear();
  appendFileSync(
    journal,
    JSON.stringify({ stage: 'requested', timestamp: new Date().toISOString(), ...request }) + '\n',
  );
  const response = await new Promise<SignResponse>((resolve, reject) => {
    const child = spawn(new URL('../bin/walleterm', import.meta.url).pathname, ['sign'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let stdout = '';
    child.stdout.on('data', (data) => {
      stdout += data;
      if (stdout.length > 1 << 20) child.kill();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const value: SignResponse = JSON.parse(stdout);
        if (code || !value.ok) throw new Error(JSON.stringify(value));
        resolve(value);
      } catch (error) {
        reject(requestError(error));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
  const digest = Buffer.from(response.digest, 'hex');
  const signature = Buffer.from(response.signature, 'hex');
  if (
    response.public_key !== key.publicKey ||
    digest.length !== 32 ||
    signature.length !== 64 ||
    !sdk.Keypair.fromPublicKey(key.publicKey).verify(digest, signature)
  )
    throw new Error('SDK signature verification failed');
  appendFileSync(
    journal,
    JSON.stringify({ stage: 'verified', timestamp: new Date().toISOString(), ...response }) + '\n',
  );
  return { response, digest, signature };
}

/** The address-bound preimage and the passphrase of its network ID. The live suites use only the SDK networks. */
function addressPreimage(preimage: sdk.xdr.HashIdPreimage) {
  if (preimage.type !== 'envelopeTypeSorobanAuthorizationWithAddress')
    throw new Error('Walleterm signs only address-bound (CAP-71) preimages');
  const value = preimage.sorobanAuthorizationWithAddress;
  const id = Buffer.from(value.networkId.toXDR());
  const network = Object.values(sdk.Networks).find((p) => Buffer.from(sdk.hash(Buffer.from(p))).equals(id));
  if (!network) throw new Error('The preimage names an unknown network');
  return { network, value };
}

/** The preimage shape: walleterm signs SHA-256 of the exact preimage. */
async function signPreimage(key: TestKey, preimage: sdk.xdr.HashIdPreimage) {
  const preimageXdr = preimage.toXDR('base64');
  const { network } = addressPreimage(preimage);
  const request = { public_key: key.publicKey, network_passphrase: network, preimage_xdr: preimageXdr };
  const { digest, signature } = await walletermSign(key, request);
  if (!digest.equals(sdk.hash(Buffer.from(preimageXdr, 'base64'))))
    throw new Error('The preimage digest differs');
  return signature;
}

/** The entry shape for the unsigned AddressV2 entry that the preimage describes. Returns the adapter digest. */
async function signEntry(key: TestKey, preimage: sdk.xdr.HashIdPreimage, adapter: AuthAdapter) {
  const { network, value } = addressPreimage(preimage);
  const entry = new sdk.xdr.SorobanAuthorizationEntry({
    credentials: sdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new sdk.xdr.SorobanAddressCredentials({
        address: value.address,
        nonce: value.nonce,
        signatureExpirationLedger: value.signatureExpirationLedger,
        signature: sdk.xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: value.invocation,
  });
  const request = {
    public_key: key.publicKey,
    network_passphrase: network,
    auth_entry_xdr: entry.toXDR('base64'),
    address: sdk.Address.fromScAddress(value.address).toString(),
    adapter,
  };
  const { digest, signature } = await walletermSign(key, request);
  return { digest, signature };
}

/** The transaction shape. The result keeps the envelope and appends one signature from `key`. */
async function sign<T extends AnyTransaction>(tx: T, key: TestKey): Promise<T> {
  assertClear();
  const digest = tx.hash();
  appendFileSync(
    journal,
    JSON.stringify({
      stage: 'envelope_before_signature',
      timestamp: new Date().toISOString(),
      public_key: key.publicKey,
      networkPassphrase: tx.networkPassphrase,
      envelope_xdr: tx.toXDR(),
      digest: Buffer.from(digest).toString('hex'),
    }) + '\n',
  );
  const request = {
    public_key: key.publicKey,
    network_passphrase: tx.networkPassphrase,
    transaction_xdr: tx.toXDR(),
  };
  const { response, signature } = await walletermSign(key, request);
  if (!Buffer.from(response.digest, 'hex').equals(Buffer.from(digest)))
    throw new Error('The transaction digest differs');
  tx.addSignature(key.publicKey, signature.toString('base64'));
  if (tx.toXDR() !== response.signed_transaction_xdr)
    throw new Error('The signed transaction differs from the reviewed envelope');
  return tx;
}

const { send, assertClear, reconcile } = createSubmissionGuard({
  rpc,
  directory: new URL('../evidence/live/', import.meta.url),
  record,
  networkPassphrase,
});

async function fund(key: TestKey) {
  assertClear();
  try {
    await rpc.getAccount(key.publicKey);
    return;
  } catch (eValue) {
    const e = requestError(eValue);
    if (!String(e).includes('not found')) throw e;
  }
  const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(key.publicKey)}`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Friendbot failed: ${response.status}`);
  await response.json();
}

export const ctx: LiveContext = {
  sdk,
  networkPassphrase,
  rpc,
  horizon,
  keys,
  signPreimage,
  signEntry,
  sign,
  send,
  record,
  fund,
  assertClear,
  reconcile,
};
