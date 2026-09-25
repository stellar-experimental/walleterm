import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { Keypair } from '@stellar/stellar-sdk';
import { signDigest } from './signer.mjs';

test('stopping the signer kills its child and rejects the request', async () => {
  const controller = new AbortController();
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  let killed = false;
  child.kill = () => { killed = true; child.emit('close', null); };
  const publicKey = Keypair.random().publicKey(); // Isolated offline mock key only.
  const pending = signDigest(publicKey, '0'.repeat(64), { signal: controller.signal, spawnSigner: () => child });
  controller.abort();
  await assert.rejects(pending, /signing service stopped/);
  assert.equal(killed, true);
});
