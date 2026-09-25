// Local browser test only. This mock key never enters 1Password or a live network.
// Run it in a terminal. It uses the real terminal review.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { createBridge } from './server.mjs';
import { createDemoSite } from '../demo/server.mjs';
const directory = mkdtempSync(join(tmpdir(), 'walleterm-browser-test-'));
const key = Keypair.random();
const bridge = createBridge({ port: 0, stateDir: directory, listSigners: async () => [{ public_key: key.publicKey(), comment: 'OFFLINE MOCK KEY' }],
  sign: async (_key, hash) => { await new Promise(resolve => setTimeout(resolve, 250)); return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex'); } });
const demo = createDemoSite({ port: 0 });
await bridge.listen(); await demo.listen();
bridge.setPublicOrigin(`http://127.0.0.1:${bridge.server.address().port}`);
demo.setPublicOrigin(`http://127.0.0.1:${demo.server.address().port}`);
console.log(JSON.stringify({ bridge: `http://127.0.0.1:${bridge.server.address().port}`, pairing: bridge.pairing, demo: `http://127.0.0.1:${demo.server.address().port}`, public_key: key.publicKey() }));
async function stop() { await Promise.all([bridge.close(), demo.close()]); rmSync(directory, { recursive: true, force: true }); process.exit(0); }
process.once('SIGTERM', stop); process.once('SIGINT', stop);
