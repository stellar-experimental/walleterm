import { deadline, requestError } from '../../sdk/errors.ts';
import type { RequestError } from '../../sdk/errors.ts';
import { createCodeView, highlightConnectionCommand } from './code-view.js';
import { WalletermConnect } from '../../sdk/connect.ts';
import { createActivityLog } from './activity.ts';
import {
  CONTRACT_RPC,
  MAX_SETS,
  assembleAuthorizedContract,
  authorizationExpiry,
  contractSet,
  demoRpc,
  hex as contractHex,
  prepareContract,
  readWalkthrough,
  signDemoAuthorization,
  validateContractReview,
  verifyContractResult,
} from './contracts.ts';
import type { ContractReview, ContractStage, WalkthroughLedger } from './contracts.ts';
import { stepButtons, stepTitles, transactionPhases, walkthroughView } from './walkthrough.ts';
import type { RowState } from './walkthrough.ts';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import type { Horizon, Transaction } from '@stellar/stellar-sdk';
import type { Account as WalletAccount, Fetch } from '../../sdk/types.ts';
import type { Sep43Error } from '../../sdk/errors.ts';
import type { Walleterm } from '../../sdk/walleterm.ts';

type Action =
  'note' | 'payment' | 'trustline' | 'offer' | 'cancel_offer' | 'contract_setup' | 'contract_counter';
type State =
  | 'review'
  | 'waiting'
  | 'signing_unknown'
  | 'signed'
  | 'submitting'
  | 'unknown'
  | 'submitted'
  | 'canceled'
  | 'denied'
  | 'expired'
  | 'failed';
interface Journal {
  kind: Action;
  address: string;
  hash: string;
  xdr: string;
  state: State;
  recipient?: string;
  signed_xdr?: string;
  result?: unknown;
  contract?: ContractReview;
}
interface TransactionResult {
  hash: string;
  ledger: number;
  successful: boolean;
  result_xdr: string;
}
interface ContractResult {
  ledger?: number;
  verification?: unknown;
  verification_error?: string;
}
interface Page<T> {
  _embedded: { records: T[] };
}
type HorizonAccount = Horizon.HorizonApi.AccountResponse;
interface HorizonFailure {
  detail?: string;
  extras?: { result_codes?: { transaction?: string }; result_xdr?: string };
}
class HorizonError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly result: HorizonFailure,
  ) {
    super(message);
  }
}
type UserStage = 'deploy-account' | 'deploy-target' | 'increment';
interface Elements {
  review: HTMLDialogElement;
  'transaction-details': HTMLDetailsElement;
  note: HTMLButtonElement;
  payment: HTMLButtonElement;
  trustline: HTMLButtonElement;
  offer: HTMLButtonElement;
  'cancel-offer': HTMLButtonElement;
  'discard-record': HTMLButtonElement;
  sign: HTMLButtonElement;
  submit: HTMLButtonElement;
  check: HTMLButtonElement;
  clear: HTMLButtonElement;
  continue: HTMLButtonElement;
  done: HTMLButtonElement;
  'cancel-request': HTMLButtonElement;
  'walkthrough-refresh': HTMLButtonElement;
  'walkthrough-new-set': HTMLButtonElement;
  'walkthrough-code-action': HTMLButtonElement;
  'walkthrough-deploy-account-action': HTMLButtonElement;
  'walkthrough-deploy-target-action': HTMLButtonElement;
  'walkthrough-increment-action': HTMLButtonElement;
  'walkthrough-deploy-account-copy': HTMLButtonElement;
  'walkthrough-deploy-target-copy': HTMLButtonElement;
}
function $<K extends string>(id: K): K extends keyof Elements ? Elements[K] : HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw Error(`Missing demo element: ${id}`);
  return element as K extends keyof Elements ? Elements[K] : HTMLElement;
}
const updateDetails = createCodeView($('details'), { label: 'JSON', disclosure: $('transaction-details') });
const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
// The trustline leaves room for the offer's 1 USDC and for Circle's 20 USDC faucet payments.
const USDC_LIMIT = '100';
const STORAGE = 'walleterm-demo-request-v1';
const OFFLINE = 'The demo could not reach testnet. Check your network.';
const BLOCKED = 'The saved transaction record cannot be read. Activity has a copy.';
const activity = createActivityLog($('activity'), {
  decodeSigned(signedXdr) {
    const transaction = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    const hex = (bytes: Uint8Array) =>
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return {
      hash: hex(transaction.hash()),
      signatures: transaction.signatures.map((signature) => hex(signature.signature.toBytes())),
    };
  },
});
// A browser network error says only "Failed to fetch". Name the cause for testnet requests.
// Activity keeps the original error. Other failures, aborts, and timeouts keep their own messages.
function testnetFetch(fetcher: Fetch): Fetch {
  return async (input, init) => {
    try {
      return await fetcher(input, init);
    } catch (errorValue) {
      let origin = '';
      try {
        origin = new URL(typeof input === 'object' && 'url' in input ? input.url : String(input)).origin;
      } catch {
        /* Not a testnet URL. */
      }
      if (
        requestError(errorValue).name === 'TypeError' &&
        [HORIZON, FRIENDBOT, CONTRACT_RPC].includes(origin)
      )
        throw Object.assign(Error(OFFLINE), { name: 'NetworkError', cause: errorValue });
      throw errorValue;
    }
  };
}
if (globalThis.fetch)
  globalThis.fetch = Object.assign(
    testnetFetch(activity.wrapFetch(globalThis.fetch.bind(globalThis))),
    globalThis.fetch,
  );
let wallet: Walleterm | null = null;
let account: WalletAccount | null = null;
let pending: Journal | null = null;
let signingController: AbortController | null = null;
let signingDeadline = 0;
let selectedAction: Action | null = null;
let selectedStage: ContractStage | null = null;
let selectedSet = 1;
let busy = false,
  journalBlocked = false,
  actionPhase = '',
  actionProgress = '';
// Live ledger state for the walkthrough. A read applies only while its generation and wallet are current.
let ledger: WalkthroughLedger | null = null;
let ledgerReading = false,
  ledgerError = '',
  ledgerChecked = 0,
  ledgerGeneration = 0,
  chosenSet = 0;
let testnetAccount: HorizonAccount | 'missing' | null = null;
// The connection component shares its session with the site's other tabs. It checks the session after a reload.
const connection = new WalletermConnect($('wallet-connection'), {
  onBusyChange: () => render(),
  onStateChange: () => render(),
  onChange(value) {
    const previousAddress = account?.address;
    wallet = value.wallet;
    // The demo builds, funds, and submits on testnet only. It sends no request to a tunnel on another network.
    const otherNetwork =
      value.account && value.account.networkPassphrase !== Networks.TESTNET ? value.account : null;
    account = otherNetwork ? null : value.account;
    activity.record(
      'walleterm',
      otherNetwork
        ? 'Wallet on another network'
        : account
          ? previousAddress && previousAddress !== account.address
            ? 'Active wallet changed'
            : 'Wallet connected'
          : 'Wallet disconnected',
      { previous_address: previousAddress, account: value.account },
    );
    // An unreadable saved record still blocks actions, so its message stays.
    status(
      journalBlocked
        ? BLOCKED
        : otherNetwork
          ? `The tunnel signs on ${otherNetwork.network.toLowerCase()}, but this demo uses testnet. Restart the tunnel without --network, then connect again.`
          : account
            ? 'Wallet connected. Choose a testnet action.'
            : 'The website is disconnected.',
    );
    if (account?.address !== previousAddress) {
      chosenSet = 0;
      ledger = null;
      ledgerError = '';
      testnetAccount = null;
      void refreshWalkthrough();
      void refreshAccount();
    }
    render();
  },
});
highlightConnectionCommand($('wallet-connection'));
function progressLabel(text: string) {
  actionProgress = text;
  render();
}
// Status text is for the page. The activity log records the events that caused it.
function status(text: string) {
  $('status').textContent = text;
  if ($('review').open || busy) $('review-status').textContent = text;
}
// A notice also goes to the activity log, because no other event records its fact.
function notice(text: string, data?: Record<string, unknown>) {
  activity.record('status', text, data);
  status(text);
}
const actionNames = {
  note: 'Write a note',
  payment: 'Pay 0.01 test XLM',
  trustline: 'Add USDC trustline',
  offer: 'Offer 0.1 test XLM',
  cancel_offer: 'Cancel newest offer',
  contract_setup: 'Walkthrough step',
  contract_counter: 'Increase the counter',
};
const actionTitle = (kind: Action, stage?: ContractStage | null) =>
  stage ? stepTitles[stage] : actionNames[kind];
const stateNames = {
  review: 'Ready to sign',
  waiting: 'Waiting for a signature',
  signing_unknown: 'Signing result unknown',
  signed: 'Ready to submit',
  submitting: 'Submitting to testnet',
  unknown: 'Submission result unknown',
  submitted: 'Transaction complete',
  canceled: 'Signing canceled',
  denied: 'Signature declined',
  expired: 'Transaction expired',
  failed: 'Transaction failed',
};
const verifiedTitles = {
  'upload-account': 'Smart account code uploaded',
  'upload-target': 'Counter code uploaded',
  'deploy-account': 'Smart account deployed',
  'deploy-target': 'Counter deployed',
  increment: 'Counter increased',
};
const short = (value = '') => (value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value);
// The Stellar RPC client rejects a JSON-RPC error as a plain object. Keep its message.
function demoError(value: unknown): RequestError {
  // The RPC client reports an HTTP failure as "Request failed with status code N".
  const status = (value as { response?: { status?: unknown } } | null)?.response?.status;
  if (value instanceof Error && typeof status === 'number')
    return Error(`Testnet returned an error (HTTP ${status}). Try again later.`);
  const plain =
    value && typeof value === 'object' && !(value instanceof Error) ? (value as { message?: unknown }) : null;
  return requestError(
    typeof plain?.message === 'string' ? Object.assign(Error(plain.message), plain) : value,
  );
}
// The button that opened the window gets focus back when it closes.
let opener: HTMLButtonElement | null = null;
function openReview() {
  if ($('review').open) return;
  const active = document.activeElement as HTMLButtonElement | null;
  opener = active?.tagName === 'BUTTON' ? active : null;
  $('review').showModal();
}
function closeReview() {
  $('review').close();
  const target =
    opener?.isConnected && !opener.disabled && opener.getClientRects().length
      ? opener
      : pending || (busy && selectedAction)
        ? $('open-review')
        : selectedStage
          ? $('walkthrough-title')
          : $('actions-title');
  // Focus must not scroll the page away from where the reader was.
  target.focus({ preventScroll: true });
}
$('open-review').onclick = openReview;
$('close-review').onclick = closeReview;
$('done').onclick = closeReview;
// showModal() makes the page inert, so Tab stays out of it. Escape and backdrop clicks return focus here.
$('review').addEventListener('cancel', (event) => {
  event.preventDefault();
  closeReview();
});
$('review').addEventListener('click', (event) => {
  const rect = $('review').getBoundingClientRect();
  if (
    event.target === $('review') &&
    (event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom)
  )
    closeReview();
});
async function horizon<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${HORIZON}${path}`, {
    ...options,
    signal: deadline(15000, 'Testnet did not answer in 15 seconds.'),
  });
  // A proxy can answer with an HTML error page. Only a JSON answer from Horizon carries a status meaning.
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error(
      response.ok
        ? 'Testnet returned an unreadable answer. Try again.'
        : `Testnet returned an error (HTTP ${response.status}). Try again later.`,
    );
  }
  if (!response.ok)
    throw new HorizonError(
      result?.detail || `Testnet returned an error (HTTP ${response.status}).`,
      response.status,
      result ?? {},
    );
  return result;
}
async function paymentRecipient() {
  progressLabel('Finding a testnet recipient…');
  const page = await horizon<Page<{ source_account: string }>>(
    '/operations?order=desc&limit=5&include_failed=false',
  );
  const addresses = new Set(page._embedded.records.map((operation) => operation.source_account));
  for (const address of addresses) {
    if (address === account?.address || !StrKey.isValidEd25519PublicKey(address)) continue;
    try {
      const candidate = await horizon<HorizonAccount>(`/accounts/${address}`);
      if (candidate.account_id === address) return address;
    } catch (errorValue) {
      const error = requestError(errorValue);
      if (error.status !== 404) throw error;
    }
  }
  throw Error('No recent testnet recipient is available. Try the payment again.');
}
// A new 1Password key has no testnet account. Friendbot creates and funds it.
async function sourceAccount() {
  progressLabel('Loading the testnet account…');
  try {
    return await horizon<HorizonAccount>(`/accounts/${account!.address}`);
  } catch (errorValue) {
    const error = requestError(errorValue);
    if (error.status !== 404) throw error;
    progressLabel('Funding the testnet account…');
    status('This testnet account does not exist yet. Funding it with Friendbot.');
    const response = await fetch(
      `https://friendbot.stellar.org/?addr=${encodeURIComponent(account!.address!)}`,
      { signal: deadline(30000, 'Friendbot did not answer in 30 seconds.') },
    );
    progressLabel('Checking the funded account…');
    // A funded account can still be missing from Horizon for a moment. Check it before failing.
    try {
      return await horizon<HorizonAccount>(`/accounts/${account!.address}`);
    } catch {
      throw Error(
        response.ok
          ? 'The funded account is not visible yet. Try again.'
          : 'Friendbot could not fund this testnet account. Try again later.',
      );
    }
  }
}
// The offer needs an authorized testnet USDC trustline with room for 1 USDC.
function usdcTrustline(source: HorizonAccount): 'none' | 'ready' | 'unauthorized' | 'full' {
  const trustline = (source.balances ?? []).find(
    (b) => 'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === ISSUER,
  );
  if (!trustline || !('asset_code' in trustline)) return 'none';
  if (trustline.is_authorized === false) return 'unauthorized';
  const room =
    Number(trustline.limit) - Number(trustline.balance) - Number(trustline.buying_liabilities || '0');
  return room >= 1 ? 'ready' : 'full';
}
const trustlineText = {
  none: 'It needs a USDC trustline. Add it first.',
  ready: 'The USDC trustline is ready.',
  unauthorized: 'The issuer has not authorized this USDC trustline. The offer cannot run.',
  full: 'The USDC trustline has no room for 1 more USDC. The offer cannot run.',
};
// Read the live account for the classic workspace. Contract transactions also spend fees from it.
async function refreshAccount() {
  const signer = account?.address;
  if (!signer) {
    testnetAccount = null;
    return render();
  }
  try {
    const source = await horizon<HorizonAccount>(`/accounts/${signer}`);
    if (account?.address === signer) testnetAccount = source;
  } catch (errorValue) {
    if (account?.address === signer)
      testnetAccount = requestError(errorValue).status === 404 ? 'missing' : null;
  }
  render();
}
// An unfinished contract journal fixes the set. Otherwise show the newer of the chosen and latest started set.
function walkthroughSet(signer: string, latest: number) {
  if (pending?.contract && !hasFinishedTransaction() && pending.address === signer)
    return contractSet(signer, pending.contract);
  return Math.max(chosenSet, latest, 1);
}
async function refreshWalkthrough() {
  const generation = ++ledgerGeneration,
    signer = account?.address;
  if (!signer) {
    ledger = null;
    ledgerReading = false;
    ledgerError = '';
    return render();
  }
  ledgerReading = true;
  render();
  try {
    const state = await readWalkthrough(demoRpc(), signer, (latest) => walkthroughSet(signer, latest));
    if (generation !== ledgerGeneration || account?.address !== signer) return;
    // The journal can change during the read, for example from another tab. Read again for its set.
    if (state.set !== walkthroughSet(signer, state.latest)) {
      void refreshWalkthrough();
      return;
    }
    const summary = (value: WalkthroughLedger | null) =>
      value && JSON.stringify({ ...value, count: undefined, done: walkthroughView(value).done });
    if (summary(state) !== summary(ledger)) {
      const done = walkthroughView(state).done;
      activity.record('walkthrough', `Walkthrough checked · Set ${state.set} · ${done} of 3 done`, {
        ...state,
        done,
      });
    }
    ledger = state;
    ledgerError = '';
    ledgerChecked = Date.now();
  } catch (errorValue) {
    if (generation !== ledgerGeneration || account?.address !== signer) return;
    const message = demoError(errorValue).message;
    // A failed request already has its own event. Record only a failure of the checks themselves.
    // The RPC client wraps a network failure in its own error, so match the message.
    const request =
      message === OFFLINE || requestError(errorValue).name === 'TypeError' || !(errorValue instanceof Error);
    if (message !== ledgerError && !request)
      activity.record('error', 'Walkthrough check failed', { message });
    ledgerError = message;
  } finally {
    if (generation === ledgerGeneration) {
      ledgerReading = false;
      render();
    }
  }
}
// An unreadable saved record blocks new transactions. Activity keeps its raw text, so a discard loses nothing.
let blockedRecord: string | null = null;
function blockJournal(errorValue: unknown) {
  journalBlocked = true;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE);
  } catch {
    /* The error below names the failure. */
  }
  if (raw !== null && raw === blockedRecord) return;
  blockedRecord = raw;
  activity.record('error', 'Saved transaction record unreadable', {
    ...(raw === null ? {} : { record: raw }),
    message: requestError(errorValue).message,
  });
}
function save() {
  if (pending) localStorage.setItem(STORAGE, JSON.stringify(pending));
  else localStorage.removeItem(STORAGE);
  activity.transaction(pending, pending ? actionTitle(pending.kind, pending.contract?.stage) : undefined);
}
function readJournal(): Journal | null {
  const raw = localStorage.getItem(STORAGE);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (
    !value ||
    Array.isArray(value) ||
    ![
      'review',
      'waiting',
      'signing_unknown',
      'signed',
      'submitting',
      'unknown',
      'submitted',
      'canceled',
      'denied',
      'expired',
      'failed',
    ].includes(value.state) ||
    !Object.hasOwn(actionNames, value.kind) ||
    typeof value.address !== 'string' ||
    !value.address ||
    typeof value.hash !== 'string' ||
    !value.hash ||
    typeof value.xdr !== 'string' ||
    !value.xdr
  )
    throw Error('The local demo journal is invalid.');
  if (value.state === 'review') describe(value.xdr); // A review must decode before the page shows it.
  if (value.kind === 'contract_setup' || value.kind === 'contract_counter') {
    validateContractReview(value.xdr, value.address, value.contract);
    if (value.hash !== contractHex(classicTransaction(value.xdr).hash()))
      throw Error('The saved contract hash is invalid.');
    if (value.signed_xdr !== undefined) verifySignedRecord(value);
  }
  return value;
}
function classicTransaction(
  text: string,
): Transaction & { timeBounds: NonNullable<Transaction['timeBounds']> } {
  const tx = TransactionBuilder.fromXDR(text, Networks.TESTNET);
  // Expiry checks and the signing deadline need an upper time bound.
  if ('innerTransaction' in tx || !tx.timeBounds || !Number(tx.timeBounds.maxTime))
    throw Error('Use a transaction with time bounds.');
  return tx as Transaction & { timeBounds: NonNullable<Transaction['timeBounds']> };
}
function verifySignedRecord(record: Journal) {
  if (typeof record.signed_xdr !== 'string') throw Error('The signed transaction is missing.');
  if (record.contract && !record.contract.authorizationReady)
    throw Error('The contract authorization is not complete.');
  const signed = classicTransaction(record.signed_xdr);
  const hash = Array.from(signed.hash(), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (
    hash !== record.hash ||
    signed.signatures.length !== 1 ||
    signed.source !== record.address ||
    !Keypair.fromPublicKey(record.address).verify(signed.hash(), signed.signatures[0].signature.toBytes())
  )
    throw Error('The signed transaction differs from the reviewed transaction.');
  if (record.contract) validateContractReview(record.signed_xdr, record.address, record.contract);
  return signed;
}
// Show every field that Sign approves.
function describe(text: string) {
  const tx = classicTransaction(text),
    [op] = tx.operations;
  const show = (value: unknown): unknown =>
    value instanceof Asset
      ? value.isNative()
        ? 'XLM'
        : `${value.getCode()}:${value.getIssuer()}`
      : value instanceof Uint8Array
        ? Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('')
        : value;
  return {
    source: tx.source,
    fee_stroops: tx.fee,
    sequence: tx.sequence,
    memo: tx.memo.value == null ? null : String(tx.memo.value),
    time_bounds: tx.timeBounds,
    operation: Object.fromEntries(Object.entries(op).map(([key, value]) => [key, show(value)])),
  };
}
function hasFinishedTransaction() {
  return !!pending && ['submitted', 'canceled', 'denied', 'expired', 'failed'].includes(pending.state);
}
function connectedTo(address: string) {
  return !!wallet?.address && account?.address === address;
}
// The walkthrough state for the connected wallet. An unfinished transaction marks its own step.
function currentWalkthrough() {
  const signer = wallet?.address ? account?.address : undefined;
  const state = signer && ledger?.signer === signer ? ledger : null;
  const unfinished =
    pending?.contract && !hasFinishedTransaction() && pending.address === signer ? pending.contract : null;
  const active =
    unfinished && state && contractSet(signer!, unfinished) === state.set ? unfinished.stage : undefined;
  return { state, view: walkthroughView(state, active) };
}
// After a finished walkthrough transaction: the step to offer next, from a ledger read of the same set.
function continueStage(): ContractStage | null {
  const record = pending?.contract;
  if (!pending || !record || !hasFinishedTransaction() || ledgerReading) return null;
  const { state, view } = currentWalkthrough();
  if (!state || state.signer !== pending.address || state.set !== contractSet(pending.address, record))
    return null;
  const result = (pending.result || {}) as ContractResult;
  if (pending.state === 'submitted' && !result.verification) return null;
  // A confirmed deployment that the ledger read does not show yet offers nothing.
  if (pending.state === 'submitted' && view.next === record.stage && record.stage !== 'increment')
    return null;
  return view.next;
}
// The fee of an unsigned contract call changes after its authorization is signed and simulated.
function feeText(record: Journal) {
  try {
    const fee = `${(Number(classicTransaction(record.xdr).fee) / 1e7).toFixed(7).replace(/\.?0+$/, '')} XLM`;
    return record.contract?.authorizations.length && !record.contract.authorizationReady
      ? `${fee} · estimate`
      : fee;
  } catch {
    return '';
  }
}
function summaryRows(record: Journal): [label: string, value: string, full?: string, note?: string][] {
  const review = record.contract;
  const rows: [string, string, string?, string?][] = [
    ['Network', 'Stellar testnet'],
    ['Wallet', short(record.address), record.address],
  ];
  if (record.recipient) rows.push(['Recipient', short(record.recipient), record.recipient]);
  if (record.kind === 'trustline')
    rows.push(
      ['USDC issuer', short(ISSUER), ISSUER, 'Circle testnet USDC'],
      ['Trust limit', `${USDC_LIMIT} USDC`],
    );
  if (review?.stage === 'upload-account') rows.push(['Contract code', 'Smart account program']);
  if (review?.stage === 'upload-target') rows.push(['Contract code', 'Counter program']);
  if (review && !review.stage.startsWith('upload'))
    rows.push([
      'Smart account',
      short(review.accountId),
      review.accountId,
      review.stage === 'deploy-account' ? 'created by this step' : undefined,
    ]);
  if (review?.stage === 'deploy-target' || review?.stage === 'increment')
    rows.push([
      'Counter',
      short(review.targetId),
      review.targetId,
      review.stage === 'deploy-target' ? 'created by this step' : undefined,
    ]);
  if (review?.before !== undefined) rows.push(['Counter value', `${review.before} → ${review.before + 1}`]);
  const fee = feeText(record);
  if (fee) rows.push(['Fee', fee]);
  return rows;
}
function confirmedText(record: Journal) {
  if (!record.contract || record.state !== 'submitted') return '';
  const result = (record.result || {}) as ContractResult;
  if (result.verification_error) return `The result is not verified: ${result.verification_error}`;
  if (!result.verification) return 'Checking the result…';
  const review = record.contract;
  return review.stage === 'increment'
    ? `Counter increased from ${review.before} to ${review.before! + 1}.`
    : `${verifiedTitles[review.stage]}.`;
}
function renderClassic() {
  const native =
    testnetAccount && testnetAccount !== 'missing'
      ? testnetAccount.balances?.find((b) => b.asset_type === 'native')
      : undefined;
  $('account-status').hidden = !testnetAccount;
  $('account-status').textContent =
    testnetAccount === 'missing'
      ? 'This account is not on testnet yet. The first action funds it through Friendbot.'
      : native
        ? `Testnet account funded · ${Number(native.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM`
        : '';
  // The offer card shows one next step: add the trustline, then place the offer.
  const usdc = usdcState();
  $('offer-requirement').textContent = usdc
    ? trustlineText[usdc]
    : 'It needs a USDC trustline with room for 1 USDC.';
  $('trustline').hidden = usdc !== 'none';
  $('offer').hidden = usdc === 'none';
  $('usdc-faucet').hidden = usdc !== 'ready';
}
// Unknown until the demo reads the account. A missing account has no trustline yet.
function usdcState() {
  if (testnetAccount === 'missing') return 'none';
  return testnetAccount ? usdcTrustline(testnetAccount) : null;
}
function renderWalkthrough() {
  const connected = !!account?.address && !!wallet?.address;
  const { state, view } = currentWalkthrough();
  const blocked =
    !connected ||
    busy ||
    ledgerReading ||
    connection.working ||
    connection.state === 'unreachable' ||
    journalBlocked ||
    (!!pending && !hasFinishedTransaction());
  $('walkthrough-progress-label').textContent = !connected
    ? 'Connect a wallet to see your progress.'
    : state
      ? `Set ${state.set} · ${view.done} of 3 done`
      : ledgerReading
        ? 'Checking the ledger…'
        : 'Progress unknown.';
  $('walkthrough-bar').setAttribute('data-done', String(view.done));
  $('walkthrough-checked').textContent = !connected
    ? ''
    : ledgerReading
      ? 'Checking…'
      : state && ledgerChecked
        ? `Checked ${new Date(ledgerChecked).toLocaleTimeString()}`
        : '';
  $('walkthrough-refresh').disabled = !connected || ledgerReading;
  $('walkthrough-error').hidden = !ledgerError;
  $('walkthrough-error').textContent =
    !ledgerError || ledgerError === OFFLINE
      ? ledgerError
      : `The demo could not read the ledger. ${/[.!?]$/.test(ledgerError) ? ledgerError : `${ledgerError}.`}`;
  // Each row: its state, its mark, a status, and at most one button. Only the next step's button is primary.
  const row = (
    id: string,
    rowState: RowState,
    mark: string,
    status: string,
    action?: string,
    mono = false,
  ) => {
    $(id).setAttribute('data-state', rowState);
    $(`${id}-mark`).textContent = rowState === 'done' ? '✓' : mark;
    $(`${id}-status`).textContent = rowState === 'active' ? 'In progress' : status;
    $(`${id}-status`).classList.toggle('mono', mono);
    const button = $(`${id}-action`) as HTMLButtonElement;
    button.hidden = !action;
    button.textContent = rowState === 'active' ? 'View transaction' : action || '';
    button.disabled = rowState !== 'active' && blocked;
    button.classList.toggle('primary', rowState === 'next');
  };
  const code = view.code;
  const upload = code.state === 'next' || code.state === 'active';
  $('walkthrough-code-detail').textContent =
    code.state === 'done'
      ? 'Both programs are on testnet. Every wallet uses the same code.'
      : code.stage === 'upload-account'
        ? 'The smart account code is not on testnet. Upload it once, and every wallet can use it.'
        : code.stage === 'upload-target'
          ? 'The counter code is not on testnet. Upload it once, and every wallet can use it.'
          : 'Both programs must be on testnet. Every wallet uses the same code.';
  // An upload shows its signature count where the finished row says when it applies.
  $('walkthrough-code-meta').textContent = upload ? '1 signature' : 'Before you start';
  row(
    'walkthrough-code',
    code.state,
    '',
    code.state === 'done' ? 'Ready' : '',
    upload && code.stage ? stepButtons[code.stage] : undefined,
  );
  const locked: Record<UserStage, string> = {
    'deploy-account': 'After the contract code',
    'deploy-target': 'After step 1',
    increment: 'After step 2',
  };
  view.steps.forEach((step, index) => {
    const id = `walkthrough-${step.stage}`;
    const address =
      step.stage === 'deploy-account'
        ? state?.account.id
        : step.stage === 'deploy-target'
          ? state?.target.id
          : undefined;
    const shown = step.state === 'done' && !!address;
    if (step.stage !== 'increment') $(`${id}-copy`).hidden = !shown;
    row(
      id,
      step.state,
      String(index + 1),
      step.state === 'locked'
        ? locked[step.stage]
        : shown
          ? short(address)
          : step.stage === 'increment' && state?.count !== undefined
            ? `Count: ${state.count}`
            : '',
      step.state === 'next' || step.state === 'active'
        ? stepButtons[step.stage]
        : step.stage === 'increment' && step.state === 'done'
          ? 'Increase again'
          : undefined,
      shown,
    );
  });
  const complete = !!state && state.account.exists && state.target.exists;
  const full = !!state && state.latest >= MAX_SETS;
  $('walkthrough-new-set').hidden = !complete || full;
  $('walkthrough-new-set').disabled = blocked;
  $('walkthrough-note').textContent = full
    ? `This wallet has used all ${MAX_SETS} contract sets.`
    : 'Contract addresses are fixed for each wallet and set. Start a new set to repeat the deploy steps.';
}
function renderPhases(progress: string) {
  const list = $('review-phases');
  if (!pending) {
    list.hidden = true;
    return list.replaceChildren();
  }
  const words = {
    done: 'Done.',
    current: 'Current step.',
    failed: 'Failed.',
    unknown: 'Result unknown.',
    pending: 'Not started.',
  };
  const phases = transactionPhases(pending, progress, confirmedText(pending));
  list.replaceChildren(
    ...phases.map((phase, index) => {
      const item = document.createElement('li'),
        mark = document.createElement('span'),
        text = document.createElement('div'),
        label = document.createElement('strong'),
        word = document.createElement('span');
      item.className = busy && phase.state === 'current' ? 'review-phase working' : 'review-phase';
      item.setAttribute('data-state', phase.state);
      if (phase.state === 'current') item.setAttribute('aria-current', 'step');
      mark.className = 'mark';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent =
        phase.state === 'done'
          ? '✓'
          : phase.state === 'failed'
            ? '×'
            : phase.state === 'unknown'
              ? '?'
              : String(index + 1);
      word.className = 'visually-hidden';
      word.textContent = words[phase.state];
      label.textContent = phase.label;
      text.append(label, word);
      if (phase.detail) {
        const detail = document.createElement('span');
        detail.textContent = phase.detail;
        text.append(detail);
      }
      item.append(mark, text);
      return item;
    }),
  );
  list.hidden = false;
}
function render() {
  connection.sync();
  connection.setBusy(busy && !signingController);
  $('connection-hint').hidden = !!account;
  const usdc = usdcState();
  for (const name of ['note', 'payment', 'trustline', 'offer', 'cancel-offer'] as const)
    $(name).disabled =
      !account ||
      !wallet?.address ||
      connection.state === 'unreachable' ||
      busy ||
      connection.working ||
      (!!pending && !hasFinishedTransaction()) ||
      journalBlocked ||
      (name === 'trustline' && usdc !== 'none') ||
      (name === 'offer' && usdc !== 'ready');
  $('record-error').hidden = !journalBlocked;
  $('discard-record').disabled = busy;
  renderClassic();
  renderWalkthrough();
  // A saved journal names the window. The selected action names it only during preparation without one.
  const kind = pending ? pending.kind : selectedAction;
  const stage = pending ? (pending.contract?.stage ?? null) : selectedStage;
  const title = kind ? actionTitle(kind, stage) : 'Your transaction';
  const set = pending?.contract ? contractSet(pending.address, pending.contract) : selectedSet;
  $('review-eyebrow').textContent = stage
    ? `Walkthrough · Set ${set} · ${stage.startsWith('upload') ? 'Before you start' : `Step ${['deploy-account', 'deploy-target', 'increment'].indexOf(stage) + 1} of 3`}`
    : 'Demo transaction';
  const state = pending
    ? stateNames[pending.state]
    : busy
      ? 'Preparing transaction'
      : 'No transaction created';
  const progressNames: Record<string, string> = {
    preparing: 'Preparing the transaction…',
    signing: signingController?.signal.aborted
      ? 'Canceling the signing request…'
      : 'Waiting for a signature…',
    submitting: 'Submitting the transaction…',
    checking: 'Checking the original transaction…',
    clearing: '',
  };
  let progress = busy
    ? actionPhase === 'signing' && signingController?.signal.aborted
      ? progressNames.signing
      : actionProgress || progressNames[actionPhase] || ''
    : '';
  let countdown = '';
  if (actionPhase === 'signing' && signingController && signingDeadline) {
    const seconds = Math.max(0, Math.ceil((signingDeadline - Date.now()) / 1000));
    countdown = seconds ? ` ${seconds}s remaining.` : ' Confirming cancellation…';
  }
  for (const [name, phase] of [
    ['sign', 'signing'],
    ['submit', 'submitting'],
    ['check', 'checking'],
  ] as const)
    $(name).setAttribute('aria-busy', String(busy && actionPhase === phase));
  // Announce state changes, without repeating the countdown each second.
  if ($('review-progress-state').textContent !== progress) $('review-progress-state').textContent = progress;
  $('review-countdown').textContent = countdown;
  $('review-progress').hidden = !progress;
  $('review-status').hidden = !!progress;
  renderPhases(['signing', 'submitting'].includes(actionPhase) ? progress + countdown : '');
  $('record-state').classList.toggle('demo-loading', !!progress);
  $('review-title').textContent = title;
  $('record-title').textContent = title;
  $('record-state').textContent = progress ? progress + countdown : state;
  $('transaction-record').hidden = !pending && !(busy && selectedAction);
  const needsStatusCheck = pending && ['submitting', 'unknown'].includes(pending.state);
  const unverified =
    pending?.contract &&
    pending.state === 'submitted' &&
    !((pending.result || {}) as ContractResult).verification;
  $('review-note').textContent = busy
    ? 'This action continues if you close this window.'
    : needsStatusCheck
      ? 'We could not confirm the result. Check before trying another transaction.'
      : hasFinishedTransaction()
        ? 'This result is in Activity. Close this window to choose another action.'
        : pending
          ? 'Closing this window keeps the transaction.'
          : 'Close this window to choose another action.';
  $('transaction-details').hidden = !pending;
  $('review-summary').replaceChildren();
  if (!pending) {
    for (const name of ['sign', 'submit', 'check', 'cancel-request', 'clear', 'continue', 'done'] as const)
      $(name).hidden = true;
    return;
  }
  for (const [label, value, full, note] of summaryRows(pending)) {
    const term = document.createElement('dt'),
      detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
    if (full) {
      detail.title = full;
      detail.className = 'mono';
    }
    if (note) {
      const extra = document.createElement('span');
      extra.className = 'summary-note';
      extra.textContent = ` · ${note}`;
      detail.append(extra);
    }
    $('review-summary').append(term, detail);
  }
  updateDetails(
    JSON.stringify(
      {
        action: pending.kind,
        state: pending.state,
        signer: pending.address,
        recipient: pending.recipient,
        hash: pending.hash,
        ...(['review', 'signed'].includes(pending.state) ? { transaction: describe(pending.xdr) } : {}),
        result: pending.result,
        ...(pending.contract ? { contract: pending.contract } : {}),
      },
      null,
      2,
    ),
  );
  $('submit').hidden = pending.state !== 'signed' && !(busy && actionPhase === 'submitting');
  $('submit').disabled = busy || connection.working || journalBlocked || !pending.signed_xdr;
  $('submit').textContent = busy && actionPhase === 'submitting' ? 'Submitting…' : 'Submit to testnet';
  $('check').hidden = !(needsStatusCheck || unverified) || (busy && actionPhase !== 'checking');
  $('check').disabled = busy || connection.working || journalBlocked;
  $('check').textContent =
    busy && actionPhase === 'checking'
      ? 'Checking…'
      : unverified
        ? 'Check result again'
        : 'Check transaction status';
  $('sign').hidden = pending.state !== 'review' && !(busy && actionPhase === 'signing');
  $('sign').disabled =
    busy ||
    connection.working ||
    connection.state === 'unreachable' ||
    journalBlocked ||
    !pending.xdr ||
    !connectedTo(pending.address);
  $('sign').textContent =
    busy && actionPhase === 'signing'
      ? 'Signing…'
      : pending.contract?.authorizations.length && !pending.contract.authorizationReady
        ? 'Sign authorization'
        : pending.contract
          ? 'Sign transaction'
          : 'Sign';
  $('cancel-request').hidden = pending.state !== 'waiting' || !signingController;
  $('cancel-request').disabled = !signingController || signingController.signal.aborted;
  $('cancel-request').textContent = signingController?.signal.aborted
    ? 'Canceling…'
    : 'Cancel signing request';
  $('clear').disabled = busy || connection.working || journalBlocked;
  $('clear').hidden =
    journalBlocked ||
    busy ||
    !(
      (['waiting', 'signing_unknown'].includes(pending.state) && !signingController) ||
      ['review', 'signed'].includes(pending.state)
    );
  $('clear').textContent =
    pending.state === 'review'
      ? 'Discard'
      : ['waiting', 'signing_unknown'].includes(pending.state)
        ? 'Clear stopped request'
        : 'Start another request';
  const next = busy ? null : continueStage();
  $('continue').hidden = !next;
  $('continue').disabled = busy || connection.working || journalBlocked || !connectedTo(pending.address);
  $('continue').textContent = !next
    ? 'Continue'
    : next === pending.contract?.stage
      ? pending.state === 'submitted'
        ? 'Increase again'
        : 'Try again'
      : `Continue: ${stepTitles[next]}`;
  $('done').hidden = !hasFinishedTransaction() || !!next || !!unverified || busy;
}
async function action(fn: () => Promise<void>, phase = 'preparing') {
  if (busy || journalBlocked || connection.working) return;
  busy = true;
  actionPhase = phase;
  actionProgress = '';
  try {
    render();
    if (!navigator.locks?.request)
      throw Error('This browser cannot coordinate transaction tabs. Use a browser with Web Locks.');
    await navigator.locks.request(STORAGE, async () => {
      let latest;
      try {
        latest = readJournal();
      } catch (errorValue) {
        blockJournal(errorValue);
        throw Error(BLOCKED);
      }
      if (JSON.stringify(latest) !== JSON.stringify(pending)) {
        pending = latest;
        void refreshWalkthrough();
        throw Error('Another tab changed the transaction. Review its latest record before continuing.');
      }
      await fn();
    });
  } catch (errorValue) {
    const error = demoError(errorValue);
    if ((errorValue as { walkthrough?: string })?.walkthrough === 'done') {
      // The ledger already has this step. Show the current walkthrough instead of a failure.
      selectedAction = null;
      closeReview();
      status(`${error.message} The walkthrough shows the current state.`);
      void refreshWalkthrough();
    } else {
      const detail = (errorValue as { detail?: unknown })?.detail;
      activity.record('error', 'Action failed', {
        action: pending
          ? actionTitle(pending.kind, pending.contract?.stage)
          : selectedAction && actionTitle(selectedAction, selectedStage),
        message: error.message,
        ...(typeof detail === 'string' ? { detail } : {}),
      });
      if (error.status === 401) account = null;
      status(error.message);
    }
  } finally {
    busy = false;
    actionPhase = '';
    actionProgress = '';
    render();
  }
}
async function build(kind: Action, stage: ContractStage | null, set: number) {
  if (!account || pending) return;
  const source = await sourceAccount();
  testnetAccount = source;
  if (kind === 'contract_setup' || kind === 'contract_counter') {
    if (!stage) throw Error('Choose a walkthrough step.');
    progressLabel('Checking the demo contracts and their code…');
    const prepared = await prepareContract(demoRpc(), account.address!, stage, set, async (file) => {
      const response = await fetch(`/fixtures/${file}`, {
        signal: deadline(15000, 'The demo server did not answer in 15 seconds.'),
      });
      if (!response.ok) throw Error('The demo contract file is unavailable.');
      return new Uint8Array(await response.arrayBuffer());
    });
    pending = {
      kind,
      address: account.address!,
      hash: contractHex(prepared.transaction.hash()),
      xdr: prepared.transaction.toXDR(),
      state: 'review',
      contract: prepared.review,
    };
    save();
    render();
    status(
      prepared.review.authorizationReady
        ? 'Review the transaction, then sign it.'
        : 'Review the authorization, then sign it. The transaction follows.',
    );
    return;
  }
  let operation;
  const id = crypto.randomUUID();
  let recipient;
  if (kind === 'note') operation = Operation.manageData({ name: 'walleterm-demo', value: id.slice(0, 16) });
  if (kind === 'payment') {
    recipient = await paymentRecipient();
    operation = Operation.payment({ destination: recipient, amount: '0.0100000', asset: Asset.native() });
  }
  // The card updates from the account read above. An action that cannot succeed stops before review.
  const usdc = usdcTrustline(source);
  if (kind === 'trustline') {
    if (usdc !== 'none')
      throw Error('This account already has a USDC trustline. The offer card shows its state.');
    operation = Operation.changeTrust({ asset: new Asset('USDC', ISSUER), limit: USDC_LIMIT });
  }
  if (kind === 'offer') {
    if (usdc !== 'ready')
      throw Error(
        usdc === 'none' ? 'This account has no USDC trustline. Add it first.' : trustlineText[usdc],
      );
    operation = Operation.manageSellOffer({
      selling: Asset.native(),
      buying: new Asset('USDC', ISSUER),
      amount: '0.1000000',
      price: '10',
      offerId: '0',
    });
  }
  // Cancel the newest open offer of this account, whatever created it.
  if (kind === 'cancel_offer') {
    progressLabel('Loading open offers…');
    const offer = (
      await horizon<Page<Horizon.ServerApi.OfferRecord>>(
        `/accounts/${account.address}/offers?order=desc&limit=1`,
      )
    )._embedded.records[0];
    if (!offer) throw Error('This account has no open offer.');
    const asset = (value: Horizon.ServerApi.OfferRecord['selling']) =>
      value.asset_type === 'native' ? Asset.native() : new Asset(value.asset_code!, value.asset_issuer!);
    operation = Operation.manageSellOffer({
      selling: asset(offer.selling),
      buying: asset(offer.buying),
      amount: '0',
      price: { n: offer.price_r.n, d: offer.price_r.d },
      offerId: String(offer.id),
    });
  }
  if (!operation || !account.address) throw Error('The transaction action is invalid.');
  const tx = new TransactionBuilder(new Account(account.address, source.sequence), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(operation)
    .setTimeout(180)
    .build();
  // The browser build can return Uint8Array rather than Buffer.
  const hash = Array.from(tx.hash(), (b) => b.toString(16).padStart(2, '0')).join('');
  pending = {
    kind,
    address: account.address,
    recipient: kind === 'payment' ? recipient : undefined,
    xdr: tx.toXDR(),
    hash,
    state: 'review',
  };
  try {
    save();
  } catch {
    pending = null;
    throw Error('The browser could not store this request. Enable site storage, then try again.');
  }
  render();
  status(
    kind === 'trustline'
      ? `Review the trustline. It lets this account hold up to ${USDC_LIMIT} testnet USDC. Select Sign to approve it, or Discard.`
      : 'Review this transaction. Select Sign to approve it, or Discard.',
  );
}
// Selecting Sign is the approval. The bridge signs every valid request from this connection.
$('sign').onclick = () =>
  action(async () => {
    if (pending?.state !== 'review') return;
    if (!connectedTo(pending.address))
      throw Error('Connect the wallet that built this transaction, then select Sign.');
    pending.state = 'waiting';
    save();
    render();
    status('Signing. Respond to 1Password on your Mac if it asks.');
    await requestSignature();
  }, 'signing');
// SEP-43 results carry a plain error object. Keep its code and request state for the journal.
function signingFailure(error: Sep43Error) {
  return Object.assign(Error(error.message), { sep43: error.code, requestState: error.requestState });
}
async function requestSignature() {
  if (!pending || !wallet) throw Error('Connect and prepare a transaction first.');
  const record = pending,
    client = wallet,
    controller = new AbortController();
  if (record.contract) validateContractReview(record.xdr, record.address, record.contract);
  signingController = controller;
  // The bridge ends each request at its expiry. The demo stops at the same time if the bridge cannot answer:
  // the transaction max_time, or the bridge expiry if earlier. The wall-clock check still holds after sleep.
  const timer = setInterval(() => {
    if (signingController !== controller) return;
    if (signingDeadline && Date.now() >= signingDeadline && !controller.signal.aborted)
      controller.abort(Object.assign(Error('The signing request expired.'), { name: 'TimeoutError' }));
    render();
  }, 1000);
  try {
    signingDeadline = Number(classicTransaction(record.xdr).timeBounds.maxTime) * 1000;
    render();
    const options = {
      signal: controller.signal,
      onProgress({ state, expiresAt }: { state: string; expiresAt?: string }) {
        if (pending !== record || signingController !== controller) return;
        const expires = Date.parse(expiresAt || '');
        if (Number.isFinite(expires)) signingDeadline = Math.min(signingDeadline, expires);
        actionProgress =
          state === 'retrying'
            ? 'The tunnel is unavailable. Retrying the same request…'
            : state === 'pending'
              ? 'Waiting for the signing request…'
              : state === 'approved'
                ? 'Checking the selected wallet…'
                : state === 'signing'
                  ? 'Waiting for 1Password on your Mac…'
                  : '';
        render();
      },
    };
    if (record.contract && !record.contract.authorizationReady) {
      for (const authorization of record.contract.authorizations) {
        if (authorization.signed) continue;
        // SEP-43 signs the address-bound preimage. The demo attaches its account's signature format.
        const signedXdr = await signDemoAuthorization(authorization, async (preimageXdr) => {
          const result = await client.signAuthEntry(preimageXdr, options);
          if (result.error) throw signingFailure(result.error);
          return result;
        });
        if (pending !== record || signingController !== controller)
          throw Error('The contract record changed during authorization signing.');
        authorization.xdr = signedXdr;
        authorization.signed = true;
        save();
      }
      actionProgress = 'Checking the signed authorization by simulation…';
      render();
      const assembled = await assembleAuthorizedContract(demoRpc(), record.xdr, record.contract);
      record.xdr = assembled.toXDR();
      record.hash = contractHex(assembled.hash());
      record.contract.authorizationReady = true;
      record.state = 'review';
      save();
      status(
        'Simulation accepted the signed authorization. Review the final fee, then sign the transaction.',
      );
      return;
    }
    const result = await client.signTransaction(record.xdr, options);
    if (result.error) throw signingFailure(result.error);
    if (pending !== record || signingController !== controller)
      throw Error('The transaction record changed during signing.');
    const signed = TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET);
    const hash = Array.from(signed.hash(), (b) => b.toString(16).padStart(2, '0')).join('');
    if (
      hash !== pending.hash ||
      signed.signatures.length !== 1 ||
      !Keypair.fromPublicKey(pending.address).verify(signed.hash(), signed.signatures[0].signature.toBytes())
    )
      throw Error('The signed transaction failed verification.');
    pending.signed_xdr = result.signedTxXdr;
    pending.state = 'signed';
    save();
    status('Signature verified. Review the transaction, then submit it when ready.');
  } catch (errorValue) {
    const error: RequestError & { sep43?: number } = requestError(errorValue);
    if (pending !== record || signingController !== controller) throw error;
    // The demo stops a request at its deadline or on Cancel. A confirmed stop means that nothing was signed.
    const stopped = controller.signal.aborted,
      expired = stopped && requestError(controller.signal.reason).name === 'TimeoutError';
    pending.state =
      error.requestState === 'unknown'
        ? 'signing_unknown'
        : stopped && error.sep43 === -4
          ? expired
            ? 'expired'
            : 'canceled'
          : error.requestState === 'denied' || error.requestState === 'expired'
            ? error.requestState
            : 'failed';
    save();
    if (stopped)
      error.message =
        error.requestState === 'unknown'
          ? `${expired ? 'The signing request expired' : 'The signing request was canceled'}. The result is unknown. If a 1Password prompt is still open, decline it.`
          : pending.state === 'expired'
            ? 'The signing request expired. Nothing was signed.'
            : error.message;
    throw error;
  } finally {
    clearInterval(timer);
    signingDeadline = 0;
    if (signingController === controller) signingController = null;
  }
}
function startAction(kind: Action, stage: ContractStage | null = null) {
  if (!account || (pending && !hasFinishedTransaction()) || busy || journalBlocked || connection.working)
    return;
  selectedAction = kind;
  selectedStage = stage;
  selectedSet = stage && ledger?.signer === account.address ? ledger.set : 1;
  activity.record('action', `Started: ${actionTitle(kind, stage)}`, stage ? { stage, set: selectedSet } : {});
  $('transaction-details').open = false;
  openReview();
  status('Preparing your transaction. Keep this window open to see its details.');
  return action(async () => {
    // Replace only a finished record, after the shared journal lock and stale-record check.
    if (hasFinishedTransaction()) {
      const previous = pending;
      pending = null;
      try {
        save();
      } catch (error) {
        pending = previous;
        throw error;
      }
      render();
    }
    await build(kind, stage, selectedSet);
  });
}
const startStep = (stage: ContractStage) =>
  startAction(stage === 'increment' ? 'contract_counter' : 'contract_setup', stage);
for (const kind of ['note', 'payment', 'trustline', 'offer'] as const)
  $(kind).onclick = () => startAction(kind);
$('cancel-offer').onclick = () => startAction('cancel_offer');
$('continue').onclick = () => {
  const next = continueStage();
  return next ? startStep(next) : undefined;
};
// A row with an unfinished transaction opens it. Otherwise the row starts its step.
$('walkthrough-code-action').onclick = () => {
  const code = currentWalkthrough().view.code;
  if (code.state === 'active') return openReview();
  return code.stage ? startStep(code.stage) : undefined;
};
for (const stage of ['deploy-account', 'deploy-target', 'increment'] as const)
  $(`walkthrough-${stage}-action`).onclick = () => {
    const step = currentWalkthrough().view.steps.find((row) => row.stage === stage);
    return step?.state === 'active' ? openReview() : startStep(stage);
  };
for (const [stage, kind] of [
  ['deploy-account', 'account'],
  ['deploy-target', 'target'],
] as const) {
  const button = $(`walkthrough-${stage}-copy`);
  button.onclick = async () => {
    const address = ledger?.[kind].id;
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      button.textContent = 'Copied';
      setTimeout(() => (button.textContent = 'Copy'), 1500);
    } catch {
      status('Copy failed. The full address is in Activity.');
    }
  };
}
$('walkthrough-refresh').onclick = () => refreshWalkthrough();
// A new set gives this wallet a new smart account and counter. Only a finished set offers it.
$('walkthrough-new-set').onclick = () => {
  if (!ledger || busy || ledgerReading || (pending && !hasFinishedTransaction()) || ledger.latest >= MAX_SETS)
    return;
  chosenSet = ledger.latest + 1;
  activity.record('action', `Started contract set ${chosenSet}`, { set: chosenSet });
  return refreshWalkthrough();
};
$('cancel-request').onclick = () => {
  signingController?.abort(Error('The signing request was canceled.'));
  render();
};
// Record the verified effect of a confirmed walkthrough transaction. A failure keeps the confirmed result.
async function verifyContract(record: Journal) {
  const review = record.contract!;
  try {
    const verification = await verifyContractResult(demoRpc(), record.address, review);
    const { verification_error: _failed, ...result } = (record.result || {}) as ContractResult;
    record.result = { ...result, verification };
    save();
    activity.record(
      'walkthrough',
      review.stage === 'increment'
        ? `Counter increased ${review.before} → ${review.before! + 1}`
        : verifiedTitles[review.stage],
      {
        action: stepTitles[review.stage],
        set: contractSet(record.address, review),
        hash: record.hash,
        ledger: result.ledger,
        verification,
      },
    );
    status(
      review.stage === 'increment'
        ? `Counter increased from ${review.before} to ${review.before! + 1}. Your smart account authorized the call.`
        : `${verifiedTitles[review.stage]}. Continue with the next step.`,
    );
  } catch (errorValue) {
    record.result = {
      ...((record.result || {}) as ContractResult),
      verification_error: requestError(errorValue).message,
    };
    save();
    throw errorValue;
  } finally {
    void refreshWalkthrough();
    void refreshAccount();
  }
}
async function confirmed(result: TransactionResult) {
  if (!pending) throw Error('The transaction record is missing.');
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    typeof result.hash !== 'string' ||
    result.hash !== pending.hash ||
    typeof result.successful !== 'boolean' ||
    !Number.isSafeInteger(result.ledger) ||
    result.ledger <= 0
  )
    throw Error('Horizon did not confirm the original transaction. Check its original hash.');
  pending.result = { hash: result.hash, ledger: result.ledger, successful: result.successful };
  pending.state = result.successful ? 'submitted' : 'failed';
  save();
  status(
    !result.successful
      ? 'The original transaction failed on testnet.'
      : pending.kind === 'trustline'
        ? 'The USDC trustline is on testnet. You can place the offer now.'
        : 'The original transaction succeeded on testnet.',
  );
  if (result.successful && pending.kind === 'offer') {
    try {
      if (typeof result.result_xdr !== 'string' || !result.result_xdr)
        throw Error('The offer result is missing.');
      const decoded = xdr.TransactionResult.fromXDR(result.result_xdr, 'base64');
      const operation = decoded.result.type === 'txSuccess' ? decoded.result.results[0] : undefined;
      const inner = operation?.type === 'opInner' ? operation.tr : undefined;
      const offerResult = inner?.type === 'manageSellOffer' ? inner.manageSellOfferResult : undefined;
      const offer = offerResult?.type === 'manageSellOfferSuccess' ? offerResult.success.offer : undefined;
      if (offer?.type !== 'manageOfferCreated')
        notice('The offer transaction succeeded without a resting offer. It can have traded immediately.');
    } catch {
      notice('The original transaction succeeded on testnet. Offer details are unavailable.');
    }
  }
  if (result.successful && pending.contract) await verifyContract(pending);
  else void refreshAccount();
}
$('submit').onclick = () =>
  action(async () => {
    if (pending?.state !== 'signed') return;
    const tx = verifySignedRecord(pending);
    if (Number(tx.timeBounds.maxTime) * 1000 <= Date.now()) {
      pending.state = 'expired';
      save();
      status('The signed transaction expired before submission. Create a new request.');
      return;
    }
    pending.state = 'submitting';
    save();
    render();
    status('Waiting for the testnet submission result.');
    try {
      if (pending.contract) {
        const server = demoRpc();
        const sent = await server.sendTransaction(tx);
        if (sent.status === 'ERROR' && sent.errorResult && sent.errorResult.result.type !== 'txBadSeq') {
          pending.state = 'failed';
          pending.result = {
            rejected: true,
            response: sent.status,
            code: sent.errorResult.result.type,
            result_xdr: sent.errorResult?.toXdr('base64'),
            hash: pending.hash,
          };
          save();
          status(`Testnet rejected the transaction: ${sent.errorResult?.result.type || sent.status}.`);
          return;
        }
        for (let attempt = 0; attempt < 10; attempt++) {
          const result = await server.getTransaction(pending.hash);
          if (result.status === 'SUCCESS' || result.status === 'FAILED') {
            await confirmed({
              hash: pending.hash,
              ledger: result.ledger,
              successful: result.status === 'SUCCESS',
              result_xdr: result.resultXdr.toXdr('base64'),
            });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw Error('The RPC has not confirmed the original transaction yet.');
      }
      const result = await horizon<TransactionResult>('/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tx: pending.signed_xdr! }),
      });
      await confirmed(result);
    } catch (errorValue) {
      const error = requestError(errorValue);
      if (hasFinishedTransaction()) throw error;
      const result = 'result' in error ? (error.result as HorizonFailure) : undefined;
      const code = result?.extras?.result_codes?.transaction;
      if (
        error.status === 400 &&
        typeof code === 'string' &&
        code !== 'tx_bad_seq' &&
        result?.extras?.result_xdr
      ) {
        pending.state = 'failed';
        pending.result = { rejected: true, code };
        save();
        status(`Testnet rejected the transaction: ${code}.`);
      } else {
        pending.state = 'unknown';
        save();
        notice(
          'Testnet did not confirm the submission. Select Check transaction status. Do not sign a replacement.',
          { hash: pending.hash, message: error.message },
        );
      }
    }
  }, 'submitting');
$('check').onclick = () =>
  action(async () => {
    // A confirmed walkthrough transaction whose effect could not be read: read it again. Nothing is sent.
    if (
      pending?.contract &&
      pending.state === 'submitted' &&
      !((pending.result || {}) as ContractResult).verification
    ) {
      status('Checking the confirmed result on the ledger.');
      return verifyContract(pending);
    }
    if (!pending || !['submitting', 'unknown'].includes(pending.state)) return;
    status('Reading the ledger and checking the original transaction hash.');
    // Read the latest ledger first. Horizon ingests ledgers in order, so a later 404 covers that ledger.
    const latest = (await horizon<Page<{ closed_at: string }>>('/ledgers?order=desc&limit=1'))._embedded
      .records[0];
    try {
      await confirmed(await horizon<TransactionResult>(`/transactions/${pending.hash}`));
    } catch (errorValue) {
      const error = requestError(errorValue);
      if (error.status !== 404) throw error;
      // The transaction can never apply when a ledger closed after its time bound, the hash is absent,
      // and the account sequence has not reached the transaction sequence.
      const tx = classicTransaction(pending.xdr);
      const source = await horizon<HorizonAccount>(`/accounts/${pending.address}`);
      if (
        Date.parse(latest.closed_at) / 1000 > Number(tx.timeBounds.maxTime) &&
        BigInt(source.sequence) < BigInt(tx.sequence)
      ) {
        if (
          pending.contract &&
          authorizationExpiry(pending.contract) >= (await demoRpc().getLatestLedger()).sequence
        ) {
          notice(
            `The original transaction expired. Its contract authorization remains valid through ledger ${authorizationExpiry(pending.contract)}. Check again later.`,
          );
          return;
        }
        pending.state = 'expired';
        save();
        status('The transaction expired without reaching the ledger. It can never apply.');
      } else
        notice(
          'The original hash is not found yet. This does not prove failure. Do not submit a replacement.',
        );
    }
  }, 'checking');
$('clear').onclick = () =>
  action(async () => {
    if (
      !pending ||
      ['submitting', 'unknown'].includes(pending.state) ||
      (['waiting', 'signing_unknown'].includes(pending.state) && signingController)
    )
      return;
    if (
      pending.contract &&
      ['waiting', 'signing_unknown'].includes(pending.state) &&
      authorizationExpiry(pending.contract) >= (await demoRpc().getLatestLedger()).sequence
    ) {
      notice(
        `Wait until after ledger ${authorizationExpiry(pending.contract)} before clearing this unknown authorization result.`,
      );
      return;
    }
    const cleared = pending;
    pending = null;
    save();
    activity.record(
      'transaction',
      `${actionTitle(cleared.kind, cleared.contract?.stage)} · ${
        cleared.state === 'review'
          ? 'Transaction discarded'
          : cleared.state === 'signed'
            ? 'Signed transaction cleared'
            : 'Stopped request cleared'
      }`,
      { hash: cleared.hash, state: cleared.state },
    );
    selectedAction = null;
    closeReview();
    selectedStage = null;
    status(
      cleared.state === 'review'
        ? 'The transaction was discarded. Choose another action.'
        : cleared.state === 'signed'
          ? 'The signed transaction was cleared without submission. Choose another action.'
          : 'The stopped request was cleared. If a 1Password prompt is still open, decline it.',
    );
  }, 'clearing');
// Discard an unreadable saved record. Its raw text stays in Activity.
$('discard-record').onclick = async () => {
  if (!journalBlocked || busy) return;
  busy = true;
  render();
  try {
    if (!navigator.locks?.request)
      throw Error('This browser cannot coordinate transaction tabs. Use a browser with Web Locks.');
    await navigator.locks.request(STORAGE, () => {
      const raw = localStorage.getItem(STORAGE);
      // Another tab can replace the record first. Keep a readable record.
      try {
        pending = readJournal();
        journalBlocked = false;
        blockedRecord = null;
        activity.transaction(
          pending,
          pending ? actionTitle(pending.kind, pending.contract?.stage) : undefined,
        );
        void refreshWalkthrough();
        status(
          pending
            ? 'Another tab replaced the saved record. Review it before you continue.'
            : 'Another tab removed the saved record. Choose an action.',
        );
        return;
      } catch {
        /* Still unreadable. Discard it. */
      }
      pending = null;
      try {
        save();
      } catch {
        throw Error('The browser could not change the saved record. Check site storage, then try again.');
      }
      activity.record(
        'transaction',
        'Unreadable saved record discarded',
        raw === blockedRecord ? {} : { record: raw },
      );
      journalBlocked = false;
      blockedRecord = null;
      status('The saved record was discarded. Activity keeps its copy. Choose an action.');
    });
  } catch (errorValue) {
    status(requestError(errorValue).message);
  } finally {
    busy = false;
    render();
  }
};
try {
  pending = readJournal();
  activity.transaction(pending, pending ? actionTitle(pending.kind, pending.contract?.stage) : undefined);
  if (pending && ['waiting', 'signing_unknown'].includes(pending.state))
    notice(
      'A signing request was open when the page closed. If a 1Password prompt is still open, decline it. Then clear this record.',
    );
} catch (errorValue) {
  blockJournal(errorValue);
  status(BLOCKED);
}
render();
if (pending && !hasFinishedTransaction()) {
  $('review-status').textContent = $('status').textContent;
  openReview();
}
