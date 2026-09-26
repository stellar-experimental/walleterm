import { createCodeView } from './code-view.js';
import { requestError } from '../../sdk/errors.ts';
// Demo-only activity history. Never inspect private keys or persist connection credentials.
const secretField =
  /^(token|accesstoken|refreshtoken|sessiontoken|capability|apikey|clientsecret|authorization|cookie|setcookie|password|code|connectioncode|grantid|privatekey|secretkey|seed)$/i;
import type { Fetch } from '../../sdk/types.ts';

type Data = null | boolean | number | string | Data[] | { [key: string]: Data };
export interface ActivityEvent {
  id: string;
  time: string;
  order?: number;
  category: string;
  title: string;
  data: Data;
}
export interface ActivityStore {
  load(): Promise<unknown[]>;
  put(event: ActivityEvent): Promise<unknown>;
}
interface HistoryOptions {
  store?: ActivityStore;
  decodeSigned?: (xdr: string) => Record<string, unknown>;
  changed?: () => void;
}
interface TransactionRecord {
  hash: string;
  state: string;
  result?: unknown;
  signed_xdr?: string;
}

export function safeData(value: unknown, depth = 0): Data {
  if (depth > 12) return '[nested data omitted]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((item) => safeData(item, depth + 1));
  if (typeof value !== 'object' || value === undefined) return null;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secretField.test(key.replace(/[-_]/g, '')) ? '[redacted]' : safeData(item, depth + 1),
    ]),
  );
}

// IndexedDB contains untrusted values. Sanitize the complete event before restoring it.
function savedEvent(value: unknown): ActivityEvent | null {
  const event = safeData(value);
  if (
    !event ||
    typeof event !== 'object' ||
    Array.isArray(event) ||
    typeof event.id !== 'string' ||
    typeof event.time !== 'string' ||
    typeof event.category !== 'string' ||
    typeof event.title !== 'string'
  )
    return null;
  return {
    id: event.id,
    time: event.time,
    category: event.category,
    title: event.title,
    ...(typeof event.order === 'number' ? { order: event.order } : {}),
    data: event.data ?? null,
  };
}

function browserStore(): ActivityStore {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opening ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('walleterm-demo-activity', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('events', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  return {
    async load() {
      const db = await open();
      return new Promise<ActivityEvent[]>((resolve, reject) => {
        const request = db.transaction('events').objectStore('events').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },
    async put(event: ActivityEvent) {
      const db = await open();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('events', 'readwrite');
        transaction.objectStore('events').put(event);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    },
  };
}

export class ActivityHistory {
  store: ActivityStore;
  decodeSigned: (xdr: string) => Record<string, unknown>;
  changed: () => void;
  events: ActivityEvent[] = [];
  loading = true;
  unsaved = false;
  polls = new Map<string, string>();
  transactionState: string | null = null;
  ready: Promise<void>;
  constructor({
    store = browserStore(),
    decodeSigned = () => ({}),
    changed = () => {},
  }: HistoryOptions = {}) {
    this.store = store;
    this.decodeSigned = decodeSigned;
    this.changed = changed;
    this.ready = Promise.resolve()
      .then(() => store.load())
      .then((saved) => {
        const existing = new Set(this.events.map((event) => event.id));
        this.events.push(
          ...saved
            .map(savedEvent)
            .filter((event): event is ActivityEvent => event !== null && !existing.has(event.id)),
        );
        this.events.sort((a, b) => (b.order ?? Date.parse(b.time)) - (a.order ?? Date.parse(a.time)));
      })
      .catch(() => {
        this.unsaved = true;
      })
      .finally(() => {
        this.loading = false;
        this.changed();
      });
  }
  record(category: string, title: string, data: unknown = {}) {
    // Activity failures must never change a wallet request or transaction outcome.
    try {
      const event = {
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        order: performance.timeOrigin + performance.now(),
        category,
        title,
        data: safeData(data),
      };
      this.events.unshift(event);
      this.changed();
      Promise.resolve()
        .then(() => this.store.put(event))
        .catch(() => {
          this.unsaved = true;
          this.changed();
        });
      return event;
    } catch {
      return null;
    }
  }
  signedData(xdr: string) {
    try {
      return this.decodeSigned(xdr);
    } catch {
      return { decoding_error: 'The demo could not decode the returned transaction.' };
    }
  }
  transaction(record: TransactionRecord | null | undefined) {
    if (!record) {
      this.transactionState = null;
      return;
    }
    const state = `${record.hash}:${record.state}:${JSON.stringify(record.result || null)}`;
    if (state === this.transactionState) return;
    this.transactionState = state;
    const titles: Record<string, string> = {
      review: 'Transaction prepared',
      waiting: 'Signature requested',
      signed: 'Signature verified',
      submitting: 'Transaction submitted for processing',
      submitted: 'Transaction confirmed',
      unknown: 'Submission result unknown',
      signing_unknown: 'Signing result unknown',
      failed: 'Transaction failed',
      canceled: 'Signing canceled',
      denied: 'Signature declined',
      expired: 'Transaction expired',
    };
    this.record('transaction', titles[record.state] || 'Transaction updated', {
      ...record,
      ...(record.signed_xdr ? this.signedData(record.signed_xdr) : {}),
    });
  }
  wrapFetch(fetcher: Fetch): Fetch {
    return async (input, options = {}) => {
      let url: URL | undefined,
        source: string | null = null,
        route = '',
        method = 'GET',
        body: Data | undefined;
      try {
        url = new URL(
          typeof input === 'string' || input instanceof URL ? String(input) : input.url,
          globalThis.location?.origin,
        );
        source =
          url.origin === 'https://horizon-testnet.stellar.org' ||
          url.origin === 'https://friendbot.stellar.org'
            ? 'network'
            : /^\/v1\/(connect|signers|select|account|disconnect|requests(?:\/[^/]+(?:\/cancel)?)?)$/.test(
                  url.pathname,
                )
              ? 'walleterm'
              : null;
        route = url.pathname;
        method = options.method || (input instanceof Request ? input.method : 'GET');
        if (typeof options.body === 'string' && options.body.startsWith('{'))
          body = safeData(JSON.parse(options.body));
        else if (options.body instanceof URLSearchParams) body = safeData(Object.fromEntries(options.body));
      } catch {
        /* Unrecognized requests pass through unchanged. */
      }
      if (!source || !url) return fetcher(input, options);
      const polling = source === 'walleterm' && method === 'GET' && /^\/v1\/requests\//.test(route);
      const labels: Record<string, string> = {
        '/v1/connect': 'Connect website',
        '/v1/signers': 'List wallets',
        '/v1/select': 'Select wallet',
        '/v1/account': 'Read active wallet',
        '/v1/disconnect': 'Disconnect website',
        '/v1/requests': 'Request signature',
      };
      const name =
        labels[route] ||
        (source === 'walleterm'
          ? route.endsWith('/cancel')
            ? 'Cancel signing request'
            : 'Signing update'
          : url.origin === 'https://friendbot.stellar.org'
            ? 'Fund testnet account'
            : route === '/transactions'
              ? 'Submit transaction'
              : route.startsWith('/transactions/')
                ? 'Check transaction'
                : 'Read testnet data');
      const request = {
        source,
        method,
        origin: url.origin,
        path: route,
        ...(source === 'network' && url.search
          ? { query: safeData(Object.fromEntries(url.searchParams)) }
          : {}),
        ...(body ? { body } : {}),
      };
      if (!polling) this.record(source, `${name} · request`, request);
      try {
        const response = await fetcher(input, options);
        // Observe a clone without delaying delivery, consuming the original body, or changing cancellation.
        try {
          response
            .clone()
            .json()
            .then((result) => {
              const data = safeData(result);
              const fields = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
              const key = `${url!.origin}${route}`,
                fingerprint = JSON.stringify(data);
              if (polling && this.polls.get(key) === fingerprint) return;
              if (source === 'walleterm' && fields.id && fields.state)
                this.polls.set(`${url!.origin}/v1/requests/${fields.id}`, fingerprint);
              if (polling) this.polls.set(key, fingerprint);
              const signed =
                source === 'walleterm' && typeof fields.signed_xdr === 'string'
                  ? this.signedData(fields.signed_xdr)
                  : {};
              this.record(
                response.ok ? source : 'error',
                `${name} · ${response.ok ? 'response' : 'failed'}`,
                {
                  ...request,
                  status: response.status,
                  response: data,
                  ...signed,
                },
              );
            })
            .catch(() =>
              this.record('error', `${name} · unreadable response`, { ...request, status: response.status }),
            );
        } catch {
          /* A response without a clone still belongs to the caller. */
        }
        return response;
      } catch (errorValue) {
        const error = requestError(errorValue);
        this.record('error', `${name} · request stopped`, { ...request, error: safeData(error) });
        throw error;
      }
    };
  }
}

const categories: Record<string, string> = {
  action: 'Action',
  status: 'Status',
  walleterm: 'Walleterm',
  transaction: 'Transaction',
  network: 'Testnet',
  error: 'Error',
};
function values(data: unknown, key: string, found: string[] = []): string[] {
  if (!data || typeof data !== 'object') return found;
  for (const [name, value] of Object.entries(data)) {
    if (name === key && typeof value === 'string' && value) found.push(value);
    else if (name === key && Array.isArray(value))
      found.push(...value.filter((item) => typeof item === 'string'));
    else if (typeof value === 'object') values(value, key, found);
  }
  return [...new Set(found)];
}

export function createActivityLog(
  element: HTMLElement,
  { decodeSigned }: Pick<HistoryOptions, 'decodeSigned'> = {},
) {
  element.innerHTML = `<div class="activity-heading"><div><h2 id="activity-title">Activity</h2><p>Actions, wallet responses, and transaction results.</p></div><button type="button" data-log="export">Export JSON</button></div>
    <div class="activity-tools"><label><span class="activity-label">Search activity</span><input data-log="search" type="search" placeholder="Find an action, hash, or wallet" autocomplete="off"></label><label><span class="activity-label">Event type</span><select data-log="filter"><option value="">All activity</option>${Object.entries(
      categories,
    )
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join('')}</select></label></div>
    <div class="activity-meta"><span data-log="count" role="status">No events yet</span><span>Saved in this browser · Newest first</span></div>
    <p class="activity-storage" data-log="storage" hidden>New activity is available in this tab but cannot be saved. Export JSON to keep it.</p>
    <p class="activity-empty" data-log="empty">Your activity will appear here. Connect a wallet or try a testnet action.</p>
    <div class="activity-events" data-log="events"></div><button type="button" class="activity-more" data-log="more" hidden>Show more activity</button><p class="activity-notice" data-log="notice" role="status"></p>`;
  type Elements = { search: HTMLInputElement; filter: HTMLSelectElement; export: HTMLButtonElement };
  const $ = <K extends string>(name: K) =>
    element.querySelector(`[data-log="${name}"]`)! as K extends keyof Elements ? Elements[K] : HTMLElement;
  const rows = new Map<string, HTMLElement>();
  const copying = new WeakSet<HTMLButtonElement>();
  let limit = 40;
  const copy = async (value: string, button: HTMLButtonElement) => {
    if (copying.has(button)) return;
    const title = button.textContent;
    copying.add(button);
    try {
      await navigator.clipboard.writeText(value);
      $('notice').textContent = `Copied ${(title || '').replace(/^Copy /, '')}.`;
    } catch {
      $('notice').textContent = 'Copy failed. Expand the JSON to select and copy the value.';
    } finally {
      copying.delete(button);
    }
  };
  const button = (title: string, value: string) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = title;
    node.onclick = () => copy(value, node);
    return node;
  };
  const row = (event: ActivityEvent): HTMLElement => {
    if (rows.has(event.id)) return rows.get(event.id)!;
    const expandable =
      event.data != null &&
      (typeof event.data === 'object' ? Object.keys(event.data).length > 0 : event.data !== '');
    const disclosure = expandable ? document.createElement('details') : undefined;
    const node = disclosure ?? document.createElement('div');
    node.className = 'activity-event';
    const summary = document.createElement(expandable ? 'summary' : 'div');
    summary.className = 'activity-summary';
    const kind = document.createElement('span');
    kind.className = `activity-kind activity-kind-${event.category}`;
    kind.textContent = categories[event.category] || 'Event';
    const title = document.createElement('strong');
    title.textContent = event.title;
    const time = document.createElement('time');
    time.dateTime = event.time;
    time.textContent = new Date(event.time).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    summary.append(kind, title, time);
    node.append(summary);
    if (!expandable) {
      rows.set(event.id, node);
      return node;
    }
    const detail = document.createElement('div');
    detail.className = 'activity-detail';
    const actions = document.createElement('div');
    actions.className = 'activity-copy';
    actions.append(button('Copy JSON', JSON.stringify(event, null, 2)));
    values(event.data, 'hash').forEach((hash, index) =>
      actions.append(button(index ? `Copy hash ${index + 1}` : 'Copy hash', hash)),
    );
    values(event.data, 'signatures').forEach((signature, index) =>
      actions.append(button(index ? `Copy signature ${index + 1}` : 'Copy signature', signature)),
    );
    const xdr =
      values(event.data, 'signed_xdr')[0] ||
      values(event.data, 'xdr')[0] ||
      values(event.data, 'transaction_xdr')[0];
    if (xdr) actions.append(button('Copy XDR', xdr));
    const code = document.createElement('div');
    const updateCode = createCodeView(code, { label: 'JSON', disclosure });
    updateCode(JSON.stringify(event.data, null, 2));
    detail.append(actions, code);
    node.append(detail);
    rows.set(event.id, node);
    return node;
  };
  const history = new ActivityHistory({ decodeSigned, changed: () => render() });
  function render() {
    const term = $('search').value.toLowerCase(),
      category = $('filter').value;
    const matching = history.events.filter(
      (event) =>
        (!category || event.category === category) &&
        (!term || JSON.stringify(event).toLowerCase().includes(term)),
    );
    const visible = matching.slice(0, limit),
      nodes = visible.map(row),
      keep = new Set<Element>(nodes),
      list = $('events');
    for (const child of [...list.children]) if (!keep.has(child)) child.remove();
    nodes.forEach((node, index) => {
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
    });
    $('count').textContent = history.loading
      ? 'Loading saved activity…'
      : `${matching.length} ${matching.length === 1 ? 'event' : 'events'}${term || category ? ` of ${history.events.length}` : ''}`;
    $('empty').hidden = !!matching.length;
    $('empty').textContent = history.events.length
      ? 'No activity matches this search.'
      : 'Your activity will appear here. Connect a wallet or try a testnet action.';
    $('storage').hidden = !history.unsaved;
    $('more').hidden = matching.length <= limit;
    $('export').disabled = history.loading || !history.events.length;
  }
  $('search').oninput = $('filter').onchange = () => {
    limit = 40;
    render();
  };
  $('more').onclick = () => {
    limit += 40;
    render();
  };
  $('export').onclick = () => {
    if (history.loading || !history.events.length) return;
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), events: history.events }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = `walleterm-activity-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const actions: Record<string, string> = {
    note: 'Write a note selected',
    payment: 'Payment selected',
    offer: 'Offer selected',
    'cancel-offer': 'Cancel offer selected',
    sign: 'Sign selected',
    submit: 'Submit selected',
    check: 'Check transaction selected',
    'cancel-request': 'Cancel signing selected',
    clear: 'Clear transaction selected',
    'open-review': 'Transaction opened',
    'close-review': 'Transaction closed',
  };
  const walletActions: Record<string, string> = {
    scan: 'Camera scan selected',
    'stop-scan': 'Camera scan stopped',
    close: 'Connection dialog closed',
    refresh: 'Wallet refresh selected',
    disconnect: 'Disconnect selected',
    copy: 'Wallet address copy selected',
  };
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target || element.contains(target) || target.disabled) return;
      const title =
        actions[target.id] ||
        walletActions[target.dataset.wt || ''] ||
        (target.classList.contains('wt-trigger')
          ? 'Wallet connection opened'
          : target.classList.contains('wt-wallet-row')
            ? 'Wallet selected'
            : null);
      if (title)
        history.record(
          'action',
          title,
          target.classList.contains('wt-wallet-row') ? { public_key: target.title } : {},
        );
    },
    true,
  );
  document.addEventListener(
    'submit',
    (event) => {
      if (event.target instanceof Element && event.target.matches('[data-wt="form"]'))
        history.record('action', 'Connection submitted');
    },
    true,
  );
  history.record('action', 'Demo opened');
  render();
  return history;
}
