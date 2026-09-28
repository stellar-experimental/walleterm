// Offline cross-tab check for Stellar Wallets Kit 2.7.0 and the Walleterm Kit module.
// Each tab is a worker with its own Kit state. The parent holds the origin localStorage and relays storage events.
// It drives the Rust bridge in walleterm-test-host with isolated random mock keys only. Run from the repository root:
//   cargo build --locked --features test-host --bin walleterm-test-host
//   bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts && bun fixtures/kit/tabs.mts
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk';
import { createHost } from '../../tests/browser/host.ts';

const key = Keypair.random(),
  other = Keypair.random();
const site = 'https://tabs.example';
const bridge = await createHost({
  latestLedger: async () => 100,
  listSigners: async () => [key, other].map((k) => ({ public_key: k.publicKey() })),
  sign: async (publicKey, digest) =>
    Buffer.from((publicKey === key.publicKey() ? key : other).sign(Buffer.from(digest, 'hex'))).toString(
      'hex',
    ),
});
const origin = bridge.origin;

// The origin's localStorage. Each write goes to every other open tab as a storage event.
const storage = new Map<string, string>();
const tabs = new Set<Worker>();
let nextCall = 0;
const replies = new Map<number, PromiseWithResolvers<unknown>>();
async function open() {
  const worker = new Worker(new URL('./tab.mts', import.meta.url).href);
  const loaded = Promise.withResolvers<void>();
  worker.onmessage = ({ data }) => {
    if (data.type === 'loaded') loaded.resolve();
    if (data.type === 'write') {
      if (data.value === null) storage.delete(data.key);
      else storage.set(data.key, data.value);
      for (const tab of tabs) if (tab !== worker) tab.postMessage({ ...data, type: 'storage' });
    }
    if (data.type === 'result') {
      const reply = replies.get(data.id)!;
      replies.delete(data.id);
      if ('error' in data) reply.reject(Error(data.error));
      else reply.resolve(data.value);
    }
  };
  tabs.add(worker);
  worker.postMessage({
    type: 'load',
    origin,
    site,
    key: key.publicKey(),
    snapshot: Object.fromEntries(storage),
  });
  await loaded.promise;
  const call = <T,>(action: string, ...args: unknown[]) => {
    const id = nextCall++,
      reply = Promise.withResolvers<unknown>();
    replies.set(id, reply);
    worker.postMessage({ type: 'call', id, action, args });
    return reply.promise as Promise<T>;
  };
  return {
    kitAddress: () => call<string | null>('kitAddress'),
    walletAddress: () => call<string | null>('walletAddress'),
    connect: async () => call<string>('connect', await bridge.code()),
    switchTo: (publicKey: string) => call<string>('switchTo', publicKey),
    kitDisconnect: () => call<void>('kitDisconnect'),
    sign: () => call<{ signer?: string; error?: string }>('sign'),
    close() {
      tabs.delete(worker);
      worker.terminate();
    },
  };
}
type Tab = Awaited<ReturnType<typeof open>>;
// Wait until both views of a tab settle on the expected address, or report what the tab shows.
async function settled(tab: Tab, address: string | null, milliseconds = 3000) {
  const deadline = Date.now() + milliseconds;
  let seen = { kit: null as string | null, wallet: null as string | null };
  while (Date.now() < deadline) {
    seen = { kit: await tab.kitAddress(), wallet: await tab.walletAddress() };
    if (seen.kit === address && seen.wallet === address) return { ...seen, agree: true };
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { ...seen, agree: false };
}

const results: Record<string, unknown> = {};
try {
  const first = await open();
  assert.equal(await first.connect(), key.publicKey());
  results.first_tab = await settled(first, key.publicKey());

  // A second tab of the same website. The Kit restores its address from localStorage.
  const second = await open();
  results.second_tab = await settled(second, key.publicKey());
  results.second_tab_sign = await second.sign();

  // A wallet change in the first tab reaches the second tab.
  await first.switchTo(other.publicKey());
  results.first_switch = await settled(first, other.publicKey());
  results.second_after_switch = await settled(second, other.publicKey());
  results.second_after_switch_sign = await second.sign();

  // A Kit disconnection in the first tab reaches the second tab.
  await first.kitDisconnect();
  results.first_disconnect = await settled(first, null);
  results.second_after_disconnect = await settled(second, null);

  // A new tab after the bridge session ended clears the address that the Kit restored.
  await first.connect();
  await settled(first, key.publicKey());
  const token = JSON.parse(storage.get('walleterm:session') ?? 'null')?.token;
  second.close();
  first.close();
  if (token)
    await fetch(`${origin}/v1/disconnect`, {
      method: 'POST',
      headers: { Origin: site, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
  results.stored_after_close = {
    kit: storage.get('@StellarWalletsKit/activeAddress') ?? null,
    walleterm: storage.has('walleterm:session'),
  };
  const third = await open();
  results.third_tab_after_expiry = await settled(third, null);
  third.close();

  console.log(JSON.stringify({ kit: '2.7.0', results }, null, 2));
  for (const [name, value] of Object.entries(results))
    if (value && typeof value === 'object' && 'agree' in value) assert.ok(value.agree, `${name} disagrees`);
  assert.deepEqual(results.second_tab_sign, { signer: key.publicKey() });
  assert.deepEqual(results.second_after_switch_sign, { signer: other.publicKey() });
  console.log(JSON.stringify({ ok: true }));
} finally {
  for (const tab of tabs) tab.terminate();
  await bridge.close();
}
