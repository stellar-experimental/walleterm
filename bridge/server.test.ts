import { jest, onTestFinished, test } from 'bun:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Account,
  Asset,
  Keypair,
  Memo,
  MuxedAccount,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { createBridge } from './server.ts';
import { inspectTransaction } from './transaction.ts';
import { WalletermClient } from '../sdk/walleterm.ts';
import { requestError } from '../sdk/errors.ts';
import { listeningPort, requestUrl } from './test/support.ts';
import type { BridgeOptions } from './server.ts';
import type { Falsy } from './test/support.ts';
import type { Fetch, RequestState, Signer, SignalOptions } from '../sdk/types.ts';

const key = Keypair.random(),
  other = Keypair.random(); // Isolated offline mock keys only.
const publicKey = key.publicKey();
interface InputOptions {
  source?: string;
  fee?: string;
  operation?: xdr.Operation;
  memo?: Memo;
  timeout?: number;
}
function input(id = 'request-1', options: InputOptions = {}) {
  const tx = new TransactionBuilder(new Account(options.source || publicKey, '10'), {
    fee: options.fee || '100',
    networkPassphrase: Networks.TESTNET,
  }).addOperation(options.operation || Operation.manageData({ name: 'test', value: 'hello' }));
  if (options.memo) tx.addMemo(options.memo);
  return {
    id,
    kind: 'transaction' as const,
    address: publicKey,
    network_passphrase: Networks.TESTNET,
    xdr: tx
      .setTimeout(options.timeout ?? 180)
      .build()
      .toXDR(),
  };
}
async function until<T>(fn: () => Falsy<T> | Promise<Falsy<T>>): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const result = await fn();
    if (result) return result;
    await delay(5);
  }
  throw Error('The test timed out.');
}
// The bridge always passes an abort signal to the signer. A missing signal fails the test.
function signalOf(options?: SignalOptions): AbortSignal {
  assert.ok(options?.signal, 'The bridge did not pass an abort signal.');
  return options.signal;
}
// Bridge JSON fields that these tests read. Each route returns a subset.
interface ReplyData {
  token?: string;
  state?: RequestState;
  signed_tx_xdr?: string;
  error?: { code: number; message: string; ext?: string[] };
  address?: string | null;
  hash?: string;
  signers?: Signer[];
  grant_id?: string;
  selection_revision?: number;
  expires_at?: string;
}
interface Reply {
  status: number;
  headers: Headers;
  data: ReplyData;
}
interface Site {
  site?: string;
  token?: string;
}
type ReviewRequest = Parameters<NonNullable<BridgeOptions['review']>>[0];
interface Decision {
  request: ReviewRequest;
  signal: AbortSignal;
  decide(value: boolean): void;
}
const originFetch =
  (site: string): Fetch =>
  (url, options) => {
    const headers = new Headers(options?.headers);
    headers.set('Origin', site);
    return fetch(url, { ...options, headers });
  };
const adapter = originFetch('https://adapter.example');
async function fixture(options: BridgeOptions = {}) {
  const decisions: Decision[] = [],
    logs: string[] = [];
  let calls = 0,
    reviews = 0;
  const bridge = createBridge({
    port: 0,
    log: (line) => logs.push(line),
    listSigners: async () => [{ public_key: publicKey, comment: 'Mock key' }],
    review: (request, { signal }) =>
      new Promise((resolve, reject) => {
        reviews++;
        const aborted = () => reject(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
        decisions.push({
          request,
          signal,
          decide(value) {
            signal.removeEventListener('abort', aborted);
            resolve(value);
          },
        });
      }),
    sign: async (_key, hash) => {
      calls++;
      return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex');
    },
    ...options,
  });
  await bridge.listen();
  const origin = `http://127.0.0.1:${listeningPort(bridge.server)}`;
  bridge.setPublicOrigin(origin);
  async function request(
    path: string,
    data?: unknown,
    { site = 'https://site-one.example', token }: Site = {},
  ): Promise<Reply> {
    const response = await fetch(origin + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
        Origin: site,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const body: ReplyData = await response.json();
    return { status: response.status, headers: response.headers, data: body };
  }
  onTestFinished(() => bridge.close());
  async function connect(site = 'https://site-one.example') {
    const r = await request('/v1/connect', { code: bridge.pairing.code, wallet_scope: 'selected' }, { site });
    assert.equal(r.status, 201);
    const s = { site, token: r.data.token };
    assert.equal((await request('/v1/select', { public_key: publicKey }, s)).status, 200);
    return s;
  }
  async function decide(value = true) {
    const decision = await until(() => decisions.shift());
    decision.decide(value);
    return decision.request;
  }
  async function result(s: Site, id = 'request-1') {
    return until(async () => {
      const r = await request(`/v1/requests/${id}`, undefined, s);
      return !['pending', 'approved', 'signing'].includes(r.data.state ?? '') && r;
    });
  }
  const client = (site: string, options: ConstructorParameters<typeof WalletermClient>[1] = {}) =>
    new WalletermClient(origin, { pollInterval: 1, fetch: originFetch(site), ...options });
  return {
    bridge,
    origin,
    request,
    connect,
    decide,
    result,
    client,
    decisions,
    logs,
    calls: () => calls,
    reviews: () => reviews,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

test('short codes expire, rotate once, and pause for one minute after five incorrect attempts', async () => {
  let clock = Date.now();
  const f = await fixture({ now: () => clock });
  const original = f.bridge.pairing.code;
  assert.match(original, /^\d{8}$/);
  await f.connect();
  assert.notEqual(f.bridge.pairing.code, original);
  assert.equal((await f.request('/v1/connect', { code: original, wallet_scope: 'selected' })).status, 403);
  clock += 300001;
  assert.equal(
    (await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'selected' })).status,
    403,
  );
  clock -= 300001;
  const beforeLock = f.bridge.pairing.code;
  for (let i = 0; i < 5; i++)
    assert.equal((await f.request('/v1/connect', { code: 'wrong', wallet_scope: 'selected' })).status, 403);
  assert.notEqual(f.bridge.pairing.code, beforeLock);
  assert.equal(
    (await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'selected' })).status,
    429,
  );
  clock += 60000;
  assert.equal(
    (await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'selected' })).status,
    201,
  );
  assert.equal(f.calls(), 0);
});

test('an unused code rotates at expiry', () => {
  jest.useFakeTimers();
  const bridge = createBridge({ port: 0 });
  let printed = 0;
  onTestFinished(async () => {
    jest.useRealTimers();
    await bridge.close();
  });
  bridge.onPairingChanged(() => printed++);
  const original = bridge.pairing.code;
  jest.advanceTimersByTime(299999);
  assert.equal(bridge.pairing.code, original);
  jest.advanceTimersByTime(1);
  assert.notEqual(bridge.pairing.code, original);
  assert.equal(printed, 1);
});

test('ended sessions release their connection slots', async () => {
  const f = await fixture();
  for (let i = 0; i < 65; i++) {
    const { status, data } = await f.request('/v1/connect', {
      code: f.bridge.pairing.code,
      wallet_scope: 'selected',
    });
    assert.equal(status, 201);
    assert.equal((await f.request('/v1/disconnect', {}, { token: data.token })).status, 200);
  }
});

test('two origins have separate authority; only the review hook decides a request', async () => {
  const f = await fixture(),
    a = await f.connect(),
    b = await f.connect('https://site-two.example');
  const initial = input();
  assert.equal((await f.request('/v1/requests', initial, a)).status, 201);
  assert.equal((await f.request('/v1/requests/request-1', undefined, b)).status, 404);
  assert.equal((await f.request('/v1/account', undefined, { ...a, site: b.site })).status, 401);
  for (const path of ['/api/pair', '/api/connect', '/api/approve', '/api/deny', '/v1/approve']) {
    assert.equal((await f.request(path, { code: f.bridge.pairing.code, hash: 'anything' }, a)).status, 404);
  }
  assert.equal(f.calls(), 0);
  const reviewed = await f.decide();
  assert.equal(reviewed.origin, a.site);
  assert.equal(reviewed.signer.public_key, publicKey);
  assert.equal(reviewed.signer.comment, 'Mock key');
  const approved = await f.result(a);
  assert.equal(approved.data.state, 'signed');
  assert.equal(f.calls(), 1);
  assert.ok(approved.data.signed_tx_xdr);
  const tx = TransactionBuilder.fromXDR(approved.data.signed_tx_xdr, Networks.TESTNET);
  assert.ok(key.verify(tx.hash(), tx.signatures[0].signature.toBytes()));
  assert.equal((await f.request('/v1/requests', initial, a)).data.state, 'signed');
  assert.equal(f.calls(), 1);
  assert.equal(
    (await f.request('/v1/requests', input('request-1', { memo: Memo.text('changed') }), a)).status,
    409,
  );
  assert.deepEqual(f.logs, [
    `Signed ${approved.data.hash} (account ${publicKey}, sequence 11) for ${a.site}.\n`,
  ]);
});

test('wallet discovery requires a session and a selected-scope wallet cannot change', async () => {
  const f = await fixture();
  assert.equal((await f.request('/v1/signers')).status, 401);
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'selected' });
  const a = { token: data.token };
  assert.equal((await f.request('/v1/signers', undefined, a)).data.signers?.[0]?.public_key, publicKey);
  assert.equal((await f.request('/v1/requests', input(), a)).status, 409);
  assert.equal((await f.request('/v1/select', { public_key: other.publicKey() }, a)).status, 400);
  assert.equal((await f.request('/v1/select', { public_key: publicKey }, a)).status, 200);
  assert.equal((await f.request('/v1/select', { public_key: other.publicKey() }, a)).status, 409);
  await f.request('/v1/disconnect', {}, a);
  assert.equal((await f.request('/v1/signers', undefined, a)).status, 401);
});

const both = [
  { public_key: publicKey, comment: 'First' },
  { public_key: other.publicKey(), comment: 'Second' },
];
async function scoped(f: Fixture, site?: string) {
  const { data } = await f.request(
    '/v1/connect',
    { code: f.bridge.pairing.code, wallet_scope: 'available' },
    { site },
  );
  const session = { token: data.token, site };
  const listing = await f.request('/v1/signers', undefined, session);
  assert.equal(
    (
      await f.request(
        '/v1/select',
        { public_key: publicKey, expected_revision: 0, grant_id: listing.data.grant_id },
        session,
      )
    ).status,
    200,
  );
  return session;
}
const select = (f: Fixture, s: Site, address: string, revision: number) =>
  f.request('/v1/select', { public_key: address, expected_revision: revision }, s);

test('scoped wallets pin the displayed list and never renew the connection deadline', async () => {
  let keys: Signer[] = [both[0]],
    clock = Date.now();
  const f = await fixture({ listSigners: async () => keys, now: () => clock });
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'available' });
  const a = { token: data.token },
    offered = (await f.request('/v1/signers', undefined, a)).data;
  keys = both;
  assert.equal(
    (
      await f.request(
        '/v1/select',
        { public_key: other.publicKey(), expected_revision: 0, grant_id: offered.grant_id },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(
        '/v1/select',
        { public_key: publicKey, expected_revision: 0, grant_id: offered.grant_id },
        a,
      )
    ).status,
    200,
  );
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

test('first selection rejects a replaced discovery grant and an unknown scope', async () => {
  const f = await fixture({ listSigners: async () => both });
  assert.equal(
    (await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'all' })).status,
    400,
  );
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'available' });
  const a = { token: data.token },
    old = (await f.request('/v1/signers', undefined, a)).data.grant_id;
  await f.request('/v1/signers', undefined, a);
  assert.equal(
    (await f.request('/v1/select', { public_key: publicKey, expected_revision: 0, grant_id: old }, a)).status,
    409,
  );
});

test('switches cancel queued reviews, preserve other sessions, and reject A-B-A delayed requests', async () => {
  const f = await fixture({ listSigners: async () => both }),
    a = await scoped(f),
    b = await scoped(f, 'https://second.example');
  const old = { ...input(), selection_revision: 1 };
  await f.request('/v1/requests', old, a);
  await f.request('/v1/requests', { ...input('queued'), selection_revision: 1 }, a);
  await f.request('/v1/requests', { ...input('separate'), selection_revision: 1 }, b);
  assert.equal((await select(f, a, other.publicKey(), 1)).data.selection_revision, 2);
  assert.equal((await f.result(a)).data.state, 'denied');
  assert.equal((await f.result(a, 'queued')).data.state, 'denied');
  assert.equal((await select(f, a, publicKey, 2)).data.selection_revision, 3);
  assert.equal((await f.request('/v1/requests', old, a)).status, 409);
  assert.equal(
    (await f.request('/v1/requests', { ...input('delayed'), selection_revision: 1 }, a)).status,
    409,
  );
  assert.equal((await f.request('/v1/requests', input('missing-revision'), a)).status, 409);
  assert.equal((await select(f, a, other.publicKey(), 1)).status, 409);
  const first = await f.decide();
  assert.equal(first.signer.public_key, publicKey);
  await f.decide();
  assert.equal((await f.result(b, 'separate')).data.state, 'signed');
  assert.equal(f.calls(), 1);
});

test('simultaneous switches use compare-and-set after delayed discovery', async () => {
  let gate: Promise<void> | undefined,
    entered = 0;
  const f = await fixture({
      listSigners: async () => {
        entered++;
        if (gate) await gate;
        return both;
      },
    }),
    a = await scoped(f);
  const opened = Promise.withResolvers<void>();
  gate = opened.promise;
  const before = entered;
  const changes = [select(f, a, other.publicKey(), 1), select(f, a, other.publicKey(), 1)];
  await until(() => entered > before);
  await delay(10);
  opened.resolve();
  assert.deepEqual((await Promise.all(changes)).map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.request('/v1/account', undefined, a)).data.selection_revision, 2);
});

for (const phase of ['approved', 'signing', 'signed'])
  test(`a switch during ${phase} withholds the old result`, async () => {
    let release: (() => void) | undefined;
    const waiting = Promise.withResolvers<void>();
    let hold = false;
    const f = await fixture({
      listSigners: async () => {
        if (hold) {
          hold = false;
          waiting.resolve();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return both;
      },
      sign: async (_key, hash) => {
        if (phase === 'signing') {
          waiting.resolve();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex');
      },
    });
    const a = await scoped(f);
    if (phase === 'approved') hold = true;
    await f.request('/v1/requests', { ...input(), selection_revision: 1 }, a);
    const decision = await until(() => f.decisions.shift());
    assert.equal(decision.request.signer.public_key, publicKey);
    decision.decide(true);
    if (phase === 'signed') await f.result(a);
    else await waiting.promise;
    assert.equal((await select(f, a, other.publicKey(), 1)).status, 200);
    release?.();
    const result = await f.result(a);
    assert.equal(result.data.state, phase === 'approved' ? 'denied' : 'unknown');
    assert.equal(result.data.signed_tx_xdr, undefined);
  });

test('SDK switches in one session and recovers a lost selection response', async () => {
  const f = await fixture({ listSigners: async () => both });
  let lose = false,
    pairings = 0;
  const client = f.client('https://adapter.example', {
    fetch: async (url, options) => {
      if (requestUrl(url).endsWith('/v1/connect')) pairings++;
      const response = await adapter(url, options);
      if (lose && requestUrl(url).endsWith('/v1/select')) {
        lose = false;
        throw TypeError('Lost selection response');
      }
      return response;
    },
  });
  await client.connect({
    code: f.bridge.pairing.code,
    walletScope: 'available',
    selectWallet: async (keys) => keys[0].public_key,
  });
  const token = client.token;
  lose = true;
  await assert.rejects(client.selectWallet(other.publicKey()), /Lost selection response/);
  assert.equal(client.account?.address, other.publicKey());
  assert.equal(client.revision, 2);
  await client.selectWallet(publicKey);
  assert.equal(client.token, token);
  assert.equal(pairings, 1);
});

test('a delayed account response cannot overwrite a newer SDK wallet', async () => {
  const f = await fixture({ listSigners: async () => both });
  let hold = false,
    release: (() => void) | undefined;
  const client = f.client('https://adapter.example', {
    fetch: async (url, options) => {
      const response = await adapter(url, options);
      if (hold && requestUrl(url).endsWith('/v1/account')) {
        hold = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return response;
    },
  });
  await client.connect({
    code: f.bridge.pairing.code,
    walletScope: 'available',
    selectWallet: async (keys) => keys[0].public_key,
  });
  hold = true;
  const old = client.getAccount();
  const rejected = assert.rejects(old, /connection changed/);
  const resume = await until(() => release);
  await client.selectWallet(other.publicKey());
  resume();
  await rejected;
  assert.equal(client.account?.address, other.publicKey());
});

test('a delayed request body fails after switching away and back', async () => {
  const f = await fixture({ listSigners: async () => both }),
    a = await scoped(f);
  const data = JSON.stringify({ ...input('late-body'), selection_revision: 1 });
  let finish: (() => void) | undefined;
  const reply = new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(
      f.origin + '/v1/requests',
      {
        method: 'POST',
        headers: {
          Origin: 'https://site-one.example',
          Authorization: `Bearer ${a.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.write(data.slice(0, -1));
    finish = () => {
      req.end(data.slice(-1));
    };
  });
  await select(f, a, other.publicKey(), 1);
  await select(f, a, publicKey, 2);
  assert.ok(finish);
  finish();
  assert.equal(await reply, 409);
  assert.equal(f.reviews(), 0);
});

test('expiry aborts active signing and switching never extends the deadline', async () => {
  let clock = Date.now(),
    aborted = false;
  const waiting = Promise.withResolvers<void>();
  const f = await fixture({
    now: () => clock,
    listSigners: async () => both,
    sign: (_key, _hash, options) => {
      const signal = signalOf(options);
      waiting.resolve();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    },
  });
  const a = await scoped(f),
    initial = (await f.request('/v1/account', undefined, a)).data;
  await select(f, a, other.publicKey(), 1);
  await select(f, a, publicKey, 2);
  assert.equal((await f.request('/v1/account', undefined, a)).data.expires_at, initial.expires_at);
  await f.request('/v1/requests', { ...input(), selection_revision: 3 }, a);
  await f.decide();
  await waiting.promise;
  clock = Date.parse(initial.expires_at ?? '');
  assert.equal((await f.request('/v1/account', undefined, a)).status, 401);
  assert.equal(aborted, true);
  assert.match(f.logs.at(-1) ?? '', /Signature withheld or stopped/);
});

test('SDK withholds a delayed successful signature after a same-session wallet change', async () => {
  const f = await fixture({ listSigners: async () => both, review: undefined });
  let release: (() => void) | undefined;
  const client = f.client('https://adapter.example', {
    fetch: async (url, options) => {
      const response = await adapter(url, options);
      // Deliberately ignore abort after the server completed this response.
      if (requestUrl(url).endsWith('/v1/requests'))
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return response;
    },
  });
  await client.connect({
    code: f.bridge.pairing.code,
    walletScope: 'available',
    selectWallet: async (keys) => keys[0].public_key,
  });
  const signing = client.signTransaction(input().xdr).catch((error: unknown) => error);
  const resume = await until(() => release);
  await client.selectWallet(other.publicKey());
  resume();
  const error = await signing;
  assert.ok(error instanceof Error);
  assert.equal(requestError(error).canceled, true);
  assert.equal(client.account?.address, other.publicKey());
  assert.equal(f.calls(), 1);
});

for (const change of ['unchanged', 'A-B', 'A-B-A'] as const) {
  test(`SDK checks an observed remote wallet revision before delayed success: ${change}`, async () => {
    const f = await fixture({ listSigners: async () => both, review: undefined });
    const sent: { path: string; body?: string; token: string | null }[] = [];
    const release = Promise.withResolvers<void>();
    onTestFinished(() => release.resolve());
    let delivered: { id: string; signed_tx_xdr: string } | undefined;
    const client = f.client('https://adapter.example', {
      page: null,
      fetch: async (url, options) => {
        const path = new URL(requestUrl(url)).pathname;
        sent.push({
          path,
          body: options?.body === undefined ? undefined : String(options.body),
          token: new Headers(options?.headers).get('Authorization'),
        });
        const response = await adapter(url, options);
        if (path.startsWith('/v1/requests')) {
          const result = await response.clone().json();
          if (result.state === 'signed') {
            delivered = result;
            await release.promise;
          }
        }
        return response;
      },
    });
    await client.connect({
      code: f.bridge.pairing.code,
      walletScope: 'available',
      selectWallet: async (keys) => keys[0].public_key,
    });
    const second = f.client('https://adapter.example', { page: null });
    second.token = client.token;
    second.walletScope = 'available';
    await second.getAccount();
    const token = client.token,
      generation = client.generation,
      original = input();
    sent.length = 0;
    const signing = client.signTransaction(original.xdr);
    const outcome =
      change === 'unchanged'
        ? signing
        : assert.rejects(signing, (value) => {
            const error = requestError(value);
            assert.match(error.message, /wallet selection changed/);
            assert.equal(error.canceled, true);
            assert.equal(error.requestState, 'unknown');
            return true;
          });
    const signed = await until(() => delivered);
    const transaction = TransactionBuilder.fromXDR(signed.signed_tx_xdr, Networks.TESTNET);
    assert.deepEqual(transaction.hash(), TransactionBuilder.fromXDR(original.xdr, Networks.TESTNET).hash());
    assert.ok(key.verify(transaction.hash(), transaction.signatures[0].signature.toBytes()));
    if (change !== 'unchanged') await second.selectWallet(other.publicKey());
    if (change === 'A-B-A') await second.selectWallet(publicKey);
    assert.equal((await client.getAccount()).address, change === 'A-B' ? other.publicKey() : publicKey);
    assert.equal(client.revision, change === 'unchanged' ? 1 : change === 'A-B' ? 2 : 3);
    assert.equal(client.generation, generation);
    assert.equal(client.token, token);
    const record = await second.request(`/v1/requests/${signed.id}`);
    assert.equal(record.state, change === 'unchanged' ? 'signed' : 'unknown');
    if (change !== 'unchanged') assert.equal(record.signed_tx_xdr, undefined);
    release.resolve();
    const result = await outcome;
    if (change === 'unchanged') {
      assert.ok(result);
      assert.deepEqual(result, { signedTxXdr: signed.signed_tx_xdr, signerAddress: publicKey });
    }
    const creates = sent.filter(({ path }) => path === '/v1/requests');
    assert.equal(creates.length, 1);
    assert.deepEqual(JSON.parse(creates[0].body ?? ''), {
      ...original,
      id: signed.id,
      selection_revision: 1,
    });
    const cancellations = sent.filter(({ path }) => path.endsWith('/cancel'));
    assert.equal(cancellations.length, change === 'unchanged' ? 0 : 1);
    for (const request of sent) {
      assert.ok(
        [
          '/v1/requests',
          `/v1/requests/${signed.id}`,
          `/v1/requests/${signed.id}/cancel`,
          '/v1/account',
        ].includes(request.path),
        `Unexpected request: ${request.path}`,
      );
      assert.equal(request.token, `Bearer ${token}`);
    }
    assert.equal(f.calls(), 1);
    assert.equal(client.signings.size, 0);
  });
}

test('scoped signing fails closed after a key is removed or discovery fails', async () => {
  let keys = both,
    broken = false;
  const f = await fixture({
    listSigners: async () => {
      if (broken) throw Error('Discovery failed');
      return keys;
    },
  });
  const a = await scoped(f);
  for (const [id, fail] of [
    ['removed', false],
    ['lookup-failed', true],
  ] as const) {
    keys = both;
    broken = false;
    await f.request('/v1/requests', { ...input(id), selection_revision: 1 }, a);
    keys = [both[1]];
    broken = fail;
    await f.decide();
    assert.equal((await f.result(a, id)).data.state, 'denied');
  }
  assert.equal(f.calls(), 0);
});

test('SDK keeps signing blocked when an aborted selection still awaits discovery', async () => {
  let hold = false,
    release: (() => void) | undefined;
  const waiting = Promise.withResolvers<void>();
  const f = await fixture({
    listSigners: async () => {
      if (hold) {
        waiting.resolve();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return both;
    },
  });
  const client = f.client('https://adapter.example');
  await client.connect({
    code: f.bridge.pairing.code,
    walletScope: 'available',
    selectWallet: async (keys) => keys[0].public_key,
  });
  hold = true;
  const controller = new AbortController();
  const changing = client.selectWallet(other.publicKey(), { signal: controller.signal });
  const failed = assert.rejects(changing);
  await waiting.promise;
  controller.abort(Error('Selection canceled'));
  await failed;
  assert.equal(client.account, null);
  await assert.rejects(client.signTransaction(input().xdr), /select a wallet first/);
  await assert.rejects(client.selectWallet(publicKey), /Recover the account/);
  await assert.rejects(client.getAccount(), /not confirmed/);
  hold = false;
  assert.ok(release);
  release();
  await until(
    async () =>
      (
        await f.request('/v1/account', undefined, {
          token: client.token ?? undefined,
          site: 'https://adapter.example',
        })
      ).data.selection_revision === 2,
  );
  assert.equal((await client.getAccount()).address, other.publicKey());
  assert.equal(f.calls(), 0);
});

test('SDK rejects account reads started during a wallet selection', async () => {
  let hold = false,
    release: (() => void) | undefined;
  const waiting = Promise.withResolvers<void>();
  const f = await fixture({
    listSigners: async () => {
      if (hold) {
        waiting.resolve();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return both;
    },
  });
  const client = f.client('https://adapter.example');
  await client.connect({
    code: f.bridge.pairing.code,
    walletScope: 'available',
    selectWallet: async (keys) => keys[0].public_key,
  });
  hold = true;
  const changing = client.selectWallet(other.publicKey());
  await waiting.promise;
  await assert.rejects(client.getAccount(), /selection to finish/);
  hold = false;
  assert.ok(release);
  release();
  await changing;
  assert.equal(client.account?.address, other.publicKey());
});

test('SDK preserves signing uncertainty when session expiry prevents cancellation', async () => {
  let clock = Date.now(),
    release: (() => void) | undefined;
  const waiting = Promise.withResolvers<void>();
  const f = await fixture({
    now: () => clock,
    review: undefined,
    sign: async (_key, hash) => {
      waiting.resolve();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex');
    },
  });
  const client = f.client('https://adapter.example');
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  const signing = client
    .signTransaction(input().xdr)
    .then(() => requestError(Error('The signature was delivered.')), requestError);
  await waiting.promise;
  clock += 3600001;
  const error = await signing;
  assert.ok(release);
  release();
  assert.equal(error.canceled, true);
  assert.equal(error.requestState, 'unknown');
  assert.equal(client.token, null);
});

test('structurally invalid requests never invoke review or signing', async () => {
  const f = await fixture(),
    a = await f.connect();
  const cases: [Record<string, unknown>, string][] = [
    [{ ...input('mainnet'), network_passphrase: Networks.PUBLIC }, 'walleterm:network_unsupported'],
    [input('no-expiry', { timeout: 0 }), 'walleterm:invalid_request'],
    [input('long', { timeout: 600 }), 'walleterm:invalid_request'],
    [input('wrong-source', { source: other.publicKey() }), 'walleterm:address_mismatch'],
    [{ ...input('garbage'), xdr: 'garbage' }, 'walleterm:invalid_request'],
    [{ ...input('address'), address: other.publicKey() }, 'walleterm:address_mismatch'],
    [{ ...input('extra'), extra: true }, 'walleterm:invalid_request'],
    [{ ...input('kindless'), kind: undefined }, 'walleterm:invalid_request'],
    [{ ...input('signed'), xdr: signedBy(input().xdr, key) }, 'walleterm:invalid_request'],
    [{ ...input('v0'), xdr: v0Envelope(input().xdr) }, 'walleterm:invalid_request'],
    // The fee-bump fee source signs the outer envelope. The inner source alone is not a required signer.
    [
      { ...input('inner-source'), xdr: feeBump(other.publicKey(), build(publicKey, [data()])) },
      'walleterm:address_mismatch',
    ],
    [
      { ...input('unbounded-inner'), xdr: feeBump(publicKey, build(other.publicKey(), [data()], '100', 0)) },
      'walleterm:invalid_request',
    ],
    [{ ...input('twenty'), xdr: signedByMany(input().xdr, 20) }, 'walleterm:invalid_request'],
  ];
  for (const [item, reason] of cases) {
    const reply = await f.request('/v1/requests', item, a);
    assert.equal(reply.status, 400, String(item.id));
    assert.equal(reply.data.error?.code, -3, String(item.id));
    assert.deepEqual(reply.data.error?.ext, [reason], String(item.id));
  }
  assert.equal(f.calls(), 0);
  assert.equal(f.reviews(), 0);
});

function signedBy(transactionXdr: string, signer: Keypair) {
  const tx = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET);
  tx.sign(signer);
  return tx.toXDR();
}
function build(source: string, operations: xdr.Operation[], fee = '100', timeout = 180) {
  const tx = new TransactionBuilder(new Account(source, '10'), { fee, networkPassphrase: Networks.TESTNET });
  for (const operation of operations) tx.addOperation(operation);
  return tx.setTimeout(timeout).build();
}
const data = () => Operation.manageData({ name: 'a', value: 'b' });
const feeBump = (feeSource: string, inner: ReturnType<typeof build>) =>
  TransactionBuilder.buildFeeBumpTransaction(feeSource, '200', inner, Networks.TESTNET).toXDR();
function signedByMany(transactionXdr: string, count: number) {
  const tx = TransactionBuilder.fromXDR(transactionXdr, Networks.TESTNET);
  for (let i = 0; i < count; i++) tx.sign(Keypair.random());
  return tx.toXDR();
}
// A V0 envelope has the same bytes after its type, without the muxed key type. Time bounds encode alike.
function v0Envelope(transactionXdr: string) {
  const v1 = Buffer.from(transactionXdr, 'base64');
  const encoded = Buffer.concat([Buffer.alloc(4), v1.subarray(8)]).toString('base64');
  assert.equal(xdr.TransactionEnvelope.fromXDR(encoded, 'base64').type, 'envelopeTypeTxV0');
  return encoded;
}

test('the bridge filters no operations and signs only for a required signer', async () => {
  const f = await fixture({ review: undefined }),
    a = await f.connect(),
    client = f.client('https://site-one.example');
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async () => publicKey });
  const inner = build(other.publicKey(), [
    Operation.payment({ destination: publicKey, asset: Asset.native(), amount: '1' }),
  ]);
  inner.sign(other);
  const envelopes = {
    options: build(publicKey, [Operation.setOptions({ homeDomain: 'example.com' })], '100001').toXDR(),
    many: build(publicKey, [
      Operation.manageData({ name: 'a', value: 'b' }),
      Operation.changeTrust({ asset: new Asset('USD', other.publicKey()) }),
      Operation.payment({
        destination: other.publicKey(),
        asset: Asset.native(),
        amount: '1',
        source: other.publicKey(),
      }),
    ]).toXDR(),
    // The selected key is an operation source. The transaction source signs separately.
    operationSource: signedBy(
      build(other.publicKey(), [Operation.manageData({ name: 'a', value: 'b', source: publicKey })]).toXDR(),
      other,
    ),
    feeBump: TransactionBuilder.buildFeeBumpTransaction(publicKey, '200', inner, Networks.TESTNET).toXDR(),
    // Nineteen signatures from other keys leave room for the selected key.
    nineteen: signedByMany(build(publicKey, [Operation.manageData({ name: 'n', value: 'x' })]).toXDR(), 19),
    // A muxed source signs with its base key.
    muxed: new TransactionBuilder(new MuxedAccount(new Account(publicKey, '10'), '7'), {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.manageData({ name: 'm', value: 'x' }))
      .setTimeout(180)
      .build()
      .toXDR(),
  };
  for (const [id, xdrValue] of Object.entries(envelopes)) {
    assert.equal((await f.request('/v1/requests', { ...input(id), xdr: xdrValue }, a)).status, 201, id);
    const signed = await f.result(a, id);
    assert.equal(signed.data.state, 'signed', id);
    const before = TransactionBuilder.fromXDR(xdrValue, Networks.TESTNET);
    const after = TransactionBuilder.fromXDR(signed.data.signed_tx_xdr!, Networks.TESTNET);
    assert.equal(after.signatures.length, before.signatures.length + 1, id);
    assert.ok(key.verify(after.hash(), after.signatures.at(-1)!.signature.toBytes()), id);
    const result = await client.signTransaction(xdrValue);
    assert.equal(result.signerAddress, publicKey);
  }
});

test('review receives generic details and the exact envelope', () => {
  const request = input('pay', {
    memo: Memo.text('a'),
    operation: Operation.payment({ destination: other.publicKey(), asset: Asset.native(), amount: '0.01' }),
  });
  const { details } = inspectTransaction(request, publicKey);
  assert.equal(details.transaction_xdr, request.xdr);
  assert.equal(details.envelope_type, 'transaction');
  assert.deepEqual(details.operations, [{ type: 'payment', source: publicKey }]);
  assert.equal(
    details.hash,
    Buffer.from(TransactionBuilder.fromXDR(request.xdr, Networks.TESTNET).hash()).toString('hex'),
  );
});

test('denial, expiry and removal of a key do not sign', async () => {
  let clock = Date.now(),
    keys: Signer[] = [{ public_key: publicKey }];
  const f = await fixture({ now: () => clock, listSigners: async () => keys }),
    a = await f.connect();
  await f.request('/v1/requests', input(), a);
  await f.decide(false);
  assert.equal((await f.result(a)).data.state, 'denied');
  await f.request('/v1/requests', input('removed'), a);
  keys = [];
  await f.decide();
  assert.equal((await f.result(a, 'removed')).data.state, 'denied');
  assert.equal(f.calls(), 0);
  keys = [{ public_key: publicKey }];
  await f.request('/v1/requests', input('expired'), a);
  clock += 181000;
  assert.equal((await f.result(a, 'expired')).data.state, 'expired');
  assert.equal(f.calls(), 0);
});

test('canceling a queued review never signs; only one review runs at a time', async () => {
  const f = await fixture(),
    a = await f.connect();
  await f.request('/v1/requests', input(), a);
  await f.request('/v1/requests', input('second'), a);
  assert.equal(f.reviews(), 1);
  await f.request('/v1/requests/second/cancel', {}, a);
  await f.decide(false);
  assert.equal((await f.result(a)).data.state, 'denied');
  assert.equal((await f.result(a, 'second')).data.state, 'denied');
  assert.equal(f.reviews(), 1);
  assert.equal(f.calls(), 0);
});

for (const revoke of [false, true])
  test(`${revoke ? 'revocation' : 'cancellation'} during signing withholds the signature`, async () => {
    let release: (() => void) | undefined;
    const waiting = Promise.withResolvers<void>();
    const f = await fixture({
      sign: async (_key, hash) => {
        waiting.resolve();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return Buffer.from(key.sign(Buffer.from(hash, 'hex'))).toString('hex');
      },
    });
    const a = await f.connect();
    await f.request('/v1/requests', input(), a);
    await f.decide();
    await waiting.promise;
    assert.equal((await f.request('/v1/requests/request-1', undefined, a)).data.state, 'signing');
    await f.request(revoke ? '/v1/disconnect' : '/v1/requests/request-1/cancel', {}, a);
    assert.ok(release);
    release();
    await delay(10);
    const r = await f.request('/v1/requests/request-1', undefined, a);
    if (revoke) assert.equal(r.status, 401);
    else {
      assert.equal(r.data.state, 'unknown');
      assert.equal(r.data.signed_tx_xdr, undefined);
    }
    assert.equal(f.logs.length, 2);
    assert.match(f.logs[0], /^Signature withheld or stopped for [0-9a-f]{64} \(account G/);
    assert.match(f.logs[1], /^1Password returned a signature after cancellation/);
  });

test('invalid signatures are never delivered', async () => {
  const f = await fixture({ sign: async () => '00'.repeat(64) }),
    a = await f.connect();
  await f.request('/v1/requests', input(), a);
  await f.decide();
  const result = await f.result(a);
  assert.equal(result.data.state, 'unknown');
  assert.equal(result.data.signed_tx_xdr, undefined);
});

test('restart invalidates old credentials and requests', async () => {
  const f = await fixture(),
    a = await f.connect();
  await f.request('/v1/requests', input(), a);
  await f.bridge.close();
  assert.equal(f.calls(), 0);
  const restarted = createBridge({ port: 0 });
  onTestFinished(() => restarted.close());
  await restarted.listen();
  const origin = `http://127.0.0.1:${listeningPort(restarted.server)}`;
  restarted.setPublicOrigin(origin);
  const response = await fetch(origin + '/v1/account', {
    headers: { Origin: a.site, Authorization: `Bearer ${a.token}` },
  });
  assert.equal(response.status, 401);
});

test('SDK uses the code and wallet picker, signs, and reconnects after revocation', async () => {
  const f = await fixture(),
    site = 'https://adapter.example',
    client = f.client(site);
  const connect = () =>
    client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  assert.equal((await connect()).address, publicKey);
  const old = client.token;
  // The address and network default to the connected account.
  const signing = client.signTransaction(input('sdk').xdr);
  await f.decide();
  const result = await signing;
  assert.ok(result.signedTxXdr);
  assert.equal(result.signerAddress, publicKey);
  await f.request('/v1/disconnect', {}, { site, token: client.token ?? undefined });
  await connect();
  assert.notEqual(client.token, old);
  await client.disconnect();
  assert.equal(client.token, null);
  assert.equal(client.account, null);
});

test('SDK preserves denied state and clears a canceled wallet selection', async () => {
  const f = await fixture(),
    client = f.client('https://adapter.example');
  await assert.rejects(
    client.connect({
      code: f.bridge.pairing.code,
      selectWallet: async () => {
        throw Error('Canceled');
      },
    }),
    /Canceled/,
  );
  assert.equal(client.token, null);
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  const denied = client.signTransaction(input('denied-sdk').xdr);
  await f.decide(false);
  await assert.rejects(denied, (error) => requestError(error).requestState === 'denied');
});

test('aborting an SDK request cancels its review and never signs', async () => {
  const f = await fixture(),
    client = f.client('https://adapter.example'),
    controller = new AbortController();
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  const signing = client.signTransaction(input('aborted').xdr, { signal: controller.signal });
  await until(() => f.reviews() === 1);
  controller.abort();
  await assert.rejects(signing);
  await until(() => f.decisions[0]?.signal.aborted);
  assert.equal(f.calls(), 0);
});

test('closing the bridge aborts signing and reports it', async () => {
  const waiting = Promise.withResolvers<void>();
  const f = await fixture({
    sign: (_key, _hash, options) => {
      const signal = signalOf(options);
      waiting.resolve();
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true }),
      );
    },
  });
  const a = await f.connect();
  await f.request('/v1/requests', input(), a);
  await f.decide();
  await waiting.promise;
  await f.bridge.close();
  assert.equal(f.logs.length, 1);
  assert.match(f.logs[0], /^Signature withheld or stopped for /);
});

for (const ending of ['disconnect', 'expiry'] as const)
  test(`${ending} withholds a signed, undelivered result as unknown`, async () => {
    let clock = Date.now();
    const f = await fixture({ review: undefined, now: () => clock }),
      a = await f.connect();
    const request = input('undelivered');
    assert.equal((await f.request('/v1/requests', request, a)).status, 201);
    // The website never polls, so the bridge has not delivered the signature.
    await until(() => f.logs.length === 1);
    const hash = Buffer.from(TransactionBuilder.fromXDR(request.xdr, Networks.TESTNET).hash()).toString(
      'hex',
    );
    assert.equal(f.logs[0], `Signed ${hash} (account ${publicKey}, sequence 11) for ${a.site}.\n`);
    if (ending === 'disconnect') assert.equal((await f.request('/v1/disconnect', {}, a)).status, 200);
    else clock += 3600001;
    const read = await f.request('/v1/requests/undelivered', undefined, a);
    assert.equal(read.status, 401);
    assert.equal(read.data.signed_tx_xdr, undefined);
    // After signing, the outcome is unknown. A denied state would print no line.
    assert.deepEqual(f.logs, [
      f.logs[0],
      `Signature withheld or stopped for ${hash} (account ${publicKey}, sequence 11): The website connection was revoked.\n`,
    ]);
    assert.equal(f.calls(), 1);
  });

test('canceling a signed request withholds its result', async () => {
  const f = await fixture(),
    a = await f.connect();
  await f.request('/v1/requests', input(), a);
  await f.decide();
  assert.equal((await f.result(a)).data.state, 'signed');
  const canceled = await f.request('/v1/requests/request-1/cancel', {}, a);
  assert.equal(canceled.data.state, 'unknown');
  assert.equal(canceled.data.signed_tx_xdr, undefined);
  assert.match(f.logs.at(-1) ?? '', /^Signature withheld or stopped/);
});

test('SDK retries a failed poll and a lost first response', async () => {
  const f = await fixture();
  let failures = 2;
  const flaky: Fetch = async (url, options) => {
    const response = await adapter(url, options);
    if (failures && requestUrl(url).includes('/v1/requests')) {
      failures--;
      return new Response('<html>Bad gateway</html>', { status: 502 });
    }
    return response;
  };
  const client = f.client('https://adapter.example', { fetch: flaky });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  const signing = client.signTransaction(input('flaky').xdr);
  await f.decide();
  assert.ok((await signing).signedTxXdr);
  assert.equal(f.calls(), 1);
  assert.equal(f.reviews(), 1);
});

test('leaving the page cancels an open SDK request', async () => {
  const f = await fixture(),
    page = new EventTarget(),
    sent: { url: string; options?: RequestInit }[] = [];
  const client = f.client('https://adapter.example', {
    page,
    fetch: (url, options) => {
      sent.push({ url: requestUrl(url), options });
      return adapter(url, options);
    },
  });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  const signing = client
    .signTransaction(input('leave').xdr)
    .then(() => requestError(Error('The signature was delivered.')), requestError);
  await until(() => f.reviews() === 1);
  page.dispatchEvent(new Event('pagehide'));
  await until(() => f.decisions[0]?.signal.aborted);
  const error = await signing;
  assert.match(error.message, /page closed/);
  assert.equal(error.canceled, true);
  assert.equal(f.calls(), 0);
  const leaving = sent.find((item) => item.url.endsWith('/cancel') && item.options?.keepalive);
  assert.ok(leaving);
  assert.equal(new Headers(leaving.options?.headers).get('Authorization'), `Bearer ${client.token}`);
});

test('a cancel that arrives before its create blocks that request ID', async () => {
  const f = await fixture(),
    a = await f.connect();
  const early = await f.request('/v1/requests/late/cancel', {}, a);
  assert.equal(early.status, 200);
  assert.equal((await f.request('/v1/requests', input('late'), a)).status, 409);
  assert.equal(f.reviews(), 0);
});

test('concurrent key listings share one signer process', async () => {
  let listings = 0;
  const gate = Promise.withResolvers<void>();
  const f = await fixture({
    listSigners: async () => {
      listings++;
      await gate.promise;
      return [{ public_key: publicKey }];
    },
  });
  const { data } = await f.request('/v1/connect', { code: f.bridge.pairing.code, wallet_scope: 'selected' });
  const a = { token: data.token };
  const calls = Array.from({ length: 20 }, () => f.request('/v1/signers', undefined, a));
  await delay(20);
  gate.resolve();
  await Promise.all(calls);
  assert.equal(listings, 1);
});

test('SDK retries stop when the connection changes', async () => {
  const f = await fixture();
  let fail = true;
  const flaky: Fetch = async (url, options) => {
    if (fail && requestUrl(url).endsWith('/v1/requests')) {
      fail = false;
      client.token = 'replaced';
      return Response.json({}, { status: 502 });
    }
    return adapter(url, options);
  };
  const client = f.client('https://adapter.example', { fetch: flaky });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  await assert.rejects(client.signTransaction(input('changed').xdr), /connection changed/);
  assert.equal(f.reviews(), 0);
});

test('SDK reports an unconfirmed cancel and accepts a primitive abort reason', async () => {
  const f = await fixture();
  let down = false;
  const client = f.client('https://adapter.example', {
    fetch: async (url, options) => {
      if (down) throw TypeError('offline');
      return adapter(url, options);
    },
  });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  const controller = new AbortController();
  const signing = client
    .signTransaction(input('offline').xdr, { signal: controller.signal })
    .catch((error: unknown) => error);
  await until(() => f.reviews() === 1);
  down = true;
  controller.abort('stop');
  const error = await signing;
  assert.ok(error instanceof Error);
  assert.equal(requestError(error).canceled, false);
});

test('SDK does not retry a non-JSON 4xx response', async () => {
  const f = await fixture();
  let posts = 0;
  const client = f.client('https://adapter.example', {
    fetch: async (url, options) => {
      if (requestUrl(url).endsWith('/v1/requests')) {
        posts++;
        return new Response('<html>Too large</html>', { status: 413 });
      }
      return adapter(url, options);
    },
  });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  await assert.rejects(client.signTransaction(input('big').xdr), /unreadable response \(413\)/);
  assert.equal(posts, 1);
});

test('a slow disconnect does not clear a newer connection', async () => {
  const f = await fixture();
  let hold = false,
    release: (() => void) | undefined;
  const client = f.client('https://adapter.example', {
    fetch: async (url, options) => {
      const response = adapter(url, options);
      if (hold && requestUrl(url).endsWith('/v1/disconnect')) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return response;
    },
  });
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  hold = true;
  const leaving = client.disconnect();
  const resume = await until(() => release);
  hold = false;
  client.token = null;
  await client.connect({ code: f.bridge.pairing.code, selectWallet: async (keys) => keys[0].public_key });
  const current = client.token;
  resume();
  await leaving;
  assert.equal(client.token, current);
  assert.ok(current);
});

test('without a review hook, the bridge signs a valid request with no terminal step', async () => {
  const f = await fixture({ review: undefined }),
    a = await f.connect();
  await f.request('/v1/requests', input(), a);
  const signed = await f.result(a);
  assert.equal(signed.data.state, 'signed');
  assert.equal(f.reviews(), 0);
  assert.equal(f.calls(), 1);
  assert.equal(
    (await f.request('/v1/requests', { ...input('mainnet'), network_passphrase: Networks.PUBLIC }, a)).status,
    400,
  );
  assert.equal(f.calls(), 1);
});
