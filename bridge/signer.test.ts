import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { requestError } from '../sdk/errors.ts';
import { availableSigners, signDigest } from './signer.ts';
import { MockChild } from './test/support.ts';
import type { SignerOptions } from './signer.ts';

test('stopping the signer kills its child and rejects the request', async () => {
  const controller = new AbortController();
  const child = new MockChild();
  const publicKey = Keypair.random().publicKey(); // Isolated offline mock key only.
  const pending = signDigest(publicKey, '0'.repeat(64), {
    signal: controller.signal,
    spawnSigner: () => child,
  });
  controller.abort();
  await assert.rejects(pending, /signing service stopped/);
  assert.equal(child.killed, true);
});

function listChild(result: unknown) {
  const child = new MockChild();
  child.stdin.once('finish', () => {
    child.stdout.end(JSON.stringify(result));
    child.emit('close', 0, null);
  });
  return child;
}

test('wallet discovery excludes agent keys outside OP_VAULT', async () => {
  const inside = Keypair.random(),
    outside = Keypair.random(); // Isolated offline mock keys only.
  const blob = Buffer.concat([
    Buffer.from([0, 0, 0, 11]),
    Buffer.from('ssh-ed25519'),
    Buffer.from([0, 0, 0, 32]),
    inside.rawPublicKey(),
  ]);
  const signers = [inside, outside].map((key) => ({
    public_key: key.publicKey(),
    fingerprint: 'mock',
    comment: 'Same display name',
  }));
  const commands: string[][] = [];
  const vault = 'kxx6p3pmtgq2hsrsjh4gakqfdi',
    item = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
  const result = await availableSigners({
    vault,
    spawnSigner: () => listChild({ ok: true, signers }),
    readVault: async (args) => {
      commands.push(args);
      if (args[0] === 'item')
        return JSON.stringify([{ id: item, vault: { id: vault }, category: 'SSH_KEY' }]);
      return `ssh-ed25519 ${blob.toString('base64')} Same display name`;
    },
  });
  assert.deepEqual(result, [signers[0]]);
  assert.deepEqual(commands, [
    ['item', 'list', '--vault', vault, '--categories', 'SSH Key', '--format', 'json'],
    ['read', '--no-newline', `op://${vault}/${item}/public key`],
  ]);
});

// Items stay unknown because some tests send malformed vault metadata.
function vaultFixture({
  vault = 'Private',
  items,
  publicKey,
  readError,
}: { vault?: string; items?: unknown; publicKey?: string; readError?: boolean } = {}) {
  const key = Keypair.random(); // Isolated offline mock key only.
  const blob = Buffer.concat([
    Buffer.from([0, 0, 0, 11]),
    Buffer.from('ssh-ed25519'),
    Buffer.from([0, 0, 0, 32]),
    key.rawPublicKey(),
  ]);
  const signer = { public_key: key.publicKey(), fingerprint: 'mock', comment: 'Mock key' };
  const calls: string[][] = [];
  const options: SignerOptions = {
    vault,
    spawnSigner: () => listChild({ ok: true, signers: [signer] }),
    readVault: async (args) => {
      calls.push(args);
      if (readError) throw Error('CLI diagnostics must stay private');
      if (args[0] === 'item')
        return JSON.stringify(
          items ?? [
            {
              id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
              vault: { id: 'kxx6p3pmtgq2hsrsjh4gakqfdi', name: 'Private' },
              category: 'SSH_KEY',
            },
          ],
        );
      return publicKey ?? `ssh-ed25519 ${blob.toString('base64')}`;
    },
  };
  return { signer, calls, options };
}

test('wallet discovery uses OP_VAULT from the process environment', async () => {
  const previous = process.env.OP_VAULT;
  onTestFinished(() => {
    if (previous === undefined) delete process.env.OP_VAULT;
    else process.env.OP_VAULT = previous;
  });
  process.env.OP_VAULT = 'Private';
  const f = vaultFixture();
  delete f.options.vault;
  assert.deepEqual(await availableSigners(f.options), [f.signer]);
  assert.equal(f.calls[0][3], 'Private');
  assert.match(f.calls[1][2], /^op:\/\/kxx6p3pmtgq2hsrsjh4gakqfdi\//);
});

test('an empty selected vault exposes no agent keys', async () => {
  const f = vaultFixture({ items: [] });
  assert.deepEqual(await availableSigners(f.options), []);
  assert.equal(f.calls.length, 1);
});

test('vault lookup failures never expose the unfiltered agent list or CLI diagnostics', async () => {
  const f = vaultFixture({ readError: true });
  await assert.rejects(
    availableSigners(f.options),
    (error) =>
      requestError(error).status === 502 &&
      requestError(error).message ===
        'The selected 1Password vault is unavailable. Check OP_VAULT and the 1Password CLI.',
  );
  const unavailable = vaultFixture();
  unavailable.options.readVault = async (args) => {
    if (args[0] === 'read') throw Error('private CLI diagnostics');
    return JSON.stringify([
      {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
        vault: { id: 'kxx6p3pmtgq2hsrsjh4gakqfdi', name: 'Private' },
        category: 'SSH_KEY',
      },
    ]);
  };
  await assert.rejects(
    availableSigners(unavailable.options),
    /A public key in the selected vault is unavailable/,
  );
});

test('invalid vault metadata and malformed Ed25519 public keys stop wallet discovery', async () => {
  for (const items of [
    {},
    [null],
    [{ id: '../../other', vault: { id: 'kxx6p3pmtgq2hsrsjh4gakqfdi' }, category: 'SSH_KEY' }],
    [
      {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
        vault: { id: 'bbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'Other' },
        category: 'SSH_KEY',
      },
    ],
  ]) {
    await assert.rejects(availableSigners(vaultFixture({ items }).options), /invalid key/);
  }
  for (const publicKey of [
    'ssh-ed25519 invalid',
    'ssh-ed25519',
    `ssh-ed25519 ${Buffer.alloc(51).toString('base64')}`,
  ]) {
    await assert.rejects(availableSigners(vaultFixture({ publicKey }).options), /public key.*invalid/);
  }
});

test('unsupported vault keys do not become wallets', async () => {
  const f = vaultFixture({ publicKey: 'ssh-rsa mock' });
  assert.deepEqual(await availableSigners(f.options), []);
});

test('an unset vault preserves agent discovery without a 1Password CLI call', async () => {
  const f = vaultFixture({ vault: '' });
  assert.deepEqual(await availableSigners(f.options), [f.signer]);
  assert.deepEqual(f.calls, []);
});
