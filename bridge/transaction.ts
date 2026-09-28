import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { walletermError } from '../sdk/errors.ts';
import { inspectTransactionRequest } from '../sdk/transaction.ts';
import type { TransactionInput } from '../sdk/types.ts';

// The bridge filters no operations. A review of each request decides its content.
// These checks bind the network, the envelope, the signer, and the signature lifetime.
export function inspectTransaction(input: TransactionInput, publicKey: string, now = Date.now()) {
  if (input.network_passphrase !== Networks.TESTNET)
    throw walletermError('network_unsupported', 'Walleterm signs only on Stellar testnet.');
  if (input.address !== publicKey)
    throw walletermError('address_mismatch', 'The requested account differs from the selected account.');
  const { tx, feeBump, signatures } = inspectTransactionRequest(input.xdr, publicKey, Networks.TESTNET);
  const inner = 'innerTransaction' in tx ? tx.innerTransaction : tx;
  // Bounded lifetime limits how long a returned signature stays usable. It inspects no operation.
  const min = Number(inner.timeBounds?.minTime),
    max = Number(inner.timeBounds?.maxTime);
  if (
    !inner.timeBounds ||
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min > now / 1000 ||
    max * 1000 <= now ||
    max * 1000 > now + 300000
  )
    throw walletermError(
      'invalid_request',
      'Use time bounds that are valid now and end within five minutes.',
    );
  const details = {
    kind: 'transaction' as const,
    network: 'TESTNET',
    envelope_type: feeBump ? 'fee_bump' : 'transaction',
    source: inner.source,
    ...(feeBump && 'feeSource' in tx ? { fee_source: tx.feeSource, fee_bump_fee_stroops: tx.fee } : {}),
    fee_stroops: inner.fee,
    sequence: inner.sequence,
    min_time: inner.timeBounds!.minTime,
    max_time: inner.timeBounds!.maxTime,
    operations: inner.operations.map((op) => ({ type: op.type, source: op.source ?? inner.source })),
    existing_signatures: signatures.length,
    transaction_xdr: input.xdr,
    hash: Buffer.from(tx.hash()).toString('hex'),
  };
  return { tx, details, expires: max * 1000 };
}

export function attachSignature(input: TransactionInput, publicKey: string, signature: string) {
  const tx = TransactionBuilder.fromXDR(input.xdr, Networks.TESTNET);
  if (
    !/^[a-f0-9]{128}$/.test(signature) ||
    !Keypair.fromPublicKey(publicKey).verify(tx.hash(), Buffer.from(signature, 'hex'))
  ) {
    throw Error('The signing response failed independent signature verification.');
  }
  tx.addSignature(publicKey, Buffer.from(signature, 'hex').toString('base64'));
  return tx.toXDR();
}
