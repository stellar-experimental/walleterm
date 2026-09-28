// The browser SDK must agree with the frozen vectors that the Rust host reproduces (tests/vectors.rs).
// SDK modules, node:crypto, and Stellar CLI only: no Rust or Dalek. Mock seeds and the public SEP-53 test key only.
// Nothing here reaches a network.
import { expect, test } from 'bun:test';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { Keypair, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
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
// The last message records the removed five-minute rule. The host now refuses only an expired max_time.
const HOST_ONLY = [
  'Walleterm signs only on Stellar testnet.',
  'The requested account differs from the selected account.',
  'Use time bounds that are valid now and end within five minutes.',
];
// Reviewed change (audit/2026-09-28-sign-design/DESIGN.md, PR A): no request reads a ledger.
// These frozen cases failed a ledger window or value check. They now sign. tests/vectors.rs lists them too.
const NOW_SIGNS = [
  'auth-window-61',
  'auth-window-now',
  'auth-ledger-zero',
  'auth-ledger-fraction',
  'auth-ledger-string',
  'auth-ledger-near-integer',
  'preimage-window-121',
  'preimage-expired',
];

test('the vector file keeps its producer and case count', () => {
  expect(vectors.schema).toBe(1);
  expect(vectors.producer.stellar_sdk).toBe('17.1.0');
  expect(key.publicKey()).toBe(G);
  expect(vectors.cases.length).toBeGreaterThanOrEqual(80);
  const ids = (vectors.cases as Case[]).map((c) => c.id);
  expect(NOW_SIGNS.filter((id) => ids.includes(id))).toEqual(NOW_SIGNS);
});

for (const c of vectors.cases as Case[]) {
  test(`vector ${c.id}`, () => {
    const check = (actual: Record<string, unknown>, expected: Record<string, unknown>) => {
      if (NOW_SIGNS.includes(c.id)) expect(actual.error).toBeUndefined();
      else expect(actual).toEqual(expected);
    };
    if (c.kind === 'auth_entry') {
      const input = c.input as never;
      const actual = outcome(() => {
        const checked = inspectAuthEntry(input, G);
        const signature = Buffer.from(key.sign(Buffer.from(checked.digest))).toString('hex');
        return {
          digest: checked.details.hash,
          signature,
          signed_auth_entry_xdr: attachAuthSignature(input, G, signature),
        };
      });
      check(actual, c.expect);
    } else if (c.kind === 'preimage') {
      const actual = outcome(() => {
        const checked = inspectAuthPreimage(
          c.preimage_xdr as string,
          c.public_key as string,
          c.network_passphrase as string,
        );
        return { digest: checked.details.hash, address: checked.details.address };
      });
      const { signature, signed_auth_entry, ...rest } = c.expect;
      check(actual, rest);
      if (typeof signed_auth_entry === 'string') {
        const digest = Buffer.from(c.expect.digest as string, 'hex');
        expect(Buffer.from(signed_auth_entry, 'base64').toString('hex')).toBe(signature as string);
        verifyPreimageSignature(digest, c.public_key as string, signed_auth_entry);
        // SDK Keypair.sign over SHA-256 of the preimage bytes gives the same signature.
        const bytes = Buffer.from(c.preimage_xdr as string, 'base64');
        const sha = createHash('sha256').update(bytes).digest();
        expect(Buffer.from(key.sign(sha)).toString('hex')).toBe(signature as string);
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
        expect(HOST_ONLY).toContain(c.expect.error.message);
        return;
      }
      expect(Buffer.from(checked.hash).toString('hex')).toBe(c.expect.hash as string);
      verifyTransactionSignature(input.xdr, c.expect.signed_tx_xdr as string, G, input.network_passphrase);
      // SDK tx.sign gives the same signed envelope, for V1 and fee-bump envelopes.
      const tx = TransactionBuilder.fromXDR(input.xdr, input.network_passphrase);
      tx.sign(key);
      expect(tx.toEnvelope().toXDR('base64')).toBe(c.expect.signed_tx_xdr as string);
    }
  });
}

// SEP-53 v1.0.0 test cases. The key is the public SEP-53 test key: a mock key, never funded or used live.
const SEP53_KEY = 'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L';
const SEP53 = [
  {
    message: Buffer.from('Hello, World!'),
    digest: 'd52eb59c06bb510d065997ff93077068eed0a486c20215b5e02e1ab0d2ebea5f',
    signature: 'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==',
  },
  {
    message: Buffer.from('こんにちは、世界！'),
    digest: '7bde4f792e336ed43df42ad66a92b44cb1bc60708e8bee63494c289dee161682',
    signature: 'CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==',
  },
  {
    message: Buffer.from('2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=', 'base64'),
    digest: '460008feac2bccee41de48c2717db5d2e81591f71205dd612c4e8ce7125dea2f',
    signature: 'VA1+7hefNwv2NKScH6n+Sljj15kLAge+M2wE7fzFOf+L0MMbssA1mwfJZRyyrhBORQRle10X1Dxpx+UOI4EbDQ==',
  },
];
const sep53Digest = (message: Buffer) =>
  createHash('sha256')
    .update(Buffer.concat([Buffer.from('Stellar Signed Message:\n'), message]))
    .digest();
const ed25519Key = (address: string) =>
  createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(StrKey.decodeEd25519PublicKey(address)).toString('base64url'),
    },
    format: 'jwk',
  });

for (const [i, v] of SEP53.entries()) {
  test(`SEP-53 vector ${i + 1} verifies with the SDK, node:crypto, and Stellar CLI`, () => {
    const signature = Buffer.from(v.signature, 'base64');
    const digest = sep53Digest(v.message);
    expect(digest.toString('hex')).toBe(v.digest);
    expect(Keypair.fromPublicKey(SEP53_KEY).verifyMessage(v.message, signature)).toBe(true);
    expect(verify(null, digest, ed25519Key(SEP53_KEY), signature)).toBe(true);
    const changed = Buffer.concat([v.message, Buffer.from('!')]);
    expect(Keypair.fromPublicKey(SEP53_KEY).verifyMessage(changed, signature)).toBe(false);
    expect(verify(null, sep53Digest(changed), ed25519Key(SEP53_KEY), signature)).toBe(false);
    // Pass the message as an argument. Standard input loses one trailing newline.
    const text = i === 2 ? ['--base64', v.message.toString('base64')] : [v.message.toString()];
    for (const [message, status] of [
      [text, 0],
      [i === 2 ? ['--base64', changed.toString('base64')] : [changed.toString()], 1],
    ] as const) {
      const run = Bun.spawnSync(
        ['stellar', 'message', 'verify', ...message, '--signature', v.signature, '--public-key', SEP53_KEY],
        { stdout: 'ignore', stderr: 'ignore' },
      );
      expect(run.exitCode).toBe(status);
    }
  });
}

test('a transaction hash sent as message text gets its own SEP-53 digest', () => {
  const hash = 'e73804551639230dc03821cfd5c11b8067d8951bf6ebc1da2326fef62c0cb4df';
  const digest = sep53Digest(Buffer.from(hash)).toString('hex');
  expect(digest).not.toBe(hash);
  expect(digest).toBe('e52151175cbac29a9dc6406729c2a173369ace8c532b361a1ced3f95b843683d');
});
