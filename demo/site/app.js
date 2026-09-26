import { WalletermClient } from '/sdk/walleterm.js';
import { scanConnection } from '/sdk/scan.js';
const $ = id => document.getElementById(id);
const { Account, Asset, Keypair, Networks, Operation, StrKey, TransactionBuilder, xdr } = globalThis.StellarSdk;
const HORIZON = 'https://horizon-testnet.stellar.org';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const STORAGE = 'walleterm-demo-request-v1';
let wallet, account, pending, busy = false, connecting = false, signingController, scanning;
function status(text) { $('status').textContent = text; }
async function horizon(path, options = {}) {
  const response = await fetch(`${HORIZON}${path}`, { ...options, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(Error(result.detail || `Horizon returned ${response.status}.`), { status: response.status, result });
  return result;
}
async function paymentRecipient() {
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
  try { return await horizon(`/accounts/${account.address}`); }
  catch (error) {
    if (error.status !== 404) throw error;
    status('This testnet account does not exist yet. Funding it with Friendbot.');
    const response = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(account.address)}`, { signal: AbortSignal.timeout(30000) });
    // A funded account can still be missing from Horizon for a moment. Check it before failing.
    try { return await horizon(`/accounts/${account.address}`); }
    catch { throw Error(response.ok ? 'The funded account is not visible yet. Try again.' : 'Friendbot could not fund this testnet account. Try again later.'); }
  }
}
function save() { if (pending) localStorage.setItem(STORAGE, JSON.stringify(pending)); else localStorage.removeItem(STORAGE); }
function render() {
  $('actions').hidden = !account;
  for (const name of ['note', 'payment', 'offer', 'cancel-offer']) $(name).disabled = busy || !!pending;
  $('account').hidden = !account; $('account').textContent = account ? `TESTNET\n${account.address}` : '';
  $('disconnect').hidden = !wallet?.token;
  $('connect-button').disabled = connecting || !!wallet?.token; $('scan').disabled = connecting || !!wallet?.token || !!scanning;
  $('bridge').disabled = !!wallet?.token; $('code').disabled = !!wallet?.token;
  $('review').hidden = !pending;
  if (!pending) return;
  $('details').textContent = JSON.stringify({ action: pending.kind, state: pending.state, signer: pending.address, recipient: pending.recipient, hash: pending.hash, result: pending.result }, null, 2);
  $('submit').hidden = pending.state !== 'signed'; $('submit').disabled = busy;
  $('check').hidden = !['submitting', 'unknown', 'submitted'].includes(pending.state); $('check').disabled = busy;
  $('cancel-request').hidden = pending.state !== 'waiting';
  $('clear').hidden = busy || !['signed', 'canceled', 'denied', 'expired', 'failed', 'submitted'].includes(pending.state);
}
async function action(fn) {
  if (busy) return; busy = true; render();
  try { await fn(); } catch (error) { if (error.status === 401) account = null; status(error.message); }
  finally { busy = false; render(); }
}
function selectWallet(signers, { signal }) {
  $('picker').hidden = false;
  $('signers').replaceChildren(new Option('Choose a testnet wallet', ''));
  for (const key of signers) $('signers').add(new Option(`${key.comment || '1Password key'} · ${key.public_key}`, key.public_key));
  $('select-wallet').disabled = true;
  status('Select a dedicated testnet wallet from 1Password.');
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      signal.removeEventListener('abort', canceled); $('picker').hidden = true;
      $('select-wallet').onclick = null; $('cancel-picker').onclick = null;
      error ? reject(error) : resolve(value);
    };
    const canceled = () => finish(signal.reason || Error('Wallet selection was canceled.'));
    signal.addEventListener('abort', canceled, { once: true });
    $('signers').onchange = () => { $('select-wallet').disabled = !$('signers').value; };
    $('select-wallet').onclick = () => { if ($('signers').value) finish(null, $('signers').value); };
    $('cancel-picker').onclick = () => finish(Error('Wallet selection was canceled. Use the next code in the tunnel terminal.'));
    if (signal.aborted) canceled();
  });
}
$('connect').onsubmit = event => { event.preventDefault(); if (connecting || wallet?.token) return;
  scanning?.abort(); connecting = true; $('connect-button').disabled = true; $('scan').disabled = true;
  (async () => {
    wallet = new WalletermClient($('bridge').value.trim().replace(/\/$/, ''));
    status('Connecting. Check your Mac if 1Password requires an unlock.');
    account = await wallet.connect({ code: $('code').value.trim(), selectWallet });
    $('code').value = ''; status('Connected. Choose an action below.'); render();
  })().catch(error => { account = null; status(error.message); render(); }).finally(() => { connecting = false; render(); });
};
$('scan').onclick = async () => {
  if (scanning || connecting) return;
  scanning = new AbortController(); $('scanner').hidden = false; $('scan').disabled = true;
  status('Allow camera access, then scan the tunnel QR code.');
  try {
    const connection = await scanConnection($('camera'), { signal: scanning.signal });
    $('bridge').value = connection.url; $('code').value = connection.code;
    status('The tunnel URL and code are ready. Select Connect wallet.');
  } catch (error) { status(scanning.signal.aborted ? 'Scanning stopped. You can enter the URL and code.' : `${error.message} You can enter the URL and code.`); }
  finally { scanning = null; $('scanner').hidden = true; $('scan').disabled = connecting; }
};
$('stop-scan').onclick = () => scanning?.abort();
$('disconnect').onclick = () => action(async () => { await wallet.disconnect(); account = null; status('The website is disconnected.'); });
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
    const offer = (await horizon(`/accounts/${account.address}/offers?order=desc&limit=1`))._embedded.records[0];
    if (!offer) throw Error('This account has no open offer.');
    const asset = value => value.asset_type === 'native' ? Asset.native() : new Asset(value.asset_code, value.asset_issuer);
    operation = Operation.manageSellOffer({ selling: asset(offer.selling), buying: asset(offer.buying), amount: '0', price: { n: offer.price_r.n, d: offer.price_r.d }, offerId: String(offer.id) });
  }
  const tx = new TransactionBuilder(new Account(account.address, source.sequence), { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(operation).setTimeout(180).build();
  // The browser build can return Uint8Array rather than Buffer.
  const hash = Array.from(tx.hash(), b => b.toString(16).padStart(2, '0')).join('');
  pending = { kind, address: account.address, recipient: kind === 'payment' ? recipient : undefined, xdr: tx.toXDR(), hash, state: 'waiting' };
  try { save(); } catch { pending = null; throw Error('The browser could not store this request. Enable site storage, then try again.'); }
  render(); status('Review this transaction in your tunnel terminal. Approve it there, then respond to 1Password if it asks.');
  await requestSignature();
}
async function requestSignature() {
  signingController = new AbortController();
  try {
    const result = await wallet.signTransaction(pending.xdr, { signal: AbortSignal.any([signingController.signal, AbortSignal.timeout(300000)]) });
    const signed = TransactionBuilder.fromXDR(result.signedTxXdr, Networks.TESTNET);
    const hash = Array.from(signed.hash(), b => b.toString(16).padStart(2, '0')).join('');
    if (hash !== pending.hash || signed.signatures.length !== 1 || !Keypair.fromPublicKey(pending.address).verify(signed.hash(), signed.signatures[0].signature.toBytes())) throw Error('The signed transaction failed verification.');
    pending.signed_xdr = result.signedTxXdr; pending.state = 'signed'; save(); status('Signature verified. Review the transaction, then submit it when ready.');
  } catch (error) {
    pending.state = signingController.signal.aborted ? 'canceled' : ['denied', 'expired'].includes(error.requestState) ? error.requestState : 'failed'; save();
    if (error.canceled === false) error.message += ' The bridge did not confirm the cancellation. If the tunnel terminal shows this request, deny it there.';
    throw error;
  }
  finally { signingController = null; }
}
for (const kind of ['note', 'payment', 'offer']) $(kind).onclick = () => action(() => build(kind));
$('cancel-offer').onclick = () => action(() => build('cancel_offer'));
$('cancel-request').onclick = () => { signingController?.abort(Error('The signing request was canceled.')); };
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
  pending.state = 'submitting'; save(); render();
  try {
    const result = await horizon('/transactions', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx: pending.signed_xdr }) });
    await confirmed(result);
  } catch (error) {
    const code = error.result?.extras?.result_codes?.transaction;
    if (error.status === 400 && typeof code === 'string' && code !== 'tx_bad_seq' && error.result?.extras?.result_xdr) {
      pending.state = 'failed'; pending.result = { rejected: true, code }; save(); status(`Testnet rejected the transaction: ${code}.`);
    } else { pending.state = 'unknown'; save(); status(`Submission is uncertain. Check the original hash. ${error.message}`); }
  }
});
$('check').onclick = () => action(async () => {
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
});
$('clear').onclick = () => action(async () => {
  if (!pending || ['submitting', 'unknown', 'waiting'].includes(pending.state)) return;
  pending = null; save();
});
try { pending = JSON.parse(localStorage.getItem(STORAGE)); if (pending?.state === 'submitting') { pending.state = 'unknown'; save(); }
  // Leaving the page cancels an open signing request through the SDK.
  if (['waiting', 'signing_unknown'].includes(pending?.state)) { pending = null; save(); status('The previous signing request stopped when the page closed. If the tunnel terminal still shows it, deny it there.'); } } catch { status('The local demo journal could not be read. Preserve it before continuing.'); }
render();
