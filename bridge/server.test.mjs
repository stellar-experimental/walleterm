import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Account, Asset, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { createBridge } from './server.mjs';
import { inspectTransaction } from './transaction.mjs';
import { WalletermClient } from '../sdk/walleterm.js';

const key = Keypair.random(), other = Keypair.random(); // Isolated offline mock keys only.
const publicKey = key.publicKey();
function input(id = 'request-1', options = {}) {
  const tx = new TransactionBuilder(new Account(options.source || publicKey, '10'), { fee: options.fee || '100', networkPassphrase: Networks.TESTNET })
    .addOperation(options.operation || Operation.manageData({ name: 'test', value: 'hello' }));
  if (options.memo) tx.addMemo(options.memo);
  return { id, public_key: publicKey, network_passphrase: Networks.TESTNET, transaction_xdr: tx.setTimeout(options.timeout ?? 180).build().toXDR() };
}
async function until(fn) {
  for (let i = 0; i < 200; i++) { const result = await fn(); if (result) return result; await delay(5); }
  throw Error('The test timed out.');
}
async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-bridge-test-')), decisions = [];
  let calls = 0, reviews = 0;
  const bridge = createBridge({ port: 0, stateDir: directory, listSigners: async () => [{ public_key: publicKey, comment: 'Mock key' }],
    review: (request, { signal }) => new Promise((resolve, reject) => {
      reviews++;
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      decisions.push({ request, decide(value) { signal.removeEventListener('abort', aborted); resolve(value); } });
    }),
    sign: async (_key, hash) => { calls++; return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex'); }, ...options });
  await bridge.listen(); const origin = `http://127.0.0.1:${bridge.server.address().port}`; bridge.setPublicOrigin(origin);
  async function request(path, data, { site = 'https://site-one.example', token } = {}) {
    const response = await fetch(origin + path, { method: data === undefined ? 'GET' : 'POST', headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), Origin: site, ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  t.after(async () => { await bridge.close(); rmSync(directory, { recursive: true, force: true }); });
  async function connect(site = 'https://site-one.example') {
    const r = await request('/v1/connect', { code: bridge.pairing.code }, { site }); assert.equal(r.status, 201);
    const s = { site, token: r.data.token };
    assert.equal((await request('/v1/select', { public_key: publicKey }, s)).status, 200);
    return s;
  }
  async function decide(value = true) { const decision = await until(() => decisions.shift()); decision.decide(value); return decision.request; }
  async function result(s, id = 'request-1') {
    return until(async () => { const r = await request(`/v1/requests/${id}`, undefined, s); return !['pending', 'approved', 'signing'].includes(r.data.state) && r; });
  }
  const client = site => new WalletermClient(origin, { pollInterval: 1, fetch: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: site } }) });
  return { bridge, directory, origin, request, connect, decide, result, client, calls: () => calls, reviews: () => reviews };
}

test('short codes expire, rotate once, and stop after five incorrect attempts', async t => {
  let clock = Date.now(); const f = await fixture(t, { now: () => clock });
  const original = f.bridge.pairing.code; assert.match(original, /^\d{8}$/);
  await f.connect(); assert.notEqual(f.bridge.pairing.code, original);
  assert.equal((await f.request('/v1/connect', { code: original })).status, 403);
  clock += 300001; assert.equal((await f.request('/v1/connect', { code: f.bridge.pairing.code })).status, 403);
  clock -= 300001;
  for (let i = 0; i < 4; i++) assert.equal((await f.request('/v1/connect', { code: 'wrong' })).status, 403);
  assert.equal((await f.request('/v1/connect', { code: f.bridge.pairing.code })).status, 429);
  assert.equal(f.calls(), 0);
});

test('an unused code rotates at expiry', t => {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-bridge-test-'));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bridge = createBridge({ port: 0, stateDir: directory }); let printed = 0;
  t.after(async () => { t.mock.timers.reset(); await bridge.close(); rmSync(directory, { recursive: true, force: true }); });
  bridge.onPairingChanged(() => printed++);
  const original = bridge.pairing.code;
  t.mock.timers.tick(299999); assert.equal(bridge.pairing.code, original);
  t.mock.timers.tick(1); assert.notEqual(bridge.pairing.code, original); assert.equal(printed, 1);
});

test('a new code prints only after the open review ends', async t => {
  const f = await fixture(t), a = await f.connect(); let printed = 0;
  f.bridge.onPairingChanged(() => printed++);
  await f.request('/v1/requests', input(), a); await until(() => f.reviews() === 1);
  await f.connect('https://site-two.example'); assert.equal(printed, 0);
  await f.decide(false); await f.result(a); assert.equal(printed, 1);
});

test('ended sessions release their connection slots', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 65; i++) {
    const { status, data } = await f.request('/v1/connect', { code: f.bridge.pairing.code }); assert.equal(status, 201);
    assert.equal((await f.request('/v1/disconnect', {}, { token: data.token })).status, 200);
  }
});

test('two origins have separate authority; no HTTP request approves a signature', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect('https://site-two.example');
  const initial = input(); assert.equal((await f.request('/v1/requests', initial, a)).status, 201);
  assert.equal((await f.request('/v1/requests/request-1', undefined, b)).status, 404);
  assert.equal((await f.request('/v1/account', undefined, { ...a, site: b.site })).status, 401);
  for (const path of ['/api/pair', '/api/connect', '/api/approve', '/api/deny', '/v1/approve']) {
    assert.equal((await f.request(path, { code: f.bridge.pairing.code, hash: 'anything' }, a)).status, 404);
  }
  assert.equal(f.calls(), 0);
  const reviewed = await f.decide(); assert.equal(reviewed.origin, a.site); assert.equal(reviewed.signer.public_key, publicKey); assert.equal(reviewed.signer.comment, 'Mock key');
  const approved = await f.result(a); assert.equal(approved.data.state, 'signed'); assert.equal(f.calls(), 1);
  const tx = TransactionBuilder.fromXDR(approved.data.signed_xdr, Networks.TESTNET);
  assert.ok(key.verify(tx.hash(), tx.signatures[0].signature.toBytes()));
  assert.equal((await f.request('/v1/requests', initial, a)).data.state, 'signed'); assert.equal(f.calls(), 1);
  assert.equal((await f.request('/v1/requests', input('request-1', { memo: Memo.text('changed') }), a)).status, 409);
  const persisted = JSON.parse(readFileSync(join(f.directory, readdirSync(f.directory).find(x => x.startsWith('request-')))));
  assert.equal(persisted.state, 'signed'); assert.equal(persisted.signed_xdr, approved.data.signed_xdr);
});

test('wallet discovery requires a session and wallet selection cannot change', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/v1/signers')).status, 401);
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code }); const a = { token: data.token };
  assert.equal((await f.request('/v1/signers', undefined, a)).data.signers[0].public_key, publicKey);
  assert.equal((await f.request('/v1/requests', input(), a)).status, 409);
  assert.equal((await f.request('/v1/select', { public_key: other.publicKey() }, a)).status, 400);
  assert.equal((await f.request('/v1/select', { public_key: publicKey }, a)).status, 200);
  assert.equal((await f.request('/v1/select', { public_key: other.publicKey() }, a)).status, 409);
  await f.request('/v1/disconnect', {}, a);
  assert.equal((await f.request('/v1/signers', undefined, a)).status, 401);
});

test('invalid or excessive transactions never invoke review or signing', async t => {
  const f = await fixture(t), a = await f.connect();
  for (const item of [
    { ...input(), network_passphrase: Networks.PUBLIC }, input('bad-fee', { fee: '100001' }),
    input('no-expiry', { timeout: 0 }), input('long', { timeout: 600 }), input('wrong-source', { source: other.publicKey() }),
    input('op-source', { operation: Operation.manageData({ name: 'x', value: 'y', source: other.publicKey() }) }),
    input('unsupported', { operation: Operation.setOptions({ homeDomain: 'example.com' }) }),
    { ...input(), transaction_xdr: 'garbage' }, { ...input(), public_key: other.publicKey() }, { ...input(), extra: true },
  ]) assert.equal((await f.request('/v1/requests', item, a)).status, 400, item.id);
  assert.equal(f.calls(), 0); assert.equal(f.reviews(), 0);
});

test('review records exact offer price, destination, memo and data bytes', () => {
  const offer = inspectTransaction(input('offer', { operation: Operation.manageSellOffer({ selling: Asset.native(), buying: new Asset('USD', other.publicKey()), amount: '0.1', price: { n: 1, d: 3 }, offerId: '10' }) }), publicKey).details;
  assert.equal(offer.operation.price_numerator, 1); assert.equal(offer.operation.price_denominator, 3); assert.equal(offer.operation.offer_id, '10');
  const pay = inspectTransaction(input('pay', { memo: Memo.text('a'), operation: Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: '0.01' }) }), publicKey).details;
  assert.equal(pay.operation.destination, other.publicKey()); assert.equal(pay.memo.value, 'a');
  assert.equal(inspectTransaction(input(), publicKey).details.operation.value_hex, Buffer.from('hello').toString('hex'));
});

test('denial, expiry and removal of a key do not sign', async t => {
  let clock = Date.now(), keys = [{ public_key: publicKey }];
  const f = await fixture(t, { now: () => clock, listSigners: async () => keys }), a = await f.connect();
  await f.request('/v1/requests', input(), a); await f.decide(false); assert.equal((await f.result(a)).data.state, 'denied');
  await f.request('/v1/requests', input('removed'), a); keys = []; await f.decide();
  assert.equal((await f.result(a, 'removed')).data.state, 'denied'); assert.equal(f.calls(), 0);
  keys = [{ public_key: publicKey }]; await f.request('/v1/requests', input('expired'), a); clock += 181000;
  assert.equal((await f.result(a, 'expired')).data.state, 'expired'); assert.equal(f.calls(), 0);
});

test('canceling a queued review never signs; only one review runs at a time', async t => {
  const f = await fixture(t), a = await f.connect();
  await f.request('/v1/requests', input(), a); await f.request('/v1/requests', input('second'), a);
  assert.equal(f.reviews(), 1);
  await f.request('/v1/requests/second/cancel', {}, a);
  await f.decide(false); assert.equal((await f.result(a)).data.state, 'denied');
  assert.equal((await f.result(a, 'second')).data.state, 'denied'); assert.equal(f.reviews(), 1); assert.equal(f.calls(), 0);
});

for (const revoke of [false, true]) test(`${revoke ? 'revocation' : 'cancellation'} during signing withholds the signature`, async t => {
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { sign: async (_key, hash) => { entered(); await new Promise(resolve => { release = resolve; }); return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex'); } });
  const a = await f.connect(); await f.request('/v1/requests', input(), a); await f.decide(); await waiting;
  const filename = join(f.directory, readdirSync(f.directory).find(x => x.startsWith('request-')));
  assert.equal(JSON.parse(readFileSync(filename)).state, 'signing');
  await f.request(revoke ? '/v1/disconnect' : '/v1/requests/request-1/cancel', {}, a); release(); await delay(10);
  const r = JSON.parse(readFileSync(filename)); assert.equal(r.state, 'unknown'); assert.equal(r.signed_xdr, undefined);
  assert.equal((await f.request('/v1/requests/request-1', undefined, a)).status, revoke ? 401 : 200);
});

test('invalid signatures are never delivered', async t => {
  const f = await fixture(t, { sign: async () => '00'.repeat(64) }), a = await f.connect();
  await f.request('/v1/requests', input(), a); await f.decide(); const result = await f.result(a);
  assert.equal(result.data.state, 'unknown'); assert.equal(result.data.signed_xdr, undefined);
});

test('restart preserves records and invalidates old credentials', async t => {
  const f = await fixture(t), a = await f.connect(); await f.request('/v1/requests', input(), a); await f.bridge.close();
  const restarted = createBridge({ stateDir: f.directory, port: 0 }); t.after(() => restarted.close()); await restarted.listen();
  const record = JSON.parse(readFileSync(join(f.directory, readdirSync(f.directory).find(x => x.startsWith('request-')))));
  assert.ok(['denied', 'expired'].includes(record.state));
  const origin = `http://127.0.0.1:${restarted.server.address().port}`; restarted.setPublicOrigin(origin);
  const response = await fetch(origin + '/v1/account', { headers: { Origin: a.site, Authorization: `Bearer ${a.token}` } }); assert.equal(response.status, 401);
});

test('SDK uses the code and wallet picker, signs, and reconnects after revocation', async t => {
  const f = await fixture(t), site = 'https://adapter.example', client = f.client(site);
  const connect = () => client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  assert.equal((await connect()).address, publicKey); const old = client.connectionId;
  const request = input('sdk'); const result = await client.signTransaction(request.transaction_xdr, {
    address: publicKey, networkPassphrase: Networks.TESTNET, requestId: request.id, onRequest: () => f.decide(),
  }); assert.ok(result.signedTxXdr);
  await f.request('/v1/disconnect', {}, { site, token: client.token });
  await connect(); assert.notEqual(client.connectionId, old);
  await client.disconnect(); assert.equal(client.token, null);
});

test('SDK preserves denied state and clears a canceled wallet selection', async t => {
  const f = await fixture(t), client = f.client('https://adapter.example');
  await assert.rejects(client.connect({ code: f.bridge.pairing.code, selectWallet: async () => { throw Error('Canceled'); } }), /Canceled/);
  assert.equal(client.token, null);
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  const r = input('denied-sdk');
  await assert.rejects(client.signTransaction(r.transaction_xdr, { address: publicKey, networkPassphrase: Networks.TESTNET, requestId: r.id,
    onRequest: () => f.decide(false),
  }), error => error.requestState === 'denied');
});

test('invalid UTF-8 data names fail before review', () => {
  const r = input(), tx = TransactionBuilder.fromXDR(r.transaction_xdr, Networks.TESTNET);
  const envelope = tx.toEnvelope(); envelope.value.tx.operations[0].body.value.dataName.bytes = new Uint8Array([255, 97]);
  r.transaction_xdr = envelope.toXDR('base64'); assert.throws(() => inspectTransaction(r, publicKey), /UTF-8/);
});

test('closing the bridge aborts signing and preserves unknown state', async t => {
  let entered; const waiting = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { sign: (_key, _hash, { signal }) => { entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true })); } });
  const a = await f.connect(); await f.request('/v1/requests', input(), a); await f.decide(); await waiting; await f.bridge.close();
  const saved = JSON.parse(readFileSync(join(f.directory, readdirSync(f.directory).find(x => x.startsWith('request-')))));
  assert.equal(saved.state, 'unknown'); assert.equal(saved.signed_xdr, undefined); assert.ok(!readdirSync(f.directory).includes('.web-lock'));
});
