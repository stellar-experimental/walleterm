import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { test } from 'node:test';
import { Account, Networks, Operation, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { createDemo } from './server.mjs';
import { lookupOffer, offerEffect } from './testnet.mjs';
import { createSubmissionGuard } from '../tests/submission.mjs';

function keypair() {
  const pair = generateKeyPairSync('ed25519');
  const der = pair.publicKey.export({ type: 'spki', format: 'der' });
  return { address: StrKey.encodeEd25519PublicKey(der.subarray(-32)), privateKey: pair.privateKey };
}
function offerResultXdr(type, address) {
  const publicKey = xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(address));
  const entry = new xdr.OfferEntry({
    sellerId: publicKey, offerId: 123n, selling: xdr.Asset.assetTypeNative(),
    buying: xdr.Asset.assetTypeCreditAlphanum4(new xdr.AlphaNum4({ assetCode: Buffer.from('USDC'), issuer: publicKey })),
    amount: 1000000n, price: new xdr.Price({ n: 10, d: 1 }), flags: 0, ext: xdr.OfferEntryExt.v0(),
  });
  const effect = type === 'created' ? xdr.ManageOfferSuccessResultOffer.manageOfferCreated(entry) : xdr.ManageOfferSuccessResultOffer.manageOfferDeleted();
  return new xdr.TransactionResult({
    feeCharged: 100n,
    result: xdr.TransactionResultResult.txSuccess([
      xdr.OperationResult.opInner(xdr.OperationResultTr.manageSellOffer(
        xdr.ManageSellOfferResult.manageSellOfferSuccess(
          new xdr.ManageOfferSuccessResult({ offersClaimed: [], offer: effect }),
        ),
      )),
    ]),
    ext: xdr.TransactionResultExt.v0(),
  }).toXDR('base64');
}

test('the offer effect comes from the transaction result XDR', () => {
  const source = keypair();
  assert.deepEqual(offerEffect(offerResultXdr('created', source.address)), {
    type: 'created', id: '123', amount: '0.1000000',
  });
  assert.deepEqual(offerEffect(offerResultXdr('deleted', source.address)), { type: 'deleted' });
  assert.deepEqual(offerEffect(xdr.TransactionResult.fromXDR(offerResultXdr('created', source.address), 'base64')), {
    type: 'created', id: '123', amount: '0.1000000',
  });
});

test('the offer lookup uses its exact RPC ledger key', async () => {
  const source = keypair();
  let inspected = false;
  const found = await lookupOffer(source.address, '123', {
    getLedgerEntries: async key => {
      assert.equal(key.type, 'offer');
      assert.equal(key.offer.offerId, 123n);
      inspected = true;
      return { latestLedger: 999, entries: [] };
    },
  });
  assert.equal(inspected, true);
  assert.deepEqual(found, { exists: false, latestLedger: 999 });
});

test('a paired phone can review, sign, and submit four bounded testnet actions', async () => {
  const source = keypair();
  const recipient = keypair();
  const port = 18000 + Math.floor(Math.random() * 2000);
  const origin = `http://localhost:${port}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'walleterm-mobile-test-'));
  let signed = 0;
  let submitted = 0;
  let offerEffects = 0;
  let rejectNext = false;
  const demo = createDemo({
    signer: source.address, recipient: recipient.address, port, publicOrigin: origin, stateDir,
    rpcClient: {
      getAccount: async () => new Account(source.address, '1'),
      sendTransaction: async tx => {
        submitted++;
        if (rejectNext) return { status: 'ERROR', hash: Buffer.from(tx.hash()).toString('hex'), errorResult: {} };
        return { status: 'SUCCESS', hash: Buffer.from(tx.hash()).toString('hex'), ledger: 123 };
      },
    },
    offerChecks: {
      offerPreflight: async () => ({ existingOfferIds: [] }),
      listOffers: async () => [{ id: '123' }],
      lookupOffer: async () => ({ exists: true, latestLedger: 999 }),
      offerEffect: () => ++offerEffects === 1 ? { type: 'created', id: '123', amount: '0.1000000' } : { type: 'deleted' },
    },
    sign: async (_publicKey, digest) => {
      signed++;
      return edSign(null, Buffer.from(digest, 'hex'), source.privateKey).toString('hex');
    },
  });
  await demo.listen();
  let cookie = '';
  async function post(path, value, extra = {}) {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', ...extra }, body: JSON.stringify(value) });
    return [response, await response.json()];
  }
  async function waitFor(state, hash) {
    let last;
    for (let i = 0; i < 60; i++) {
      const response = await fetch(`${origin}/api/session`, { headers: { cookie } });
      const value = await response.json();
      last = value;
      if (state === 'complete' && value.last_result?.hash === hash && !value.current) return value.last_result;
      if (value.current?.hash === hash && value.current.state === state) return value.current;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error(`The request did not reach ${state}: ${JSON.stringify(last)}`);
  }
  try {
    let [response] = await post('/api/prepare', { kind: 'note' });
    assert.equal(response.status, 401);
    [response] = await post('/api/pair', { code: new URL(demo.pairUrl).hash.slice(6) }, { origin: 'https://other.example' });
    assert.equal(response.status, 403);
    [response] = await post('/api/pair', { code: new URL(demo.pairUrl).hash.slice(6) });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie').split(';')[0];
    [response] = await post('/api/pair', { code: new URL(demo.pairUrl).hash.slice(6) });
    assert.equal(response.status, 403);

    for (const kind of ['note', 'payment', 'offer', 'cancel_offer']) {
      let item;
      [response, item] = await post('/api/prepare', { kind });
      assert.equal(response.status, 200);
      assert.equal(item.kind, kind);
      assert.equal(item.state, 'prepared');
      assert.equal(item.details.network, 'TESTNET');
      [response] = await post('/api/approve', { id: 'wrong' });
      assert.equal(response.status, 409);
      let signedItem;
      [response, signedItem] = await post('/api/approve', { id: item.id });
      assert.equal(response.status, 202);
      signedItem = await waitFor('signed', item.hash);
      assert.ok(signedItem.signed_xdr);
      [response] = await post('/api/approve', { id: item.id });
      assert.equal(response.status, 409);
      let result;
      [response, result] = await post('/api/submit', { id: item.id });
      assert.equal(response.status, 202);
      result = await waitFor('complete', item.hash);
      assert.equal(result.hash, item.hash);
      assert.equal(result.status, 'SUCCESS');
      assert.equal(result.ledger, 123);
    }
    rejectNext = true;
    const [, rejectedItem] = await post('/api/prepare', { kind: 'note' });
    await post('/api/approve', { id: rejectedItem.id });
    await waitFor('signed', rejectedItem.hash);
    await post('/api/submit', { id: rejectedItem.id });
    const rejected = await waitFor('complete', rejectedItem.hash);
    assert.equal(rejected.status, 'ERROR');
    const [nextResponse, nextItem] = await post('/api/prepare', { kind: 'note' });
    assert.equal(nextResponse.status, 200);
    await post('/api/cancel', { id: nextItem.id });
    assert.equal(signed, 5);
    assert.equal(submitted, 5);
  } finally {
    await demo.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('a second preparation cannot replace the first request during account lookup', async () => {
  const source = keypair();
  const recipient = keypair();
  const port = 20000 + Math.floor(Math.random() * 2000);
  const origin = `http://localhost:${port}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'walleterm-mobile-race-'));
  let enterLookup;
  let releaseLookup;
  const entered = new Promise(resolve => { enterLookup = resolve; });
  const held = new Promise(resolve => { releaseLookup = resolve; });
  const demo = createDemo({ signer: source.address, recipient: recipient.address, port, publicOrigin: origin, stateDir,
    rpcClient: { getAccount: async () => { enterLookup(); await held; return new Account(source.address, '1'); } },
  });
  await demo.listen();
  try {
    const code = new URL(demo.pairUrl).hash.slice(6);
    const paired = await fetch(`${origin}/api/pair`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
    const cookie = paired.headers.get('set-cookie').split(';')[0];
    const post = kind => fetch(`${origin}/api/prepare`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ kind }) });
    const first = post('note');
    await entered;
    const second = await post('payment');
    assert.equal(second.status, 409);
    releaseLookup();
    assert.equal((await first).status, 200);
  } finally {
    releaseLookup();
    await demo.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('a restarted server reconciles one uncertain submission without resending', async () => {
  const source = keypair();
  const recipient = keypair();
  const port = 22000 + Math.floor(Math.random() * 2000);
  const origin = `http://localhost:${port}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'walleterm-mobile-restart-'));
  let sent = 0;
  let lastHash;
  const common = { signer: source.address, recipient: recipient.address, port, publicOrigin: origin, stateDir,
    sign: async (_key, digest) => edSign(null, Buffer.from(digest, 'hex'), source.privateKey).toString('hex') };
  let demo = createDemo({ ...common, rpcClient: {
    getAccount: async () => new Account(source.address, '1'),
    sendTransaction: async tx => { sent++; lastHash = Buffer.from(tx.hash()).toString('hex'); throw Error('connection lost'); },
  } });
  async function pair() {
    const response = await fetch(`${origin}/api/pair`, { method: 'POST', headers: { origin, connection: 'close', 'content-type': 'application/json' }, body: JSON.stringify({ code: new URL(demo.pairUrl).hash.slice(6) }) });
    return response.headers.get('set-cookie').split(';')[0];
  }
  async function post(path, value, cookie) {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { origin, cookie, connection: 'close', 'content-type': 'application/json' }, body: JSON.stringify(value) });
    return [response, await response.json()];
  }
  async function state(cookie) {
    return (await fetch(`${origin}/api/session`, { headers: { cookie, connection: 'close' } })).json();
  }
  async function until(cookie, predicate) {
    for (let i = 0; i < 70; i++) {
      const value = await state(cookie);
      if (predicate(value)) return value;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('The requested state did not appear.');
  }
  await demo.listen();
  try {
    let cookie = await pair();
    let [, item] = await post('/api/prepare', { kind: 'note' }, cookie);
    await post('/api/approve', { id: item.id }, cookie);
    await until(cookie, value => value.current?.state === 'signed');
    await post('/api/submit', { id: item.id }, cookie);
    await until(cookie, value => value.current?.state === 'unknown');
    assert.equal(sent, 1);
    await demo.close();
    demo = createDemo({ ...common, rpcClient: {
      getAccount: async () => new Account(source.address, '1'),
      getTransaction: async hash => ({ status: 'SUCCESS', hash, ledger: 456 }),
      sendTransaction: async () => { sent++; throw Error('must not resend'); },
    } });
    await demo.listen();
    cookie = await pair();
    const recovered = await state(cookie);
    assert.equal(recovered.current?.hash, lastHash);
    assert.equal(recovered.current?.state, 'unknown');
    const [response] = await post('/api/reconcile', {}, cookie);
    assert.equal(response.status, 202);
    const result = await until(cookie, value => value.last_result?.hash === lastHash && !value.current);
    assert.equal(result.last_result.ledger, 456);
    assert.equal(sent, 1);
  } finally {
    await demo.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('offer creation and cancellation recover after uncertain submissions and restarts', async () => {
  const source = keypair();
  const recipient = keypair();
  const port = 24000 + Math.floor(Math.random() * 2000);
  const origin = `http://localhost:${port}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'walleterm-mobile-offer-'));
  const results = new Map();
  let sends = 0;
  let demo;
  const offerChecks = { offerPreflight: async () => ({ existingOfferIds: [] }), listOffers: async () => [{ id: '123' }], lookupOffer: async () => ({ exists: true, latestLedger: 999 }), offerEffect };
  const common = { signer: source.address, recipient: recipient.address, port, publicOrigin: origin, stateDir, offerChecks,
    sign: async (_key, digest) => edSign(null, Buffer.from(digest, 'hex'), source.privateKey).toString('hex') };
  const makeClient = () => ({
    getAccount: async () => new Account(source.address, '1'),
    sendTransaction: async tx => {
      sends++;
      const hash = Buffer.from(tx.hash()).toString('hex');
      const kind = tx.operations[0].amount === '0.0000000' ? 'deleted' : 'created';
      results.set(hash, { status: 'SUCCESS', hash, ledger: 700 + sends, resultXdr: offerResultXdr(kind, source.address) });
      throw Error('The response was lost.');
    },
    getTransaction: async hash => results.get(hash) || { status: 'NOT_FOUND' },
  });
  async function pair() {
    const response = await fetch(`${origin}/api/pair`, { method: 'POST', headers: { origin, connection: 'close', 'content-type': 'application/json' }, body: JSON.stringify({ code: new URL(demo.pairUrl).hash.slice(6) }) });
    return response.headers.get('set-cookie').split(';')[0];
  }
  async function post(path, value, cookie) {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { origin, cookie, connection: 'close', 'content-type': 'application/json' }, body: JSON.stringify(value) });
    return [response, await response.json()];
  }
  async function state(cookie) { return (await fetch(`${origin}/api/session`, { headers: { cookie, connection: 'close' } })).json(); }
  async function until(cookie, predicate) {
    for (let i = 0; i < 70; i++) {
      const value = await state(cookie);
      if (predicate(value)) return value;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('The requested offer state did not appear.');
  }
  try {
    for (const kind of ['offer', 'cancel_offer']) {
      demo = createDemo({ ...common, rpcClient: makeClient() });
      await demo.listen();
      let cookie = await pair();
      const [, item] = await post('/api/prepare', { kind }, cookie);
      assert.equal(item.kind, kind);
      await post('/api/approve', { id: item.id }, cookie);
      await until(cookie, value => value.current?.state === 'signed');
      await post('/api/submit', { id: item.id }, cookie);
      await until(cookie, value => value.current?.state === 'unknown');
      await demo.close();

      demo = createDemo({ ...common, rpcClient: makeClient() });
      await demo.listen();
      cookie = await pair();
      const [response] = await post('/api/reconcile', {}, cookie);
      assert.equal(response.status, 202);
      const finished = await until(cookie, value => value.last_result?.hash === item.hash && !value.current);
      assert.equal(finished.last_result.status, 'SUCCESS');
      assert.equal(finished.offer_id, kind === 'offer' ? '123' : null);
      await demo.close();
    }
    assert.equal(sends, 2);
  } finally {
    if (demo.server.listening) await demo.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('a confirmed missing tracked offer releases its saved ID', async () => {
  const source = keypair();
  const recipient = keypair();
  const port = 26000 + Math.floor(Math.random() * 2000);
  const origin = `http://localhost:${port}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'walleterm-mobile-stale-offer-'));
  writeFileSync(join(stateDir, 'demo-offer.json'), JSON.stringify({ signer: source.address, offer_id: '123', ledger: 100 }));
  let currentLedger = 100;
  const demo = createDemo({ signer: source.address, recipient: recipient.address, port, publicOrigin: origin, stateDir,
    rpcClient: { getAccount: async () => new Account(source.address, '1') },
    offerChecks: { listOffers: async () => [], lookupOffer: async () => ({ exists: false, latestLedger: currentLedger }), offerPreflight: async () => ({ existingOfferIds: [] }), offerEffect },
  });
  await demo.listen();
  try {
    const paired = await fetch(`${origin}/api/pair`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ code: new URL(demo.pairUrl).hash.slice(6) }) });
    const cookie = paired.headers.get('set-cookie').split(';')[0];
    async function prepare(kind) {
      const response = await fetch(`${origin}/api/prepare`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ kind }) });
      return [response, await response.json()];
    }
    const [missing] = await prepare('cancel_offer');
    assert.equal(missing.status, 409);
    let state = await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json();
    assert.equal(state.offer_id, '123');
    currentLedger = 200;
    const [gone] = await prepare('cancel_offer');
    assert.equal(gone.status, 409);
    state = await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json();
    assert.equal(state.offer_id, null);
    const [fresh, item] = await prepare('offer');
    assert.equal(fresh.status, 200);
    assert.equal(item.kind, 'offer');
  } finally {
    await demo.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test('restart recovers a durable known rejection without another network lookup', async () => {
  const source = keypair();
  const recipient = keypair();
  const port = 28000 + Math.floor(Math.random() * 2000);
  const origin = `http://localhost:${port}`;
  const stateDir = mkdtempSync(join(tmpdir(), 'walleterm-mobile-rejection-'));
  const tx = new TransactionBuilder(new Account(source.address, '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.manageData({ name: 'walleterm-poc', value: Buffer.from('rejection') })).setTimeout(600).build();
  const hash = Buffer.from(tx.hash()).toString('hex');
  const guard = createSubmissionGuard({
    rpc: { sendTransaction: async () => ({ status: 'ERROR', hash, errorResult: {} }) },
    directory: stateDir, networkPassphrase: Networks.TESTNET, record: () => {},
  });
  await assert.rejects(guard.send(tx, 'known-rejection'), error => error.code === 'known_rejection');
  const archive = readdirSync(stateDir).find(name => name.startsWith('submission-'));
  const prepared = JSON.parse(readFileSync(join(stateDir, archive), 'utf8').split('\n')[0]);
  writeFileSync(join(stateDir, 'pending-submission.json'), JSON.stringify({
    attempt: prepared.attempt, label: prepared.label, hash, networkPassphrase: Networks.TESTNET,
  }));
  writeFileSync(join(stateDir, 'submitted-request.json'), JSON.stringify({ id: 'restart-test', kind: 'note', hash, attempt: prepared.attempt }));
  let lookups = 0;
  const demo = createDemo({ signer: source.address, recipient: recipient.address, port, publicOrigin: origin, stateDir,
    rpcClient: { getTransaction: async () => { lookups++; return { status: 'NOT_FOUND' }; }, getAccount: async () => new Account(source.address, '1') },
  });
  await demo.listen();
  try {
    const paired = await fetch(`${origin}/api/pair`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ code: new URL(demo.pairUrl).hash.slice(6) }) });
    const cookie = paired.headers.get('set-cookie').split(';')[0];
    const reconciled = await fetch(`${origin}/api/reconcile`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(reconciled.status, 202);
    let value;
    for (let i = 0; i < 50; i++) {
      value = await (await fetch(`${origin}/api/session`, { headers: { cookie } })).json();
      if (value.last_result && !value.current) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(value.last_result.status, 'ERROR');
    assert.equal(lookups, 0);
    const next = await fetch(`${origin}/api/prepare`, { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'note' }) });
    assert.equal(next.status, 200);
  } finally {
    await demo.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
