// Demo-only activity history. Never inspect private keys or persist connection credentials.
const secretField = /^(token|accesstoken|refreshtoken|sessiontoken|capability|apikey|clientsecret|authorization|cookie|setcookie|password|code|connectioncode|grantid|privatekey|secretkey|seed)$/i;
export function safeData(value, depth = 0) {
  if (depth > 12) return '[nested data omitted]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map(item => safeData(item, depth + 1));
  if (typeof value !== 'object' || value === undefined) return null;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    secretField.test(key.replace(/[-_]/g, '')) ? '[redacted]' : safeData(item, depth + 1)]));
}

function browserStore() {
  let opening;
  const open = () => opening ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('walleterm-demo-activity', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('events', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return {
    async load() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction('events').objectStore('events').getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    },
    async put(event) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('events', 'readwrite');
        transaction.objectStore('events').put(event);
        transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
  };
}

export class ActivityHistory {
  constructor({ store = browserStore(), decodeSigned = () => ({}), changed = () => {} } = {}) {
    this.store = store; this.decodeSigned = decodeSigned; this.changed = changed;
    this.events = []; this.unsaved = false; this.polls = new Map(); this.transactionState = null;
    this.ready = Promise.resolve().then(() => store.load()).then(saved => {
      const existing = new Set(this.events.map(event => event.id));
      this.events.push(...saved.filter(event => event && typeof event.id === 'string' && !existing.has(event.id)).map(event => safeData(event)));
      this.events.sort((a, b) => (b.order ?? Date.parse(b.time)) - (a.order ?? Date.parse(a.time)));  this.changed();
    }).catch(() => { this.unsaved = true; this.changed(); });
  }
  record(category, title, data = {}) {
    // Activity failures must never change a wallet request or transaction outcome.
    try {
      const event = { id: crypto.randomUUID(), time: new Date().toISOString(), order: performance.timeOrigin + performance.now(), category, title, data: safeData(data) };
      this.events.unshift(event); this.changed();
      Promise.resolve().then(() => this.store.put(event)).catch(() => { this.unsaved = true; this.changed(); });
      return event;
    } catch { return null; }
  }
  signedData(xdr) {
    try { return this.decodeSigned(xdr); }
    catch { return { decoding_error: 'The demo could not decode the returned transaction.' }; }
  }
  transaction(record) {
    if (!record) { this.transactionState = null; return; }
    const state = `${record.hash}:${record.state}:${JSON.stringify(record.result || null)}`;
    if (state === this.transactionState) return;
    this.transactionState = state;
    const titles = { review: 'Transaction prepared', waiting: 'Signature requested', signed: 'Signature verified',
      submitting: 'Transaction submitted for processing', submitted: 'Transaction confirmed', unknown: 'Submission result unknown',
      signing_unknown: 'Signing result unknown', failed: 'Transaction failed', canceled: 'Signing canceled', denied: 'Signature declined', expired: 'Transaction expired' };
    this.record('transaction', titles[record.state] || 'Transaction updated', {
      ...record, ...(record.signed_xdr ? this.signedData(record.signed_xdr) : {}),
    });
  }
  wrapFetch(fetcher) {
    return async (input, options = {}) => {
      let url, source, route, method, body;
      try {
        url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, globalThis.location?.origin);
        source = url.origin === 'https://horizon-testnet.stellar.org' || url.origin === 'https://friendbot.stellar.org' ? 'network'
          : /^\/v1\/(connect|signers|select|account|disconnect|requests(?:\/[^/]+(?:\/cancel)?)?)$/.test(url.pathname) ? 'walleterm' : null;
        route = url.pathname; method = options.method || input.method || 'GET';
        if (typeof options.body === 'string' && options.body.startsWith('{')) body = safeData(JSON.parse(options.body));
        else if (options.body instanceof URLSearchParams) body = safeData(Object.fromEntries(options.body));
      } catch { /* Unrecognized requests pass through unchanged. */ }
      if (!source) return fetcher(input, options);
      const polling = source === 'walleterm' && method === 'GET' && /^\/v1\/requests\//.test(route);
      const labels = { '/v1/connect': 'Connect website', '/v1/signers': 'List wallets', '/v1/select': 'Select wallet',
        '/v1/account': 'Read active wallet', '/v1/disconnect': 'Disconnect website', '/v1/requests': 'Request signature' };
      const name = labels[route] || (source === 'walleterm' ? route.endsWith('/cancel') ? 'Cancel signing request' : 'Signing update'
        : url.origin === 'https://friendbot.stellar.org' ? 'Fund testnet account' : route === '/transactions' ? 'Submit transaction' : route.startsWith('/transactions/') ? 'Check transaction' : 'Read testnet data');
      const request = { source, method, origin: url.origin, path: route, ...(source === 'network' && url.search ? { query: safeData(Object.fromEntries(url.searchParams)) } : {}), ...(body ? { body } : {}) };
      if (!polling) this.record(source, `${name} · request`, request);
      try {
        const response = await fetcher(input, options);
        // Observe a clone without delaying delivery, consuming the original body, or changing cancellation.
        try {
          response.clone().json().then(result => {
            const data = safeData(result);
            const key = `${url.origin}${route}`, fingerprint = JSON.stringify(data);
            if (polling && this.polls.get(key) === fingerprint) return;
            if (source === 'walleterm' && data?.id && data?.state) this.polls.set(`${url.origin}/v1/requests/${data.id}`, fingerprint);
            if (polling) this.polls.set(key, fingerprint);
            const signed = source === 'walleterm' && typeof data?.signed_xdr === 'string' ? this.signedData(data.signed_xdr) : {};
            this.record(response.ok ? source : 'error', `${name} · ${response.ok ? 'response' : 'failed'}`, {
              ...request, status: response.status, response: data, ...signed,
            });
          }).catch(() => this.record('error', `${name} · unreadable response`, { ...request, status: response.status }));
        } catch { /* A response without a clone still belongs to the caller. */ }
        return response;
      } catch (error) {
        this.record('error', `${name} · request stopped`, { ...request, error: safeData(error) });
        throw error;
      }
    };
  }
}

const categories = { action: 'Action', status: 'Status', walleterm: 'Walleterm', transaction: 'Transaction', network: 'Testnet', error: 'Error' };
function values(data, key, found = []) {
  if (!data || typeof data !== 'object') return found;
  for (const [name, value] of Object.entries(data)) {
    if (name === key && typeof value === 'string' && value) found.push(value);
    else if (name === key && Array.isArray(value)) found.push(...value.filter(item => typeof item === 'string'));
    else if (typeof value === 'object') values(value, key, found);
  }
  return [...new Set(found)];
}

export function createActivityLog(element, { decodeSigned } = {}) {
  element.innerHTML = `<div class="activity-heading"><div><h2 id="activity-title">Activity</h2><p>Actions, wallet responses, and transaction results.</p></div><button type="button" data-log="export">Export JSON</button></div>
    <div class="activity-tools"><label><span class="activity-label">Search activity</span><input data-log="search" type="search" placeholder="Find an action, hash, or wallet" autocomplete="off"></label><label><span class="activity-label">Event type</span><select data-log="filter"><option value="">All activity</option>${Object.entries(categories).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label></div>
    <div class="activity-meta"><span data-log="count" role="status">No events yet</span><span>Saved in this browser · Newest first</span></div>
    <p class="activity-storage" data-log="storage" hidden>New activity is available in this tab but cannot be saved. Export JSON to keep it.</p>
    <p class="activity-empty" data-log="empty">Your activity will appear here. Connect a wallet or try a testnet action.</p>
    <div class="activity-events" data-log="events"></div><button type="button" class="activity-more" data-log="more" hidden>Show more activity</button><p class="activity-notice" data-log="notice" role="status"></p>`;
  const $ = name => element.querySelector(`[data-log="${name}"]`), rows = new Map(); let limit = 40;
  const copy = async (value, button) => {
    try { await navigator.clipboard.writeText(value); $('notice').textContent = `Copied ${button.textContent.replace(/^Copy /, '')}.`; }
    catch { $('notice').textContent = 'Copy failed. Expand the JSON to select and copy the value.'; }
  };
  const button = (title, value) => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = title;
    node.onclick = () => copy(value, node); return node;
  };
  const row = event => {
    if (rows.has(event.id)) return rows.get(event.id);
    const expandable = event.data != null && (typeof event.data === 'object' ? Object.keys(event.data).length > 0 : event.data !== '');
    const node = document.createElement(expandable ? 'details' : 'div'); node.className = 'activity-event';
    const summary = document.createElement(expandable ? 'summary' : 'div'); summary.className = 'activity-summary';
    const kind = document.createElement('span'); kind.className = `activity-kind activity-kind-${event.category}`; kind.textContent = categories[event.category] || 'Event';
    const title = document.createElement('strong'); title.textContent = event.title;
    const time = document.createElement('time'); time.dateTime = event.time; time.textContent = new Date(event.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    summary.append(kind, title, time); node.append(summary);
    if (!expandable) { rows.set(event.id, node); return node; }
    const detail = document.createElement('div'); detail.className = 'activity-detail';
    const actions = document.createElement('div'); actions.className = 'activity-copy';
    actions.append(button('Copy JSON', JSON.stringify(event, null, 2)));
    values(event.data, 'hash').forEach((hash, index) => actions.append(button(index ? `Copy hash ${index + 1}` : 'Copy hash', hash)));
    values(event.data, 'signatures').forEach((signature, index) => actions.append(button(index ? `Copy signature ${index + 1}` : 'Copy signature', signature)));
    const xdr = values(event.data, 'signed_xdr')[0] || values(event.data, 'xdr')[0] || values(event.data, 'transaction_xdr')[0];
    if (xdr) actions.append(button('Copy XDR', xdr));
    const pre = document.createElement('pre'); pre.tabIndex = 0;
    pre.setAttribute('role', 'region'); pre.setAttribute('aria-label', 'Event JSON');
    pre.textContent = JSON.stringify(event.data, null, 2);
    detail.append(actions, pre); node.append(detail); rows.set(event.id, node); return node;
  };
  const history = new ActivityHistory({ decodeSigned, changed: () => render() });
  function render() {
    const term = $('search').value.toLowerCase(), category = $('filter').value;
    const matching = history.events.filter(event => (!category || event.category === category) && (!term || JSON.stringify(event).toLowerCase().includes(term)));
    const visible = matching.slice(0, limit), nodes = visible.map(row), keep = new Set(nodes), list = $('events');
    for (const child of [...list.children]) if (!keep.has(child)) child.remove();
    nodes.forEach((node, index) => { if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null); });
    $('count').textContent = `${matching.length} ${matching.length === 1 ? 'event' : 'events'}${term || category ? ` of ${history.events.length}` : ''}`;
    $('empty').hidden = !!matching.length; $('empty').textContent = history.events.length ? 'No activity matches this search.' : 'Your activity will appear here. Connect a wallet or try a testnet action.';
    $('storage').hidden = !history.unsaved; $('more').hidden = matching.length <= limit; $('export').disabled = !history.events.length;
  }
  $('search').oninput = $('filter').onchange = () => { limit = 40; render(); };
  $('more').onclick = () => { limit += 40; render(); };
  $('export').onclick = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), events: history.events }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `walleterm-activity-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const actions = { note: 'Write a note selected', payment: 'Payment selected', offer: 'Offer selected', 'cancel-offer': 'Cancel offer selected',
    sign: 'Sign selected', submit: 'Submit selected', check: 'Check transaction selected', 'cancel-request': 'Cancel signing selected', clear: 'Clear transaction selected',
    'open-review': 'Transaction opened', 'close-review': 'Transaction closed' };
  const walletActions = { scan: 'Camera scan selected', 'stop-scan': 'Camera scan stopped', close: 'Connection dialog closed', refresh: 'Wallet refresh selected', disconnect: 'Disconnect selected', copy: 'Wallet address copy selected' };
  document.addEventListener('click', event => {
    const target = event.target.closest?.('button'); if (!target || element.contains(target) || target.disabled) return;
    const title = actions[target.id] || walletActions[target.dataset.wt] || (target.classList.contains('wt-trigger') ? 'Wallet connection opened' : target.classList.contains('wt-wallet-row') ? 'Wallet selected' : null);
    if (title) history.record('action', title, target.classList.contains('wt-wallet-row') ? { public_key: target.title } : {});
  }, true);
  document.addEventListener('submit', event => {
    if (event.target.matches('[data-wt="form"]')) history.record('action', 'Connection submitted');
  }, true);
  history.record('action', 'Demo opened'); render();
  return history;
}
