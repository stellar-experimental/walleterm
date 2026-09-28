import { Keypair, MuxedAccount, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { walletermError } from './errors.js';
import type { FeeBumpTransaction, Transaction } from '@stellar/stellar-sdk';

export const MAX_TRANSACTION_XDR = 262144;
// The protocol permits 20 envelope signatures. The selected key adds one.
const MAX_EXISTING_SIGNATURES = 19;
const invalid = (message: string) => walletermError('invalid_request', message);

function envelope(encoded: string, extra = 0) {
  if (typeof encoded !== 'string' || !encoded || encoded.length > MAX_TRANSACTION_XDR + extra)
    throw invalid('The transaction XDR is invalid or too large.');
  let value: xdr.TransactionEnvelope;
  try {
    value = xdr.TransactionEnvelope.fromXDR(encoded, 'base64');
  } catch {
    throw invalid('The transaction XDR is invalid.');
  }
  if (value.toXDR('base64') !== encoded) throw invalid('Use canonical transaction XDR.');
  if (value.type !== 'envelopeTypeTx' && value.type !== 'envelopeTypeTxFeeBump')
    throw invalid('Use a V1 or fee-bump transaction envelope.');
  return value;
}
// A muxed account signs with its base key.
export function baseAccount(address: string) {
  return StrKey.isValidMed25519PublicKey(address)
    ? MuxedAccount.fromAddress(address, '0').baseAccount().accountId()
    : address;
}
const signatureXdr = (value: xdr.TransactionEnvelope) => value.value.signatures.map((s) => s.toXDR('base64'));
const equalBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * Structural checks only: a canonical V1 or fee-bump envelope that needs the selected key.
 * The key must be the transaction source, an operation source, or the fee-bump fee source.
 * Operation types and counts are not filtered. Review of the request decides them.
 */
export function inspectTransactionRequest(
  transactionXdr: string,
  publicKey: string,
  networkPassphrase: string,
) {
  if (!StrKey.isValidEd25519PublicKey(publicKey))
    throw walletermError('address_mismatch', 'Select a valid G-address.');
  if (typeof networkPassphrase !== 'string' || !networkPassphrase.trim() || networkPassphrase.length > 256)
    throw invalid('Provide the exact network passphrase.');
  const value = envelope(transactionXdr);
  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
  } catch {
    throw invalid('The transaction XDR is invalid.');
  }
  const signers =
    'innerTransaction' in tx
      ? [baseAccount(tx.feeSource)]
      : [tx.source, ...tx.operations.flatMap((op) => (op.source ? [op.source] : []))].map(baseAccount);
  if (!signers.includes(publicKey))
    throw walletermError('address_mismatch', 'The selected account does not need to sign this transaction.');
  const hash = tx.hash(),
    signer = Keypair.fromPublicKey(publicKey),
    hint = signer.signatureHint();
  if (value.value.signatures.length > MAX_EXISTING_SIGNATURES)
    throw invalid('The transaction has too many signatures.');
  if (
    value.value.signatures.some(
      (s) => equalBytes(s.hint.toBytes(), hint) && signer.verify(hash, s.signature.toBytes()),
    )
  )
    throw invalid('The selected account already signed this transaction.');
  return {
    tx,
    hash,
    feeBump: 'innerTransaction' in tx,
    body: value.value.tx.toXDR('base64'),
    signatures: signatureXdr(value),
  };
}

/** A result is valid only when it keeps the request and appends one signature from the selected key. */
export function verifyTransactionSignature(
  transactionXdr: string,
  signedTransactionXdr: string,
  publicKey: string,
  networkPassphrase: string,
): true {
  const requested = inspectTransactionRequest(transactionXdr, publicKey, networkPassphrase);
  const signed = envelope(signedTransactionXdr, 256);
  const signatures = signatureXdr(signed);
  if (
    signed.type !== (requested.feeBump ? 'envelopeTypeTxFeeBump' : 'envelopeTypeTx') ||
    signed.value.tx.toXDR('base64') !== requested.body
  )
    throw invalid('The signed transaction differs from the requested transaction.');
  if (
    signatures.length !== requested.signatures.length + 1 ||
    requested.signatures.some((value, i) => signatures[i] !== value)
  )
    throw invalid('The signed transaction must keep its signatures and add one.');
  const signature = signed.value.signatures.at(-1)!,
    signer = Keypair.fromPublicKey(publicKey);
  if (
    !equalBytes(signature.hint.toBytes(), signer.signatureHint()) ||
    !signer.verify(requested.hash, signature.signature.toBytes())
  )
    throw invalid('The transaction signature failed independent verification.');
  return true;
}
