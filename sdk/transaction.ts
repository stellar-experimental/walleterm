import { Keypair, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

const MAX_TRANSACTION_XDR = 262144;
function envelope(encoded: string, signed: boolean) {
  if (typeof encoded !== 'string' || !encoded || encoded.length > MAX_TRANSACTION_XDR + (signed ? 256 : 0))
    throw Error('The transaction XDR is invalid or too large.');
  const value = xdr.TransactionEnvelope.fromXDR(encoded, 'base64');
  if (value.type !== 'envelopeTypeTx' || value.toXDR('base64') !== encoded)
    throw Error('Use canonical v1 transaction XDR.');
  if (value.value.signatures.length !== (signed ? 1 : 0))
    throw Error(
      signed ? 'The returned transaction must contain one signature.' : 'Use an unsigned transaction.',
    );
  return value;
}

/** Capture the exact requested transaction before any asynchronous bridge work. */
export function inspectTransactionRequest(
  transactionXdr: string,
  publicKey: string,
  networkPassphrase: string,
) {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) throw Error('Select a valid G-address.');
  if (typeof networkPassphrase !== 'string' || !networkPassphrase.trim() || networkPassphrase.length > 256)
    throw Error('Provide the exact network passphrase.');
  const unsigned = envelope(transactionXdr, false);
  const tx = TransactionBuilder.fromXDR(transactionXdr, networkPassphrase);
  if ('innerTransaction' in tx || tx.source !== publicKey)
    throw Error('The transaction source differs from the selected account.');
  return { body: unsigned.value.tx.toXDR('base64'), hash: tx.hash() };
}

/** A signature is valid only for the exact body, selected key, and requested network. */
export function verifyTransactionSignature(
  transactionXdr: string,
  signedTransactionXdr: string,
  publicKey: string,
  networkPassphrase: string,
): true {
  const requested = inspectTransactionRequest(transactionXdr, publicKey, networkPassphrase);
  const signed = envelope(signedTransactionXdr, true);
  if (signed.value.tx.toXDR('base64') !== requested.body)
    throw Error('The signed transaction differs from the requested transaction.');
  const tx = TransactionBuilder.fromXDR(signedTransactionXdr, networkPassphrase);
  const signer = Keypair.fromPublicKey(publicKey),
    signature = signed.value.signatures[0];
  const returnedHash = tx.hash(),
    hint = signature.hint.toBytes();
  if (
    !requested.hash.every((byte, i) => returnedHash[i] === byte) ||
    !signer.signatureHint().every((byte, i) => hint[i] === byte) ||
    !signer.verify(requested.hash, signature.signature.toBytes())
  )
    throw Error('The transaction signature failed independent verification.');
  return true;
}
