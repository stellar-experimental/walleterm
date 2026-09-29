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
  /** Called after each new or changed event, with the changed event's ID. */
  changed?: (id?: string) => void;
}
interface TransactionRecord {
  hash: string;
  state: string;
  result?: unknown;
  signed_xdr?: string;
  contract?: { authorizations: unknown[]; authorizationReady: boolean };
}
type Fields = { [key: string]: Data };

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
      // A numeric code is an error code, such as a JSON-RPC error. Connection codes are strings.
      secretField.test(key.replace(/[-_]/g, '')) && !(key === 'code' && typeof item === 'number')
        ? '[redacted]'
        : safeData(item, depth + 1),
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

const RPC = 'https://soroban-testnet.stellar.org';
const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const rpcNames: Record<string, string> = {
  getLedgerEntries: 'Read ledger entries',
  simulateTransaction: 'Simulate transaction',
  sendTransaction: 'Send transaction',
  getTransaction: 'Check transaction',
  getLatestLedger: 'Read latest ledger',
  getNetwork: 'Read network',
};
// These RPC methods only read. Identical repeats group into one event.
const rpcReads = new Set([
  'getLedgerEntries',
  'simulateTransaction',
  'getTransaction',
  'getLatestLedger',
  'getNetwork',
]);
// Ledger position fields change on every response. They do not make a read different.
const ledgerPosition = new Set([
  'latestLedger',
  'latestLedgerCloseTime',
  'oldestLedger',
  'oldestLedgerCloseTime',
]);
const fields = (data: Data | undefined): Fields =>
  data && typeof data === 'object' && !Array.isArray(data) ? data : {};

// Classify a response. JSON-RPC reports errors inside HTTP 200 responses.
function outcome(ok: boolean, status: number, data: Data, rpcMethod?: string, lookup = false) {
  // A missing Horizon account or transaction is an answer, not a failure.
  if (!ok && lookup && status === 404) return { error: false, label: 'not found' };
  if (!ok) return { error: true, label: String(status) };
  if (!rpcMethod) return { error: false, label: String(status) };
  const response = fields(data),
    result = fields(response.result);
  if (response.error) return { error: true, label: 'RPC error' };
  if (rpcMethod === 'simulateTransaction' && result.error) return { error: true, label: 'simulation failed' };
  if (
    (rpcMethod === 'sendTransaction' || rpcMethod === 'getTransaction') &&
    typeof result.status === 'string'
  )
    return {
      error: ['ERROR', 'TRY_AGAIN_LATER', 'FAILED'].includes(result.status),
      label: result.status,
    };
  return { error: false, label: String(status) };
}

export class ActivityHistory {
  store: ActivityStore;
  decodeSigned: (xdr: string) => Record<string, unknown>;
  changed: (id?: string) => void;
  events: ActivityEvent[] = [];
  loading = true;
  unsaved = false;
  // The last event of each read, and the fingerprint of its response.
  reads = new Map<string, { fingerprint: string; event: ActivityEvent }>();
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
  private persist(event: ActivityEvent) {
    Promise.resolve()
      .then(() => this.store.put(event))
      .catch(() => {
        this.unsaved = true;
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
      this.changed(event.id);
      this.persist(event);
      return event;
    } catch {
      return null;
    }
  }
  /** Complete or extend an event in place. It keeps its ID, time, and position. */
  update(event: ActivityEvent, change: { category?: string; title?: string; data?: unknown }) {
    try {
      if (change.category) event.category = change.category;
      if (change.title) event.title = change.title;
      if (change.data !== undefined) event.data = safeData(change.data);
      this.changed(event.id);
      this.persist(event);
    } catch {
      /* Activity failures must never change an outcome. */
    }
  }
  signedData(xdr: string) {
    try {
      return this.decodeSigned(xdr);
    } catch {
      return { decoding_error: 'The demo could not decode the returned transaction.' };
    }
  }
  /** Record a changed journal state. `label` names the action, for example "Write a note". */
  transaction(record: TransactionRecord | null | undefined, label?: string) {
    if (!record) {
      this.transactionState = null;
      return;
    }
    // A verification result has its own event. It does not repeat the confirmed state.
    const {
      verification: _verified,
      verification_error: _failed,
      ...result
    } = fields(safeData(record.result));
    const state = `${record.hash}:${record.state}:${JSON.stringify(result)}`;
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
    // A contract call with an authorization entry has two signatures. Name the one that changed.
    const authorization = !!record.contract?.authorizations.length;
    const title =
      authorization && record.state === 'waiting' && !record.contract!.authorizationReady
        ? 'Authorization signature requested'
        : authorization && record.state === 'review' && record.contract!.authorizationReady
          ? 'Authorization signed and verified'
          : titles[record.state] || 'Transaction updated';
    this.record('transaction', label ? `${label} · ${title}` : title, {
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
        source = [HORIZON, FRIENDBOT, RPC].includes(url.origin)
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
      const rpcMethod =
        url.origin === RPC && typeof fields(body).method === 'string'
          ? (fields(body).method as string)
          : undefined;
      const labels: Record<string, string> = {
        '/v1/connect': 'Connect website',
        '/v1/signers': 'List wallets',
        '/v1/select': 'Select wallet',
        '/v1/account': 'Read active wallet',
        '/v1/disconnect': 'Disconnect website',
        '/v1/requests': 'Request signature',
      };
      const name =
        source === 'walleterm'
          ? labels[route] || (route.endsWith('/cancel') ? 'Cancel signing request' : 'Signing update')
          : url.origin === FRIENDBOT
            ? 'Fund testnet account'
            : rpcMethod
              ? rpcNames[rpcMethod] || `RPC ${rpcMethod}`
              : route === '/transactions'
                ? 'Submit transaction'
                : route.startsWith('/transactions/')
                  ? 'Check transaction'
                  : /^\/accounts\/[^/]+\/offers$/.test(route)
                    ? 'Read open offers'
                    : route.startsWith('/accounts/')
                      ? 'Read testnet account'
                      : 'Read testnet data';
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
      // A read repeats safely. A write gets its event when it starts, so a reload keeps evidence of it.
      const read = rpcMethod ? rpcReads.has(rpcMethod) : method === 'GET' && url.origin !== FRIENDBOT;
      const readKey = rpcMethod
        ? `${rpcMethod}:${JSON.stringify(fields(body).params ?? null)}`
        : `${method}:${url.href}`;
      const started = performance.now();
      const sent = read ? null : this.record(source, `${name} · sent`, request);
      const finish = (category: string, title: string, data: Record<string, unknown>) => {
        // A failed read ends its group, so a later success is a new event.
        if (category === 'error') this.reads.delete(readKey);
        return sent ? this.update(sent, { category, title, data }) : this.record(category, title, data);
      };
      try {
        const response = await fetcher(input, options);
        // Observe a clone without delaying delivery, consuming the original body, or changing cancellation.
        try {
          response
            .clone()
            .json()
            .then((result) => {
              const data = safeData(result);
              const lookup =
                url!.origin === HORIZON &&
                method === 'GET' &&
                /^\/(accounts|transactions)\/[^/]+$/.test(route);
              const { error, label } = outcome(response.ok, response.status, data, rpcMethod, lookup);
              const signed =
                source === 'walleterm' && typeof fields(data).signed_xdr === 'string'
                  ? this.signedData(fields(data).signed_xdr as string)
                  : {};
              const entry = {
                ...request,
                status: response.status,
                duration_ms: Math.round(performance.now() - started),
                response: data,
                ...signed,
              };
              const category = error ? 'error' : source!,
                title = `${name} · ${label}`;
              if (!read || error) return finish(category, title, entry);
              const { id: _id, ...response_ } = fields(data);
              const fingerprint = JSON.stringify([
                response.status,
                rpcMethod
                  ? Object.fromEntries(
                      Object.entries(fields(response_.result)).filter(([key]) => !ledgerPosition.has(key)),
                    )
                  : data,
              ]);
              const previous = this.reads.get(readKey);
              if (previous?.fingerprint === fingerprint && this.events.includes(previous.event)) {
                const earlier = fields(previous.event.data);
                return this.update(previous.event, {
                  data: {
                    ...earlier,
                    repeats: (typeof earlier.repeats === 'number' ? earlier.repeats : 1) + 1,
                    last_time: new Date().toISOString(),
                  },
                });
              }
              const event = this.record(category, title, entry);
              if (event) this.reads.set(readKey, { fingerprint, event });
            })
            .catch(() =>
              finish('error', `${name} · unreadable response`, {
                ...request,
                status: response.status,
                duration_ms: Math.round(performance.now() - started),
              }),
            );
        } catch {
          /* A response without a clone still belongs to the caller. */
        }
        return response;
      } catch (errorValue) {
        const error = requestError(errorValue);
        finish('error', `${name} · stopped`, {
          ...request,
          duration_ms: Math.round(performance.now() - started),
          error: safeData(error),
        });
        throw error;
      }
    };
  }
}

const categories: Record<string, string> = {
  action: 'Action',
  walkthrough: 'Walkthrough',
  transaction: 'Transaction',
  walleterm: 'Walleterm',
  network: 'Testnet',
  status: 'Status',
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
      button.textContent = 'Copied ✓';
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch {
      $('notice').textContent = 'Copy failed. Expand the JSON to select and copy the value.';
    } finally {
      button.textContent = title;
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
  const clock = (time: string) =>
    new Date(time).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
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
    const repeats = fields(event.data).repeats;
    if (typeof repeats === 'number') {
      const count = document.createElement('span');
      count.className = 'activity-repeats';
      count.textContent = ` ×${repeats}`;
      count.title = `Repeated ${repeats} times with the same result. Last at ${clock(String(fields(event.data).last_time))}.`;
      title.append(count);
    }
    const time = document.createElement('time');
    time.dateTime = event.time;
    time.textContent = clock(event.time);
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
  const history = new ActivityHistory({
    decodeSigned,
    changed: (id) => {
      // A changed event gets a new row. An open row stays open.
      const open = !!id && (rows.get(id) as HTMLDetailsElement | undefined)?.open === true;
      if (id) rows.delete(id);
      render();
      if (open) rows.get(id!)?.setAttribute('open', '');
    },
  });
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
  // Camera scans leave no request of their own. Other controls are recorded by the request or state they change.
  const scans: Record<string, string> = { scan: 'Camera scan started', 'stop-scan': 'Camera scan stopped' };
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target || element.contains(target) || target.disabled) return;
      const title = scans[target.dataset.wt || ''];
      if (title) history.record('action', title);
    },
    true,
  );
  history.record('action', 'Demo opened');
  render();
  return history;
}
