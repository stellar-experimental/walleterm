// Local browser fixture: the Rust bridge and demo with offline mock wallets, for real-browser checks.
// Build the host first: cargo build --locked --features test-host --bin walleterm-test-host
// These mock keys never enter 1Password or a live network.
import { Keypair } from '@stellar/stellar-sdk';
import { createHost } from './host.ts';

const key = Keypair.random(),
  second = Keypair.random();
const host = await createHost({
  demo: true,
  listSigners: async () => [
    { public_key: key.publicKey(), comment: 'Demo wallet (offline)' },
    { public_key: second.publicKey(), comment: 'Second wallet (offline)' },
  ],
  sign: async (publicKey, hash) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    return Buffer.from(
      (publicKey === second.publicKey() ? second : key).sign(Buffer.from(hash, 'hex')),
    ).toString('hex');
  },
});
console.log(
  JSON.stringify({
    bridge: host.origin,
    pairing: await host.pairing(),
    demo: host.demoOrigin,
    public_key: key.publicKey(),
  }),
);
host.onPairingChanged(() => void host.pairing().then((pairing) => console.log(JSON.stringify({ pairing }))));
async function stop() {
  await host.close();
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
