import { requestError } from '../../sdk/errors.ts';
import { createCodeView, highlightConnectionCommand } from './code-view.js';
import { WalletermConnect } from '../../sdk/connect.ts';
import { createActivityLog } from './activity.ts';
import {
  assembleAuthorizedContract,
  authorizationExpiry,
  demoRpc,
  hex as contractHex,
  prepareContract,
  validateContractReview,
  verifyContractResult,
} from './contracts.ts';
import type { ContractReview } from './contracts.ts';
import type { Horizon, Transaction } from '@stellar/stellar-sdk';
import type { Account as WalletAccount } from '../../sdk/types.ts';
import type { WalletermClient } from '../../sdk/walleterm.ts';

declare global {
  var StellarSdk: typeof import('@stellar/stellar-sdk');
}
type Action = 'note' | 'payment' | 'offer' | 'cancel_offer' | 'contract_setup' | 'contract_counter';
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
interface Elements {
  review: HTMLDialogElement;
  'transaction-details': HTMLDetailsElement;
  note: HTMLButtonElement;
  payment: HTMLButtonElement;
  offer: HTMLButtonElement;
  'cancel-offer': HTMLButtonElement;
  'contract-setup': HTMLButtonElement;
  'contract-counter': HTMLButtonElement;
  sign: HTMLButtonElement;
  submit: HTMLButtonElement;
  check: HTMLButtonElement;
  clear: HTMLButtonElement;
  'cancel-request': HTMLButtonElement;
}
function $<K extends string>(id: K): K extends keyof Elements ? Elements[K] : HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw Error(`Missing demo element: ${id}`);
  return element as K extends keyof Elements ? Elements[K] : HTMLElement;
}
const updateDetails = createCodeView($('details'), { label: 'JSON', disclosure: $('transaction-details') });
const { Account, Asset, Keypair, Networks, Operation, StrKey, TransactionBuilder, xdr } =
  globalThis.StellarSdk;
const HORIZON = 'https://horizon-testnet.stellar.org';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const STORAGE = 'walleterm-demo-request-v1';
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
if (globalThis.fetch)
  globalThis.fetch = Object.assign(activity.wrapFetch(globalThis.fetch.bind(globalThis)), globalThis.fetch);
let wallet: WalletermClient | null = null;
let account: WalletAccount | null = null;
let pending: Journal | null = null;
let signingController: AbortController | null = null;
let signingDeadline = 0;
let selectedAction: Action | null = null;
let busy = false,
  journalBlocked = false,
  actionPhase = '',
  actionProgress = '';
const connection = new WalletermConnect($('wallet-connection'), {
  sessionStorageKey: 'walleterm-demo-connection-v1',
  onBusyChange: () => render(),
  onStateChange: () => render(),
  onChange(value) {
    const previousAddress = account?.address;
    wallet = value.client;
    account = value.account;
    activity.record(
      'walleterm',
      account
        ? previousAddress && previousAddress !== account.address
          ? 'Active wallet changed'
          : 'Wallet connected'
        : 'Wallet disconnected',
      { previous_address: previousAddress, account },
    );
    status(account ? 'Wallet connected. Choose a testnet action.' : 'The website is disconnected.');
    render();
  },
});
highlightConnectionCommand($('wallet-connection'));
function progressLabel(text: string) {
  actionProgress = text;
  render();
}
function status(text: string) {
  activity.record('status', text);
  $('status').textContent = text;
  if ($('review').open || busy) $('review-status').textContent = text;
}
const actionNames = {
  note: 'Write a note',
  payment: 'Pay 0.01 test XLM',
  offer: 'Offer 0.1 test XLM',
  cancel_offer: 'Cancel newest offer',
  contract_setup: 'Set up contract demo',
  contract_counter: 'Increment contract counter',
};
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
function openReview() {
  if (!$('review').open) $('review').showModal();
}
function closeReview() {
  $('review').close();
  (pending || (busy && selectedAction) ? $('open-review') : $('actions-title')).focus();
}
$('open-review').onclick = openReview;
$('close-review').onclick = closeReview;
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
$('review').addEventListener('keydown', (event) => {
  if (event.key !== 'Tab') return;
  const controls = [
    ...$('review').querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]'),
  ].filter((node) => node.getClientRects().length);
  const first = controls[0],
    last = controls.at(-1);
  if (
    (event.shiftKey && document.activeElement === first) ||
    (!event.shiftKey && document.activeElement === last)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
});
async function horizon<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${HORIZON}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok)
    throw new HorizonError(result.detail || `Horizon returned ${response.status}.`, response.status, result);
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
      { signal: AbortSignal.timeout(30000) },
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
function save() {
  if (pending) localStorage.setItem(STORAGE, JSON.stringify(pending));
  else localStorage.removeItem(STORAGE);
  activity.transaction(pending);
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
    !['note', 'payment', 'offer', 'cancel_offer', 'contract_setup', 'contract_counter'].includes(
      value.kind,
    ) ||
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
  if ('innerTransaction' in tx || !tx.timeBounds) throw Error('Use a transaction with time bounds.');
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
  return !!wallet?.token && account?.address === address;
}
function render() {
  connection.sync();
  connection.setBusy(busy && !signingController);
  $('connection-hint').hidden = !!account;
  for (const name of [
    'note',
    'payment',
    'offer',
    'cancel-offer',
    'contract-setup',
    'contract-counter',
  ] as const)
    $(name).disabled =
      !account ||
      !wallet?.token ||
      connection.state === 'unreachable' ||
      busy ||
      connection.working ||
      (!!pending && !hasFinishedTransaction()) ||
      journalBlocked;
  const kind = pending?.kind || selectedAction;
  const title = kind ? actionNames[kind] : 'Your transaction';
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
  $('record-state').classList.toggle('demo-loading', !!progress);
  $('review-title').textContent = title;
  $('record-title').textContent = title;
  $('record-state').textContent = progress ? progress + countdown : state;
  $('transaction-record').hidden = !pending && !(busy && selectedAction);
  const needsStatusCheck = pending && ['submitting', 'unknown'].includes(pending.state);
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
    for (const name of ['sign', 'submit', 'check', 'cancel-request', 'clear'] as const) $(name).hidden = true;
    return;
  }
  for (const [label, value] of [
    ['Status', state],
    ['Network', 'Stellar testnet'],
    ['Wallet', pending.address],
    ...(pending.recipient ? [['Recipient', pending.recipient]] : []),
    ...(pending.contract
      ? [
          ['Smart account', pending.contract.accountId],
          ['Contract', pending.contract.targetId],
          ['Action', pending.contract.stage],
          ...(pending.contract.before === undefined
            ? []
            : [['Counter', `${pending.contract.before} → ${pending.contract.before + 1}`]]),
          ['Next signature', pending.contract.authorizationReady ? 'Transaction' : 'Contract authorization'],
        ]
      : []),
  ]) {
    const term = document.createElement('dt'),
      detail = document.createElement('dd');
    term.textContent = label;
    detail.textContent = value;
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
  $('check').hidden = !needsStatusCheck || (busy && actionPhase !== 'checking');
  $('check').disabled = busy || connection.working || journalBlocked;
  $('check').textContent = busy && actionPhase === 'checking' ? 'Checking…' : 'Check transaction status';
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
      : pending.contract
        ? pending.contract.authorizationReady
          ? 'Sign transaction'
          : 'Sign contract authorization'
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
      } catch {
        journalBlocked = true;
        throw Error('The local demo journal could not be read. Preserve it before continuing.');
      }
      if (JSON.stringify(latest) !== JSON.stringify(pending)) {
        pending = latest;
        throw Error('Another tab changed the transaction. Review its latest record before continuing.');
      }
      await fn();
    });
  } catch (errorValue) {
    const error = requestError(errorValue);
    activity.record('error', 'Action failed', {
      action: pending?.kind || selectedAction,
      message: error.message,
    });
    if (error.status === 401) account = null;
    status(error.message);
  } finally {
    busy = false;
    actionPhase = '';
    actionProgress = '';
    render();
  }
}
async function build(kind: Action) {
  if (!account || pending) return;
  const source = await sourceAccount();
  if (kind === 'contract_setup' || kind === 'contract_counter') {
    progressLabel('Checking the demo contracts and their code…');
    const prepared = await prepareContract(
      demoRpc(),
      account.address!,
      kind === 'contract_counter',
      async (file) => {
        const response = await fetch(`/fixtures/${file}`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error('The demo contract file is unavailable.');
        return new Uint8Array(await response.arrayBuffer());
      },
    );
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
        ? 'Review the setup transaction before signing it.'
        : 'Review the exact contract authorization before signing it.',
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
  if (kind === 'offer') {
    const trustline = source.balances.find(
      (b) => 'asset_code' in b && b.asset_code === 'USDC' && b.asset_issuer === ISSUER,
    );
    if (
      !trustline ||
      !('asset_code' in trustline) ||
      trustline.is_authorized === false ||
      Number(trustline.limit) - Number(trustline.balance) - Number(trustline.buying_liabilities || '0') < 1
    )
      throw Error('This account needs an authorized testnet USDC trustline with free capacity.');
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
  status('Review this transaction. Select Sign to approve it, or Discard.');
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
async function requestSignature() {
  if (!pending || !wallet) throw Error('Connect and prepare a transaction first.');
  const record = pending,
    client = wallet,
    controller = new AbortController();
  if (record.contract) validateContractReview(record.xdr, record.address, record.contract);
  signingController = controller;
  const timer = setInterval(() => {
    if (signingController !== controller) return;
    if (signingDeadline && Date.now() >= signingDeadline && !controller.signal.aborted)
      controller.abort(Error('The signing request timed out.'));
    render();
  }, 1000);
  try {
    signingDeadline = Math.min(
      Date.now() + 300000,
      Number(classicTransaction(record.xdr).timeBounds.maxTime) * 1000,
    );
    render();
    const options = {
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(Math.max(1, signingDeadline - Date.now())),
      ]),
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
        const result = await client.signAuthEntry(authorization.xdr, {
          ...options,
          address: authorization.address,
          adapter: { type: authorization.adapter },
        });
        if (pending !== record || signingController !== controller)
          throw Error('The contract record changed during authorization signing.');
        authorization.xdr = result.signedAuthEntryXdr;
        authorization.signed = true;
        save();
        activity.record('authorization', 'Contract authorization signed', {
          authorizer: authorization.address,
          signer: record.address,
          signed_auth_entry_xdr: result.signedAuthEntryXdr,
        });
      }
      actionProgress = 'Checking the signed contract authorization…';
      render();
      const assembled = await assembleAuthorizedContract(demoRpc(), record.xdr, record.contract);
      record.xdr = assembled.toXDR();
      record.hash = contractHex(assembled.hash());
      record.contract.authorizationReady = true;
      record.state = 'review';
      save();
      status(
        'Contract authorization verified by simulation. Review the final fee, then sign the transaction.',
      );
      return;
    }
    const result = await client.signTransaction(record.xdr, options);
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
    const error = requestError(errorValue);
    if (pending !== record || signingController !== controller) throw error;
    pending.state =
      error.canceled === false || error.requestState === 'unknown'
        ? 'signing_unknown'
        : controller.signal.aborted || error.canceled === true
          ? 'canceled'
          : error.requestState === 'denied' || error.requestState === 'expired'
            ? error.requestState
            : 'failed';
    save();
    if (error.canceled === false)
      error.message +=
        ' The bridge did not confirm the cancellation. Decline the 1Password prompt if it appears.';
    throw error;
  } finally {
    clearInterval(timer);
    signingDeadline = 0;
    if (signingController === controller) signingController = null;
  }
}
function startAction(kind: Action) {
  if (!account || (pending && !hasFinishedTransaction()) || busy || journalBlocked || connection.working)
    return;
  selectedAction = kind;
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
    await build(kind);
  });
}
for (const kind of ['note', 'payment', 'offer'] as const) $(kind).onclick = () => startAction(kind);
$('cancel-offer').onclick = () => startAction('cancel_offer');
$('contract-setup').onclick = () => startAction('contract_setup');
$('contract-counter').onclick = () => startAction('contract_counter');
$('cancel-request').onclick = () => {
  signingController?.abort(Error('The signing request was canceled.'));
  render();
};
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
    result.successful
      ? 'The original transaction succeeded on testnet.'
      : 'The original transaction failed on testnet.',
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
        status('The offer transaction succeeded without a resting offer. It can have traded immediately.');
    } catch {
      status('The original transaction succeeded on testnet. Offer details are unavailable.');
    }
  }
  if (result.successful && pending.contract) {
    const verification = await verifyContractResult(demoRpc(), pending.address, pending.contract);
    pending.result = { ...(pending.result as Record<string, unknown>), verification };
    save();
    status(
      pending.contract.stage === 'increment'
        ? `Contract authorization verified. Counter changed from ${pending.contract.before} to ${pending.contract.before! + 1}.`
        : 'Setup step confirmed. Select Set up contract demo to continue, or Increment counter when ready.',
    );
  }
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
        status(`Submission is uncertain. Check the original hash. ${error.message}`);
      }
    }
  }, 'submitting');
$('check').onclick = () =>
  action(async () => {
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
          status(
            `The original transaction expired. Its contract authorization remains valid through ledger ${authorizationExpiry(pending.contract)}. Check again later.`,
          );
          return;
        }
        pending.state = 'expired';
        save();
        status('The transaction expired without reaching the ledger. It can never apply.');
      } else
        status(
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
      status(
        `Wait until after ledger ${authorizationExpiry(pending.contract)} before clearing this unknown authorization result.`,
      );
      return;
    }
    pending = null;
    save();
    selectedAction = null;
    closeReview();
  }, 'clearing');
try {
  pending = readJournal();
  activity.transaction(pending);
  if (pending && ['waiting', 'signing_unknown'].includes(pending.state))
    status(
      'A signing request was open when the page closed. Decline the 1Password prompt if it appears, then clear this record.',
    );
} catch {
  journalBlocked = true;
  status('The local demo journal could not be read. Preserve it before continuing.');
}
render();
if (pending && !hasFinishedTransaction()) {
  $('review-status').textContent = $('status').textContent;
  openReview();
}
