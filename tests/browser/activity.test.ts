import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { ActivityHistory, safeData } from '../../demo/site/activity.ts';
import type { ActivityEvent } from '../../demo/site/activity.ts';
type Data = ActivityEvent['data'];
const memory = () => {
  const events: ActivityEvent[] = [];
  return {
    events,
    async load() {
      return events;
    },
    async put(event: ActivityEvent) {
      events.push(event);
    },
    async clear() {
      events.length = 0;
    },
  };
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await tick();
  }
  assert.fail('The activity event did not arrive.');
}
// Read one field of a logged JSON object. A different shape fails the test.
function field(value: Data, key: string): Data {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `Expected an object with ${key}.`);
  return value[key] ?? null;
}
function text(value: Data): string {
  assert.ok(typeof value === 'string', 'Expected a string.');
  return value;
}

test('activity JSON redacts nested credentials without changing source data', () => {
  const original = {
    code: '12345678',
    token: 'session-secret',
    grant_id: 'grant-secret',
    nested: [{ authorization: 'Bearer hidden', private_key: 'never-log', accessToken: 'access-secret' }],
    hash: 'transaction-hash',
    signatures: ['public-signature'],
    signed_xdr: 'public-envelope',
  };
  const sanitized = safeData(original);
  assert.equal(field(sanitized, 'code'), '[redacted]');
  assert.equal(field(sanitized, 'token'), '[redacted]');
  assert.equal(field(sanitized, 'grant_id'), '[redacted]');
  assert.deepEqual(field(sanitized, 'nested'), [
    { authorization: '[redacted]', private_key: '[redacted]', accessToken: '[redacted]' },
  ]);
  assert.equal(field(sanitized, 'hash'), original.hash);
  assert.deepEqual(field(sanitized, 'signatures'), original.signatures);
  assert.equal(original.token, 'session-secret');
});

test('transport history preserves the original request, response body, and abort signal', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  const controller = new AbortController();
  const options = {
    method: 'POST',
    signal: controller.signal,
    headers: { Authorization: 'Bearer header-secret' },
    body: JSON.stringify({ code: '12345678', wallet_scope: 'available' }),
  };
  const response = Response.json({ token: 'response-secret', wallet_scope: 'available' });
  const tracked = history.wrapFetch(async (url, received) => {
    assert.equal(url, 'https://bridge.example/v1/connect');
    assert.equal(received, options);
    assert.equal(received?.signal, controller.signal);
    return response;
  });
  const returned = await tracked('https://bridge.example/v1/connect', options);
  assert.equal(returned, response);
  assert.equal((await returned.json()).token, 'response-secret');
  // A write has one event. It starts when the request is sent and completes in place.
  await until(() => history.events[0]?.title === 'Connect website · 200');
  assert.equal(history.events.length, 1);
  assert.equal(typeof field(history.events[0].data, 'duration_ms'), 'number');
  const serialized = JSON.stringify(history.events);
  for (const secret of ['12345678', 'header-secret', 'response-secret'])
    assert.equal(serialized.includes(secret), false);
  assert.ok(serialized.includes('[redacted]'));
});

test('unchanged signing polls collapse while changed states and signatures remain searchable', async () => {
  const history = new ActivityHistory({
    store: memory(),
    decodeSigned: () => ({ hash: 'h1', signatures: ['signature-hex'] }),
  });
  await history.ready;
  let result: { id: string; state: string; hash: string; signed_xdr?: string } = {
    id: 'request-1',
    state: 'signing',
    hash: 'h1',
  };
  const tracked = history.wrapFetch(async () => Response.json(result));
  await tracked('https://bridge.example/v1/requests', {
    method: 'POST',
    body: JSON.stringify({ id: 'request-1' }),
  });
  await until(() => history.events[0]?.title === 'Request signature · 200');
  for (let i = 0; i < 3; i++) {
    await tracked('https://bridge.example/v1/requests/request-1');
    await tick();
  }
  // The first poll is a new event. Identical polls count on it.
  assert.equal(history.events.length, 2);
  assert.equal(history.events[0].title, 'Signing update · 200');
  assert.equal(field(history.events[0].data, 'repeats'), 3);
  assert.equal(typeof field(history.events[0].data, 'last_time'), 'string');
  result = { ...result, state: 'signed', signed_xdr: 'envelope' };
  await tracked('https://bridge.example/v1/requests/request-1');
  await until(() => history.events.length === 3);
  assert.deepEqual(field(history.events[0].data, 'signatures'), ['signature-hex']);
  assert.equal(field(field(history.events[0].data, 'response'), 'signed_xdr'), 'envelope');
});

test('transaction history survives clearing and preserves earlier state snapshots', async () => {
  const store = memory(),
    history = new ActivityHistory({ store, decodeSigned: () => ({ signatures: ['signature'] }) });
  await history.ready;
  const pending: { kind: string; hash: string; state: string; xdr: string; signed_xdr?: string } = {
    kind: 'note',
    hash: 'hash',
    state: 'review',
    xdr: 'unsigned',
  };
  history.transaction(pending);
  history.transaction(pending);
  pending.state = 'signed';
  pending.signed_xdr = 'signed';
  history.transaction(pending);
  history.transaction(null);
  await tick();
  assert.equal(history.events.length, 2);
  assert.equal(field(history.events[1].data, 'state'), 'review');
  const restored = new ActivityHistory({ store });
  await restored.ready;
  assert.equal(restored.events.length, 2);
  assert.deepEqual(field(restored.events[0].data, 'signatures'), ['signature']);
});

test('history loading merges with new activity instead of overwriting it', async () => {
  const loading = Promise.withResolvers<ActivityEvent[]>();
  const history = new ActivityHistory({
    store: { load: () => loading.promise, async put() {}, async clear() {} },
  });
  await tick();
  assert.equal(history.loading, true);
  history.record('action', 'New action');
  loading.resolve([
    {
      id: 'older',
      time: '2020-01-01T00:00:00.000Z',
      category: 'walleterm',
      title: 'Older event',
      data: { token: 'old-secret' },
    },
  ]);
  await history.ready;
  assert.equal(history.loading, false);
  assert.equal(history.events.length, 2);
  assert.equal(history.events[0].title, 'New action');
  assert.equal(field(history.events[1].data, 'token'), '[redacted]');
});

test('restored history drops stored credentials and events with malformed metadata', async () => {
  // Browser storage is untrusted. These records model damaged or altered IndexedDB rows.
  const stored: unknown[] = [
    {
      id: 'kept',
      time: '2020-01-01T00:00:00.000Z',
      category: 'walleterm',
      title: 'Stored event',
      token: 'top-level-secret',
      data: { nested: { token: 'data-secret' } },
    },
    {
      id: 'bad-title',
      time: '2020-01-01T00:00:01.000Z',
      category: 'walleterm',
      title: { token: 'title-secret' },
      data: {},
    },
    {
      id: 'bad-category',
      time: '2020-01-01T00:00:02.000Z',
      category: { nested: { token: 'category-secret' } },
      title: 'Malformed category',
      data: {},
    },
  ];
  const history = new ActivityHistory({
    store: { load: async () => stored, async put() {}, async clear() {} },
  });
  await history.ready;
  assert.deepEqual(
    history.events.map((event) => event.id),
    ['kept'],
  );
  assert.deepEqual(Object.keys(history.events[0]).sort(), ['category', 'data', 'id', 'time', 'title']);
  assert.deepEqual(history.events[0].data, { nested: { token: '[redacted]' } });
  // The Export JSON button serializes this same event list.
  const exported = JSON.stringify({ exported_at: new Date().toISOString(), events: history.events }, null, 2);
  for (const secret of ['top-level-secret', 'data-secret', 'title-secret', 'category-secret'])
    assert.equal(exported.includes(secret), false, secret);
});

test('storage and decoding failures do not block wallet response delivery', async () => {
  const history = new ActivityHistory({
    store: {
      async load() {
        throw Error('Unavailable');
      },
      async put() {
        throw Error('Quota');
      },
      async clear() {},
    },
    decodeSigned() {
      throw Error('Invalid XDR');
    },
  });
  await history.ready;
  const response = Response.json({ id: 'r', state: 'signed', signed_xdr: 'bad-envelope' });
  const returned = await history.wrapFetch(async () => response)('https://bridge.example/v1/requests/r');
  assert.equal(returned, response);
  await until(() => history.events.length === 1);
  assert.equal(history.unsaved, true);
  assert.match(text(field(history.events[0].data, 'decoding_error')), /could not decode/);
});

test('request failures retain their original error and log without headers', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  const error = Error('Canceled by the caller');
  await assert.rejects(
    history.wrapFetch(async () => {
      throw error;
    })('https://bridge.example/v1/signers'),
    (caught) => caught === error,
  );
  assert.equal(history.events[0].category, 'error');
  assert.equal(field(field(history.events[0].data, 'error'), 'message'), error.message);
});

test('non-JSON responses remain readable and unrelated requests stay outside the log', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  const response = new Response('Service unavailable', { status: 503 });
  const returned = await history.wrapFetch(async () => response)('https://bridge.example/v1/signers');
  assert.equal(await returned.text(), 'Service unavailable');
  await until(() => history.events.length === 1);
  assert.equal(history.events[0].category, 'error');
  assert.equal(history.events[0].title, 'List wallets · unreadable response');
  await history.wrapFetch(async () => new Response('module'))('https://demo.example/stellar-sdk.js');
  assert.equal(history.events.length, 1);
});

const RPC = 'https://soroban-testnet.stellar.org';
const rpcCall = (method: string, params: unknown, id = 1) => ({
  method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
});

test('a write that stops keeps one event with its request and error', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  let release!: () => void;
  const tracked = history.wrapFetch(
    () => new Promise((_resolve, reject) => (release = () => reject(Error('Tunnel closed')))),
  );
  const sent = tracked('https://horizon-testnet.stellar.org/transactions', {
    method: 'POST',
    body: new URLSearchParams({ tx: 'signed-envelope' }),
  });
  // The event exists before the response, so a reload keeps evidence of the submission.
  assert.equal(history.events.length, 1);
  assert.equal(history.events[0].title, 'Submit transaction · sent');
  release();
  await assert.rejects(sent, /Tunnel closed/);
  assert.equal(history.events.length, 1);
  assert.equal(history.events[0].title, 'Submit transaction · stopped');
  assert.equal(history.events[0].category, 'error');
  assert.equal(field(field(history.events[0].data, 'body'), 'tx'), 'signed-envelope');
});

test('RPC calls are named by method, and errors inside HTTP 200 are errors with their numeric code', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  const responses: Record<string, unknown> = {
    getLedgerEntries: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid keys' } },
    simulateTransaction: { jsonrpc: '2.0', id: 1, result: { error: 'HostError: auth', latestLedger: 5 } },
    sendTransaction: { jsonrpc: '2.0', id: 1, result: { status: 'ERROR', hash: 'h1' } },
    getTransaction: { jsonrpc: '2.0', id: 1, result: { status: 'FAILED', ledger: 9 } },
    getLatestLedger: { jsonrpc: '2.0', id: 1, result: { sequence: 9 } },
  };
  const tracked = history.wrapFetch(async (_url, options) =>
    Response.json(responses[JSON.parse(String(options?.body)).method]),
  );
  for (const method of Object.keys(responses)) await tracked(RPC, rpcCall(method, { key: method }));
  await until(() => history.events.length === 5);
  assert.deepEqual(history.events.map((event) => [event.category, event.title]).reverse(), [
    ['error', 'Read ledger entries · RPC error'],
    ['error', 'Simulate transaction · simulation failed'],
    ['error', 'Send transaction · ERROR'],
    ['error', 'Check transaction · FAILED'],
    ['network', 'Read latest ledger · 200'],
  ]);
  assert.equal(field(field(field(history.events[4].data, 'response'), 'error'), 'code'), -32602);
  assert.equal(safeData({ code: '12345678' }) && field(safeData({ code: '12345678' }), 'code'), '[redacted]');
});

test('identical reads group into one event, while a changed result or a failure is new', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  let ledger = 10,
    status = 'NOT_FOUND';
  const tracked = history.wrapFetch(async () =>
    Response.json({
      jsonrpc: '2.0',
      id: ledger,
      result: { status, latestLedger: ledger++, oldestLedger: 1 },
    }),
  );
  // Each poll has a new JSON-RPC ID and ledger position. The result is the same.
  for (let id = 1; id <= 3; id++) {
    await tracked(RPC, rpcCall('getTransaction', { hash: 'h1' }, id));
    await tick();
  }
  assert.equal(history.events.length, 1);
  assert.equal(history.events[0].title, 'Check transaction · NOT_FOUND');
  assert.equal(field(history.events[0].data, 'repeats'), 3);
  await tracked(RPC, rpcCall('getTransaction', { hash: 'h2' }, 4));
  await until(() => history.events.length === 2);
  status = 'SUCCESS';
  await tracked(RPC, rpcCall('getTransaction', { hash: 'h1' }, 5));
  await until(() => history.events.length === 3);
  assert.equal(history.events[0].title, 'Check transaction · SUCCESS');
  const failing = history.wrapFetch(async () => new Response('{}', { status: 503 }));
  for (let i = 0; i < 2; i++) await failing('https://horizon-testnet.stellar.org/ledgers?order=desc&limit=1');
  await until(() => history.events.length === 5);
  assert.ok(history.events.slice(0, 2).every((event) => event.category === 'error'));
});

test('transaction events name the action and the signature, and verification has its own event', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  const record = {
    hash: 'h1',
    state: 'waiting',
    result: undefined as unknown,
    contract: { authorizations: [{}], authorizationReady: false },
  };
  history.transaction(record, 'Deploy the counter');
  record.state = 'review';
  record.hash = 'h2';
  record.contract.authorizationReady = true;
  history.transaction(record, 'Deploy the counter');
  record.state = 'submitted';
  record.result = { ledger: 7 };
  history.transaction(record, 'Deploy the counter');
  record.result = { ledger: 7, verification: { stage: 'deploy-target' } };
  history.transaction(record, 'Deploy the counter');
  await tick();
  assert.deepEqual(history.events.map((event) => event.title).reverse(), [
    'Deploy the counter · Authorization signature requested',
    'Deploy the counter · Authorization signed and verified',
    'Deploy the counter · Transaction confirmed',
  ]);
});

test('only a missing Horizon account or transaction is a normal 404', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  const tracked = history.wrapFetch(async () => Response.json({ status: 404 }, { status: 404 }));
  const horizon = 'https://horizon-testnet.stellar.org';
  await tracked(`${horizon}/accounts/GMISSING`);
  await tracked(`${horizon}/transactions/${'a'.repeat(64)}`);
  await tracked(`${horizon}/accounts/GMISSING/offers`);
  await tracked(RPC, rpcCall('getLedgerEntries', { keys: [] }));
  await tracked('https://bridge.example/v1/signers');
  await until(() => history.events.length === 5);
  assert.deepEqual(history.events.map((event) => [event.category, event.title]).reverse(), [
    ['network', 'Read testnet account · not found'],
    ['network', 'Check transaction · not found'],
    ['error', 'Read open offers · 404'],
    ['error', 'Read ledger entries · 404'],
    ['error', 'List wallets · 404'],
  ]);
});

test('a failed read ends its group, so a recovery is a new event', async () => {
  const history = new ActivityHistory({ store: memory() });
  await history.ready;
  let status = 200;
  const tracked = history.wrapFetch(async () => Response.json({ sequence: '5' }, { status }));
  const url = 'https://horizon-testnet.stellar.org/accounts/GREAD';
  for (const next of [200, 200, 503, 200]) {
    status = next;
    await tracked(url);
    await tick();
  }
  await until(() => history.events.length === 3);
  assert.deepEqual(history.events.map((event) => [event.category, event.title]).reverse(), [
    ['network', 'Read testnet account · 200'],
    ['error', 'Read testnet account · 503'],
    ['network', 'Read testnet account · 200'],
  ]);
  assert.equal(field(history.events[2].data, 'repeats'), 2);
});

test('clearing deletes every event from the tab and the store, and a late request stays cleared', async () => {
  const store = memory(),
    history = new ActivityHistory({ store });
  await history.ready;
  let release!: (response: Response) => void;
  const tracked = history.wrapFetch(() => new Promise<Response>((resolve) => (release = resolve)));
  history.record('action', 'Before clearing');
  history.transaction({ hash: 'h1', state: 'review' }, 'Write a note');
  const sent = tracked('https://horizon-testnet.stellar.org/transactions', {
    method: 'POST',
    body: new URLSearchParams({ tx: 'signed-envelope' }),
  });
  await tick();
  assert.equal(history.events.length, 3);
  await history.clear();
  assert.equal(history.events.length, 0);
  assert.equal(store.events.length, 0);
  // The submission that started before clearing completes, but its event does not come back.
  release(Response.json({ hash: 'h1', ledger: 5, successful: true }));
  await sent;
  await tick();
  assert.equal(history.events.length, 0);
  assert.equal(store.events.length, 0);
  // The same journal state is recorded again after clearing.
  history.transaction({ hash: 'h1', state: 'review' }, 'Write a note');
  assert.equal(history.events[0].title, 'Write a note · Transaction prepared');
  const restored = new ActivityHistory({ store });
  await restored.ready;
  assert.equal(restored.events.length, 1);
});
