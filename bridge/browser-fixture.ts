// Local browser test only. This mock key never enters 1Password or a live network.
import { Keypair } from '@stellar/stellar-sdk';
import { createBridge } from './server.ts';
import { createDemoSite } from '../demo/server.ts';
import { listeningPort } from './test/support.ts';
const key = Keypair.random(),
  second = Keypair.random();
const bridge = createBridge({
  port: 0,
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
const demo = createDemoSite({ port: 0 });
await bridge.listen();
await demo.listen();
bridge.setPublicOrigin(`http://127.0.0.1:${listeningPort(bridge.server)}`);
demo.setPublicOrigin(`http://127.0.0.1:${listeningPort(demo.server)}`);
console.log(
  JSON.stringify({
    bridge: `http://127.0.0.1:${listeningPort(bridge.server)}`,
    pairing: bridge.pairing,
    demo: `http://127.0.0.1:${listeningPort(demo.server)}`,
    public_key: key.publicKey(),
  }),
);
bridge.onPairingChanged(() => console.log(JSON.stringify({ pairing: bridge.pairing })));
async function stop() {
  await Promise.all([bridge.close(), demo.close()]);
  process.exit(0);
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
