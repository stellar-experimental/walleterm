import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkCheckpoint,
  OZ_COMMIT,
  type CheckpointContext,
  type ContractsState,
  type Manifest,
} from './contracts.ts';

const manifest: Manifest = JSON.parse(
  readFileSync(new URL('../fixtures/wasm/manifest.json', import.meta.url), 'utf8'),
);
const ctx: CheckpointContext = {
  networkPassphrase: 'test network',
  keys: { a: { publicKey: 'a' }, b: { publicKey: 'b' }, c: { publicKey: 'c' } },
};
const fresh = (): ContractsState => ({ oz_commit: OZ_COMMIT, wasm: {}, contracts: {}, done: {} });

test('checkpoint binds its network and public keys', () => {
  const state = fresh();
  checkCheckpoint(state, manifest, ctx);
  assert.throws(
    () => checkCheckpoint(state, manifest, { ...ctx, networkPassphrase: 'other network' }),
    /network or public keys/,
  );
  assert.throws(
    () => checkCheckpoint(state, manifest, { ...ctx, keys: { ...ctx.keys, c: { publicKey: 'other' } } }),
    /network or public keys/,
  );
});

test('checkpoint rejects stale source, stale code, and unbound prior deployments', () => {
  assert.throws(() => checkCheckpoint({ ...fresh(), oz_commit: 'old' }, manifest, ctx), /revision mismatch/);
  const file = Object.keys(manifest.artifacts)[0];
  assert.throws(
    () => checkCheckpoint({ ...fresh(), wasm: { [file]: { hash: 'wrong' } } }, manifest, ctx),
    /hash mismatch/,
  );
  assert.throws(
    () => checkCheckpoint({ ...fresh(), contracts: { old: { id: 'C...', wasm: file } } }, manifest, ctx),
    /without a network\/key binding/,
  );
  const changed = structuredClone(manifest);
  changed.artifacts[file].sha256 = 'wrong';
  assert.throws(() => checkCheckpoint(fresh(), changed, ctx), /hash mismatch/);
});
