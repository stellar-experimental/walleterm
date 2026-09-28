// Offline compatibility check for Stellar Wallets Kit 2.7.0, pinned in this fixture package only.
// It drives the real Kit SDK against an in-process bridge. It uses isolated random mock keys only.
// Run from the repository root:
//   bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts && bun fixtures/kit/check.mts
import assert from 'node:assert/strict';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { Networks } from '@creit.tech/stellar-wallets-kit/types';
import type { ModuleInterface } from '@creit.tech/stellar-wallets-kit/types';
import {
  Account,
  Address,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  buildAuthorizationEntryPreimage,
  hash,
  xdr,
} from '@stellar/stellar-sdk';
import { createBridge } from '../../bridge/server.ts';
import { Walleterm } from '../../sdk/walleterm.ts';
import { WalletermModule } from '../../sdk/kit.ts';

const key = Keypair.random(),
  other = Keypair.random();
const bridge = createBridge({
  port: 0,
  log() {},
  review: undefined,
  latestLedger: async () => 100,
  listSigners: async () => [key, other].map((k) => ({ public_key: k.publicKey() })),
  sign: async (publicKey, digest) =>
    Buffer.from((publicKey === key.publicKey() ? key : other).sign(Buffer.from(digest, 'hex'))).toString(
      'hex',
    ),
});
await bridge.listen();
const bound = bridge.server.address();
if (!bound || typeof bound === 'string') throw Error('The mock bridge did not bind.');
const origin = `http://127.0.0.1:${bound.port}`;
bridge.setPublicOrigin(origin);
const results: Record<string, string> = {};
try {
  const wallet = new Walleterm({
    walletScope: 'available',
    sessionStorageKey: null,
    page: null,
    pollInterval: 5,
    fetch: (url, options) => {
      const headers = new Headers(options?.headers);
      headers.set('Origin', 'https://kit.example');
      return fetch(url, { ...options, headers });
    },
    // Stands in for the pairing dialog.
    ui: {
      requestAccess: async (target) =>
        (
          await target.connect({
            url: origin,
            code: bridge.pairing.code,
            selectWallet: async () => key.publicKey(),
          })
        ).address,
    },
  });
  const module = new WalletermModule({ wallet });
  // Type check against the pinned Kit interface.
  const typed: ModuleInterface = module;
  assert.equal(typed.productId, 'walleterm');

  // The Kit defaults to PUBLIC. Walleterm refuses it before any bridge request.
  StellarWalletsKit.init({ modules: [module], selectedWalletId: 'walleterm' });
  const unsigned = new TransactionBuilder(new Account(key.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'kit', value: 'yes' }))
    .setTimeout(120)
    .build()
    .toXDR();
  await assert.rejects(StellarWalletsKit.signTransaction(unsigned), { code: -3 });
  results.public_default = 'rejected with -3 before pairing';

  StellarWalletsKit.setNetwork(Networks.TESTNET);
  assert.deepEqual(await StellarWalletsKit.fetchAddress(), { address: key.publicKey() });
  assert.deepEqual(await StellarWalletsKit.getAddress(), { address: key.publicKey() });
  results.fetch_address = 'paired through getAddress';

  const { signedTxXdr, signerAddress } = await StellarWalletsKit.signTransaction(unsigned);
  const signed = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
  assert.equal(signerAddress, key.publicKey());
  assert.ok(key.verify(signed.hash(), signed.signatures[0].signature.toBytes()));
  results.sign_transaction = 'verified';

  const contractId = StrKey.encodeContract(new Uint8Array(32).fill(4));
  const entry = new xdr.SorobanAuthorizationEntry({
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(contractId).toScAddress(),
          functionName: 'increment',
          args: [],
        }),
      ),
      subInvocations: [],
    }),
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      new xdr.SorobanAddressCredentials({
        address: new Address(contractId).toScAddress(),
        nonce: 3n,
        signatureExpirationLedger: 200,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
  });
  const preimage = buildAuthorizationEntryPreimage(entry, 200, Networks.TESTNET).toXDR('base64');
  const { signedAuthEntry } = await StellarWalletsKit.signAuthEntry(preimage);
  assert.ok(key.verify(hash(Buffer.from(preimage, 'base64')), Buffer.from(signedAuthEntry, 'base64')));
  results.sign_auth_entry = 'verified';

  await assert.rejects(StellarWalletsKit.signMessage('hello'), { code: -3, ext: ['walleterm:unsupported'] });
  results.sign_message = 'rejected with -3';
  assert.deepEqual(await StellarWalletsKit.getNetwork(), {
    network: 'TESTNET',
    networkPassphrase: Networks.TESTNET,
  });

  // The Kit core does not subscribe to onChange. A website connects it to fetchAddress.
  const updated = Promise.withResolvers<void>();
  module.onChange(() => void StellarWalletsKit.fetchAddress().then(() => updated.resolve(), updated.reject));
  await wallet.selectWallet(other.publicKey());
  await updated.promise;
  assert.deepEqual(await StellarWalletsKit.getAddress(), { address: other.publicKey() });
  results.switch = 'Kit address followed onChange';

  await StellarWalletsKit.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(wallet.address, '');
  results.disconnect = 'bridge session revoked';
  console.log(JSON.stringify({ kit: '2.7.0', ok: true, results }, null, 2));
} finally {
  await bridge.close();
}
