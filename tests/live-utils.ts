import { requestError } from '../sdk/errors.ts';
import * as sdk from '@stellar/stellar-sdk';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createSubmissionGuard } from './submission.ts';
import type { AnyTransaction, Details, KeyName, LiveContext, TestKey } from './types.ts';

const networkPassphrase = sdk.Networks.TESTNET;
// Output of `walleterm sign`. docs/INTERFACE.md defines it.
interface SignResponse {
  ok: boolean;
  public_key: string;
  digest: string;
  signature: string;
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

async function signDigest(key: TestKey, digest: Uint8Array) {
  assertClear();
  if (digest.length !== 32) throw new Error('Expected a 32-byte signing digest');
  const request = { public_key: key.publicKey, digest: Buffer.from(digest).toString('hex') };
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
      if (stdout.length > 8192) child.kill();
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
  const signature = Buffer.from(response.signature, 'hex');
  if (
    response.public_key !== key.publicKey ||
    response.digest !== request.digest ||
    signature.length !== 64 ||
    !sdk.Keypair.fromPublicKey(key.publicKey).verify(digest, signature)
  )
    throw new Error('SDK signature verification failed');
  appendFileSync(
    journal,
    JSON.stringify({ stage: 'verified', timestamp: new Date().toISOString(), ...response }) + '\n',
  );
  return signature;
}

async function sign<T extends AnyTransaction>(tx: T, key: TestKey): Promise<T> {
  assertClear();
  const digest = tx.hash();
  appendFileSync(
    journal,
    JSON.stringify({
      stage: 'envelope_before_signature',
      timestamp: new Date().toISOString(),
      public_key: key.publicKey,
      networkPassphrase,
      envelope_xdr: tx.toXDR(),
      digest: Buffer.from(digest).toString('hex'),
    }) + '\n',
  );
  const signature = await signDigest(key, digest);
  tx.addSignature(key.publicKey, signature.toString('base64'));
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
  signDigest,
  sign,
  send,
  record,
  fund,
  assertClear,
  reconcile,
};
