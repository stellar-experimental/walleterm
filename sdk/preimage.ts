import { Address, Keypair, StrKey, hash, xdr } from '@stellar/stellar-sdk';
import { countAuthContexts } from './authorization.js';
import { walletermError } from './errors.js';

/** SEP-43 `signAuthEntry` input: a CAP-71 address-bound authorization preimage. */
export const MAX_PREIMAGE_XDR = 32768;
// The SDK contract client defaults to the latest ledger plus 100. Keep slack for RPC differences.
export const MAX_PREIMAGE_LEDGER_WINDOW = 120;
const invalid = (message: string) => walletermError('invalid_request', message);
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const equalBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Validate one preimage and compute the digest that the key signs.
 * Without `latestLedger`, only the structure is checked. The bridge supplies a trusted ledger.
 */
export function inspectAuthPreimage(
  preimageXdr: string,
  publicKey: string,
  networkPassphrase: string,
  latestLedger?: number,
) {
  if (!StrKey.isValidEd25519PublicKey(publicKey))
    throw walletermError('address_mismatch', 'Select a valid G-address.');
  if (typeof preimageXdr !== 'string' || !preimageXdr || preimageXdr.length > MAX_PREIMAGE_XDR)
    throw invalid('The authorization preimage is invalid or too large.');
  let preimage: xdr.HashIdPreimage;
  try {
    preimage = xdr.HashIdPreimage.fromXDR(preimageXdr, 'base64');
  } catch {
    throw invalid('Use Base64 HashIdPreimage XDR from buildAuthorizationEntryPreimage.');
  }
  if (preimage.toXDR('base64') !== preimageXdr) throw invalid('Use canonical authorization preimage XDR.');
  if (preimage.type === 'envelopeTypeSorobanAuthorization')
    throw walletermError(
      'unsupported',
      'Use an address-bound (CAP-71) preimage. The legacy preimage permits cross-address replay.',
    );
  if (preimage.type !== 'envelopeTypeSorobanAuthorizationWithAddress')
    throw invalid('The preimage is not a Soroban authorization preimage.');
  const value = preimage.sorobanAuthorizationWithAddress;
  if (
    typeof networkPassphrase !== 'string' ||
    !equalBytes(value.networkId.toXDR(), hash(new TextEncoder().encode(networkPassphrase)))
  )
    throw walletermError('network_unsupported', 'The authorization is for a different network.');
  const address = Address.fromScAddress(value.address).toString();
  if (address !== publicKey && !StrKey.isValidContract(address))
    throw walletermError(
      'address_mismatch',
      'The authorization address must be the selected G-address or a C-address.',
    );
  countAuthContexts(value.invocation);
  const expiration = value.signatureExpirationLedger;
  if (
    latestLedger !== undefined &&
    (expiration <= latestLedger || expiration > latestLedger + MAX_PREIMAGE_LEDGER_WINDOW)
  )
    throw invalid(`The authorization must expire within the next ${MAX_PREIMAGE_LEDGER_WINDOW} ledgers.`);
  const digest = hash(Uint8Array.from(atob(preimageXdr), (c) => c.charCodeAt(0)));
  return {
    digest,
    details: {
      kind: 'auth_entry' as const,
      hash: hex(digest),
      address,
      public_key: publicKey,
      network_passphrase: networkPassphrase,
      nonce: value.nonce.toString(),
      expiration_ledger: expiration,
      invocation_xdr: value.invocation.toXDR('base64'),
      preimage_xdr: preimageXdr,
    },
  };
}

/** Decode one canonical Base64 Ed25519 signature and verify it against the preimage digest. */
export function verifyPreimageSignature(
  digest: Uint8Array,
  publicKey: string,
  signature: string,
): Uint8Array {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature))
    throw invalid('The authorization signature is not canonical Base64.');
  const raw = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));
  if (base64(raw) !== signature) throw invalid('The authorization signature is not canonical Base64.');
  if (!Keypair.fromPublicKey(publicKey).verify(digest, raw))
    throw invalid('The authorization signature failed independent verification.');
  return raw;
}
