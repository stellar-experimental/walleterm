import { test, expect } from 'bun:test';
import {
  Account,
  Address,
  Keypair,
  Memo,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { WalletermClient } from '../sdk/walleterm.ts';
import { attachAuthSignature, createAuthEntry, inspectAuthEntry } from '../sdk/authorization.ts';
import type { SignOptions } from '../sdk/types.ts';

const key = Keypair.random(),
  other = Keypair.random(); // Offline mock keys only.
const contract = StrKey.encodeContract(new Uint8Array(32).fill(51));
function transaction({
  source = key.publicKey(),
  fee = '100',
  sequence = '10',
  value = 'reviewed',
  memo = '',
} = {}) {
  return new TransactionBuilder(new Account(source, sequence), { fee, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.manageData({ name: 'authorization-review', value }))
    .addMemo(Memo.text(memo))
    .setTimebounds(0, 1900000000)
    .build();
}
const original = transaction().toXDR();
function signed(encoded = original, signer = key, network = Networks.TESTNET) {
  const tx = TransactionBuilder.fromXDR(encoded, network);
  tx.sign(signer);
  return tx.toXDR();
}
function replaceSignatures(encoded: string, signatures: xdr.DecoratedSignature[]) {
  const envelope = xdr.TransactionEnvelope.fromXDR(encoded, 'base64');
  if (envelope.type !== 'envelopeTypeTx') throw Error();
  return xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: envelope.value.tx, signatures }),
  ).toXDR('base64');
}
function fixture(artifact: unknown, reply = true) {
  let requests = 0;
  const client = new WalletermClient('https://bridge.example', {
    page: null,
    fetch: async () => {
      requests++;
      return Response.json(reply ? { state: 'signed', signed_xdr: artifact } : { state: 'signed' });
    },
  });
  client.token = 'session';
  client.account = { address: key.publicKey(), networkPassphrase: Networks.TESTNET };
  return { client, requests: () => requests };
}
async function unknownOutcome(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error.requestState).toBe('unknown');
  expect(error.canceled).toBe(false);
}

test('SDK verifies valid classic and Soroban transaction envelopes', async () => {
  const func = xdr.HostFunction.hostFunctionTypeUploadContractWasm(new Uint8Array([0, 97, 115, 109]));
  const soroban = new TransactionBuilder(new Account(key.publicKey(), '10'), {
    fee: '10000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeHostFunction({ func }))
    .setSorobanData(new SorobanDataBuilder().build())
    .setTimeout(180)
    .build()
    .toXDR();
  for (const unsigned of [original, soroban]) {
    const expected = signed(unsigned),
      f = fixture(expected);
    expect(await f.client.signTransaction(unsigned)).toEqual({
      signedTxXdr: expected,
      signerAddress: key.publicKey(),
    });
    expect(f.requests()).toBe(1);
  }
});

test('SDK rejects malformed, changed, wrongly signed, and wrong-network returned envelopes with unknown outcomes', async () => {
  const valid = signed(),
    envelope = xdr.TransactionEnvelope.fromXDR(valid, 'base64');
  if (envelope.type !== 'envelopeTypeTx') throw Error();
  const signature = envelope.value.signatures[0];
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(
    key.publicKey(),
    '200',
    transaction(),
    Networks.TESTNET,
  );
  feeBump.sign(key);
  const cases = [
    'not XDR',
    null,
    undefined,
    '',
    valid + '\n',
    valid + 'AAAA',
    'A'.repeat(262401),
    original,
    signed(transaction({ fee: '101' }).toXDR()),
    signed(transaction({ sequence: '11' }).toXDR()),
    signed(transaction({ value: 'substituted' }).toXDR()),
    signed(transaction({ memo: 'changed' }).toXDR()),
    signed(transaction({ source: other.publicKey() }).toXDR(), other),
    signed(original, other),
    signed(original, key, Networks.PUBLIC),
    feeBump.toXDR(),
    replaceSignatures(valid, [signature, signature]),
    replaceSignatures(valid, [
      new xdr.DecoratedSignature({ hint: new Uint8Array(4), signature: signature.signature.toBytes() }),
    ]),
    replaceSignatures(valid, [
      new xdr.DecoratedSignature({ hint: signature.hint.toBytes(), signature: new Uint8Array(64) }),
    ]),
  ];
  for (const artifact of cases) {
    const f = fixture(artifact);
    await unknownOutcome(f.client.signTransaction(original));
    expect(f.requests()).toBe(1); // No repeat signing or misleading cancellation after signature delivery.
  }
  const missing = fixture(undefined, false);
  await unknownOutcome(missing.client.signTransaction(original));
  expect(missing.requests()).toBe(1);
});

test('SDK rejects invalid transaction requests and mismatched selected signer or network before sending', async () => {
  const f = fixture(signed());
  for (const [encoded, options] of [
    ['not XDR', {}],
    [signed(), {}],
    [original, { address: other.publicKey() }],
    [original, { networkPassphrase: Networks.PUBLIC }],
    [transaction({ source: other.publicKey() }).toXDR(), {}],
  ] satisfies [string, SignOptions][]) {
    const error = await f.client.signTransaction(encoded, options).then(
      () => null,
      (caught) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.requestState).toBeUndefined();
  }
  expect(f.requests()).toBe(0);
});

test('SDK freezes transaction signer and network options while awaiting the response', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = new WalletermClient('https://bridge.example', {
    page: null,
    fetch: async (_url, options) => {
      expect(JSON.parse(String(options?.body))).toMatchObject({
        public_key: key.publicKey(),
        network_passphrase: Networks.TESTNET,
        transaction_xdr: original,
      });
      await pending;
      return Response.json({ state: 'signed', signed_xdr: signed() });
    },
  });
  client.token = 'session';
  client.account = { address: key.publicKey(), networkPassphrase: Networks.TESTNET };
  const options: SignOptions = { address: key.publicKey(), networkPassphrase: Networks.TESTNET };
  const promise = client.signTransaction(original, options);
  options.address = other.publicKey();
  options.networkPassphrase = Networks.PUBLIC;
  release();
  expect(await promise).toEqual({ signedTxXdr: signed(), signerAddress: key.publicKey() });
});

function authInput(nonce = 7n) {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract).toScAddress(),
        functionName: 'increment',
        args: [],
      }),
    ),
    subInvocations: [],
  });
  return {
    address: contract,
    adapter: { type: 'contract-ed25519' as const },
    public_key: key.publicKey(),
    network_passphrase: Networks.TESTNET,
    auth_entry_xdr: createAuthEntry({ address: contract, invocation, nonce, expirationLedger: 160 }),
  };
}
function signedAuth(input = authInput()) {
  return attachAuthSignature(
    input,
    key.publicKey(),
    100,
    Buffer.from(key.sign(inspectAuthEntry(input, key.publicKey(), 100).digest)).toString('hex'),
  );
}
test('SDK authorization artifact verification failures always preserve unknown signing outcomes', async () => {
  const input = authInput();
  for (const artifact of [
    'not XDR',
    null,
    undefined,
    input.auth_entry_xdr,
    signedAuth(authInput(8n)),
    signedAuth() + '\n',
  ]) {
    const f = fixture(artifact);
    await unknownOutcome(
      f.client.signAuthEntry(input.auth_entry_xdr, { address: contract, adapter: input.adapter }),
    );
    expect(f.requests()).toBe(1);
  }
  const missing = fixture(undefined, false);
  await unknownOutcome(
    missing.client.signAuthEntry(input.auth_entry_xdr, { address: contract, adapter: input.adapter }),
  );
  expect(missing.requests()).toBe(1);
});
