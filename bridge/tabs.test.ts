import { expect, onTestFinished, test } from 'bun:test';
import vm from 'node:vm';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { createBridge } from './server.ts';
import { browserScript, listeningPort } from './test/support.ts';
import * as authorization from '../sdk/authorization.ts';
import * as preimage from '../sdk/preimage.ts';
import * as transaction from '../sdk/transaction.ts';
import type { Walleterm } from '../sdk/walleterm.ts';

// Tabs of one website share one Walleterm session through localStorage.
// Each tab is a VM context with its own globals, as in a browser. Keys are isolated offline mock keys.
const key = Keypair.random(),
  other = Keypair.random();
const site = 'https://tabs.example';
const STORAGE = 'walleterm:session';

async function website() {
  let signatures = 0;
  const paths: string[] = [];
  const bridge = createBridge({
    port: 0,
    log() {},
    review: undefined,
    latestLedger: async () => 100,
    listSigners: async () => [key, other].map((k) => ({ public_key: k.publicKey() })),
    sign: async (publicKey, digest) => {
      signatures++;
      const signer = publicKey === key.publicKey() ? key : other;
      return Buffer.from(signer.sign(Buffer.from(digest, 'hex'))).toString('hex');
    },
  });
  await bridge.listen();
  onTestFinished(() => bridge.close());
  const origin = `http://127.0.0.1:${listeningPort(bridge.server)}`;
  bridge.setPublicOrigin(origin);
  // A test can hold revocation responses after the bridge revokes the session.
  let held: Promise<void> | null = null;
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    const headers = new Headers(init?.headers);
    headers.set('Origin', site);
    const response = await fetch(url, { ...init, headers });
    if (path === '/v1/disconnect' && held) await held;
    return response;
  };
  // The origin's localStorage. A write fires a storage event in every other tab, one task later.
  const stored = new Map<string, string>();
  const pages = new Set<EventTarget>();
  function write(page: EventTarget, name: string, value: string | null) {
    const oldValue = stored.get(name) ?? null;
    if (oldValue === value) return;
    if (value === null) stored.delete(name);
    else stored.set(name, value);
    for (const target of pages)
      if (target !== page)
        setTimeout(() =>
          target.dispatchEvent(Object.assign(new Event('storage'), { key: name, oldValue, newValue: value })),
        );
  }
  function tab(options: { page?: boolean } = {}) {
    const page = new EventTarget();
    if (options.page !== false) pages.add(page);
    const context = vm.createContext({
      ...authorization,
      ...preimage,
      ...transaction,
      Networks,
      fetch: fetcher,
      localStorage: {
        getItem: (name: string) => stored.get(name) ?? null,
        setItem: (name: string, value: string) => write(page, name, String(value)),
        removeItem: (name: string) => write(page, name, null),
      },
      addEventListener: page.addEventListener.bind(page),
      removeEventListener: page.removeEventListener.bind(page),
      AbortController,
      AbortSignal,
      URL,
      crypto,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      structuredClone,
    });
    vm.runInContext(browserScript(new URL('../sdk/errors.ts', import.meta.url)), context);
    vm.runInContext(browserScript(new URL('../sdk/walleterm.ts', import.meta.url)), context);
    const wallet: Walleterm = vm.runInContext(
      `new Walleterm({ walletScope: 'available', pollInterval: 1, ${options.page === false ? 'page: null' : ''} })`,
      context,
    );
    const changes: (string | null)[] = [];
    wallet.onChange(({ address }) => changes.push(address));
    return { wallet, changes };
  }
  const pair = (wallet: Walleterm) =>
    wallet.connect({ url: origin, code: bridge.pairing.code, selectWallet: async () => key.publicKey() });
  const revoke = (token: string) =>
    fetcher(`${origin}/v1/disconnect`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  const hold = () => {
    const release = Promise.withResolvers<void>();
    held = release.promise;
    return () => {
      held = null;
      release.resolve();
    };
  };
  return { tab, pair, revoke, hold, stored, paths, signatures: () => signatures };
}

function unsigned(source: string) {
  return new TransactionBuilder(new Account(source, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'tabs', value: 'yes' }))
    .setTimeout(120)
    .build()
    .toXDR();
}
async function until(check: () => boolean, what: string) {
  for (let attempt = 0; attempt < 200 && !check(); attempt++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  if (!check()) throw Error(`Timed out waiting for ${what}.`);
}

test('a new tab uses the saved session and signs with the confirmed wallet', async () => {
  const f = await website();
  const first = f.tab();
  await f.pair(first.wallet);
  const second = f.tab();
  expect((await second.wallet.getAddress({ skipRequestAccess: true })).address).toBe(key.publicKey());
  expect(second.wallet.client!.token).toBe(first.wallet.client!.token);
  const signed = await second.wallet.signTransaction(unsigned(key.publicKey()));
  expect(signed.error).toBeUndefined();
  expect(signed.signerAddress).toBe(key.publicKey());
  expect(f.paths.filter((path) => path === '/v1/connect')).toHaveLength(1);
});

test('a wallet change in one tab reaches the other tab, including a change away and back', async () => {
  const f = await website();
  const first = f.tab();
  await f.pair(first.wallet);
  const second = f.tab();
  await second.wallet.getAddress({ skipRequestAccess: true });
  await first.wallet.selectWallet(other.publicKey());
  await until(() => second.wallet.address === other.publicKey(), 'the second tab to follow the switch');
  // Back to the first wallet. Only the selection revision tells the second tab that it is stale.
  await first.wallet.selectWallet(key.publicKey());
  await until(() => second.wallet.client!.revision === 3, 'the second tab to read the new revision');
  expect(second.changes).toEqual([key.publicKey(), other.publicKey(), key.publicKey()]);
  const signed = await second.wallet.signTransaction(unsigned(key.publicKey()));
  expect(signed.error).toBeUndefined();
  expect(f.signatures()).toBe(1);
});

test('a disconnection in one tab ends the session in every tab with one revocation', async () => {
  const f = await website();
  const first = f.tab();
  await f.pair(first.wallet);
  const second = f.tab();
  await second.wallet.getAddress({ skipRequestAccess: true });
  await first.wallet.disconnect();
  await until(() => second.wallet.client === null, 'the second tab to forget the session');
  expect(second.changes).toEqual([key.publicKey(), null]);
  expect(f.stored.has(STORAGE)).toBe(false);
  expect(f.paths.filter((path) => path === '/v1/disconnect')).toHaveLength(1);
});

test('a new pairing in another tab replaces the session without an intermediate disconnection', async () => {
  const f = await website();
  const first = f.tab();
  await f.pair(first.wallet);
  const second = f.tab();
  await second.wallet.getAddress({ skipRequestAccess: true });
  const previous = first.wallet.client!.token!;
  // The Kit hook would revoke a session after a reported disconnection. None may appear here.
  await f.pair(first.wallet);
  const next = first.wallet.client!.token!;
  expect(next).not.toBe(previous);
  await until(() => second.wallet.client?.token === next && !!second.wallet.address, 'the new session');
  expect(second.changes).toEqual([key.publicKey()]);
  expect((await second.wallet.signTransaction(unsigned(key.publicKey()))).error).toBeUndefined();
});

test('another tab reporting the revoked session does not disconnect a tab that replaces it', async () => {
  const f = await website();
  const first = f.tab();
  await f.pair(first.wallet);
  const second = f.tab();
  await second.wallet.getAddress({ skipRequestAccess: true });
  const previous = first.wallet.client!.token!;
  const release = f.hold();
  const replacing = f.pair(first.wallet);
  // The bridge revoked the previous session. The second tab finds that out and removes the saved session.
  await until(() => f.paths.includes('/v1/disconnect'), 'the revocation');
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect((await second.wallet.getAddress({ skipRequestAccess: true })).error?.ext).toEqual([
    'walleterm:not_connected',
  ]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  await replacing;
  expect(first.wallet.client!.token).not.toBe(previous);
  expect(first.changes).toEqual([key.publicKey()]);
  await until(() => second.wallet.address === key.publicKey(), 'the second tab to use the new session');
  expect(second.changes).toEqual([key.publicKey(), null, key.publicKey()]);
});

test('a session that one tab finds expired ends in every tab', async () => {
  const f = await website();
  const first = f.tab();
  await f.pair(first.wallet);
  const second = f.tab();
  await second.wallet.getAddress({ skipRequestAccess: true });
  await f.revoke(first.wallet.client!.token!);
  expect((await first.wallet.getAddress({ skipRequestAccess: true })).error?.ext).toEqual([
    'walleterm:not_connected',
  ]);
  await until(() => second.wallet.client === null, 'the second tab to forget the session');
  expect(first.changes).toEqual([key.publicKey(), null]);
  expect(second.changes).toEqual([key.publicKey(), null]);
});

test('a restored session reports its confirmed state once, even a disconnection', async () => {
  const f = await website();
  const first = f.tab();
  await f.pair(first.wallet);
  const confirmed = f.tab();
  await confirmed.wallet.getAddress({ skipRequestAccess: true });
  expect(confirmed.changes).toEqual([key.publicKey()]);
  await f.revoke(first.wallet.client!.token!);
  // This tab did not see the revocation. A Kit restored on load can still show the address.
  const restored = f.tab({ page: false });
  expect((await restored.wallet.getAddress({ skipRequestAccess: true })).address).toBe('');
  expect(restored.changes).toEqual([null]);
  expect(f.stored.has(STORAGE)).toBe(false);
});

test('a wallet change that fails reports no disconnection and recovers the account', async () => {
  const f = await website();
  const first = f.tab();
  await f.pair(first.wallet);
  // This tab misses storage events, so its selection revision becomes stale.
  const late = f.tab({ page: false });
  await late.wallet.getAddress({ skipRequestAccess: true });
  await first.wallet.selectWallet(other.publicKey());
  // The bridge compares the stale revision first, so this selection fails with 409.
  await expect(late.wallet.selectWallet(other.publicKey())).rejects.toMatchObject({
    ext: ['walleterm:conflict'],
  });
  expect(late.wallet.address).toBe(other.publicKey());
  expect(late.changes).toEqual([key.publicKey(), other.publicKey()]);
  expect(first.wallet.client!.token).toBeTruthy();
});
