import { createPublicKey, verify } from 'node:crypto';

const [publicKey, digest, signature] = process.argv.slice(2);
if (
  !/^[0-9a-f]{64}$/.test(publicKey ?? '') ||
  !/^[0-9a-f]{64}$/.test(digest ?? '') ||
  !/^[0-9a-f]{128}$/.test(signature ?? '')
) {
  process.exit(1);
}
const key = createPublicKey({
  key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey, 'hex').toString('base64url') },
  format: 'jwk',
});
process.exit(verify(null, Buffer.from(digest, 'hex'), key, Buffer.from(signature, 'hex')) ? 0 : 1);
