import { expect, test } from 'bun:test';
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { inspectTransaction, attachSignature } from './transaction.ts';
import {
  createAuthEntry,
  parseAuthEntry,
  inspectAuthEntry,
  attachAuthSignature,
} from '../sdk/authorization.ts';
const key = Keypair.random();
const contract = StrKey.encodeContract(new Uint8Array(32).fill(31));
const args = new xdr.InvokeContractArgs({
  contractAddress: new Address(contract).toScAddress(),
  functionName: 'hello',
  args: [],
});
const invocation = new xdr.SorobanAuthorizedInvocation({
  function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
  subInvocations: [],
});
function input(operation: xdr.Operation, fee = '1000000') {
  const transaction_xdr = new TransactionBuilder(new Account(key.publicKey(), '10'), {
    fee,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(180)
    .build()
    .toXDR();
  return { public_key: key.publicKey(), network_passphrase: Networks.TESTNET, transaction_xdr };
}
const host = (func: xdr.HostFunction, auth: xdr.SorobanAuthorizationEntry[] = []) =>
  Operation.invokeHostFunction({ func, auth });
test('generic Soroban upload, create, invoke, restore and extend envelopes sign independently', () => {
  const create = new xdr.CreateContractArgsV2({
    contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
      new xdr.ContractIdPreimageFromAddress({
        address: new Address(key.publicKey()).toScAddress(),
        salt: new Uint8Array(32),
      }),
    ),
    executable: xdr.ContractExecutable.contractExecutableWasm(new Uint8Array(32)),
    constructorArgs: [],
  });
  for (const op of [
    host(xdr.HostFunction.hostFunctionTypeUploadContractWasm(new Uint8Array([0, 97, 115, 109]))),
    host(xdr.HostFunction.hostFunctionTypeCreateContractV2(create)),
    host(xdr.HostFunction.hostFunctionTypeInvokeContract(args)),
    Operation.restoreFootprint({}),
    Operation.extendFootprintTtl({ extendTo: 123 }),
  ]) {
    const request = input(op),
      checked = inspectTransaction(request, key.publicKey());
    const signed = attachSignature(
      request,
      key.publicKey(),
      Buffer.from(key.sign(checked.tx.hash())).toString('hex'),
    );
    const parsed = TransactionBuilder.fromXDR(signed, Networks.TESTNET);
    expect(parsed.signatures).toHaveLength(1);
    expect(key.verify(parsed.hash(), parsed.signatures[0].signature.toBytes())).toBe(true);
    expect(() => inspectTransaction({ ...request, transaction_xdr: signed }, key.publicKey())).toThrow(
      'unsigned',
    );
  }
});
test('envelopes permit SourceAccount and signed explicit G/C entries, but never sign an auth entry implicitly', () => {
  const source = new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
  });
  expect(() =>
    inspectTransaction(
      input(host(xdr.HostFunction.hostFunctionTypeInvokeContract(args), [source])),
      key.publicKey(),
    ),
  ).not.toThrow();
  expect(() => parseAuthEntry(source.toXDR('base64'))).toThrow('SourceAccount');
  for (const address of [key.publicKey(), contract]) {
    const authInput = {
      public_key: key.publicKey(),
      address,
      network_passphrase: Networks.TESTNET,
      adapter: address === contract ? { type: 'contract-ed25519' as const } : { type: 'account' as const },
      auth_entry_xdr: createAuthEntry({ address, invocation, nonce: 1n, expirationLedger: 160 }),
    };
    const unsigned = parseAuthEntry(authInput.auth_entry_xdr);
    expect(() =>
      inspectTransaction(
        input(host(xdr.HostFunction.hostFunctionTypeInvokeContract(args), [unsigned])),
        key.publicKey(),
      ),
    ).toThrow('Sign explicit');
    const checked = inspectAuthEntry(authInput, key.publicKey(), 100);
    const signed = parseAuthEntry(
      attachAuthSignature(
        authInput,
        key.publicKey(),
        100,
        Buffer.from(key.sign(checked.digest)).toString('hex'),
      ),
    );
    expect(() =>
      inspectTransaction(
        input(host(xdr.HostFunction.hostFunctionTypeInvokeContract(args), [signed])),
        key.publicKey(),
      ),
    ).not.toThrow();
  }
});
test('Soroban envelope fee, preconditions, signer and unsupported credentials remain bounded', () => {
  const op = host(xdr.HostFunction.hostFunctionTypeInvokeContract(args));
  expect(() => inspectTransaction(input(op, '100000001'), key.publicKey())).toThrow('fee');
  const request = input(op);
  expect(() =>
    inspectTransaction({ ...request, transaction_xdr: request.transaction_xdr + '\n' }, key.publicKey()),
  ).toThrow('canonical');
  expect(() => inspectTransaction(request, Keypair.random().publicKey())).toThrow('selected');
  const entry = parseAuthEntry(
    createAuthEntry({ address: contract, invocation, nonce: 1n, expirationLedger: 160 }),
  );
  if (entry.credentials.type !== 'sorobanCredentialsAddressV2') throw Error();
  const delegated = new xdr.SorobanAuthorizationEntry({
    rootInvocation: invocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
      new xdr.SorobanAddressCredentialsWithDelegates({
        addressCredentials: entry.credentials.addressV2,
        delegates: [],
      }),
    ),
  });
  expect(() =>
    inspectTransaction(
      input(host(xdr.HostFunction.hostFunctionTypeInvokeContract(args), [delegated])),
      key.publicKey(),
    ),
  ).toThrow('delegated');
});
