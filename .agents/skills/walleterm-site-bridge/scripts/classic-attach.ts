// Attach one verified Walleterm signature to a reviewed V1 envelope.
// Stellar CLI decodes, encodes, and hashes the XDR. node:crypto verifies the signature independently of the signer.
import { spawnSync } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual, parseArgs } from 'node:util';

const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const MAX_XDR = 1_500_000;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Envelope = { tx: { tx: Json; signatures: { hint?: string; signature?: string }[] } };

class Refusal extends Error {}

function stellar(args: string[], input?: string): string {
  const result = spawnSync('stellar', args, { input, encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) {
    throw new Refusal(`stellar ${args.slice(0, 2).join(' ')} failed: ${(result.stderr ?? '').trim()}`);
  }
  return result.stdout.trim();
}

// Stellar CLI prints 64-bit values as strings. Refuse any number that JavaScript cannot hold exactly.
function parse(text: string): Json {
  const value = JSON.parse(text) as Json;
  const check = (item: Json): void => {
    if (typeof item === 'number' && !Number.isSafeInteger(item)) {
      throw new Refusal('Stellar CLI returned a number that cannot be kept exactly.');
    }
    if (item && typeof item === 'object') Object.values(item).forEach(check);
  };
  check(value);
  return value;
}

function envelope(text: string): Envelope {
  const value = parse(stellar(['tx', 'decode'], text + '\n')) as { tx?: { tx?: Json; signatures?: Json } };
  const tx = value?.tx;
  if (!tx || typeof tx !== 'object' || !tx.tx || typeof tx.tx !== 'object' || Array.isArray(tx.tx)) {
    throw new Refusal('Use this helper only for a V1 transaction envelope.');
  }
  if (!Array.isArray(tx.signatures)) throw new Refusal('The V1 signature list is missing.');
  return value as Envelope;
}

function digest(text: string, passphrase: string): string {
  const value = stellar(['tx', 'hash', '--network-passphrase', passphrase], text + '\n');
  if (!HEX_32.test(value)) throw new Refusal('Stellar CLI returned an invalid transaction hash.');
  return value;
}

function verified(publicKeyHex: string, digestHex: string, signatureHex: string): boolean {
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKeyHex, 'hex').toString('base64url') },
    format: 'jwk',
  });
  return verify(null, Buffer.from(digestHex, 'hex'), key, Buffer.from(signatureHex, 'hex'));
}

function main(): void {
  const { values } = parseArgs({
    options: {
      unsigned: { type: 'string' },
      signature: { type: 'string' },
      'expected-public-key': { type: 'string' },
      'network-passphrase': { type: 'string' },
      'expected-hash': { type: 'string' },
      output: { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const unsignedPath = values.unsigned;
  const signaturePath = values.signature;
  const expectedKey = values['expected-public-key'];
  const passphrase = values['network-passphrase'];
  const expectedHash = values['expected-hash'];
  const output = values.output;
  if (!unsignedPath || !signaturePath || !expectedKey || !passphrase || !expectedHash || !output) {
    throw new Refusal(
      'Use --unsigned, --signature, --expected-public-key, --network-passphrase, --expected-hash, and --output.',
    );
  }

  if (!HEX_32.test(expectedHash)) {
    throw new Refusal('The expected hash must contain 64 lowercase hexadecimal characters.');
  }
  if (!/^G[A-Z2-7]{55}$/.test(expectedKey)) {
    throw new Refusal('Use the selected full G-address as the expected public key.');
  }
  if (resolve(output) === resolve(unsignedPath) || lstatSync(output, { throwIfNoEntry: false })) {
    throw new Refusal('Use a new output path. Never overwrite the unsigned XDR.');
  }
  const unsigned = readFileSync(unsignedPath, 'utf8').trim();
  if (unsigned.length > MAX_XDR) throw new Refusal('The XDR is too large.');
  if (unsigned.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(unsigned)) {
    throw new Refusal('The unsigned XDR is not canonical Base64.');
  }
  const result = JSON.parse(readFileSync(signaturePath, 'utf8')) as Record<string, unknown>;
  if (
    result.ok !== true ||
    result.verified !== true ||
    result.digest !== expectedHash ||
    result.public_key !== expectedKey ||
    typeof result.signature !== 'string' ||
    !HEX_64.test(result.signature)
  ) {
    throw new Refusal('The Walleterm result does not match the reviewed hash.');
  }
  const signature = result.signature;
  if (digest(unsigned, passphrase) !== expectedHash) throw new Refusal('The unsigned XDR hash changed.');

  const rawKey = parse(stellar(['strkey', 'decode', expectedKey])) as { public_key_ed25519?: unknown };
  const publicKeyHex = rawKey?.public_key_ed25519;
  if (typeof publicKeyHex !== 'string' || !HEX_32.test(publicKeyHex)) {
    throw new Refusal('The signer is not a canonical Ed25519 G-address.');
  }
  if (!verified(publicKeyHex, expectedHash, signature)) {
    throw new Refusal('The signature does not verify for the expected key and hash.');
  }

  const document = envelope(unsigned);
  const body = structuredClone(document.tx.tx);
  const signatures = document.tx.signatures;
  const original = structuredClone(signatures);
  if (signatures.length >= 20) throw new Refusal('The envelope already has 20 signatures.');
  if (signatures.some((item) => item?.signature === signature)) {
    throw new Refusal('The envelope already has this signature.');
  }
  const added = { hint: publicKeyHex.slice(-8), signature };
  signatures.push(added);
  const signed = stellar(['tx', 'encode'], JSON.stringify(document) + '\n');
  if (signed.length > MAX_XDR) throw new Refusal('The signed XDR is too large.');
  const check = envelope(signed).tx;
  if (!isDeepStrictEqual(check.tx, body) || !isDeepStrictEqual(check.signatures, [...original, added])) {
    throw new Refusal('Encoding changed the transaction body or signatures.');
  }
  if (digest(signed, passphrase) !== expectedHash) throw new Refusal('The signed XDR hash changed.');

  // Create the output exclusively. A file that appears after the check above still stops the write.
  const descriptor = openSync(output, 'wx', 0o600);
  try {
    writeSync(descriptor, signed + '\n');
    fsyncSync(descriptor);
  } catch (error) {
    unlinkSync(output);
    throw error;
  } finally {
    closeSync(descriptor);
  }
  console.log(
    JSON.stringify({
      ok: true,
      hash: expectedHash,
      public_key: expectedKey,
      signature_count: signatures.length,
      output,
    }),
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
