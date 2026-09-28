import { test, expect } from 'bun:test';
import { Address, Keypair, Networks, StrKey, authorizeEntry, hash, xdr } from '@stellar/stellar-sdk';
import {
  addressCredentials,
  attachAuthSignature,
  createAuthEntry,
  inspectAuthEntry,
  parseAuthEntry,
  setAuthEntryExpiration,
  verifyAuthEntrySignature,
} from '../../sdk/authorization.ts';
import type { AuthAdapter, AuthEntryInput } from '../../sdk/authorization.ts';

const key = Keypair.random(),
  other = Keypair.random(); // Offline mock keys only.
const contract = (n: number) => StrKey.encodeContract(new Uint8Array(32).fill(n));
function invocation(children: xdr.SorobanAuthorizedInvocation[] = [], argument = 42) {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contract(2)).toScAddress(),
        functionName: 'arbitrary_call',
        args: [xdr.ScVal.scvU32(argument), xdr.ScVal.scvSymbol('reviewed')],
      }),
    ),
    subInvocations: children,
  });
}
function input(adapter: AuthAdapter = { type: 'account' }): AuthEntryInput {
  const address = adapter.type === 'account' ? key.publicKey() : contract(1);
  return {
    public_key: key.publicKey(),
    address,
    network_passphrase: Networks.TESTNET,
    adapter,
    auth_entry_xdr: createAuthEntry({
      address,
      invocation: invocation([invocation()]),
      nonce: -123n,
      expirationLedger: 160,
    }),
  };
}
function signed(request: AuthEntryInput) {
  const checked = inspectAuthEntry(request, key.publicKey(), 100);
  return attachAuthSignature(
    request,
    key.publicKey(),
    100,
    Buffer.from(key.sign(checked.digest)).toString('hex'),
  );
}
function mutate(request: AuthEntryInput, changes: Partial<xdr.SorobanAddressCredentials>) {
  const entry = parseAuthEntry(request.auth_entry_xdr);
  const credentials = new xdr.SorobanAddressCredentials({ ...addressCredentials(entry), ...changes });
  return {
    ...request,
    auth_entry_xdr: new xdr.SorobanAuthorizationEntry({
      rootInvocation: entry.rootInvocation,
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials),
    }).toXDR('base64'),
  };
}
for (const adapter of [
  { type: 'account' },
  { type: 'contract-ed25519' },
  { type: 'openzeppelin-ed25519', verifier: contract(3), context_rule_ids: [0, 4] },
] satisfies AuthAdapter[]) {
  test(`auth ${adapter.type}: exact fields, nested calls, independent SDK preimage`, async () => {
    const request = input(adapter),
      checked = inspectAuthEntry(request, key.publicKey(), 100);
    const result = signed(request);
    expect(verifyAuthEntrySignature(request, result, 100)).toBe(true);
    const after = parseAuthEntry(result);
    expect(after.credentials.type).toBe(checked.entry.credentials.type);
    expect(after.rootInvocation.toXDR('base64')).toBe(checked.entry.rootInvocation.toXDR('base64'));
    expect(addressCredentials(after).nonce).toBe(-123n);
    expect(addressCredentials(after).signatureExpirationLedger).toBe(160);
    await authorizeEntry(
      checked.entry,
      async (_preimage, payload) => {
        const expected =
          adapter.type === 'openzeppelin-ed25519'
            ? hash(
                new Uint8Array([
                  ...payload,
                  ...xdr.ScVal.scvVec([xdr.ScVal.scvU32(0), xdr.ScVal.scvU32(4)]).toXdr(),
                ]),
              )
            : payload;
        expect(Buffer.from(checked.digest)).toEqual(Buffer.from(expected));
        return { signatureScVal: addressCredentials(after).signature, address: request.address };
      },
      160,
      Networks.TESTNET,
    );
    expect(() => attachAuthSignature(request, key.publicKey(), 100, '00'.repeat(64))).toThrow('verification');
    expect(() =>
      attachAuthSignature(
        request,
        key.publicKey(),
        100,
        Buffer.from(other.sign(checked.digest)).toString('hex'),
      ),
    ).toThrow('verification');
    expect(() => inspectAuthEntry({ ...request, auth_entry_xdr: result }, key.publicKey(), 100)).toThrow(
      'unsigned',
    );
  });
}
test('V1 entries stay readable but are never rebuilt or signed', () => {
  const request = input({ type: 'contract-ed25519' }),
    entry = parseAuthEntry(request.auth_entry_xdr);
  const v1 = new xdr.SorobanAuthorizationEntry({
    rootInvocation: entry.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(addressCredentials(entry)),
  }).toXDR('base64');
  expect(parseAuthEntry(v1).credentials.type).toBe('sorobanCredentialsAddress');
  expect(() => inspectAuthEntry({ ...request, auth_entry_xdr: v1 }, key.publicKey(), 100)).toThrow('V2');
  expect(() => setAuthEntryExpiration(v1, 150)).toThrow('V2');
});
test('binding mutations invalidate signatures', () => {
  const request = input({ type: 'contract-ed25519' }),
    result = signed(request);
  for (const changed of [
    { ...request, network_passphrase: Networks.PUBLIC },
    mutate(request, { nonce: 42n }),
    mutate(request, { signatureExpirationLedger: 159 }),
    { ...mutate(request, { address: new Address(contract(9)).toScAddress() }), address: contract(9) },
    {
      ...request,
      auth_entry_xdr: createAuthEntry({
        address: request.address,
        invocation: invocation(),
        nonce: -123n,
        expirationLedger: 160,
      }),
    },
    { ...request, public_key: other.publicKey() },
  ])
    expect(() => verifyAuthEntrySignature(changed, result, 100)).toThrow();
  expect(() => inspectAuthEntry({ ...request, address: contract(9) }, key.publicKey(), 100)).toThrow(
    'address',
  );
  expect(() => inspectAuthEntry({ ...request, public_key: other.publicKey() }, key.publicKey(), 100)).toThrow(
    'signer',
  );
  expect(() => inspectAuthEntry({ ...input(), address: contract(1) }, key.publicKey(), 100)).toThrow();
});
test('expiry, unsigned canonical bounded XDR, variants and adapters fail closed', () => {
  const request = input(),
    entry = parseAuthEntry(request.auth_entry_xdr);
  for (const current of [0, 99, 160, 161, NaN, 1.5, 0x100000000])
    expect(() => inspectAuthEntry(request, key.publicKey(), current)).toThrow();
  for (const encoded of [
    '',
    'AA==',
    request.auth_entry_xdr + '\n',
    request.auth_entry_xdr + 'AAAA',
    'A'.repeat(32769),
  ])
    expect(() => parseAuthEntry(encoded)).toThrow();
  const padded = Buffer.from(request.auth_entry_xdr, 'base64');
  const name = padded.indexOf(Buffer.from('arbitrary_call'));
  padded[name + 'arbitrary_call'.length] = 1;
  expect(() => parseAuthEntry(padded.toString('base64'))).toThrow();
  const unknown = Buffer.from(request.auth_entry_xdr, 'base64');
  unknown.writeUInt32BE(0x7fffffff, 0);
  expect(() => parseAuthEntry(unknown.toString('base64'))).toThrow();
  const source = new xdr.SorobanAuthorizationEntry({
    rootInvocation: entry.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
  }).toXDR('base64');
  expect(() => parseAuthEntry(source)).toThrow('SourceAccount');
  const delegated = new xdr.SorobanAuthorizationEntry({
    rootInvocation: entry.rootInvocation,
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
      new xdr.SorobanAddressCredentialsWithDelegates({
        addressCredentials: addressCredentials(entry),
        delegates: [],
      }),
    ),
  }).toXDR('base64');
  expect(() => parseAuthEntry(delegated)).toThrow('delegated');
  expect(() =>
    inspectAuthEntry(
      { ...request, adapter: { type: 'unknown' } } as unknown as AuthEntryInput,
      key.publicKey(),
      100,
    ),
  ).toThrow('adapter');
  expect(() =>
    inspectAuthEntry(
      { ...request, adapter: { type: 'account', digest: '00' } } as unknown as AuthEntryInput,
      key.publicKey(),
      100,
    ),
  ).toThrow('fields');
  expect(() =>
    inspectAuthEntry(
      input({ type: 'openzeppelin-ed25519', verifier: contract(3), context_rule_ids: [0] }),
      key.publicKey(),
      100,
    ),
  ).toThrow('rule');
  expect(() => setAuthEntryExpiration(signed(request), 150)).toThrow('unsigned');
  expect(
    addressCredentials(parseAuthEntry(setAuthEntryExpiration(request.auth_entry_xdr, 150)))
      .signatureExpirationLedger,
  ).toBe(150);
  let deep = invocation();
  for (let n = 0; n < 32; n++) deep = invocation([deep]);
  expect(() =>
    createAuthEntry({ address: request.address, invocation: deep, nonce: 1n, expirationLedger: 160 }),
  ).toThrow('depth');
});
test('OZ adds its custom digest and binds context rule IDs', () => {
  const raw = input({ type: 'contract-ed25519' });
  const oz = {
    ...raw,
    adapter: {
      type: 'openzeppelin-ed25519',
      verifier: contract(3),
      context_rule_ids: [0, 4],
    } satisfies AuthAdapter,
  };
  const host = inspectAuthEntry(raw, key.publicKey(), 100),
    custom = inspectAuthEntry(oz, key.publicKey(), 100);
  expect(host.details.hash).not.toBe(custom.details.hash);
  expect(() =>
    attachAuthSignature(oz, key.publicKey(), 100, Buffer.from(key.sign(host.digest)).toString('hex')),
  ).toThrow('verification');
  const changed = { ...oz, adapter: { ...oz.adapter, context_rule_ids: [0, 5] } };
  expect(() => verifyAuthEntrySignature(changed, signed(oz), 100)).toThrow();
});
