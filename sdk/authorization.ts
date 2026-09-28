import { Address, Keypair, StrKey, hash, xdr } from '@stellar/stellar-sdk';

/** Schemas pinned to SDK 17.1.0 and the commit below. No delegated signers. */
export const OPENZEPPELIN_AUTH_COMMIT = 'a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640';
export const MAX_AUTH_XDR = 32768;
export type AuthAdapter =
  | { type: 'account' }
  | { type: 'contract-ed25519' }
  | { type: 'openzeppelin-ed25519'; verifier: string; context_rule_ids: number[] };
export interface AuthEntryInput {
  auth_entry_xdr: string;
  network_passphrase: string;
  public_key: string;
  address: string;
  adapter: AuthAdapter;
}
export interface AuthSignOptions {
  address: string;
  adapter?: AuthAdapter;
  networkPassphrase?: string;
  signal?: AbortSignal;
  onProgress?: import('./types.js').SignOptions['onProgress'];
}
const invalid = (message: string): never => {
  throw Object.assign(Error(message), { status: 400, code: 'invalid_input' });
};
// Reads address credentials. V1 stays readable because a transaction can carry signed V1 entries from others.
// No helper here creates, rebuilds, or signs a V1 entry.
export function addressCredentials(entry: xdr.SorobanAuthorizationEntry) {
  if (entry.credentials.type === 'sorobanCredentialsAddress') return entry.credentials.address;
  if (entry.credentials.type === 'sorobanCredentialsAddressV2') return entry.credentials.addressV2;
  return invalid(
    'Use explicit V1 or V2 address credentials. SourceAccount and delegated credentials are not supported.',
  );
}
export function parseAuthEntry(encoded: string) {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > MAX_AUTH_XDR)
    invalid('The authorization XDR is invalid or too large.');
  try {
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(encoded, 'base64');
    if (entry.toXDR('base64') !== encoded) invalid('Use canonical authorization XDR.');
    addressCredentials(entry);
    countAuthContexts(entry.rootInvocation);
    return entry;
  } catch (error) {
    if (error instanceof Error && 'code' in error) throw error;
    return invalid('The authorization XDR is invalid.');
  }
}
export function countAuthContexts(invocation: xdr.SorobanAuthorizedInvocation): number {
  let count = 0;
  const visit = (node: xdr.SorobanAuthorizedInvocation, depth: number) => {
    if (++count > 256 || depth > 32) invalid('The invocation tree exceeds the size or depth limit.');
    for (const child of node.subInvocations) visit(child, depth + 1);
  };
  visit(invocation, 1);
  return count;
}
const V2_REQUIRED =
  'Authorization signing requires address-bound V2 credentials. Legacy V1 permits cross-address replay.';
/** Rebuild an AddressV2 entry with changed credential fields. V1 entries are never rebuilt. */
function credentialsWith(
  entry: xdr.SorobanAuthorizationEntry,
  changes: Partial<xdr.SorobanAddressCredentials>,
) {
  if (entry.credentials.type !== 'sorobanCredentialsAddressV2') return invalid(V2_REQUIRED);
  const credentials = new xdr.SorobanAddressCredentials({ ...entry.credentials.addressV2, ...changes });
  return new xdr.SorobanAuthorizationEntry({
    rootInvocation: entry.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials),
  });
}
function ledger(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff)
    invalid('Use a positive uint32 ledger number.');
}
/** Build a fresh explicit AddressV2 entry. This never converts SourceAccount credentials. */
export function createAuthEntry({
  address,
  invocation,
  nonce,
  expirationLedger,
}: {
  address: string;
  invocation: xdr.SorobanAuthorizedInvocation;
  nonce: bigint;
  expirationLedger: number;
}): string {
  if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address))
    invalid('Use a G-address or C-address.');
  ledger(expirationLedger);
  if (typeof nonce !== 'bigint' || nonce < -(1n << 63n) || nonce >= 1n << 63n) invalid('Use an int64 nonce.');
  countAuthContexts(invocation);
  const credentials = new xdr.SorobanAddressCredentials({
    address: new Address(address).toScAddress(),
    nonce,
    signatureExpirationLedger: expirationLedger,
    signature: xdr.ScVal.scvVoid(),
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials),
  });
  return parseAuthEntry(entry.toXDR('base64')).toXDR('base64');
}
/** Set expiry before review/signing. All other fields remain exact. */
export function setAuthEntryExpiration(encoded: string, expirationLedger: number): string {
  ledger(expirationLedger);
  const entry = parseAuthEntry(encoded);
  if (addressCredentials(entry).signature.type !== 'scvVoid') invalid('Use an unsigned authorization entry.');
  return credentialsWith(entry, { signatureExpirationLedger: expirationLedger }).toXDR('base64');
}
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const symbol = (s: string) => xdr.ScVal.scvSymbol(s);
const bytes = (value: Uint8Array) => xdr.ScVal.scvBytes(value);
const map = (pairs: [xdr.ScVal, xdr.ScVal][]) =>
  xdr.ScVal.scvMap(pairs.map(([key, val]) => new xdr.ScMapEntry({ key, val })));
/** Check one unsigned AddressV2 entry. No check reads a ledger. The network enforces expiry. */
export function inspectAuthEntry(input: AuthEntryInput, selectedPublicKey: string) {
  if (!input || typeof input !== 'object') invalid('Use an authorization request object.');
  if (!StrKey.isValidEd25519PublicKey(selectedPublicKey) || input.public_key !== selectedPublicKey)
    invalid('The requested signer differs from the selected key.');
  if (
    typeof input.network_passphrase !== 'string' ||
    !input.network_passphrase.trim() ||
    input.network_passphrase.length > 256
  )
    invalid('Provide the exact network passphrase.');
  const entry = parseAuthEntry(input.auth_entry_xdr),
    credentials = addressCredentials(entry);
  if (entry.credentials.type !== 'sorobanCredentialsAddressV2') invalid(V2_REQUIRED);
  if (Address.fromScAddress(credentials.address).toString() !== input.address)
    invalid('The authorization address differs from the requested address.');
  if (credentials.signature.type !== 'scvVoid') invalid('Use an unsigned authorization entry.');
  const expiration = credentials.signatureExpirationLedger;
  // Ledger 0 is always in the past. Simulation leaves it at 0 when the caller never set it.
  if (expiration === 0) invalid('Set the authorization expiration ledger. Ledger 0 is always in the past.');
  const adapter = input.adapter;
  if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter))
    invalid('Provide an authorization adapter.');
  const fields =
    adapter.type === 'openzeppelin-ed25519' ? ['type', 'verifier', 'context_rule_ids'] : ['type'];
  if (Object.keys(adapter).some((k) => !fields.includes(k))) invalid('The adapter fields are invalid.');
  if (adapter.type === 'account') {
    if (input.address !== selectedPublicKey)
      invalid('The account authorization must match the selected G-address.');
  } else if (adapter.type === 'contract-ed25519' || adapter.type === 'openzeppelin-ed25519') {
    if (!StrKey.isValidContract(input.address)) invalid('The contract adapter requires a C-address.');
  } else invalid('The authorization adapter is not supported.');
  if (adapter.type === 'openzeppelin-ed25519') {
    if (
      !StrKey.isValidContract(adapter.verifier) ||
      !Array.isArray(adapter.context_rule_ids) ||
      adapter.context_rule_ids.length !== countAuthContexts(entry.rootInvocation) ||
      adapter.context_rule_ids.some((id) => !Number.isInteger(id) || id < 0 || id > 0xffffffff)
    )
      invalid('Provide a verifier C-address and one uint32 rule ID per authorization context.');
  }
  const common = {
    networkId: hash(input.network_passphrase),
    nonce: credentials.nonce,
    signatureExpirationLedger: expiration,
    invocation: entry.rootInvocation,
  };
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
    new xdr.HashIdPreimageSorobanAuthorizationWithAddress({ ...common, address: credentials.address }),
  );
  const payload = hash(preimage.toXdr());
  const ruleIds =
    adapter.type === 'openzeppelin-ed25519'
      ? xdr.ScVal.scvVec(adapter.context_rule_ids.map((id) => xdr.ScVal.scvU32(id)))
      : undefined;
  const digest = ruleIds ? hash(new Uint8Array([...payload, ...ruleIds.toXdr()])) : payload;
  return {
    entry,
    digest,
    details: {
      kind: 'authorization' as const,
      hash: hex(digest),
      address: input.address,
      public_key: selectedPublicKey,
      network_passphrase: input.network_passphrase,
      credential_type: entry.credentials.type,
      nonce: credentials.nonce.toString(),
      expiration_ledger: expiration,
      invocation_xdr: entry.rootInvocation.toXDR('base64'),
      adapter: structuredClone(adapter),
      sequence: undefined,
    },
    ruleIds,
  };
}
/** Verify raw Ed25519 independently, then change only the signature ScVal. */
export function attachAuthSignature(input: AuthEntryInput, publicKey: string, signature: string): string {
  const checked = inspectAuthEntry(input, publicKey);
  if (typeof signature !== 'string' || !/^[a-f0-9]{128}$/.test(signature))
    invalid('The signer returned an invalid signature.');
  const raw = Uint8Array.from(signature.match(/../g)!, (h) => parseInt(h, 16));
  if (!Keypair.fromPublicKey(publicKey).verify(checked.digest, raw))
    invalid('The signature failed independent verification.');
  const key = bytes(StrKey.decodeEd25519PublicKey(publicKey));
  let value: xdr.ScVal = bytes(raw);
  if (input.adapter.type === 'account')
    value = xdr.ScVal.scvVec([
      map([
        [symbol('public_key'), key],
        [symbol('signature'), value],
      ]),
    ]);
  if (input.adapter.type === 'openzeppelin-ed25519')
    value = map([
      [symbol('context_rule_ids'), checked.ruleIds!],
      [
        symbol('signers'),
        map([
          [xdr.ScVal.scvVec([symbol('External'), new Address(input.adapter.verifier).toScVal(), key]), value],
        ]),
      ],
    ]);
  return credentialsWith(checked.entry, { signature: value }).toXDR('base64');
}

/** Verify the complete returned artifact against the reviewed unsigned request. */
export function verifyAuthEntrySignature(input: AuthEntryInput, signedAuthEntryXdr: string): true {
  const signed = parseAuthEntry(signedAuthEntryXdr);
  const value = addressCredentials(signed).signature;
  const asBytes = (v: xdr.ScVal) => {
    if (v.type !== 'scvBytes') return invalid('The signed authorization schema is invalid.');
    return v.bytes.toBytes();
  };
  const asMap = (v: xdr.ScVal) => {
    if (v.type !== 'scvMap' || !v.map) return invalid('The signed authorization schema is invalid.');
    return v.map;
  };
  let raw: Uint8Array;
  try {
    if (input.adapter.type === 'contract-ed25519') raw = asBytes(value);
    else if (input.adapter.type === 'account') {
      if (value.type !== 'scvVec' || !value.vec)
        return invalid('The signed authorization schema is invalid.');
      raw = asBytes(asMap(value.vec[0])[1].val);
    } else raw = asBytes(asMap(asMap(value)[1].val)[0].val);
  } catch {
    return invalid('The signed authorization schema is invalid.');
  }
  if (attachAuthSignature(input, input.public_key, hex(raw)) !== signedAuthEntryXdr)
    invalid('The signed authorization differs from the reviewed request.');
  return true;
}
