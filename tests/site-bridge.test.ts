import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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
  requests: Record<string, unknown>[];
}
interface PageWindow {
  addEventListener(name: string, listener: (event: PageEvent) => void): void;
  postMessage(message: Record<string, unknown>, target: string): void;
  freighter?: boolean;
  __walletermBridge?: PageBridge;
}

const skill = fileURLToPath(new URL('../.agents/skills/walleterm-site-bridge/', import.meta.url));
const bridge = join(skill, 'scripts/legacy-freighter.ts');

test('a reviewed V1 XDR crosses the legacy page bridge once', () => {
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
        '--legacy-flag',
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
