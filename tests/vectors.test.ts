// The browser SDK must agree with the frozen vectors that the Rust host reproduces (tests/vectors.rs).
// SDK modules only. Mock seeds only; nothing here reaches a network.
import { expect, test } from 'bun:test';
import { Keypair } from '@stellar/stellar-sdk';
import { attachAuthSignature, inspectAuthEntry } from '../sdk/authorization.ts';
import { inspectAuthPreimage, verifyPreimageSignature } from '../sdk/preimage.ts';
import { inspectTransactionRequest, verifyTransactionSignature } from '../sdk/transaction.ts';
import vectors from '../fixtures/parity/vectors.json';

interface Case {
  id: string;
  kind: 'auth_entry' | 'preimage' | 'transaction';
  expect: Record<string, unknown> & { error?: { code: string; message: string } };
  [field: string]: unknown;
}
const key = Keypair.fromRawEd25519Seed(Buffer.from(vectors.mock_seed_hex, 'hex'));
const G = vectors.public_key;
const failure = (error: unknown) => {
  const e = error as { code?: unknown; ext?: string[]; message: string };
  const code = Array.isArray(e.ext) ? e.ext[0].replace('walleterm:', '') : String(e.code);
  return { error: { code, message: e.message } };
};
const outcome = (run: () => Record<string, unknown>) => {
  try {
    return run();
  } catch (error) {
    return failure(error);
  }
};
// The v3 bridge adds these admission rules. The Rust host owns them; the SDK checks only structure.
const BRIDGE_ONLY = [
  'Walleterm signs only on Stellar testnet.',
  'The requested account differs from the selected account.',
  'Use time bounds that are valid now and end within five minutes.',
];

test('the vector file keeps its producer and case count', () => {
  expect(vectors.schema).toBe(1);
  expect(vectors.producer.stellar_sdk).toBe('17.1.0');
  expect(key.publicKey()).toBe(G);
  expect(vectors.cases.length).toBeGreaterThanOrEqual(80);
});

for (const c of vectors.cases as Case[]) {
  test(`vector ${c.id}`, () => {
    if (c.kind === 'auth_entry') {
      const input = c.input as never;
      const latest = c.latest_ledger as number;
      const actual = outcome(() => {
        const checked = inspectAuthEntry(input, G, latest);
        const signature = Buffer.from(key.sign(Buffer.from(checked.digest))).toString('hex');
        return {
          digest: checked.details.hash,
          signature,
          signed_auth_entry_xdr: attachAuthSignature(input, G, latest, signature),
        };
      });
      expect(actual).toEqual(c.expect);
    } else if (c.kind === 'preimage') {
      const latest = c.latest_ledger === null ? undefined : (c.latest_ledger as number);
      const actual = outcome(() => {
        const checked = inspectAuthPreimage(
          c.preimage_xdr as string,
          c.public_key as string,
          c.network_passphrase as string,
          latest,
        );
        return { digest: checked.details.hash, address: checked.details.address };
      });
      const { signature, signed_auth_entry, ...rest } = c.expect;
      expect(actual).toEqual(rest);
      if (typeof signed_auth_entry === 'string') {
        const digest = Buffer.from(c.expect.digest as string, 'hex');
        expect(Buffer.from(signed_auth_entry, 'base64').toString('hex')).toBe(signature as string);
        verifyPreimageSignature(digest, c.public_key as string, signed_auth_entry);
      }
    } else {
      const input = c.input as { xdr: string; network_passphrase: string };
      let checked;
      try {
        checked = inspectTransactionRequest(input.xdr, G, input.network_passphrase);
      } catch (error) {
        expect(failure(error) as Record<string, unknown>).toEqual(c.expect);
        return;
      }
      if (c.expect.error) {
        expect(BRIDGE_ONLY).toContain(c.expect.error.message);
        return;
      }
      expect(Buffer.from(checked.hash).toString('hex')).toBe(c.expect.hash as string);
      verifyTransactionSignature(input.xdr, c.expect.signed_tx_xdr as string, G, input.network_passphrase);
    }
  });
}
