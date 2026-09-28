// Offline check for the SEP-43 live acceptance page. It uses an in-process bridge and isolated random mock keys.
// Run from the repository root: bun fixtures/kit/live/check.mts
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { createBridge } from '../../../bridge/server.ts';
import { Walleterm } from '../../../sdk/walleterm.ts';
import { mismatches, runNegatives } from './negatives.mts';
import { buildPage } from './serve.mts';
import type { BridgeRequest } from './negatives.mts';

const key = Keypair.random();
let signatures = 0;
const bridge = createBridge({
  port: 0,
  log() {},
  review: undefined,
  latestLedger: async () => 100,
  listSigners: async () => [{ public_key: key.publicKey() }],
  sign: async (_publicKey, digest) => {
    signatures++;
    return Buffer.from(key.sign(Buffer.from(digest, 'hex'))).toString('hex');
  },
});
await bridge.listen();
const bound = bridge.server.address();
if (!bound || typeof bound === 'string') throw Error('The mock bridge did not bind.');
const origin = `http://127.0.0.1:${bound.port}`;
bridge.setPublicOrigin(origin);
try {
  const requests: BridgeRequest[] = [];
  const wallet = new Walleterm({
    sessionStorageKey: null,
    page: null,
    fetch: (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push({ method: init?.method ?? 'GET', path: new URL(url).pathname });
      const headers = new Headers(init?.headers);
      headers.set('Origin', 'http://127.0.0.1:8790');
      return fetch(input, { ...init, headers });
    },
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
  assert.equal((await wallet.getAddress()).address, key.publicKey());
  const result = await runNegatives(wallet, requests);
  assert.deepEqual(mismatches(result), []);
  assert.equal(signatures, 0);
  const files = await buildPage();
  assert.ok(files.has('/page.js'), 'The page bundle has no page.js.');
  const page = await files.get('/page.js')!.text();
  assert.ok(page.includes('BRIDGE_WALLET'), 'The page bundle lacks the Walleterm Kit module.');
  console.log(JSON.stringify({ ok: true, signatures, negatives: result, page: [...files.keys()] }, null, 2));
} finally {
  await bridge.close();
}
