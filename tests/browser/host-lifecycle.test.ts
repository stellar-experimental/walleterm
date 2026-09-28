// The real SDK against the Rust bridge (tests/browser/host.ts). Ported from the SDK tests in bridge/server.test.ts.
import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { WalletermClient } from '../../sdk/walleterm.ts';
import { requestError } from '../../sdk/errors.ts';
import { requestUrl } from '../../bridge/test/support.ts';
import { createHost } from './host.ts';
import type { Falsy } from '../../bridge/test/support.ts';
import type { HostOptions, ReviewRequest } from './host.ts';
import type { Fetch, RequestState, Signer, SignalOptions } from '../../sdk/types.ts';

const key = Keypair.random(),
  other = Keypair.random(); // Isolated offline mock keys only.
const publicKey = key.publicKey();
function input(id = 'request-1') {
  const tx = new TransactionBuilder(new Account(publicKey, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'test', value: 'hello' }))
    .setTimeout(180)
    .build();
  return {
    id,
    kind: 'transaction' as const,
    address: publicKey,
    network_passphrase: Networks.TESTNET,
    xdr: tx.toXDR(),
  };
}
async function until<T>(fn: () => Falsy<T> | Promise<Falsy<T>>): Promise<T> {
  for (let i = 0; i < 400; i++) {
    const result = await fn();
    if (result) return result;
    await delay(5);
  }
  throw Error('The test timed out.');
}
function signalOf(options?: SignalOptions): AbortSignal {
  assert.ok(options?.signal, 'The bridge did not pass an abort signal.');
  return options.signal;
}
interface ReplyData {
  token?: string;
  state?: RequestState;
  signed_tx_xdr?: string;
  error?: { code: number; message: string; ext?: string[] };
  address?: string | null;
  selection_revision?: number;
}
interface Site {
  site?: string;
  token?: string;
}
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
const both = [
  { public_key: publicKey, comment: 'First' },
  { public_key: other.publicKey(), comment: 'Second' },
];
async function fixture(options: HostOptions = {}) {
  const decisions: Decision[] = [],
    logs: string[] = [];
  let calls = 0,
    reviews = 0;
  const bridge = await createHost({
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
  onTestFinished(() => bridge.close());
  const origin = bridge.origin;
  async function request(
    path: string,
    data?: unknown,
    { site = 'https://site-one.example', token }: Site = {},
  ) {
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
  async function decide(value = true) {
    const decision = await until(() => decisions.shift());
    decision.decide(value);
    return decision.request;
  }
  const client = (site: string, clientOptions: ConstructorParameters<typeof WalletermClient>[1] = {}) =>
    new WalletermClient(origin, { pollInterval: 1, fetch: originFetch(site), ...clientOptions });
  return {
    bridge,
    origin,
    request,
    decide,
    client,
    decisions,
    logs,
    code: () => bridge.code(),
    calls: () => calls,
    reviews: () => reviews,
  };
}
function buildTx(source: string) {
  return new TransactionBuilder(new Account(source, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'a', value: 'b' }))
    .setTimeout(180)
    .build();
}
void signalOf;
void buildTx;

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
    code: await f.code(),
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
    code: await f.code(),
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
    code: await f.code(),
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
      code: await f.code(),
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
    code: await f.code(),
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
    code: await f.code(),
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
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
  const signing = client
    .signTransaction(input().xdr)
    .then(() => requestError(Error('The signature was delivered.')), requestError);
  await waiting.promise;
  await f.bridge.advance(3600001);
  const error = await signing;
  assert.ok(release);
  release();
  assert.equal(error.canceled, true);
  assert.equal(error.requestState, 'unknown');
  assert.equal(client.token, null);
});

test('SDK uses the code and wallet picker, signs, and reconnects after revocation', async () => {
  const f = await fixture(),
    site = 'https://adapter.example',
    client = f.client(site);
  const connect = async () =>
    client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
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
      code: await f.code(),
      selectWallet: async () => {
        throw Error('Canceled');
      },
    }),
    /Canceled/,
  );
  assert.equal(client.token, null);
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
  const denied = client.signTransaction(input('denied-sdk').xdr);
  await f.decide(false);
  await assert.rejects(denied, (error) => requestError(error).requestState === 'denied');
});

test('aborting an SDK request cancels its review and never signs', async () => {
  const f = await fixture(),
    client = f.client('https://adapter.example'),
    controller = new AbortController();
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
  const signing = client.signTransaction(input('aborted').xdr, { signal: controller.signal });
  await until(() => f.reviews() === 1);
  controller.abort();
  await assert.rejects(signing);
  await until(() => f.decisions[0]?.signal.aborted);
  assert.equal(f.calls(), 0);
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
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
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
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
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
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
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
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
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
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
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
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
  hold = true;
  const leaving = client.disconnect();
  const resume = await until(() => release);
  hold = false;
  client.token = null;
  await client.connect({ code: await f.code(), selectWallet: async (keys) => keys[0].public_key });
  const current = client.token;
  resume();
  await leaving;
  assert.equal(client.token, current);
  assert.ok(current);
});
