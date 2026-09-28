// Offline compatibility check for Stellar Wallets Kit 2.7.0, pinned in this fixture package only.
// It drives the real Kit SDK against the Rust bridge (walleterm-test-host). It uses isolated random mock keys only.
// Run from the repository root:
//   cargo build --locked --features test-host --bin walleterm-test-host
//   bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts && bun fixtures/kit/check.mts
import assert from 'node:assert/strict';
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { ModuleType, Networks } from '@creit.tech/stellar-wallets-kit/types';
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
import { createHost } from '../../tests/browser/host.ts';
import { Walleterm } from '../../sdk/walleterm.ts';
import { WALLETERM_ID, WalletermModule } from '../../sdk/kit.ts';

const key = Keypair.random(),
  other = Keypair.random();
const bridge = await createHost({
  listSigners: async () => [key, other].map((k) => ({ public_key: k.publicKey() })),
  sign: async (publicKey, digest) =>
    Buffer.from((publicKey === key.publicKey() ? key : other).sign(Buffer.from(digest, 'hex'))).toString(
      'hex',
    ),
});
const origin = bridge.origin;
const results: Record<string, string> = {};
let dialogs = 0;
try {
  const wallet = new Walleterm({
    walletScope: 'available',
    storageKey: null,
    page: null,
    pollInterval: 5,
    fetch: (url, options) => {
      const headers = new Headers(options?.headers);
      headers.set('Origin', 'https://kit.example');
      return fetch(url, { ...options, headers });
    },
    // Stands in for the pairing dialog. The check counts each time it opens.
    ui: {
      requestAccess: async (target) => {
        dialogs++;
        return (
          await target.connect({
            url: origin,
            code: await bridge.code(),
            selectWallet: async () => key.publicKey(),
          })
        ).address;
      },
    },
  });
  const module = new WalletermModule({ wallet });
  // Type check against the pinned Kit interface.
  const typed: ModuleInterface = module;
  assert.equal(typed.productId, 'walleterm');

  // A second Kit wallet. The documented hook must never act on it.
  const otherAddress = Keypair.random().publicKey();
  const otherCalls = { getAddress: 0, disconnect: 0 };
  const refuse = async () => Promise.reject({ code: -3, message: 'Not used by this check.' });
  const otherWallet: ModuleInterface = {
    moduleType: ModuleType.HOT_WALLET,
    productId: 'other',
    productName: 'Other',
    productUrl: 'https://other.example',
    productIcon: '',
    isAvailable: async () => true,
    getAddress: async () => {
      otherCalls.getAddress++;
      return { address: otherAddress };
    },
    signTransaction: refuse,
    signAuthEntry: refuse,
    signMessage: refuse,
    getNetwork: async () => ({ network: 'TESTNET', networkPassphrase: Networks.TESTNET }),
    disconnect: async () => {
      otherCalls.disconnect++;
    },
  };

  // The Kit defaults to PUBLIC. Walleterm refuses it before any bridge request.
  StellarWalletsKit.init({ modules: [module, otherWallet], selectedWalletId: 'walleterm' });
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

  // The Kit core adds the selected network to the options. The bridge returns Base64, as Freighter does.
  const message = 'kit.example asks for proof of key control. Nonce: 1.';
  const signedMessage = await StellarWalletsKit.signMessage(message);
  assert.equal(signedMessage.signerAddress, key.publicKey());
  assert.ok(key.verifyMessage(message, Buffer.from(signedMessage.signedMessage, 'base64')));
  results.sign_message = 'verified';
  assert.deepEqual(await StellarWalletsKit.getNetwork(), {
    network: 'TESTNET',
    networkPassphrase: Networks.TESTNET,
  });

  // The Kit core does not subscribe to onChange. A website connects the documented, guarded hook.
  let hookFailure: unknown;
  let events = Promise.withResolvers<void>();
  const walletermActive = () => {
    try {
      return StellarWalletsKit.selectedModule.productId === WALLETERM_ID;
    } catch {
      return false; // No Kit wallet is selected.
    }
  };
  module.onChange(({ address }) => {
    if (!walletermActive()) return events.resolve();
    void (address ? StellarWalletsKit.fetchAddress() : StellarWalletsKit.disconnect())
      .then(() => events.resolve())
      .catch((error) => {
        hookFailure = error;
        events.resolve();
      });
  });
  const settled = async () => {
    await events.promise;
    events = Promise.withResolvers<void>();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(hookFailure, undefined);
  };
  const cleared = () =>
    assert.rejects(StellarWalletsKit.getAddress(), { code: -1, message: 'No wallet has been connected.' });
  const pairAgain = async () => {
    StellarWalletsKit.setWallet('walleterm');
    assert.deepEqual(await StellarWalletsKit.fetchAddress(), { address: key.publicKey() });
    await settled();
  };

  const paired = dialogs;
  await wallet.selectWallet(other.publicKey());
  await settled();
  assert.deepEqual(await StellarWalletsKit.getAddress(), { address: other.publicKey() });
  assert.equal(dialogs, paired);
  results.switch = 'Kit address followed onChange';

  // A disconnection from the Walleterm side clears the Kit address and opens no dialog.
  await wallet.disconnect();
  await settled();
  await cleared();
  assert.equal(dialogs, paired);
  results.wallet_disconnect = 'Kit address cleared, no dialog';

  // A revoked or expired session (401) clears the Kit address and opens no dialog.
  await pairAgain();
  const afterPairing = dialogs;
  const revoked = await fetch(`${origin}/v1/disconnect`, {
    method: 'POST',
    headers: {
      Origin: 'https://kit.example',
      Authorization: `Bearer ${wallet.client!.token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(revoked.status, 200);
  await assert.rejects(StellarWalletsKit.signTransaction(unsigned), {
    code: -3,
    ext: ['walleterm:not_connected'],
  });
  await settled();
  await cleared();
  assert.equal(dialogs, afterPairing);
  results.expiry_401 = 'signing returned -3, Kit address cleared, no dialog';

  // With another Kit wallet selected, the guard ignores Walleterm switches and disconnections.
  await pairAgain();
  StellarWalletsKit.setWallet('other');
  assert.deepEqual(await StellarWalletsKit.fetchAddress(), { address: otherAddress });
  const selected = { ...otherCalls };
  await wallet.selectWallet(other.publicKey());
  await settled();
  await wallet.disconnect();
  await settled();
  assert.deepEqual(otherCalls, selected);
  assert.deepEqual(await StellarWalletsKit.getAddress(), { address: otherAddress });
  results.other_wallet = 'guard ignored Walleterm events while another Kit wallet was selected';

  // A disconnection from the Kit side revokes the bridge session.
  await pairAgain();
  const token = wallet.client!.token;
  await StellarWalletsKit.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(wallet.address, '');
  const stale = await fetch(`${origin}/v1/account`, {
    headers: { Origin: 'https://kit.example', Authorization: `Bearer ${token}` },
  });
  assert.equal(stale.status, 401);
  await cleared();
  results.disconnect = 'bridge session revoked';
  console.log(JSON.stringify({ kit: '2.7.0', ok: true, results }, null, 2));
} finally {
  await bridge.close();
}
