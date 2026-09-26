import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
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
  const decisions = [], logs = [];
  let calls = 0, reviews = 0;
  const bridge = createBridge({ port: 0, log: line => logs.push(line), listSigners: async () => [{ public_key: publicKey, comment: 'Mock key' }],
    review: (request, { signal }) => new Promise((resolve, reject) => {
      reviews++;
      const aborted = () => reject(signal.reason);
      signal.addEventListener('abort', aborted, { once: true });
      decisions.push({ request, signal, decide(value) { signal.removeEventListener('abort', aborted); resolve(value); } });
    }),
    sign: async (_key, hash) => { calls++; return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex'); }, ...options });
  await bridge.listen(); const origin = `http://127.0.0.1:${bridge.server.address().port}`; bridge.setPublicOrigin(origin);
  async function request(path, data, { site = 'https://site-one.example', token } = {}) {
    const response = await fetch(origin + path, { method: data === undefined ? 'GET' : 'POST', headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), Origin: site, ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  t.after(() => bridge.close());
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
  const client = (site, options = {}) => new WalletermClient(origin, { pollInterval: 1, fetch: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: site } }), ...options });
  return { bridge, origin, request, connect, decide, result, client, decisions, logs, calls: () => calls, reviews: () => reviews };
}

test('short codes expire, rotate once, and pause for one minute after five incorrect attempts', async t => {
  let clock = Date.now(); const f = await fixture(t, { now: () => clock });
  const original = f.bridge.pairing.code; assert.match(original, /^\d{8}$/);
  await f.connect(); assert.notEqual(f.bridge.pairing.code, original);
  assert.equal((await f.request('/v1/connect', { code: original })).status, 403);
  clock += 300001; assert.equal((await f.request('/v1/connect', { code: f.bridge.pairing.code })).status, 403);
  clock -= 300001;
  const beforeLock = f.bridge.pairing.code;
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/v1/connect', { code: 'wrong' })).status, 403);
  assert.notEqual(f.bridge.pairing.code, beforeLock);
  assert.equal((await f.request('/v1/connect', { code: f.bridge.pairing.code })).status, 429);
  clock += 60000; assert.equal((await f.request('/v1/connect', { code: f.bridge.pairing.code })).status, 201);
  assert.equal(f.calls(), 0);
});

test('an unused code rotates at expiry', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bridge = createBridge({ port: 0 }); let printed = 0;
  t.after(async () => { t.mock.timers.reset(); await bridge.close(); });
  bridge.onPairingChanged(() => printed++);
  const original = bridge.pairing.code;
  t.mock.timers.tick(299999); assert.equal(bridge.pairing.code, original);
  t.mock.timers.tick(1); assert.notEqual(bridge.pairing.code, original); assert.equal(printed, 1);
});

test('ended sessions release their connection slots', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 65; i++) {
    const { status, data } = await f.request('/v1/connect', { code: f.bridge.pairing.code }); assert.equal(status, 201);
    assert.equal((await f.request('/v1/disconnect', {}, { token: data.token })).status, 200);
  }
});

test('two origins have separate authority; only the review hook decides a request', async t => {
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
  assert.deepEqual(f.logs, [`Signed ${approved.data.hash} (account ${publicKey}, sequence 11) for ${a.site}.\n`]);
});

test('wallet discovery requires a session and legacy wallet selection cannot change', async t => {
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

const both = [{ public_key: publicKey, comment: 'First' }, { public_key: other.publicKey(), comment: 'Second' }];
async function scoped(f, site) {
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'available' }, { site });
  const session = { token: data.token, site };
  const listing = await f.request('/v1/signers', undefined, session);
  assert.equal((await f.request('/v1/select', { public_key: publicKey, expected_revision: 0, grant_id: listing.data.grant_id }, session)).status, 200);
  return session;
}
const select = (f, s, address, revision) => f.request('/v1/select', { public_key: address, expected_revision: revision }, s);

test('scoped wallets pin the displayed list and never renew the connection deadline', async t => {
  let keys = [both[0]], clock = Date.now();
  const f = await fixture(t, { listSigners: async () => keys, now: () => clock });
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'available' });
  const a = { token: data.token }, offered = (await f.request('/v1/signers', undefined, a)).data;
  keys = both;
  assert.equal((await f.request('/v1/select', { public_key: other.publicKey(), expected_revision: 0, grant_id: offered.grant_id }, a)).status, 400);
  assert.equal((await f.request('/v1/select', { public_key: publicKey, expected_revision: 0, grant_id: offered.grant_id }, a)).status, 200);
  const before = (await f.request('/v1/account', undefined, a)).data;
  assert.deepEqual((await f.request('/v1/signers', undefined, a)).data.signers, [both[0]]);
  assert.equal((await select(f, a, other.publicKey(), 1)).status, 400);
  clock += 5000;
  assert.equal((await select(f, a, publicKey, 1)).data.selection_revision, 1);
  assert.equal((await f.request('/v1/account', undefined, a)).data.expires_at, before.expires_at);
  keys = [];
  assert.equal((await select(f, a, publicKey, 1)).status, 400);
  assert.deepEqual((await f.request('/v1/signers', undefined, a)).data.signers, []);
});

test('first selection rejects a replaced discovery grant and an unknown scope', async t => {
  const f = await fixture(t, { listSigners: async () => both });
  assert.equal((await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'all' })).status, 400);
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'available' });
  const a = { token: data.token }, old = (await f.request('/v1/signers', undefined, a)).data.grant_id;
  await f.request('/v1/signers', undefined, a);
  assert.equal((await f.request('/v1/select', { public_key: publicKey, expected_revision: 0, grant_id: old }, a)).status, 409);
});

test('switches cancel queued reviews, preserve other sessions, and reject A-B-A delayed requests', async t => {
  const f = await fixture(t, { listSigners: async () => both }), a = await scoped(f), b = await scoped(f, 'https://second.example');
  const old = { ...input(), selection_revision: 1 };
  await f.request('/v1/requests', old, a);
  await f.request('/v1/requests', { ...input('queued'), selection_revision: 1 }, a);
  await f.request('/v1/requests', { ...input('separate'), selection_revision: 1 }, b);
  assert.equal((await select(f, a, other.publicKey(), 1)).data.selection_revision, 2);
  assert.equal((await f.result(a)).data.state, 'denied');
  assert.equal((await f.result(a, 'queued')).data.state, 'denied');
  assert.equal((await select(f, a, publicKey, 2)).data.selection_revision, 3);
  assert.equal((await f.request('/v1/requests', old, a)).status, 409);
  assert.equal((await f.request('/v1/requests', { ...input('delayed'), selection_revision: 1 }, a)).status, 409);
  assert.equal((await f.request('/v1/requests', input('missing-revision'), a)).status, 409);
  assert.equal((await select(f, a, other.publicKey(), 1)).status, 409);
  const first = await f.decide(); assert.equal(first.signer.public_key, publicKey);
  await f.decide(); assert.equal((await f.result(b, 'separate')).data.state, 'signed');
  assert.equal(f.calls(), 1);
});

test('simultaneous switches use compare-and-set after delayed discovery', async t => {
  let gate, entered = 0;
  const f = await fixture(t, { listSigners: async () => { entered++; if (gate) await gate; return both; } }), a = await scoped(f);
  let release; gate = new Promise(resolve => { release = resolve; });
  const before = entered;
  const changes = [select(f, a, other.publicKey(), 1), select(f, a, other.publicKey(), 1)];
  await until(() => entered > before); await delay(10); release();
  assert.deepEqual((await Promise.all(changes)).map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.request('/v1/account', undefined, a)).data.selection_revision, 2);
});

for (const phase of ['approved', 'signing', 'signed']) test(`a switch during ${phase} withholds the old result`, async t => {
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  let hold = false;
  const f = await fixture(t, { listSigners: async () => { if (hold) { hold = false; entered(); await new Promise(resolve => { release = resolve; }); } return both; },
    sign: async (_key, hash) => { if (phase === 'signing') { entered(); await new Promise(resolve => { release = resolve; }); } return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex'); } });
  const a = await scoped(f);
  if (phase === 'approved') hold = true;
  await f.request('/v1/requests', { ...input(), selection_revision: 1 }, a);
  const decision = await until(() => f.decisions.shift());
  assert.equal(decision.request.signer.public_key, publicKey); decision.decide(true);
  if (phase === 'signed') await f.result(a); else await waiting;
  assert.equal((await select(f, a, other.publicKey(), 1)).status, 200);
  release?.();
  const result = await f.result(a);
  assert.equal(result.data.state, phase === 'approved' ? 'denied' : 'unknown');
  assert.equal(result.data.signed_xdr, undefined);
});

test('SDK switches in one session and recovers a lost selection response', async t => {
  const f = await fixture(t, { listSigners: async () => both }); let lose = false, pairings = 0;
  const client = f.client('https://adapter.example', { fetch: async (url, options) => {
    if (url.endsWith('/v1/connect')) pairings++;
    const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } });
    if (lose && url.endsWith('/v1/select')) { lose = false; throw TypeError('Lost selection response'); }
    return response;
  } });
  await client.connect({ code: f.bridge.pairing.code, walletScope: 'available', selectWallet: async keys => keys[0].public_key });
  const token = client.token;
  lose = true; await assert.rejects(client.selectWallet(other.publicKey()), /Lost selection response/);
  assert.equal(client.account.address, other.publicKey()); assert.equal(client.revision, 2);
  await client.selectWallet(publicKey); assert.equal(client.token, token); assert.equal(pairings, 1);
});

test('a delayed account response cannot overwrite a newer SDK wallet', async t => {
  const f = await fixture(t, { listSigners: async () => both }); let hold = false, release;
  const client = f.client('https://adapter.example', { fetch: async (url, options) => {
    const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } });
    if (hold && url.endsWith('/v1/account')) { hold = false; await new Promise(resolve => { release = resolve; }); }
    return response;
  } });
  await client.connect({ code: f.bridge.pairing.code, walletScope: 'available', selectWallet: async keys => keys[0].public_key });
  hold = true; const old = client.getAddress(); const rejected = assert.rejects(old, /connection changed/);
  await until(() => release); await client.selectWallet(other.publicKey()); release(); await rejected;
  assert.equal(client.account.address, other.publicKey());
});

test('a delayed request body fails after switching away and back', async t => {
  const f = await fixture(t, { listSigners: async () => both }), a = await scoped(f);
  const data = JSON.stringify({ ...input('late-body'), selection_revision: 1 });
  let finish;
  const reply = new Promise((resolve, reject) => {
    const req = httpRequest(f.origin + '/v1/requests', { method: 'POST', headers: {
      Origin: 'https://site-one.example', Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data),
    } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.write(data.slice(0, -1)); finish = () => req.end(data.slice(-1));
  });
  await select(f, a, other.publicKey(), 1); await select(f, a, publicKey, 2);
  finish(); assert.equal(await reply, 409); assert.equal(f.reviews(), 0);
});

test('expiry aborts active signing and switching never extends the deadline', async t => {
  let clock = Date.now(), entered, aborted = false;
  const waiting = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { now: () => clock, listSigners: async () => both,
    sign: (_key, _hash, { signal }) => { entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true })); } });
  const a = await scoped(f), initial = (await f.request('/v1/account', undefined, a)).data;
  await select(f, a, other.publicKey(), 1); await select(f, a, publicKey, 2);
  assert.equal((await f.request('/v1/account', undefined, a)).data.expires_at, initial.expires_at);
  await f.request('/v1/requests', { ...input(), selection_revision: 3 }, a); await f.decide(); await waiting;
  clock = Date.parse(initial.expires_at);
  assert.equal((await f.request('/v1/account', undefined, a)).status, 401);
  assert.equal(aborted, true); assert.match(f.logs.at(-1), /Signature withheld or stopped/);
});

test('SDK withholds a delayed successful signature after a same-session wallet change', async t => {
  const f = await fixture(t, { listSigners: async () => both, review: undefined }); let release;
  const client = f.client('https://adapter.example', { fetch: async (url, options) => {
    const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } });
    // Deliberately ignore abort after the server completed this response.
    if (url.endsWith('/v1/requests')) await new Promise(resolve => { release = resolve; });
    return response;
  } });
  await client.connect({ code: f.bridge.pairing.code, walletScope: 'available', selectWallet: async keys => keys[0].public_key });
  const signing = client.signTransaction(input().transaction_xdr).catch(error => error);
  await until(() => release); await client.selectWallet(other.publicKey()); release();
  const error = await signing; assert.ok(error instanceof Error); assert.equal(error.canceled, true);
  assert.equal(client.account.address, other.publicKey()); assert.equal(f.calls(), 1);
});

test('scoped signing fails closed after a key is removed or discovery fails', async t => {
  let keys = both, broken = false;
  const f = await fixture(t, { listSigners: async () => { if (broken) throw Error('Discovery failed'); return keys; } });
  const a = await scoped(f);
  for (const [id, fail] of [['removed', false], ['lookup-failed', true]]) {
    keys = both; broken = false;
    await f.request('/v1/requests', { ...input(id), selection_revision: 1 }, a);
    keys = [both[1]]; broken = fail; await f.decide();
    assert.equal((await f.result(a, id)).data.state, 'denied');
  }
  assert.equal(f.calls(), 0);
});

test('SDK keeps signing blocked when an aborted selection still awaits discovery', async t => {
  let hold = false, release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { listSigners: async () => { if (hold) { entered(); await new Promise(resolve => { release = resolve; }); } return both; } });
  const client = f.client('https://adapter.example');
  await client.connect({ code: f.bridge.pairing.code, walletScope: 'available', selectWallet: async keys => keys[0].public_key });
  hold = true; const controller = new AbortController();
  const changing = client.selectWallet(other.publicKey(), { signal: controller.signal });
  const failed = assert.rejects(changing); await waiting; controller.abort(Error('Selection canceled')); await failed;
  assert.equal(client.account, null);
  await assert.rejects(client.signTransaction(input().transaction_xdr), /select a wallet first/);
  await assert.rejects(client.selectWallet(publicKey), /Recover the account/);
  await assert.rejects(client.getAddress(), /not confirmed/);
  hold = false; release();
  await until(async () => (await f.request('/v1/account', undefined, { token: client.token, site: 'https://adapter.example' })).data.selection_revision === 2);
  assert.equal((await client.getAddress()).address, other.publicKey()); assert.equal(f.calls(), 0);
});

test('SDK rejects account reads started during a wallet selection', async t => {
  let hold = false, release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { listSigners: async () => { if (hold) { entered(); await new Promise(resolve => { release = resolve; }); } return both; } });
  const client = f.client('https://adapter.example');
  await client.connect({ code: f.bridge.pairing.code, walletScope: 'available', selectWallet: async keys => keys[0].public_key });
  hold = true; const changing = client.selectWallet(other.publicKey()); await waiting;
  await assert.rejects(client.getAddress(), /selection to finish/);
  hold = false; release(); await changing; assert.equal(client.account.address, other.publicKey());
});

test('SDK preserves signing uncertainty when session expiry prevents cancellation', async t => {
  let clock = Date.now(), entered, release;
  const waiting = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { now: () => clock, review: undefined,
    sign: async (_key, hash) => { entered(); await new Promise(resolve => { release = resolve; }); return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex'); } });
  const client = f.client('https://adapter.example');
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  const signing = client.signTransaction(input().transaction_xdr).catch(error => error);
  await waiting; clock += 3600001;
  const error = await signing; release();
  assert.equal(error.canceled, true); assert.equal(error.requestState, 'unknown'); assert.equal(client.token, null);
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
  assert.equal((await f.request('/v1/requests/request-1', undefined, a)).data.state, 'signing');
  await f.request(revoke ? '/v1/disconnect' : '/v1/requests/request-1/cancel', {}, a); release(); await delay(10);
  const r = await f.request('/v1/requests/request-1', undefined, a);
  if (revoke) assert.equal(r.status, 401); else { assert.equal(r.data.state, 'unknown'); assert.equal(r.data.signed_xdr, undefined); }
  assert.equal(f.logs.length, 2); assert.match(f.logs[0], /^Signature withheld or stopped for [0-9a-f]{64} \(account G/);
  assert.match(f.logs[1], /^1Password returned a signature after cancellation/);
});

test('invalid signatures are never delivered', async t => {
  const f = await fixture(t, { sign: async () => '00'.repeat(64) }), a = await f.connect();
  await f.request('/v1/requests', input(), a); await f.decide(); const result = await f.result(a);
  assert.equal(result.data.state, 'unknown'); assert.equal(result.data.signed_xdr, undefined);
});

test('restart invalidates old credentials and requests', async t => {
  const f = await fixture(t), a = await f.connect(); await f.request('/v1/requests', input(), a); await f.bridge.close();
  assert.equal(f.calls(), 0);
  const restarted = createBridge({ port: 0 }); t.after(() => restarted.close()); await restarted.listen();
  const origin = `http://127.0.0.1:${restarted.server.address().port}`; restarted.setPublicOrigin(origin);
  const response = await fetch(origin + '/v1/account', { headers: { Origin: a.site, Authorization: `Bearer ${a.token}` } }); assert.equal(response.status, 401);
});

test('SDK uses the code and wallet picker, signs, and reconnects after revocation', async t => {
  const f = await fixture(t), site = 'https://adapter.example', client = f.client(site);
  const connect = () => client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  assert.equal((await connect()).address, publicKey); const old = client.token;
  // The address and network default to the connected account.
  const signing = client.signTransaction(input('sdk').transaction_xdr); await f.decide();
  const result = await signing; assert.ok(result.signedTxXdr); assert.equal(result.signerAddress, publicKey);
  await f.request('/v1/disconnect', {}, { site, token: client.token });
  await connect(); assert.notEqual(client.token, old);
  await client.disconnect(); assert.equal(client.token, null); assert.equal(client.account, null);
});

test('SDK preserves denied state and clears a canceled wallet selection', async t => {
  const f = await fixture(t), client = f.client('https://adapter.example');
  await assert.rejects(client.connect({ code: f.bridge.pairing.code, selectWallet: async () => { throw Error('Canceled'); } }), /Canceled/);
  assert.equal(client.token, null);
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  const denied = client.signTransaction(input('denied-sdk').transaction_xdr); await f.decide(false);
  await assert.rejects(denied, error => error.requestState === 'denied');
});

test('aborting an SDK request cancels its review and never signs', async t => {
  const f = await fixture(t), client = f.client('https://adapter.example'), controller = new AbortController();
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  const signing = client.signTransaction(input('aborted').transaction_xdr, { signal: controller.signal });
  await until(() => f.reviews() === 1); controller.abort();
  await assert.rejects(signing); await until(() => f.decisions[0]?.signal.aborted);
  assert.equal(f.calls(), 0);
});

test('invalid UTF-8 data names fail before review', () => {
  const r = input(), tx = TransactionBuilder.fromXDR(r.transaction_xdr, Networks.TESTNET);
  const envelope = tx.toEnvelope(); envelope.value.tx.operations[0].body.value.dataName.bytes = new Uint8Array([255, 97]);
  r.transaction_xdr = envelope.toXDR('base64'); assert.throws(() => inspectTransaction(r, publicKey), /UTF-8/);
});

test('closing the bridge aborts signing and reports it', async t => {
  let entered; const waiting = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, { sign: (_key, _hash, { signal }) => { entered(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true })); } });
  const a = await f.connect(); await f.request('/v1/requests', input(), a); await f.decide(); await waiting; await f.bridge.close();
  assert.equal(f.logs.length, 1); assert.match(f.logs[0], /^Signature withheld or stopped for /);
});

test('canceling a signed request withholds its result', async t => {
  const f = await fixture(t), a = await f.connect();
  await f.request('/v1/requests', input(), a); await f.decide(); assert.equal((await f.result(a)).data.state, 'signed');
  const canceled = await f.request('/v1/requests/request-1/cancel', {}, a);
  assert.equal(canceled.data.state, 'unknown'); assert.equal(canceled.data.signed_xdr, undefined);
  assert.match(f.logs.at(-1), /^Signature withheld or stopped/);
});

test('SDK retries a failed poll and a lost first response', async t => {
  const f = await fixture(t); let failures = 2;
  const flaky = async (url, options) => {
    const response = await fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } });
    if (failures && url.includes('/v1/requests')) { failures--; return { ok: false, status: 502, json: async () => { throw SyntaxError('HTML'); } }; }
    return response;
  };
  const client = f.client('https://adapter.example', { fetch: flaky });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  const signing = client.signTransaction(input('flaky').transaction_xdr); await f.decide();
  assert.ok((await signing).signedTxXdr); assert.equal(f.calls(), 1); assert.equal(f.reviews(), 1);
});

test('leaving the page cancels an open SDK request', async t => {
  const f = await fixture(t), page = new EventTarget(), sent = [];
  const client = f.client('https://adapter.example', { page, fetch: (url, options) => { sent.push({ url, options }); return fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } }); } });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  const signing = client.signTransaction(input('leave').transaction_xdr).catch(error => error);
  await until(() => f.reviews() === 1); page.dispatchEvent(new Event('pagehide'));
  await until(() => f.decisions[0]?.signal.aborted);
  const error = await signing; assert.match(error.message, /page closed/); assert.equal(error.canceled, true); assert.equal(f.calls(), 0);
  const leaving = sent.find(item => item.url.endsWith('/cancel') && item.options.keepalive);
  assert.ok(leaving); assert.equal(leaving.options.headers.Authorization, `Bearer ${client.token}`);
});

test('a cancel that arrives before its create blocks that request ID', async t => {
  const f = await fixture(t), a = await f.connect();
  const early = await f.request('/v1/requests/late/cancel', {}, a); assert.equal(early.status, 200);
  assert.equal((await f.request('/v1/requests', input('late'), a)).status, 409); assert.equal(f.reviews(), 0);
});

test('concurrent key listings share one signer process', async t => {
  let listings = 0, release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { listSigners: async () => { listings++; await gate; return [{ public_key: publicKey }]; } });
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code }); const a = { token: data.token };
  const calls = Array.from({ length: 20 }, () => f.request('/v1/signers', undefined, a));
  await delay(20); release(); await Promise.all(calls); assert.equal(listings, 1);
});

test('SDK retries stop when the connection changes', async t => {
  const f = await fixture(t); let fail = true, client;
  const flaky = async (url, options) => {
    if (fail && url.endsWith('/v1/requests')) { fail = false; client.token = 'replaced'; return { ok: false, status: 502, json: async () => ({}) }; }
    return fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } });
  };
  client = f.client('https://adapter.example', { fetch: flaky });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  await assert.rejects(client.signTransaction(input('changed').transaction_xdr), /connection changed/);
  assert.equal(f.reviews(), 0);
});

test('SDK reports an unconfirmed cancel and accepts a primitive abort reason', async t => {
  const f = await fixture(t); let down = false;
  const client = f.client('https://adapter.example', { fetch: async (url, options) => {
    if (down) throw TypeError('offline');
    return fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } });
  } });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  const controller = new AbortController();
  const signing = client.signTransaction(input('offline').transaction_xdr, { signal: controller.signal }).catch(error => error);
  await until(() => f.reviews() === 1); down = true; controller.abort('stop');
  const error = await signing; assert.ok(error instanceof Error); assert.equal(error.canceled, false);
});

test('SDK does not retry a non-JSON 4xx response', async t => {
  const f = await fixture(t); let posts = 0;
  const client = f.client('https://adapter.example', { fetch: async (url, options) => {
    if (url.endsWith('/v1/requests')) { posts++; return { ok: false, status: 413, json: async () => { throw SyntaxError('HTML'); } }; }
    return fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } });
  } });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  await assert.rejects(client.signTransaction(input('big').transaction_xdr), /unreadable response \(413\)/); assert.equal(posts, 1);
});

test('a slow disconnect does not clear a newer connection', async t => {
  const f = await fixture(t); let hold, release;
  const client = f.client('https://adapter.example', { fetch: async (url, options) => {
    const response = fetch(url, { ...options, headers: { ...options.headers, Origin: 'https://adapter.example' } });
    if (hold && url.endsWith('/v1/disconnect')) { await new Promise(resolve => { release = resolve; }); }
    return response;
  } });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  hold = true; const leaving = client.disconnect(); await until(() => release); hold = false;
  client.token = null; await client.connect({ code: f.bridge.pairing.code, selectWallet: async keys => keys[0].public_key });
  const current = client.token; release(); await leaving;
  assert.equal(client.token, current); assert.ok(current);
});

test('without a review hook, the bridge signs a valid request with no terminal step', async t => {
  const f = await fixture(t, { review: undefined }), a = await f.connect();
  await f.request('/v1/requests', input(), a);
  const signed = await f.result(a); assert.equal(signed.data.state, 'signed'); assert.equal(f.reviews(), 0); assert.equal(f.calls(), 1);
  assert.equal((await f.request('/v1/requests', input('bad-fee', { fee: '100001' }), a)).status, 400); assert.equal(f.calls(), 1);
});
