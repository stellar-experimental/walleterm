import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, verify as edVerify } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/Users/kalepail/Desktop/walleterm-v2/node_modules/@stellar/stellar-sdk/package.json');
const sdk = require('@stellar/stellar-sdk');
const { xdr, Keypair, StrKey, Address, Account, Asset, Operation, TransactionBuilder, Networks,
  buildWithDelegatesEntry, buildAuthorizationEntryPreimage, authorizeEntry, inspectAuthEntry } = sdk;
const out = dirname(fileURLToPath(import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest();
const hex = bytes => Buffer.from(bytes).toString('hex');
const mock = () => Keypair.fromRawEd25519Seed(randomBytes(32));
const verify = (pub, digest, sig) => {
  const raw = StrKey.decodeEd25519PublicKey(pub);
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw)]);
  return edVerify(null, digest, createPublicKey({ key: spki, format: 'der', type: 'spki' }), sig);
};
const save = (name, obj) => writeFileSync(join(out, name), JSON.stringify(obj, null, 2) + '\n');
const network = Networks.TESTNET;

// Example 1: a transaction source and a distinct operation source.
const txSource = mock(), opSource = mock(), destination = mock();
const makePayment = (amount = '7', op = opSource.publicKey(), passphrase = network) => {
  const account = new Account(txSource.publicKey(), '123456789');
  return new TransactionBuilder(account, { fee: '100', networkPassphrase: passphrase,
    timebounds: { minTime: '1700000000', maxTime: '4102444800' } })
    .addOperation(Operation.payment({ source: op, destination: destination.publicKey(), asset: Asset.native(), amount }))
    .build();
};
const payment = makePayment();
const txDigest = payment.hash();
assert.equal(hex(sha(payment.signatureBase())), hex(txDigest));
const txSig = txSource.sign(txDigest), opSig = opSource.sign(txDigest);
assert(verify(txSource.publicKey(), txDigest, txSig));
assert(verify(opSource.publicKey(), txDigest, opSig));
assert.notEqual(txSource.publicKey(), opSource.publicKey());
const alteredAmount = makePayment('8').hash();
const alteredSource = makePayment('7', destination.publicKey()).hash();
const alteredNetwork = makePayment('7', opSource.publicKey(), 'Different test network').hash();
for (const changed of [alteredAmount, alteredSource, alteredNetwork]) {
  assert(!verify(txSource.publicKey(), changed, txSig));
  assert(!verify(opSource.publicKey(), changed, opSig));
}
payment.sign(txSource, opSource);
assert.equal(payment.signatures.length, 2);
const parsedPayment = TransactionBuilder.fromXDR(payment.toXDR(), network);
assert.equal(hex(parsedPayment.hash()), hex(txDigest));
for (const [kp, sig] of [[txSource, txSig], [opSource, opSig]]) {
  const hint = StrKey.decodeEd25519PublicKey(kp.publicKey()).subarray(28);
  const item = parsedPayment.signatures.find(s => hex(s.hint.value) === hex(hint));
  assert(item);
  assert.equal(hex(item.signature.value), hex(sig));
  assert(verify(kp.publicKey(), parsedPayment.hash(), item.signature.value));
}
const decorated = [
  { signer: txSource.publicKey(), signature: txSig },
  { signer: opSource.publicKey(), signature: opSig }
].map(({ signer, signature }) => ({ signer, hintHex: hex(StrKey.decodeEd25519PublicKey(signer).subarray(28)), signatureBase64: Buffer.from(signature).toString('base64') }));
save('classic.json', { example: 'classic_separate_operation_source', networkPassphrase: network,
  signedTransactionXdrBase64: payment.toXDR(), signatureBaseXdrBase64: Buffer.from(payment.signatureBase()).toString('base64'),
  digestHex: hex(txDigest), transactionSource: txSource.publicKey(), operationSource: opSource.publicKey(),
  destination: destination.publicKey(), amount: '7', asset: 'native', timebounds: { minTime: '1700000000', maxTime: '4102444800' },
  signatures: decorated, checks: { signatureBaseHashMatches: true, bothEd25519SignaturesVerify: true, signedEnvelopeHasTwoSignatures: true, decodedEnvelopeSignaturesVerify: true,
    changedAmountRejected: true, changedOperationSourceRejected: true, changedNetworkRejected: true } });

// Example 2: CAP-71 delegates sign one address-bound preimage.
const delegateA = mock(), delegateB = mock();
const accountC = StrKey.encodeContract(randomBytes(32));
const targetC = StrKey.encodeContract(randomBytes(32));
const nonce = 42001n;
const expiration = 500000;
const invocation = new xdr.SorobanAuthorizedInvocation({
  function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({ contractAddress: new Address(targetC).toScAddress(), functionName: 'transfer',
      args: [xdr.ScVal.scvAddress(new Address(accountC).toScAddress()), xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: 23n }))] })),
  subInvocations: []
});
const base = new xdr.SorobanAuthorizationEntry({
  credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(new xdr.SorobanAddressCredentials({
    address: new Address(accountC).toScAddress(), nonce, signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid() })),
  rootInvocation: invocation
});
let delegated = buildWithDelegatesEntry({ entry: base, validUntilLedgerSeq: expiration,
  delegates: [{ address: delegateB.publicKey() }, { address: delegateA.publicKey() }] });
const preimage = buildAuthorizationEntryPreimage(delegated, expiration, network);
const payload = sha(preimage.toXdr());
const independentPreimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
  new xdr.HashIdPreimageSorobanAuthorizationWithAddress({ networkId: sha(Buffer.from(network)), nonce,
    invocation, address: new Address(accountC).toScAddress(), signatureExpirationLedger: expiration }));
assert.equal(hex(preimage.toXdr()), hex(independentPreimage.toXdr()));
const delegateSignatures = [];
for (const kp of [delegateA, delegateB]) {
  const sig = kp.sign(payload);
  assert(verify(kp.publicKey(), payload, sig));
  delegated = await authorizeEntry(delegated, async (_preimage, gotPayload) => {
    assert.equal(hex(gotPayload), hex(payload));
    return { signature: sig, publicKey: kp.publicKey() };
  }, expiration, network, kp.publicKey());
  delegateSignatures.push({ address: kp.publicKey(), signatureBase64: Buffer.from(sig).toString('base64') });
}
const inspect = inspectAuthEntry(xdr.SorobanAuthorizationEntry.fromXdr(delegated.toXdr('base64'), 'base64'));
assert.equal(inspect.credentialType, 'addressWithDelegates');
assert.equal(inspect.signers.length, 3);
assert.equal(inspect.signers.filter(s => s.signed).length, 2);
for (const node of inspect.signers.slice(1)) {
  assert.equal(node.signatures.length, 1);
  assert.equal(node.signatures[0].publicKey, node.address);
  assert(verify(node.address, payload, node.signatures[0].signature));
}
assert.deepEqual(inspect.signers.slice(1).map(s => s.address).sort(), [delegateA.publicKey(), delegateB.publicKey()].sort());
const otherC = StrKey.encodeContract(randomBytes(32));
const differentAddress = new xdr.SorobanAuthorizationEntry({ credentials:
  xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(new xdr.SorobanAddressCredentialsWithDelegates({
    addressCredentials: new xdr.SorobanAddressCredentials({ address: new Address(otherC).toScAddress(), nonce,
      signatureExpirationLedger: expiration, signature: xdr.ScVal.scvVoid() }),
    delegates: delegated.credentials.addressWithDelegates.delegates })), rootInvocation: invocation });
const changedAddressDigest = sha(buildAuthorizationEntryPreimage(differentAddress, expiration, network).toXdr());
const changedNonce = 42002n;
const changedNoncePreimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
  new xdr.HashIdPreimageSorobanAuthorizationWithAddress({ networkId: sha(Buffer.from(network)), nonce: changedNonce,
    invocation, address: new Address(accountC).toScAddress(), signatureExpirationLedger: expiration }));
const changedNonceDigest = sha(changedNoncePreimage.toXdr());
const changedInvocation = new xdr.SorobanAuthorizedInvocation({
  function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({ contractAddress: new Address(targetC).toScAddress(), functionName: 'approve', args: [] })),
  subInvocations: [] });
const changedInvocationDigest = sha(xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
  new xdr.HashIdPreimageSorobanAuthorizationWithAddress({ networkId: sha(Buffer.from(network)), nonce,
    invocation: changedInvocation, address: new Address(accountC).toScAddress(), signatureExpirationLedger: expiration })).toXdr());
for (const changed of [changedAddressDigest, changedNonceDigest, changedInvocationDigest]) {
  for (const { address, signatureBase64 } of delegateSignatures) assert(!verify(address, changed, Buffer.from(signatureBase64, 'base64')));
}
assert(!verify(delegateA.publicKey(), txDigest, Buffer.from(delegateSignatures[0].signatureBase64, 'base64')));
save('delegation.json', { example: 'cap71_two_g_delegates', networkPassphrase: network,
  authorizationEntryXdrBase64: delegated.toXdr('base64'), preimageXdrBase64: preimage.toXdr('base64'),
  digestHex: hex(payload), topLevelAddress: accountC, nonce: '42001', syntheticLedgerWindow: { assumedStart: 499900, expiration: expiration },
  targetContract: targetC, topLevelSignature: 'void', delegates: delegateSignatures,
  checks: { independentPreimageXdrMatches: true, twoSignaturesVerifyOverSameDigest: true,
    changedTopLevelAddressRejected: true, changedNonceRejected: true, changedInvocationRejected: true, serializedNodeSignaturesVerify: true, transactionDigestRejected: true,
    topLevelAccountPolicyEnforced: false, enforceSimulationPerformed: false } });

// Example 3: synthetic CAP-85 ledger state before and after a manager update.
const userContract = StrKey.encodeContract(randomBytes(32));
const managerContract = StrKey.encodeContract(randomBytes(32));
const tag = 'release-channel';
const codeA = Buffer.from('offline mock wasm A; never upload');
const codeB = Buffer.from('offline mock wasm B; never upload');
const hashA = sha(codeA), hashB = sha(codeB);
const instance = new xdr.ContractDataEntry({ ext: xdr.ExtensionPoint.v0(),
  contract: new Address(userContract).toScAddress(), key: xdr.ScVal.scvLedgerKeyContractInstance(),
  durability: xdr.ContractDataDurability.persistent,
  val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableExternalRef(new xdr.ContractExecutableExternalRef({
      executableOwner: new Address(managerContract).toScAddress(), tag })), storage: null })) });
const mapping = hash => new xdr.ContractDataEntry({ ext: xdr.ExtensionPoint.v0(),
  contract: new Address(managerContract).toScAddress(), key: xdr.ScVal.scvExecutableTag(tag),
  durability: xdr.ContractDataDurability.persistent, val: xdr.ScVal.scvBytes(hash) });
const encodedInstance = instance.toXdr('base64');
const encodedA = mapping(hashA).toXdr('base64'), encodedB = mapping(hashB).toXdr('base64');
const decodedInstance = xdr.ContractDataEntry.fromXdr(encodedInstance, 'base64');
const decodedA = xdr.ContractDataEntry.fromXdr(encodedA, 'base64');
const decodedB = xdr.ContractDataEntry.fromXdr(encodedB, 'base64');
assert.equal(decodedInstance.val.instance.executable.type, 'contractExecutableExternalRef');
assert.equal(Address.fromScAddress(decodedInstance.val.instance.executable.externalRef.executableOwner).toString(), managerContract);
assert.equal(decodedInstance.val.instance.executable.externalRef.tag.toString(), tag);
for (const [entry, expected] of [[decodedA, hashA], [decodedB, hashB]]) {
  assert.equal(Address.fromScAddress(entry.contract).toString(), managerContract);
  assert.equal(entry.key.type, 'scvExecutableTag');
  assert.equal(entry.key.value, tag);
  assert.equal(entry.durability.name, 'persistent');
  assert.equal(hex(entry.val.value.value), hex(expected));
}
assert.notEqual(hex(hashA), hex(hashB));
save('cap85.json', { example: 'cap85_manager_mutable_executable', syntheticOnly: true,
  userContract, managerContract, tag, instanceContractDataXdrBase64: encodedInstance,
  before: { managerTagEntryXdrBase64: encodedA, resolvedWasmHashHex: hex(hashA), mockCodeSha256Matches: true },
  after: { managerTagEntryXdrBase64: encodedB, resolvedWasmHashHex: hex(hashB), mockCodeSha256Matches: true },
  checks: { instanceExternalRefUnchanged: true, ownerAndTagDecodedFromXdr: true,
    ownerPersistentEntryCanChangeResolvedHash: true, realNetworkStateChecked: false,
    managerUpdateAuthorityVerified: false } });

console.log(JSON.stringify({ outputDirectory: out, artifacts: ['classic.json', 'delegation.json', 'cap85.json'], sdkVersion: JSON.parse(readFileSync('/Users/kalepail/Desktop/walleterm-v2/node_modules/@stellar/stellar-sdk/package.json', 'utf8')).version }));

const savedClassic = JSON.parse(readFileSync(join(out, 'classic.json')));
assert.equal(hex(sha(Buffer.from(savedClassic.signatureBaseXdrBase64, 'base64'))), savedClassic.digestHex);
