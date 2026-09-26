import { Keypair, Networks, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

function reject(message: string): never {
  throw Object.assign(Error(message), { status: 400 });
}
import type { Asset, Transaction } from '@stellar/stellar-sdk';
import type { SigningInput } from '../sdk/types.ts';

const asset = (value: Asset) =>
  value.isNative() ? { code: 'XLM' } : { code: value.code, issuer: value.issuer };
export function inspectTransaction(input: SigningInput, publicKey: string, now = Date.now()) {
  if (input.network_passphrase !== Networks.TESTNET) reject('Only Stellar testnet is supported.');
  if (input.public_key !== publicKey || !StrKey.isValidEd25519PublicKey(publicKey))
    reject('The requested account differs from the selected account.');
  if (typeof input.transaction_xdr !== 'string' || input.transaction_xdr.length > 32768)
    reject('The transaction XDR is invalid or too large.');
  let envelope: xdr.TransactionEnvelope;
  let tx: Transaction;
  try {
    envelope = xdr.TransactionEnvelope.fromXDR(input.transaction_xdr, 'base64');
    const parsed = TransactionBuilder.fromXDR(input.transaction_xdr, Networks.TESTNET);
    if ('innerTransaction' in parsed) reject('Use a classic v1 transaction.');
    tx = parsed;
  } catch {
    reject('The transaction XDR is invalid.');
  }
  if (
    envelope.type !== 'envelopeTypeTx' ||
    envelope.value.tx.ext.type !== 'v0' ||
    envelope.value.tx.cond.type !== 'precondTime'
  ) {
    reject('Use a classic v1 transaction with only time preconditions.');
  }
  if (tx.toXDR() !== input.transaction_xdr) reject('Use canonical transaction XDR.');
  if (tx.source !== publicKey || tx.signatures.length || tx.operations.length !== 1)
    reject('Use one unsigned operation from the selected account.');
  if (BigInt(tx.fee) < 100n || BigInt(tx.fee) > 100000n)
    reject('The fee must be between 100 and 100000 stroops.');
  if (!tx.timeBounds) reject('Use transaction time bounds.');
  const min = Number(tx.timeBounds.minTime),
    max = Number(tx.timeBounds.maxTime);
  if (
    !Number.isSafeInteger(min) ||
    !Number.isSafeInteger(max) ||
    min > now / 1000 ||
    max * 1000 <= now ||
    max * 1000 > now + 300000
  ) {
    reject('Use a transaction that expires within five minutes and is valid now.');
  }
  if (BigInt(tx.sequence) <= 0n) reject('The transaction sequence must be positive.');
  const op = tx.operations[0];
  if (op.source && op.source !== publicKey) reject('The operation source differs from the selected account.');
  let operation;
  if (op.type === 'payment') {
    if (!op.asset.isNative() || !StrKey.isValidEd25519PublicKey(op.destination) || Number(op.amount) <= 0)
      reject('Use a native payment to a G-address.');
    operation = { type: op.type, destination: op.destination, amount: op.amount, asset: 'XLM' };
  } else if (op.type === 'manageData') {
    const body = envelope.value.tx.operations[0].body;
    if (body.type !== 'manageData') reject('The operation type is invalid.');
    const rawName = body.value.dataName;
    try {
      rawName.toStringStrict();
    } catch {
      reject('Use a valid UTF-8 data name.');
    }
    operation = {
      type: op.type,
      name: op.name,
      name_hex: Buffer.from(rawName.bytes).toString('hex'),
      value_hex: op.value == null ? null : Buffer.from(op.value).toString('hex'),
      effect: op.value == null ? 'Delete this data entry' : 'Set this data entry',
    };
  } else if (op.type === 'manageSellOffer') {
    const body = envelope.value.tx.operations[0].body;
    if (body.type !== 'manageSellOffer') reject('The operation type is invalid.');
    const raw = body.value;
    if (Number(op.amount) < 0 || raw.price.n <= 0 || raw.price.d <= 0 || BigInt(op.offerId) < 0n)
      reject('The offer amount, price, or ID is invalid.');
    operation = {
      type: op.type,
      selling: asset(op.selling),
      buying: asset(op.buying),
      amount: op.amount,
      price_numerator: raw.price.n,
      price_denominator: raw.price.d,
      price_units: 'buying units per selling unit',
      offer_id: op.offerId,
      effect:
        Number(op.amount) === 0 ? 'Cancel this offer' : 'Create or update an offer; it can trade immediately',
    };
  } else reject('The bridge does not support this operation.');
  const memo = tx.memo;
  const memoValue = memo.value;
  const details = {
    network: 'TESTNET',
    source: tx.source,
    operation_source: op.source || tx.source,
    fee_stroops: tx.fee,
    sequence: tx.sequence,
    min_time: tx.timeBounds.minTime,
    max_time: tx.timeBounds.maxTime,
    memo: {
      type: memo.type,
      value:
        memoValue == null
          ? null
          : memo.type === 'text'
            ? Buffer.from(memoValue).toString('utf8')
            : typeof memoValue === 'string'
              ? memoValue
              : Buffer.from(memoValue).toString('hex'),
      ...(memo.type === 'text' ? { hex: Buffer.from(memoValue ?? '').toString('hex') } : {}),
    },
    operation,
    hash: Buffer.from(tx.hash()).toString('hex'),
  };
  return { tx, details, expires: max * 1000 };
}

export function attachSignature(input: SigningInput, publicKey: string, signature: string) {
  const tx = TransactionBuilder.fromXDR(input.transaction_xdr, Networks.TESTNET);
  if (
    !/^[a-f0-9]{128}$/.test(signature) ||
    !Keypair.fromPublicKey(publicKey).verify(tx.hash(), Buffer.from(signature, 'hex'))
  ) {
    throw Error('The signing response failed independent signature verification.');
  }
  tx.addSignature(publicKey, Buffer.from(signature, 'hex').toString('base64'));
  return tx.toXDR();
}
