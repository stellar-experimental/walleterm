import { createCodeView, highlightConnectionCommand } from '/code-view.js';
import { WalletermConnect } from '/sdk/connect.js';
import { createActivityLog } from '/activity.js';
const $ = id => document.getElementById(id);
const updateDetails = createCodeView($('details'), { label: 'JSON', disclosure: $('transaction-details') });
const { Account, Asset, Keypair, Networks, Operation, StrKey, TransactionBuilder, xdr } = globalThis.StellarSdk;
const HORIZON = 'https://horizon-testnet.stellar.org';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const STORAGE = 'walleterm-demo-request-v1';
const activity = createActivityLog($('activity'), { decodeSigned(signedXdr) {
  const transaction = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
  const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return { hash: hex(transaction.hash()), signatures: transaction.signatures.map(signature => hex(signature.signature.toBytes())) };
} });
if (globalThis.fetch) globalThis.fetch = activity.wrapFetch(globalThis.fetch.bind(globalThis));
let wallet, account, pending, busy = false, signingController, journalBlocked = false, selectedAction, actionPhase = '', actionProgress = '';
const connection = new WalletermConnect($('wallet-connection'), { onBusyChange: () => render(), onChange(value) {
  const previousAddress = account?.address;
  wallet = value.client; account = value.account;
  activity.record('walleterm', account ? previousAddress && previousAddress !== account.address ? 'Active wallet changed' : 'Wallet connected' : 'Wallet disconnected', { previous_address: previousAddress, account });
  status(account ? 'Wallet connected. Choose a testnet action.' : 'The website is disconnected.');
  render();
} });
highlightConnectionCommand($('wallet-connection'));
function progressLabel(text) { actionProgress = text; render(); }
function status(text) {
  activity.record('status', text);
  $('status').textContent = text;
  if ($('review').open || busy) $('review-status').textContent = text;
}
const actionNames = { note: 'Write a note', payment: 'Pay 0.01 test XLM', offer: 'Offer 0.1 test XLM', cancel_offer: 'Cancel newest offer' };
const stateNames = { review: 'Ready to sign', waiting: 'Waiting for a signature', signing_unknown: 'Signing result unknown', signed: 'Ready to submit',
  submitting: 'Submitting to testnet', unknown: 'Submission result unknown', submitted: 'Transaction complete', canceled: 'Signing canceled',
  denied: 'Signature declined', expired: 'Transaction expired', failed: 'Transaction failed' };
function openReview() {
  if (!$('review').open) $('review').showModal();
}
function closeReview() {
  $('review').close();
  (pending || busy && selectedAction ? $('open-review') : $('actions-title')).focus();
}
$('open-review').onclick = openReview;
$('close-review').onclick = closeReview;
$('review').addEventListener('cancel', event => { event.preventDefault(); closeReview(); });
$('review').addEventListener('click', event => {
  const rect = $('review').getBoundingClientRect();
  if (event.target === $('review') && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeReview();
});
$('review').addEventListener('keydown', event => {
  if (event.key !== 'Tab') return;
  const controls = [...$('review').querySelectorAll('button:not(:disabled), summary, [tabindex="0"]')].filter(node => node.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
    event.preventDefault(); (event.shiftKey ? last : first)?.focus();
  }
});
async function horizon(path, options = {}) {
  const response = await fetch(`${HORIZON}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.detail || `Horizon returned ${response.status}.`), { status: response.status, result });
  return result;
}
async function paymentRecipient() {
  progressLabel('Finding a testnet recipient…');
  const page = await horizon('/operations?order=desc&limit=5&include_failed=false');
  const addresses = new Set(page._embedded.records.map(operation => operation.source_account));
  for (const address of addresses) {
    if (address === account.address || !StrKey.isValidEd25519PublicKey(address)) continue;
    try {
      const candidate = await horizon(`/accounts/${address}`);
      if (candidate.account_id === address) return address;
    } catch (error) { if (error.status !== 404) throw error; }
  }
  throw Error('No recent testnet recipient is available. Try the payment again.');
}
// A new 1Password key has no testnet account. Friendbot creates and funds it.
async function sourceAccount() {
  progressLabel('Loading the testnet account…');
  try { return await horizon(`/accounts/${account.address}`); }
  catch (error) {
    if (error.status !== 404) throw error;
    progressLabel('Funding the testnet account…');
    status('This testnet account does not exist yet. Funding it with Friendbot.');
    const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(account.address)}`, { signal: AbortSignal.timeout(30000) });
    progressLabel('Checking the funded account…');
    // A funded account can still be missing from Horizon for a moment. Check it before failing.
    try { return await horizon(`/accounts/${account.address}`); }
    catch { throw Error(response.ok ? 'The funded account is not visible yet. Try again.' : 'Friendbot could not fund this testnet account. Try again later.'); }
  }
}
function save() {
  if (pending) localStorage.setItem(STORAGE, JSON.stringify(pending)); else localStorage.removeItem(STORAGE);
  activity.transaction(pending);
}
function readJournal() {
  const raw = localStorage.getItem(STORAGE);
  if (raw === null) return null;
  const value = JSON.parse(raw);
  if (!value || Array.isArray(value) || !['review', 'waiting', 'signing_unknown', 'signed', 'submitting', 'unknown', 'submitted', 'canceled', 'denied', 'expired', 'failed'].includes(value.state)
    || !['note', 'payment', 'offer', 'cancel_offer'].includes(value.kind) || typeof value.address !== 'string' || !value.address
    || typeof value.hash !== 'string' || !value.hash || typeof value.xdr !== 'string' || !value.xdr) throw Error('The local demo journal is invalid.');
  if (value.state === 'review') describe(value.xdr); // A review must decode before the page shows it.
  return value;
}
// Show every field that Sign approves.
function describe(text) {
  const tx = TransactionBuilder.fromXDR(text, Networks.TESTNET), [op] = tx.operations;
  const show = value => value?.getCode ? (value.isNative() ? 'XLM' : `${value.getCode()}:${value.getIssuer()}`)
    : value instanceof Uint8Array ? Array.from(value, b => b.toString(16).padStart(2, '0')).join('') : value;
  return { source: tx.source, fee_stroops: tx.fee, sequence: tx.sequence, memo: tx.memo.value == null ? null : String(tx.memo.value),
    time_bounds: tx.timeBounds, operation: Object.fromEntries(Object.entries(op).map(([key, value]) => [key, show(value)])) };
}
function hasFinishedTransaction() { return !!pending && ['submitted', 'canceled', 'denied', 'expired', 'failed'].includes(pending.state); }
function connectedTo(address) { return !!wallet?.token && account?.address === address; }
function render() {
  connection.sync(); connection.setBusy(busy && !signingController);
  $('connection-hint').hidden = !!account;
  for (const name of ['note', 'payment', 'offer', 'cancel-offer']) $(name).disabled = !account || !wallet?.token || busy || connection.working || (!!pending && !hasFinishedTransaction()) || journalBlocked;
  const title = actionNames[pending?.kind || selectedAction] || 'Your transaction';
  const state = pending ? stateNames[pending.state] : busy ? 'Preparing transaction' : 'No transaction created';
  const progress = busy ? actionProgress || {
    preparing: 'Preparing the transaction…', signing: signingController?.signal.aborted ? 'Canceling the signing request…' : 'Waiting for a signature…',
    submitting: 'Submitting the transaction…', checking: 'Checking the original transaction…', clearing: '',
  }[actionPhase] || '' : '';
  for (const [name, phase] of [['sign', 'signing'], ['submit', 'submitting'], ['check', 'checking']]) $(name).setAttribute('aria-busy', String(busy && actionPhase === phase));
  $('review-progress').textContent = progress; $('review-progress').hidden = !progress;
  $('record-state').classList.toggle('demo-loading', !!progress);
  $('review-title').textContent = title;
  $('record-title').textContent = title; $('record-state').textContent = progress || state;
  $('transaction-record').hidden = !pending && !(busy && selectedAction);
  $('review-note').textContent = busy ? 'This action continues if you close this window.' : hasFinishedTransaction() ? 'This result is in Activity. Close this window to choose another action.' : pending ? 'Closing this window keeps the transaction.' : 'Close this window to choose another action.';
  $('transaction-details').hidden = !pending;
  $('review-summary').replaceChildren();
  if (!pending) {
    for (const name of ['sign', 'submit', 'check', 'cancel-request', 'clear']) $(name).hidden = true;
    return;
  }
  for (const [label, value] of [['Status', state], ['Network', 'Stellar testnet'], ['Wallet', pending.address], ...(pending.recipient ? [['Recipient', pending.recipient]] : [])]) {
    const term = document.createElement('dt'), detail = document.createElement('dd');
    term.textContent = label; detail.textContent = value; $('review-summary').append(term, detail);
  }
  updateDetails(JSON.stringify({ action: pending.kind, state: pending.state, signer: pending.address, recipient: pending.recipient, hash: pending.hash,
    ...(pending.state === 'review' ? { transaction: describe(pending.xdr) } : {}), result: pending.result }, null, 2));
  $('submit').hidden = pending.state !== 'signed' && !(busy && actionPhase === 'submitting'); $('submit').disabled = busy || connection.working || journalBlocked || !pending.signed_xdr;
  $('submit').textContent = busy && actionPhase === 'submitting' ? 'Submitting…' : 'Submit to testnet';
  $('check').hidden = !['submitting', 'unknown', 'submitted'].includes(pending.state); $('check').disabled = busy || connection.working || journalBlocked;
  $('check').textContent = busy && actionPhase === 'checking' ? 'Checking…' : 'Check original transaction';
  $('sign').hidden = pending.state !== 'review' && !(busy && actionPhase === 'signing'); $('sign').disabled = busy || connection.working || journalBlocked || !pending.xdr || !connectedTo(pending.address);
  $('sign').textContent = busy && actionPhase === 'signing' ? 'Signing…' : 'Sign';
  $('cancel-request').hidden = pending.state !== 'waiting' || !signingController;
  $('cancel-request').disabled = !signingController || signingController.signal.aborted;
  $('cancel-request').textContent = signingController?.signal.aborted ? 'Canceling…' : 'Cancel signing request';
  $('clear').disabled = busy || connection.working || journalBlocked;
  $('clear').hidden = journalBlocked || busy || !(['waiting', 'signing_unknown'].includes(pending.state) && !signingController || ['review', 'signed'].includes(pending.state));
  $('clear').textContent = pending.state === 'review' ? 'Discard' : ['waiting', 'signing_unknown'].includes(pending.state) ? 'Clear stopped request' : 'Start another request';
}
async function action(fn, phase = 'preparing') {
  if (busy || journalBlocked || connection.working) return; busy = true; actionPhase = phase; actionProgress = '';
  try {
    render();
    if (!navigator.locks?.request) throw Error('This browser cannot coordinate transaction tabs. Use a browser with Web Locks.');
    await navigator.locks.request(STORAGE, async () => {
      let latest;
      try { latest = readJournal(); }
      catch { journalBlocked = true; throw Error('The local demo journal could not be read. Preserve it before continuing.'); }
      if (JSON.stringify(latest) !== JSON.stringify(pending)) {
        pending = latest;
        throw Error('Another tab changed the transaction. Review its latest record before continuing.');
      }
      await fn();
    });
  } catch (error) {
    activity.record('error', 'Action failed', { action: pending?.kind || selectedAction, message: error.message });
    if (error.status === 401) account = null; status(error.message);
  }
  finally { busy = false; actionPhase = ''; actionProgress = ''; render(); }
}
async function build(kind) {
  if (!account || pending) return;
  const source = await sourceAccount();
  let operation;
  const id = crypto.randomUUID();
  let recipient;
  if (kind === 'note') operation = Operation.manageData({ name: 'walleterm-demo', value: id.slice(0, 16) });
  if (kind === 'payment') {
    recipient = await paymentRecipient();
    operation = Operation.payment({ destination: recipient, amount: '0.0100000', asset: Asset.native() });
  }
  if (kind === 'offer') {
    const trustline = source.balances.find(b => b.asset_code === 'USDC' && b.asset_issuer === ISSUER);
    if (!trustline || trustline.is_authorized === false || Number(trustline.limit) - Number(trustline.balance) - Number(trustline.buying_liabilities) < 1) throw Error('This account needs an authorized testnet USDC trustline with free capacity.');
    operation = Operation.manageSellOffer({ selling: Asset.native(), buying: new Asset('USDC', ISSUER), amount: '0.1000000', price: '10', offerId: '0' });
  }
  // Cancel the newest open offer of this account, whatever created it.
  if (kind === 'cancel_offer') {
    progressLabel('Loading open offers…');
    const offer = (await horizon(`/accounts/${account.address}/offers?order=desc&limit=1`))._embedded.records[0];
    if (!offer) throw Error('This account has no open offer.');
    const asset = value => value.asset_type === 'native' ? Asset.native() : new Asset(value.asset_code, value.asset_issuer);
    operation = Operation.manageSellOffer({ selling: asset(offer.selling), buying: asset(offer.buying), amount: '0', price: { n: offer.price_r.n, d: offer.price_r.d }, offerId: String(offer.id) });
  }
  const tx = new TransactionBuilder(new Account(account.address, source.sequence), { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(operation).setTimeout(180).build();
  // The browser build can return Uint8Array rather than Buffer.
  const hash = Array.from(tx.hash(), b => b.toString(16).padStart(2, '0')).join('');
  pending = { kind, address: account.address, recipient: kind === 'payment' ? recipient : undefined, xdr: tx.toXDR(), hash, state: 'review' };
  try { save(); } catch { pending = null; throw Error('The browser could not store this request. Enable site storage, then try again.'); }
  render(); status('Review this transaction. Select Sign to approve it, or Discard.');
}
// Selecting Sign is the approval. The bridge signs every valid request from this connection.
$('sign').onclick = () => action(async () => {
  if (pending?.state !== 'review') return;
  if (!connectedTo(pending.address)) throw Error('Connect the wallet that built this transaction, then select Sign.');
  pending.state = 'waiting'; save(); render(); status('Signing. Respond to 1Password on your Mac if it asks.');
  await requestSignature();
}, 'signing');
async function requestSignature() {
  const record = pending, client = wallet, controller = new AbortController();
  signingController = controller; render();
  try {
    const result = await client.signTransaction(record.xdr, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]) });
    if (pending !== record || signingController !== controller) throw Error('The transaction record changed during signing.');
    const signed = TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET);
    const hash = Array.from(signed.hash(), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== pending.hash || signed.signatures.length !== 1 || !Keypair.fromPublicKey(pending.address).verify(signed.hash(), signed.signatures[0].signature.toBytes())) throw Error('The signed transaction failed verification.');
    pending.signed_xdr = result.signedTxXdr; pending.state = 'signed'; save(); status('Signature verified. Review the transaction, then submit it when ready.');
  } catch (error) {
    if (pending !== record || signingController !== controller) throw error;
    pending.state = error.canceled === false || error.requestState === 'unknown' ? 'signing_unknown'
      : controller.signal.aborted || error.canceled === true ? 'canceled'
        : ['denied', 'expired'].includes(error.requestState) ? error.requestState : 'failed'; save();
    if (error.canceled === false) error.message += ' The bridge did not confirm the cancellation. Decline the 1Password prompt if it appears.';
    throw error;
  }
  finally { if (signingController === controller) signingController = null; }
}
function startAction(kind) {
  if (!account || (pending && !hasFinishedTransaction()) || busy || journalBlocked || connection.working) return;
  selectedAction = kind; $('transaction-details').open = false;
  openReview(); status('Preparing your transaction. Keep this window open to see its details.');
  return action(async () => {
    // Replace only a finished record, after the shared journal lock and stale-record check.
    if (hasFinishedTransaction()) {
      const previous = pending; pending = null;
      try { save(); } catch (error) { pending = previous; throw error; }
      render();
    }
    await build(kind);
  });
}
for (const kind of ['note', 'payment', 'offer']) $(kind).onclick = () => startAction(kind);
$('cancel-offer').onclick = () => startAction('cancel_offer');
$('cancel-request').onclick = () => { signingController?.abort(Error('The signing request was canceled.')); render(); };
async function confirmed(result) {
  pending.result = { hash: result.hash, ledger: result.ledger, successful: result.successful };
  pending.state = result.successful ? 'submitted' : 'failed'; save();
  status(result.successful ? 'The original transaction succeeded on testnet.' : 'The original transaction failed on testnet.');
  if (result.successful && pending.kind === 'offer') {
    const decoded = xdr.TransactionResult.fromXDR(result.result_xdr, 'base64');
    const offer = decoded.result.results?.[0]?.tr?.manageSellOfferResult?.success?.offer;
    if (offer?.type !== 'manageOfferCreated') status('The offer transaction succeeded without a resting offer. It can have traded immediately.');
  }
}
$('submit').onclick = () => action(async () => {
  if (pending?.state !== 'signed') return;
  const tx = TransactionBuilder.fromXDR(pending.signed_xdr, Networks.TESTNET);
  if (Number(tx.timeBounds.maxTime) * 1000 <= Date.now()) {
    pending.state = 'expired'; save(); status('The signed transaction expired before submission. Create a new request.'); return;
  }
  pending.state = 'submitting'; save(); render(); status('Waiting for the testnet submission result.');
  try {
    const result = await horizon('/transactions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx: pending.signed_xdr }) });
    await confirmed(result);
  } catch (error) {
    const code = error.result?.extras?.result_codes?.transaction;
    if (error.status === 400 && typeof code === 'string' && code !== 'tx_bad_seq' && error.result?.extras?.result_xdr) {
      pending.state = 'failed'; pending.result = { rejected: true, code }; save(); status(`Testnet rejected the transaction: ${code}.`);
    } else { pending.state = 'unknown'; save(); status(`Submission is uncertain. Check the original hash. ${error.message}`); }
  }
}, 'submitting');
$('check').onclick = () => action(async () => {
  if (!pending || !['submitting', 'unknown', 'submitted'].includes(pending.state)) return;
  status('Reading the ledger and checking the original transaction hash.');
  // Read the latest ledger first. Horizon ingests ledgers in order, so a later 404 covers that ledger.
  const latest = (await horizon('/ledgers?order=desc&limit=1'))._embedded.records[0];
  try { await confirmed(await horizon(`/transactions/${pending.hash}`)); }
  catch (error) {
    if (error.status !== 404) throw error;
    // The transaction can never apply when a ledger closed after its time bound, the hash is absent,
    // and the account sequence has not reached the transaction sequence.
    const tx = TransactionBuilder.fromXDR(pending.xdr, Networks.TESTNET);
    const source = await horizon(`/accounts/${pending.address}`);
    if (Date.parse(latest.closed_at) / 1000 > Number(tx.timeBounds.maxTime) && BigInt(source.sequence) < BigInt(tx.sequence)) {
      pending.state = 'expired'; save(); status('The transaction expired without reaching the ledger. It can never apply.');
    }
    else status('The original hash is not found yet. This does not prove failure. Do not submit a replacement.');
  }
}, 'checking');
$('clear').onclick = () => action(async () => {
  if (!pending || ['submitting', 'unknown'].includes(pending.state) || ['waiting', 'signing_unknown'].includes(pending.state) && signingController) return;
  pending = null; save(); selectedAction = null; closeReview();
}, 'clearing');
try { pending = readJournal();
  activity.transaction(pending);
  if (['waiting', 'signing_unknown'].includes(pending?.state)) status('A signing request was open when the page closed. Decline the 1Password prompt if it appears, then clear this record.');
} catch { journalBlocked = true; status('The local demo journal could not be read. Preserve it before continuing.'); }
render();
if (pending && !hasFinishedTransaction()) { $('review-status').textContent = $('status').textContent; openReview(); }
