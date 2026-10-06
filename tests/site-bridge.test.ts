import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk';

// The page surface that the generated bridge script reads and writes.
interface PageRequest {
  source: string;
  messageId: number;
  type: string;
  [field: string]: unknown;
}
interface PageEvent {
  source: unknown;
  origin: string;
  data: PageRequest;
}
interface PageBridge {
  pending(): { index: number; type: string; messageId: number; payloadLength: number }[];
  respond(index: number, originalXdr: string, signedXdr: string): unknown;
  respondMessage(index: number, originalBlob: string, signedBlob: string): unknown;
  requests: Record<string, unknown>[];
  unsupported: { type: string; messageId: number }[];
}
interface PageWindow {
  addEventListener(name: string, listener: (event: PageEvent) => void): void;
  postMessage(message: Record<string, unknown>, target: string): void;
  freighter?: boolean;
  __walletermBridge?: PageBridge;
}

const skill = fileURLToPath(new URL('../.agents/skills/walleterm-site-bridge/', import.meta.url));
const bridge = join(skill, 'scripts/freighter-page.ts');

test('a reviewed V1 XDR crosses the Freighter page bridge once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-site-bridge-'));
  try {
    const signer = Keypair.random(); // Isolated mock key. Never import it into 1Password.
    const recipient = Keypair.random();
    const transaction = new TransactionBuilder(new Account(signer.publicKey(), '0'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: recipient.publicKey(),
          asset: Asset.native(),
          amount: '0.0100000',
        }),
      )
      .setTimeout(60)
      .build();
    const hash = Buffer.from(transaction.hash()).toString('hex');
    const unsigned = transaction.toEnvelope().toXDR('base64');
    const unsignedPath = join(directory, 'unsigned.xdr');
    const signedPath = join(directory, 'signed.xdr');
    writeFileSync(unsignedPath, unsigned + '\n', { mode: 0o600 });
    // `walleterm sign` returns signed_transaction_xdr: the same envelope with one appended signature.
    const signedTx = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET);
    signedTx.sign(signer);
    const signed = signedTx.toEnvelope().toXDR('base64');
    writeFileSync(signedPath, signed + '\n', { mode: 0o600 });
    const parsed = TransactionBuilder.fromXDR(signed, Networks.TESTNET);
    assert.ok(parsed instanceof Transaction);
    assert.equal(Buffer.from(parsed.hash()).toString('hex'), hash);
    assert.equal(parsed.signatures.length, 1);

    const source = execFileSync(
      process.execPath,
      [
        bridge,
        'inject',
        '--public-key',
        signer.publicKey(),
        '--origin',
        'https://site.example',
        '--window-flag',
      ],
      { encoding: 'utf8' },
    );
    const events: ((event: PageEvent) => void)[] = [];
    const replies: { message: Record<string, unknown>; target: string }[] = [];
    const window: PageWindow = {
      addEventListener: (_name, listener) => {
        events.push(listener);
      },
      postMessage: (message, target) => {
        replies.push({ message, target });
      },
    };
    const page = () => {
      assert.ok(window.__walletermBridge, 'The bridge script defines window.__walletermBridge');
      return window.__walletermBridge;
    };
    const context = { window, location: { origin: 'https://site.example' }, Date, Error };
    vm.runInNewContext(source, context);
    assert.equal(window.freighter, true);
    assert.equal(events.length, 1);
    events[0]({
      source: window,
      origin: 'https://other.example',
      data: {
        source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
        messageId: 1,
        type: 'REQUEST_ACCESS',
      },
    });
    assert.equal(replies.length, 0);
    events[0]({
      source: window,
      origin: 'https://site.example',
      data: {
        source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
        messageId: 2,
        type: 'REQUEST_ACCESS',
      },
    });
    assert.equal(replies[0].message.publicKey, signer.publicKey());
    events[0]({
      source: window,
      origin: 'https://site.example',
      data: {
        source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
        messageId: 3,
        type: 'SUBMIT_TRANSACTION',
        transactionXdr: unsigned,
      },
    });
    assert.equal(page().pending()[0].messageId, 3);
    assert.equal(page().pending()[0].payloadLength, unsigned.length);
    assert.throws(() => page().respond(0, 'changed', signed), /changed/);

    events[0]({
      source: window,
      origin: 'https://site.example',
      data: {
        source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
        messageId: 4,
        type: 'SUBMIT_BLOB',
        blob: 'Sign this login challenge',
        accountToSign: signer.publicKey(),
        apiVersion: '4.1.0',
      },
    });
    assert.equal(page().pending()[1].type, 'SUBMIT_BLOB');
    assert.equal(page().pending()[1].payloadLength, 25);
    assert.equal(page().requests[1].blob, 'Sign this login challenge');
    assert.throws(() => page().respond(1, unsigned, signed), /No pending/);
    assert.equal(replies.length, 1);

    events[0]({
      source: window,
      origin: 'https://site.example',
      data: {
        source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
        messageId: 5,
        type: 'SUBMIT_AUTH_ENTRY',
        entryXdr: 'AAAA',
        accountToSign: signer.publicKey(),
        networkPassphrase: Networks.TESTNET,
      },
    });
    assert.equal(page().pending()[2].type, 'SUBMIT_AUTH_ENTRY');
    assert.equal(page().requests[2].entryXdr, 'AAAA');
    assert.equal(replies.length, 1);

    const other = Keypair.random(); // Same body, signed by another isolated mock key.
    const otherTx = TransactionBuilder.fromXDR(unsigned, Networks.TESTNET);
    otherTx.sign(other);
    const otherPath = join(directory, 'other.xdr');
    writeFileSync(otherPath, otherTx.toEnvelope().toXDR('base64') + '\n', { mode: 0o600 });
    const wrongSigner = spawnSync(
      process.execPath,
      [
        bridge,
        'reply',
        '--index',
        '0',
        '--public-key',
        signer.publicKey(),
        '--unsigned-xdr',
        unsignedPath,
        '--signed-xdr',
        otherPath,
        '--expected-hash',
        hash,
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(wrongSigner.status, 0);
    assert.equal(wrongSigner.stdout, '');

    const reply = execFileSync(
      process.execPath,
      [
        bridge,
        'reply',
        '--index',
        '0',
        '--public-key',
        signer.publicKey(),
        '--unsigned-xdr',
        unsignedPath,
        '--signed-xdr',
        signedPath,
        '--expected-hash',
        hash,
      ],
      { encoding: 'utf8' },
    );
    vm.runInNewContext(reply, context);
    assert.equal(replies[1].message.messagedId, 3);
    assert.equal(replies[1].message.signedTransaction, signed);
    assert.equal(replies[1].target, 'https://site.example');
    assert.throws(() => page().respond(0, unsigned, signed), /No pending/);

    const rejected = spawnSync(
      process.execPath,
      [
        bridge,
        'reply',
        '--index',
        '0',
        '--public-key',
        signer.publicKey(),
        '--unsigned-xdr',
        unsignedPath,
        '--signed-xdr',
        signedPath,
        '--expected-hash',
        '0'.repeat(64),
      ],
      { encoding: 'utf8' },
    );
    assert.notEqual(rejected.status, 0);
    assert.equal(rejected.stdout, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the Freighter page bridge answers access and allowed-status requests', () => {
  const key = Keypair.random().publicKey(); // Isolated mock key. Never import it into 1Password.
  const source = execFileSync(
    process.execPath,
    [bridge, 'inject', '--public-key', key, '--origin', 'https://site.example'],
    {
      encoding: 'utf8',
    },
  );
  const events: ((event: PageEvent) => void)[] = [];
  const replies: Record<string, unknown>[] = [];
  const window: PageWindow = {
    addEventListener: (_name, listener) => {
      events.push(listener);
    },
    postMessage: (message) => {
      replies.push(message);
    },
  };
  vm.runInNewContext(source, { window, location: { origin: 'https://site.example' }, Date, Error });
  const types = ['REQUEST_PUBLIC_KEY', 'REQUEST_ALLOWED_STATUS', 'SET_ALLOWED_STATUS', 'REQUEST_USER_INFO'];
  types.forEach((type, messageId) =>
    events[0]({
      source: window,
      origin: 'https://site.example',
      data: { source: 'FREIGHTER_EXTERNAL_MSG_REQUEST', messageId, type },
    }),
  );
  // The page objects come from another realm. Compare plain copies.
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(replies), [
    { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: 0, publicKey: key },
    { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: 1, isAllowed: true },
    { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: 2, isAllowed: true },
  ]);
  assert.deepEqual(plain(window.__walletermBridge?.unsupported), [
    { type: 'REQUEST_USER_INFO', messageId: 3 },
  ]);
});

test('a reviewed SEP-53 message crosses the Freighter page bridge once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-site-bridge-'));
  try {
    const signer = Keypair.random(); // Isolated mock key. Never import it into 1Password.
    const other = Keypair.random(); // Isolated mock key. Never import it into 1Password.
    const message = 'Example lane tx 2b1f… ✓';
    const digest = createHash('sha256').update('Stellar Signed Message:\n').update(message).digest('hex');
    const messagePath = join(directory, 'message.json');
    writeFileSync(messagePath, JSON.stringify(message), { mode: 0o600 });
    // The `walleterm sign` result shape: lowercase hexadecimal over the SEP-53 digest.
    const result = (key: Keypair) => ({
      ok: true,
      public_key: signer.publicKey(),
      digest,
      signature: Buffer.from(key.signMessage(message)).toString('hex'),
      verified: true,
    });
    const resultPath = join(directory, 'result.json');
    const otherPath = join(directory, 'other.json');
    writeFileSync(resultPath, JSON.stringify(result(signer)), { mode: 0o600 });
    writeFileSync(otherPath, JSON.stringify(result(other)), { mode: 0o600 });

    const source = execFileSync(
      process.execPath,
      [bridge, 'inject', '--public-key', signer.publicKey(), '--origin', 'https://site.example'],
      { encoding: 'utf8' },
    );
    const events: ((event: PageEvent) => void)[] = [];
    const replies: { message: Record<string, unknown>; target: string }[] = [];
    const window: PageWindow = {
      addEventListener: (_name, listener) => {
        events.push(listener);
      },
      postMessage: (reply, target) => {
        replies.push({ message: reply, target });
      },
    };
    const context = { window, location: { origin: 'https://site.example' }, Date, Error };
    vm.runInNewContext(source, context);
    const blob = (messageId: number, text: string, apiVersion: string) =>
      events[0]({
        source: window,
        origin: 'https://site.example',
        data: {
          source: 'FREIGHTER_EXTERNAL_MSG_REQUEST',
          messageId,
          type: 'SUBMIT_BLOB',
          blob: text,
          apiVersion,
        },
      });
    blob(7, message, '6.0.0');
    blob(8, message, '3.1.0');
    blob(9, 'Another message', '6.0.0');
    const page = window.__walletermBridge;
    assert.ok(page);

    const replyMessage = (index: number, path: string) =>
      spawnSync(
        process.execPath,
        [
          bridge,
          'reply-message',
          '--index',
          String(index),
          '--public-key',
          signer.publicKey(),
          '--message-json',
          messagePath,
          '--result',
          path,
        ],
        { encoding: 'utf8' },
      );
    const wrongSigner = replyMessage(0, otherPath);
    assert.notEqual(wrongSigner.status, 0);
    assert.equal(wrongSigner.stdout, '');

    const reply = replyMessage(0, resultPath);
    assert.equal(reply.status, 0, reply.stderr);
    vm.runInNewContext(reply.stdout, context);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].message.messagedId, 7);
    assert.equal(replies[0].message.signerAddress, signer.publicKey());
    assert.equal(replies[0].target, 'https://site.example');
    const signedBlob = Buffer.from(String(replies[0].message.signedBlob), 'base64');
    assert.ok(signer.verifyMessage(message, signedBlob));
    assert.throws(() => vm.runInNewContext(reply.stdout, context), /No pending message/);

    // The same signature never answers an older API or a different message.
    assert.throws(() => vm.runInNewContext(replyMessage(1, resultPath).stdout, context), /before 4/);
    assert.throws(() => vm.runInNewContext(replyMessage(2, resultPath).stdout, context), /changed/);
    assert.equal(replies.length, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
