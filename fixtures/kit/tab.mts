// One browser tab for fixtures/kit/tabs.mts. It runs in a worker, so it has its own Kit state.
// Its localStorage is a local copy of the origin storage. The parent applies each write and sends it to the other tabs.
import type { WalletermModule } from '../../sdk/kit.ts';

declare const self: Worker;
type Call = { id: number; action: string; args: unknown[] };

const local = new Map<string, string>(),
  session = new Map<string, string>();
const events: { address: string; active: boolean }[] = [];
let actions: Record<string, (...args: never[]) => unknown> = {};

function install(snapshot: Record<string, string>) {
  for (const [key, value] of Object.entries(snapshot)) local.set(key, value);
  const area = (store: Map<string, string>, shared: boolean) => ({
    getItem: (key: string) => store.get(key) ?? null,
    setItem(key: string, value: string) {
      value = String(value);
      if (store.get(key) === value) return;
      store.set(key, value);
      if (shared) postMessage({ type: 'write', key, value });
    },
    removeItem(key: string) {
      if (!store.delete(key)) return;
      if (shared) postMessage({ type: 'write', key, value: null });
    },
  });
  Object.assign(globalThis, { localStorage: area(local, true), sessionStorage: area(session, false) });
}

async function load(origin: string, site: string, key: string, snapshot: Record<string, string>) {
  install(snapshot);
  // The Kit reads its saved state at import, as it does on page load.
  const { StellarWalletsKit } = await import('@creit.tech/stellar-wallets-kit/sdk');
  const { Networks } = await import('@creit.tech/stellar-wallets-kit/types');
  const { Account, Operation, TransactionBuilder } = await import('@stellar/stellar-sdk');
  const { Walleterm } = await import('../../sdk/walleterm.ts');
  const { WALLETERM_ID, WalletermModule } = await import('../../sdk/kit.ts');
  let code = '';
  const wallet = new Walleterm({
    walletScope: 'available',
    pollInterval: 5,
    fetch: (url, options) => {
      const headers = new Headers(options?.headers);
      headers.set('Origin', site);
      return fetch(url, { ...options, headers });
    },
    // Stands in for the pairing dialog.
    ui: {
      requestAccess: async (target) =>
        (await target.connect({ url: origin, code, selectWallet: async () => key })).address,
    },
  });
  const module: WalletermModule = new WalletermModule({ wallet });
  StellarWalletsKit.init({ modules: [module], network: Networks.TESTNET });
  // The documented guarded hook.
  const walletermActive = () => {
    try {
      return StellarWalletsKit.selectedModule.productId === WALLETERM_ID;
    } catch {
      return false;
    }
  };
  module.onChange(({ address }) => {
    const active = walletermActive();
    events.push({ address, active });
    if (active)
      void (address ? StellarWalletsKit.fetchAddress() : StellarWalletsKit.disconnect()).catch(() => {});
  });
  const kitAddress = () =>
    StellarWalletsKit.getAddress().then(
      ({ address }) => address,
      () => null,
    );
  actions = {
    kitAddress,
    walletAddress: () => wallet.address || null,
    events: () => events,
    async connect(value: string) {
      code = value;
      StellarWalletsKit.setWallet(WALLETERM_ID);
      return (await StellarWalletsKit.fetchAddress()).address;
    },
    async switchTo(publicKey: string) {
      return (await wallet.selectWallet(publicKey)).address;
    },
    kitDisconnect: () => StellarWalletsKit.disconnect(),
    // Sign a transaction for the Kit address through the Kit. Returns the signer or the error reason.
    async sign() {
      const address = await kitAddress();
      if (!address) return { error: 'The Kit has no address.' };
      const xdr = new TransactionBuilder(new Account(address, '1'), {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.manageData({ name: 'tab', value: 'yes' }))
        .setTimeout(120)
        .build()
        .toXDR();
      try {
        return { signer: (await StellarWalletsKit.signTransaction(xdr)).signerAddress };
      } catch (error) {
        return { error: (error as { ext?: string[] }).ext?.[0] ?? String(error) };
      }
    },
  };
}

self.onmessage = async ({ data }) => {
  if (data.type === 'load') {
    await load(data.origin, data.site, data.key, data.snapshot);
    return postMessage({ type: 'loaded' });
  }
  if (data.type === 'storage') {
    // Another tab wrote the origin storage. Update this copy, then fire the storage event, as a browser does.
    const oldValue = local.get(data.key) ?? null;
    if (data.value === null) local.delete(data.key);
    else local.set(data.key, data.value);
    const event = Object.assign(new Event('storage'), { key: data.key, oldValue, newValue: data.value });
    return globalThis.dispatchEvent(event);
  }
  if (data.type === 'call') {
    const { id, action, args } = data as Call;
    try {
      postMessage({ type: 'result', id, value: await actions[action](...(args as never[])) });
    } catch (error) {
      postMessage({ type: 'result', id, error: String((error as Error)?.message ?? error) });
    }
  }
};
