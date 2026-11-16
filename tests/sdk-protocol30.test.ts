// Protocol 30 (CAP-0084): the browser SDK reads a muxed contract (W) argument as the Rust core does.
// The bytes and digests come from tests/support/muxed-contract.json, which tests/cli.rs pins against the Rust core.
import { expect, test } from 'bun:test';
import { Address, Networks, Operation, StrKey, scValToNative, xdr } from '@stellar/stellar-sdk';
import { inspectAuthPreimage } from '../sdk/preimage.ts';
import { inspectTransactionRequest } from '../sdk/transaction.ts';
import pinned from './support/muxed-contract.json';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

test('the SDK reads the SEP-23 muxed contract address', () => {
  expect(StrKey.isValidMuxedContract(pinned.muxed_contract)).toBe(true);
  expect(new Address(pinned.muxed_contract).toString()).toBe(pinned.muxed_contract);
});

test('a W argument gives the same transaction digest and text as the Rust core', () => {
  for (const [network, digest] of [
    [Networks.TESTNET, pinned.testnet_digest],
    [Networks.PUBLIC, pinned.mainnet_digest],
  ]) {
    const checked = inspectTransactionRequest(pinned.transaction_xdr, pinned.public_key, network);
    expect(hex(checked.hash)).toBe(digest);
    const op = checked.tx.operations[0] as Operation.InvokeHostFunction;
    if (op.func.type !== 'hostFunctionTypeInvokeContract') throw new Error('a contract call');
    const args = op.func.invokeContract.args.map((v: xdr.ScVal) => scValToNative(v));
    expect(args[1]).toBe(pinned.muxed_contract);
  }
});

test('a W argument gives the same preimage digest as the Rust core', () => {
  const checked = inspectAuthPreimage(pinned.preimage_xdr, pinned.public_key, Networks.TESTNET);
  expect(checked.details.hash).toBe(pinned.preimage_digest);
  expect(checked.details.address).toBe(pinned.public_key);
});
