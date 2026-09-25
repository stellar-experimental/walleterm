const $ = id => document.getElementById(id);
let pending = null;
let completed = null;
let busy = false;
let offerId = null;

function show(id, visible) { $(id).classList.toggle('hidden', !visible); }
function message(text, type = '') {
  $('message').textContent = text;
  $('message').className = `message ${type}`.trim();
}
async function request(path, data) {
  const response = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'The request failed.');
  return result;
}
async function session() {
  const response = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
  return response.json();
}
async function waitFor(hash, accepted, deadlineMs = 145000, allowUnknown = false) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const state = await session();
    if (state.current?.hash === hash) {
      render(state.current);
      if (state.current.error && !(allowUnknown && state.current.state === 'unknown')) throw Error(state.current.error);
      if (state.current.state === 'unknown' && !allowUnknown) throw Error('The submission outcome is unknown. Check the original hash.');
      if (accepted.includes(state.current.state)) return state;
    }
    if (!state.current && state.last_result?.hash === hash && accepted.includes('complete')) {
      completed = state.last_result;
      render(null);
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw Error('The request is still pending. Refresh this page to check it.');
}
function details(target, values) {
  const dl = $(target);
  dl.replaceChildren();
  for (const [key, value] of Object.entries(values)) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = key.replaceAll('_', ' ');
    dd.textContent = value;
    dl.append(dt, dd);
  }
}
function render(item) {
  pending = item;
  show('actions', !item && !completed);
  show('review', ['prepared', 'signing', 'sign_failed'].includes(item?.state));
  show('signed', ['signed', 'submitting', 'submit_failed'].includes(item?.state));
  show('result', !item && !!completed);
  show('reconcile', item?.state === 'unknown');
  show('discard', item?.state === 'submit_failed');
  if (item?.details) details('details', item.details);
  if (item?.signed_xdr) $('signed-xdr').value = item.signed_xdr;
  if (completed) {
    details('result-details', completed);
    $('result-title').textContent = completed.status === 'SUCCESS' ? 'Testnet accepted the transaction.' : 'Testnet rejected the transaction.';
  }
  $('approve').disabled = busy || item?.state !== 'prepared';
  $('cancel').disabled = busy || !['prepared', 'sign_failed', 'submit_failed'].includes(item?.state);
  $('submit').disabled = busy || item?.state !== 'signed';
}
async function run(fn) {
  if (busy) return;
  busy = true;
  render(pending);
  try { await fn(); }
  catch (error) {
    message(error.message, 'error');
    try {
      const state = await session();
      completed = state.last_result || null;
      offerId = state.offer_id;
      show('cancel-offer-action', !!offerId);
      render(state.current);
    }
    catch { /* Keep the visible request for a manual refresh. */ }
  }
  finally { busy = false; render(pending); }
}
async function init() {
  const code = new URLSearchParams(location.hash.slice(1)).get('code');
  if (code) {
    history.replaceState(null, '', '/');
    try {
      await request('/api/pair', { code });
      message('This browser is paired.', 'success');
    } catch (error) { message(error.message, 'error'); }
  }
  try {
    const state = await session();
    show('pair-panel', !state.paired);
    show('app-panel', state.paired);
    if (!state.paired) {
      if (!code) message('Open the pairing link shown on your Mac.');
      return;
    }
    $('signer-short').textContent = `${state.signer.slice(0, 10)}…${state.signer.slice(-6)}`;
    offerId = state.offer_id;
    show('cancel-offer-action', !!offerId);
    completed = state.last_result || null;
    render(state.current);
    if (state.current?.error) message(state.current.error, 'error');
    else if (!code) message(state.current ? 'Finish the current request.' : 'Choose a testnet action.');
  } catch (error) { message(error.message, 'error'); }
}

document.querySelectorAll('.action').forEach(button => button.addEventListener('click', () => run(async () => {
  const item = await request('/api/prepare', { kind: button.dataset.kind });
  completed = null;
  render(item);
  message('Review the transaction before you approve it.');
})));
$('approve').addEventListener('click', () => run(async () => {
  message('Waiting for 1Password on the Mac…');
  const hash = pending.hash;
  await request('/api/approve', { id: pending.id });
  await waitFor(hash, ['signed']);
  message('The signed transaction returned to this browser.', 'success');
}));
$('cancel').addEventListener('click', () => run(async () => {
  await request('/api/cancel', { id: pending.id });
  render(null);
  message('The request was canceled.');
}));
$('submit').addEventListener('click', () => run(async () => {
  message('Sending the signed transaction to testnet…');
  const hash = pending.hash;
  await request('/api/submit', { id: pending.id });
  await waitFor(hash, ['complete']);
  const state = await session();
  offerId = state.offer_id;
  show('cancel-offer-action', !!offerId);
  message(completed.status === 'SUCCESS' ? 'Testnet accepted the transaction.' : 'Testnet rejected the transaction.', completed.status === 'SUCCESS' ? 'success' : 'error');
}));
$('discard').addEventListener('click', () => run(async () => {
  await request('/api/cancel', { id: pending.id });
  render(null);
  message('The failed request was discarded.');
}));
$('reconcile').addEventListener('click', () => run(async () => {
  const hash = pending.hash;
  await request('/api/reconcile', {});
  await waitFor(hash, ['complete'], 145000, true);
  const state = await session();
  offerId = state.offer_id;
  show('cancel-offer-action', !!offerId);
  message('The original transaction has a final ledger result.', completed.status === 'SUCCESS' ? 'success' : 'error');
}));
$('again').addEventListener('click', () => { completed = null; render(null); message('Choose another testnet action.'); });
init();
