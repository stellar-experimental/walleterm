// SEP-43 live acceptance page: the real Stellar Wallets Kit 2.7.0 with WalletermModule,
// the WalletermConnect header, and the documented guarded onChange hook.
// Every action runs on Stellar testnet. The coordinator drives it through window.acceptance.
import { StellarWalletsKit } from '@creit.tech/stellar-wallets-kit/sdk';
import { ModuleType, Networks } from '@creit.tech/stellar-wallets-kit/types';
import type { ModuleInterface } from '@creit.tech/stellar-wallets-kit/types';
import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  contract,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { Walleterm } from '../../../sdk/walleterm.ts';
import { WalletermConnect } from '../../../sdk/connect.ts';
import { WALLETERM_ID, WalletermModule } from '../../../sdk/kit.ts';
import { EXPECTED, mismatches, runNegatives } from './negatives.mts';
import type { BridgeRequest } from './negatives.mts';

const HORIZON = 'https://horizon-testnet.stellar.org';
const RPC = 'https://soroban-testnet.stellar.org';

// Record every bridge request from the wallet. Step 4 uses the count.
const requests: BridgeRequest[] = [];
const wallet = new Walleterm({
  walletScope: 'available',
  fetch: (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ method: init?.method ?? 'GET', path: new URL(url).pathname });
    return fetch(input, init);
  },
});
new WalletermConnect(document.getElementById('wallet-connection')!, { wallet });
const walletermModule = new WalletermModule({ wallet });

// A second Kit wallet for the guard check. It never signs.
const otherAddress = Keypair.random().publicKey();
const otherCalls = { getAddress: 0, disconnect: 0 };
const refuse = async () => Promise.reject({ code: -3, message: 'The acceptance wallet does not sign.' });
const otherWallet: ModuleInterface = {
  moduleType: ModuleType.HOT_WALLET,
  productId: 'other',
  productName: 'Other acceptance wallet',
  productUrl: 'https://example.com',
  productIcon: '',
  isAvailable: async () => true,
  getAddress: async () => {
    otherCalls.getAddress++;
    return { address: otherAddress };
  },
  signTransaction: refuse,
  signAuthEntry: refuse,
  signMessage: refuse,
  getNetwork: async () => ({ network: 'TESTNET', networkPassphrase: Networks.TESTNET }),
  disconnect: async () => {
    otherCalls.disconnect++;
  },
};
StellarWalletsKit.init({ modules: [walletermModule, otherWallet], network: Networks.TESTNET });

// The documented hook: act only while Walleterm is the selected Kit wallet.
const events: unknown[] = [];
const walletermActive = () => {
  try {
    return StellarWalletsKit.selectedModule.productId === WALLETERM_ID;
  } catch {
    return false; // No Kit wallet is selected.
  }
};
walletermModule.onChange(({ address }) => {
  const active = walletermActive();
  events.push({ address, active, at: new Date().toISOString() });
  if (!active) return;
  void (address ? StellarWalletsKit.fetchAddress() : StellarWalletsKit.disconnect()).catch((error) =>
    events.push({ hookError: String(error?.message ?? error) }),
  );
});

async function kitAddress() {
  try {
    return (await StellarWalletsKit.getAddress()).address;
  } catch {
    return null;
  }
}
async function until(check: () => Promise<boolean>, what: string, milliseconds = 20000) {
  const deadline = Date.now() + milliseconds;
  while (!(await check())) {
    if (Date.now() > deadline) throw Error(`Timed out waiting for ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function sequence(address: string) {
  const response = await fetch(`${HORIZON}/accounts/${address}`);
  if (!response.ok) throw Error(`Horizon has no account ${address}.`);
  return (await response.json()).sequence as string;
}
async function submit(signedXdr: string) {
  const response = await fetch(`${HORIZON}/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: signedXdr }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Error(`Horizon rejected the transaction: ${JSON.stringify(data.extras?.result_codes)}`);
  return { hash: data.hash as string, ledger: data.ledger as number, successful: data.successful as boolean };
}
function build(address: string, sequenceNumber: string, operation: ReturnType<typeof Operation.manageData>) {
  return new TransactionBuilder(new Account(address, sequenceNumber), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(120)
    .build();
}

const actions = {
  // Step 3a. authModal calls the module's getAddress, which calls Walleterm.getAddress and its dialog.
  async kitConnect() {
    const { address } = await StellarWalletsKit.authModal();
    return { address, walletermAddress: wallet.address };
  },
  // Step 3b. A classic transaction signed through the Kit.
  async signNote() {
    const address = (await StellarWalletsKit.getAddress()).address;
    const tx = build(
      address,
      await sequence(address),
      Operation.manageData({ name: 'sep43-kit', value: new Date().toISOString().slice(0, 19) }),
    );
    const { signedTxXdr, signerAddress } = await StellarWalletsKit.signTransaction(tx.toXDR());
    return { signerAddress, ...(await submit(signedTxXdr)) };
  },
  // Step 3c. A SAC transfer from the Kit address. The recipient is the source and signs the envelope.
  // signAuthEntries signs the sender's address-bound preimage. A Walleterm switch then moves the Kit to the recipient.
  async transferWithAuth(to: string, amount = '1') {
    const from = (await StellarWalletsKit.getAddress()).address;
    if (from === to) throw Error('Choose a recipient other than the Kit address.');
    const tx = await contract.AssembledTransaction.build({
      contractId: Asset.native().contractId(Networks.TESTNET),
      method: 'transfer',
      args: [
        nativeToScVal(from, { type: 'address' }),
        nativeToScVal(to, { type: 'address' }),
        nativeToScVal(BigInt(Math.round(Number(amount) * 1e7)), { type: 'i128' }),
      ],
      networkPassphrase: Networks.TESTNET,
      rpcUrl: RPC,
      publicKey: to,
      parseResultXdr: () => null,
      useUpgradedAuth: true,
    });
    const needed = tx.needsNonInvokerSigningBy();
    await tx.signAuthEntries({
      address: from,
      signAuthEntry: (preimage, opts) => StellarWalletsKit.signAuthEntry(preimage, opts),
    });
    await tx.simulate();
    await wallet.selectWallet(to);
    await until(async () => (await kitAddress()) === to, 'the Kit address to follow the Walleterm switch');
    const sent = await tx.signAndSend({
      signTransaction: (xdr, opts) => StellarWalletsKit.signTransaction(xdr, opts),
    });
    const final = sent.getTransactionResponse;
    return {
      from,
      to,
      needed,
      hash: sent.sendTransactionResponse?.hash,
      status: final?.status,
      ledger: final && 'ledger' in final ? final.ledger : undefined,
    };
  },
  // Step 3 switch without a transaction, as the header dropdown does.
  async switchTo(address: string) {
    await wallet.selectWallet(address);
    await until(
      async () => (await kitAddress()) === address,
      'the Kit address to follow the Walleterm switch',
    );
    return { walletermAddress: wallet.address, kitAddress: await kitAddress() };
  },
  // Step 3d. With another Kit wallet selected, Walleterm events must call nothing on it.
  async guard(switchTo: string) {
    StellarWalletsKit.setWallet('other');
    await StellarWalletsKit.fetchAddress();
    const before = { ...otherCalls };
    await wallet.selectWallet(switchTo);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = { ...otherCalls },
      kitWhileOther = await kitAddress();
    StellarWalletsKit.setWallet(WALLETERM_ID);
    await StellarWalletsKit.fetchAddress();
    return {
      passed: JSON.stringify(before) === JSON.stringify(after) && kitWhileOther === otherAddress,
      otherCallsBefore: before,
      otherCallsAfter: after,
      kitWhileOther,
      otherAddress,
      walletermAddress: wallet.address,
      kitAddressAfter: await kitAddress(),
    };
  },
  // Step 4. Four requests that must never reach the signer.
  async negatives() {
    const result = await runNegatives(wallet, requests);
    const failed = mismatches(result);
    return { passed: failed.length === 0, failed, ...result, expected: EXPECTED };
  },
  // Step 5. changeTrust was blocked by the old operation allowlist. It signs through plain SEP-43.
  async changeTrust(issuer: string, remove = false) {
    const address = wallet.address;
    if (!address) throw Error('Connect Walleterm first.');
    const asset = new Asset('SEP43ACC', issuer);
    const tx = build(
      address,
      await sequence(address),
      Operation.changeTrust({ asset, ...(remove ? { limit: '0' } : {}) }),
    );
    const { signedTxXdr, signerAddress, error } = await wallet.signTransaction(tx.toXDR());
    if (error) throw error;
    const submitted = await submit(signedTxXdr);
    const account = await (await fetch(`${HORIZON}/accounts/${address}`)).json();
    const trustline =
      account.balances.find(
        (line: { asset_code?: string; asset_issuer?: string }) =>
          line.asset_code === 'SEP43ACC' && line.asset_issuer === issuer,
      ) ?? null;
    return { signerAddress, ...submitted, trustline };
  },
  // Step 3e. A Kit disconnection revokes the Walleterm bridge session.
  async kitDisconnect() {
    const token = wallet.client?.token,
      url = wallet.client?.url;
    await StellarWalletsKit.disconnect();
    await until(async () => wallet.address === '', 'Walleterm to disconnect');
    const revoked =
      token && url
        ? await fetch(`${url}/v1/account`, { headers: { Authorization: `Bearer ${token}` } })
        : null;
    return {
      walletermAddress: wallet.address,
      kitAddress: await kitAddress(),
      oldTokenStatus: revoked?.status,
    };
  },
};

type ActionName = keyof typeof actions;
interface Result {
  status: 'running' | 'ok' | 'error';
  started: string;
  finished?: string;
  value?: unknown;
  error?: unknown;
}
const results: Record<string, Result> = {};
const log = document.getElementById('log')!;
const render = () => {
  log.textContent = JSON.stringify({ results, events, requests: requests.length }, null, 2);
};
function serialize(error: unknown) {
  const value = (error ?? {}) as {
    name?: string;
    message?: string;
    code?: number;
    ext?: string[];
    requestState?: string;
  };
  return {
    name: value.name,
    message: value.message ?? String(error),
    code: value.code,
    ext: value.ext,
    requestState: value.requestState,
  };
}
// Start an action and return at once. The caller polls acceptance.finished(name).
function start<N extends ActionName>(name: N, ...args: Parameters<(typeof actions)[N]>) {
  if (results[name]?.status === 'running') return 'running';
  const started = new Date().toISOString();
  results[name] = { status: 'running', started };
  render();
  (actions[name] as (...values: unknown[]) => Promise<unknown>)(...args)
    .then(
      (value) => (results[name] = { status: 'ok', started, finished: new Date().toISOString(), value }),
      (error) =>
        (results[name] = {
          status: 'error',
          started,
          finished: new Date().toISOString(),
          error: serialize(error),
        }),
    )
    .finally(render);
  return 'started';
}
const acceptance = {
  wallet,
  kit: StellarWalletsKit,
  walletermModule,
  start,
  results,
  events,
  requests,
  otherCalls,
  finished: (name: string) => !!results[name] && results[name].status !== 'running',
  result: (name: string) => JSON.stringify(results[name] ?? null),
  state: async () =>
    JSON.stringify({
      walletermAddress: wallet.address,
      kitAddress: await kitAddress(),
      walletScope: wallet.client?.walletScope ?? null,
      bridge: wallet.url,
      requests: requests.length,
      events,
    }),
};
declare global {
  interface Window {
    acceptance: typeof acceptance;
  }
}
window.acceptance = acceptance;
document.getElementById('kit-connect')!.onclick = () => start('kitConnect');
render();
