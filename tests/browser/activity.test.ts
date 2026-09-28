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
  await until(() => history.events.length === 2);
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
  await until(() => history.events.length === 2);
  for (let i = 0; i < 3; i++) {
    await tracked('https://bridge.example/v1/requests/request-1');
    await tick();
  }
  assert.equal(history.events.length, 2);
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
  const history = new ActivityHistory({ store: { load: () => loading.promise, async put() {} } });
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
  const history = new ActivityHistory({ store: { load: async () => stored, async put() {} } });
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
  await until(() => history.events.length === 2);
  assert.equal(history.events[0].category, 'error');
  await history.wrapFetch(async () => new Response('module'))('https://demo.example/stellar-sdk.js');
  assert.equal(history.events.length, 2);
});
