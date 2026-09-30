import { onTestFinished, spyOn, test } from 'bun:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { browserScript } from './support.ts';
import { scanConnection } from '../../sdk/scan.ts';
import { Networks } from '@stellar/stellar-sdk';
import type { Walleterm, WalletermClient } from '../../sdk/walleterm.ts';

// The connection UI reads and writes only these node members.
interface MockNode {
  hidden: boolean;
  value: string;
  disabled?: boolean;
  textContent?: string;
  srcObject?: MediaProvider | null;
  onclick?: () => unknown;
  classList: { add(): void; remove(): void; toggle(): void };
  addEventListener(): void;
  removeEventListener(): void;
  setAttribute(): void;
  removeAttribute(): void;
  querySelector(): void;
  replaceChildren(): void;
  focus(): void;
}
interface MockSigner {
  public_key: string;
}
interface MockAccount {
  address: string;
}
interface Change {
  wallet: unknown;
  account: MockAccount | null;
}
type ScanMock = (video: unknown, options: { signal: AbortSignal }) => unknown;
// The members of the VM WalletermConnect instance that these tests drive.
interface ConnectUI {
  wallet: Walleterm;
  header: boolean;
  requestAccess(): Promise<string>;
  walletChanged(): void;
  unsubscribe: () => void;
  destroy(): void;
  destroyed: boolean;
  scanning: AbortController | null;
  connection: AbortController | null;
  restoreSession(): Promise<void>;
  checkHealth(): Promise<void>;
  state: string;
  onStateChange: (state: string) => void;
  open(): void;
  close(): void;
  toggleMenu(): void;
  scan(): Promise<void>;
  update(): void;
  setBusy(busy: boolean): void;
  setWorking(working: boolean): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  changeWallet(key: MockSigner): Promise<void>;
  chooseWallet(client: object, keys: MockSigner[], signal: AbortSignal): Promise<string>;
  rows: (target: unknown, keys: MockSigner[], choose: (key: MockSigner) => void) => void;
  onBusyChange: (busy: boolean) => void;
  client: unknown;
  account: MockAccount | null;
  wallets: MockSigner[];
  working: boolean;
  phase: string;
  selectingKey: string | null;
  refreshing: boolean;
  dialog: { open: boolean };
}
function fixture(scanConnection: ScanMock, WalletermClient?: unknown) {
  let focused: string | undefined;
  const nodes = new Map<string, MockNode>();
  const node = (name: string) => {
    let value = nodes.get(name);
    if (!value) {
      value = {
        hidden: false,
        value: '',
        classList: { add() {}, remove() {}, toggle() {} },
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        removeAttribute() {},
        querySelector() {},
        replaceChildren() {},
        focus() {
          // A browser does not focus a disabled control.
          if (!this.disabled) focused = name;
        },
      };
      nodes.set(name, value);
    }
    return value;
  };
  const events = new EventTarget();
  const context = vm.createContext({
    scanConnection,
    mockClient: WalletermClient,
    Networks,
    AbortController,
    AbortSignal,
    URL,
    clearInterval,
    queueMicrotask,
    document: events,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  // Errors must come from the page realm, as in the browser.
  vm.runInContext(browserScript(new URL('../../sdk/errors.ts', import.meta.url)), context);
  vm.runInContext(browserScript(new URL('../../sdk/walleterm.ts', import.meta.url)), context);
  // A mock replaces the session class for the component and the shared wallet.
  if (WalletermClient) vm.runInContext('WalletermClient = mockClient', context);
  vm.runInContext(browserScript(new URL('../../sdk/connect.ts', import.meta.url)), context);
  const ui: ConnectUI = vm.runInContext('Object.create(WalletermConnect.prototype)', context);
  const wallet: Walleterm = vm.runInContext("new Walleterm({ walletScope: 'available' })", context);
  Object.assign(ui, {
    wallet,
    header: true,
    access: null,
    destroyed: false,
    scanning: null,
    connection: null,
    client: null,
    account: null,
    wallets: [],
    onChange() {},
    onBusyChange() {},
    wake() {},
    outside() {},
    keyboard() {},
    $: node,
    element: { querySelector: node, querySelectorAll: () => [] },
    trigger: node('trigger'),
    dialog: {
      open: false,
      showModal() {
        this.open = true;
        node('close').focus();
      },
      close() {
        this.open = false;
      },
    },
  });
  wallet.ui = ui;
  ui.unsubscribe = wallet.onChange(() => ui.walletChanged());
  const click = (name: string) => {
    const handler = node(name).onclick;
    assert.ok(handler, `Node ${name} has no click handler.`);
    return handler;
  };
  const view = () => ({
    focused,
    nodes: [...nodes].map(([name, value]) => ({
      name,
      hidden: value.hidden,
      value: value.value,
      disabled: value.disabled,
      textContent: value.textContent,
    })),
  });
  return { ui, node, click, context, view, focused: () => focused };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

function observe(f: ReturnType<typeof fixture>) {
  const callbacks: unknown[] = [],
    writes: unknown[] = [];
  Object.assign(f.ui, {
    onChange: (value: Change) => callbacks.push(['connection', value]),
    onStateChange: (value: string) => callbacks.push(['state', value]),
    onBusyChange: (value: boolean) => callbacks.push(['busy', value]),
  });
  Object.assign(f.context, {
    localStorage: {
      setItem: (key: string, value: string) => writes.push(['set', key, value]),
      removeItem: (key: string) => writes.push(['remove', key]),
    },
  });
  return { callbacks, writes };
}

function savedConnection() {
  const f = fixture(() => {});
  const storage = new Map<string, string>();
  const key = 'walleterm:session';
  const token = 's'.repeat(43);
  storage.set(key, JSON.stringify({ version: 3, url: 'https://bridge.example', token }));
  Object.assign(f.context, {
    localStorage: {
      getItem: (name: string) => storage.get(name) ?? null,
      setItem: (name: string, value: string) => storage.set(name, value),
      removeItem: (name: string) => storage.delete(name),
    },
  });
  return { ...f, storage, key, token };
}
const recoveredAccount = {
  address: 'GRECOVERED',
  network: 'TESTNET',
  network_passphrase: Networks.TESTNET,
  selection_revision: 7,
  wallet_scope: 'available',
};

test('reload checks the saved session before publishing the wallet and uses the live selection revision', async () => {
  const f = savedConnection();
  const response = Promise.withResolvers<Response>();
  const requests: string[] = [];
  const changes: Change[] = [];
  Object.assign(f.context, {
    fetch: (url: string, options: RequestInit) => {
      requests.push(url);
      assert.equal(options.method, 'GET');
      assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${f.token}`);
      return response.promise;
    },
  });
  Object.assign(f.ui, { onChange: (value: Change) => changes.push(value) });
  const restoring = f.ui.restoreSession();
  assert.equal(f.ui.working, true);
  assert.equal(f.ui.account ?? null, null);
  assert.equal(changes.length, 0);
  response.resolve(Response.json(recoveredAccount));
  await restoring;
  assert.equal(f.ui.state, 'connected');
  assert.equal(f.ui.account?.address, 'GRECOVERED');
  assert.equal(f.ui.working, false);
  assert.equal(Reflect.get(f.ui.client as object, 'revision'), 7);
  assert.equal(Reflect.get(f.ui.client as object, 'walletScope'), 'available');
  assert.equal(changes.length, 1);
  assert.deepEqual(requests, ['https://bridge.example/v1/account']);
  assert.equal(f.node('url').value, 'https://bridge.example');
  assert.equal(f.node('code').value, '');
  // The confirmed revision tells other tabs about a later wallet change. Nothing else joins the credentials.
  assert.deepEqual(JSON.parse(f.storage.get(f.key)!), {
    version: 3,
    url: 'https://bridge.example',
    token: f.token,
    revision: 7,
  });
});

test('reload keeps an offline session and recovers it on the next health check without replaying requests', async () => {
  const f = savedConnection();
  let online = false;
  const requests: string[] = [];
  Object.assign(f.context, {
    fetch: async (url: string) => {
      requests.push(url);
      if (!online) throw Error('Offline');
      return Response.json(recoveredAccount);
    },
  });
  await f.ui.restoreSession();
  assert.equal(f.ui.state, 'unreachable');
  assert.equal(f.ui.account ?? null, null);
  assert.ok(f.storage.has(f.key));
  assert.equal(f.ui.working, false);
  f.node('menu').hidden = true;
  f.ui.toggleMenu();
  assert.equal(f.node('reconnect').hidden, false);
  assert.equal(f.node('disconnect').disabled, false);
  online = true;
  await f.ui.checkHealth();
  assert.equal(f.ui.state, 'connected');
  assert.equal(f.ui.account?.address, 'GRECOVERED');
  assert.deepEqual(requests, Array(2).fill('https://bridge.example/v1/account'));
});

test('reload removes a revoked or expired session and does not exchange the old connection code', async () => {
  const f = savedConnection();
  const requests: string[] = [];
  Object.assign(f.context, {
    fetch: async (url: string) => {
      requests.push(url);
      return Response.json({ error: { message: 'Expired' } }, { status: 401 });
    },
  });
  await f.ui.restoreSession();
  assert.equal(f.ui.state, 'expired');
  assert.equal(f.ui.client, null);
  assert.equal(f.ui.account, null);
  assert.equal(f.storage.has(f.key), false);
  assert.deepEqual(requests, ['https://bridge.example/v1/account']);
});

test('invalid saved details never send credentials, and unavailable storage does not break the UI', async () => {
  const token = 's'.repeat(43);
  for (const saved of [
    '{',
    'null',
    JSON.stringify({ version: 2, url: 'https://bridge.example', token }),
    JSON.stringify({ version: 3, url: 'https://bridge.example', token: 'invalid' }),
    JSON.stringify({ version: 3, url: 'https://bridge.example/path', token }),
    JSON.stringify({ version: 3, url: 'http://bridge.example', token }),
  ]) {
    const f = savedConnection();
    let calls = 0;
    Object.assign(f.context, { fetch: () => calls++ });
    f.storage.set(f.key, saved);
    await f.ui.restoreSession();
    assert.equal(f.storage.has(f.key), false, saved);
    assert.equal(f.ui.client ?? null, null);
    assert.equal(calls, 0);
  }
  const f = savedConnection();
  let calls = 0;
  Object.assign(f.context, {
    fetch: () => calls++,
    localStorage: {
      getItem() {
        throw Error('Storage disabled');
      },
      removeItem() {
        throw Error('Storage disabled');
      },
      setItem() {
        throw Error('Storage disabled');
      },
    },
  });
  await f.ui.restoreSession();
  assert.equal(calls, 0);
  assert.equal(f.ui.working ?? false, false);
});

test('explicit disconnect clears saved credentials even when remote revocation fails', async () => {
  const f = savedConnection();
  Object.assign(f.context, {
    fetch: async () => {
      throw Error('Offline');
    },
  });
  await f.ui.restoreSession();
  await f.ui.disconnect();
  assert.equal(f.storage.has(f.key), false);
  assert.equal(f.ui.client, null);
  assert.equal(f.ui.account, null);
  assert.match(f.node('health').textContent ?? '', /did not confirm session revocation/);
});

test('health checks retain credentials through a network failure and recover the connection', async () => {
  const f = fixture(() => {});
  const states: string[] = [];
  let online = false,
    calls = 0;
  const client = {
    token: 'session',
    generation: 1,
    url: 'https://bridge.example',
    async getAccount() {
      calls++;
      if (!online) throw Error('Offline');
      return { address: 'GORIGINAL', networkPassphrase: 'testnet' };
    },
  };
  Object.assign(f.ui, {
    client,
    account: { address: 'GORIGINAL' },
    wallets: [],
    onStateChange: (state: string) => states.push(state),
  });
  await f.ui.checkHealth();
  assert.equal(f.ui.state, 'unreachable');
  assert.equal(client.token, 'session');
  assert.equal(f.node('reconnect').hidden, false);
  online = true;
  await f.ui.checkHealth();
  assert.equal(calls, 2);
  assert.deepEqual(states, ['unreachable', 'connected']);
  assert.equal(f.node('health').hidden, true);
});

test('an expired session removes the account and requires a new code', async () => {
  const f = fixture(() => {});
  const expired = vm.runInContext("Object.assign(Error('Expired'), {status:401})", f.context);
  const client = {
    token: 'session',
    generation: 1,
    url: 'https://bridge.example',
    async getAccount() {
      this.token = '';
      throw expired;
    },
  };
  let changes = 0;
  Object.assign(f.ui, { client, account: { address: 'GORIGINAL' }, wallets: [], onChange: () => changes++ });
  await f.ui.checkHealth();
  assert.equal(f.ui.state, 'expired');
  assert.equal(f.ui.client, null);
  assert.equal(f.ui.account, null);
  assert.equal(changes, 1);
  assert.match(f.node('health').textContent ?? '', /session expired/);
});

test('health checks do not overlap or overwrite a newer connection', async () => {
  const f = fixture(() => {});
  const response = Promise.withResolvers<{ address: string }>();
  let calls = 0;
  const client = {
    generation: 1,
    getAccount: () => {
      calls++;
      return response.promise;
    },
  };
  Object.assign(f.ui, { client, account: { address: 'GORIGINAL' }, state: 'connected' });
  const pending = f.ui.checkHealth();
  await f.ui.checkHealth();
  f.ui.client = { generation: 2 };
  f.ui.account = { address: 'GNEW' };
  response.resolve({ address: 'GOLD' });
  await pending;
  assert.equal(calls, 1);
  assert.equal(f.ui.account.address, 'GNEW');
  assert.equal(f.ui.state, 'connected');
});

test('manual replacement connects to a new tunnel when the previous tunnel cannot revoke its session', async () => {
  class Replacement {
    token = 'new-session';
    url = 'https://new.example';
    account: MockAccount | null = null;
    async connect() {
      this.account = { address: 'GNEW' };
      return { address: 'GNEW', networkPassphrase: 'testnet' };
    }
    async disconnect() {}
  }
  const f = fixture(() => {}, Replacement);
  let forgotten = 0;
  const previous = {
    token: 'old-session',
    url: 'https://old.example',
    async disconnect() {
      throw Error('The old tunnel is unavailable.');
    },
    forgetConnection() {
      forgotten++;
      this.token = '';
    },
  };
  Object.assign(f.ui, {
    client: previous,
    account: { address: 'GOLD' },
    state: 'unreachable',
    wallets: [],
    onChange() {},
    onBusyChange() {},
  });
  Object.assign(f.ui.wallet, { client: previous });
  f.node('url').value = 'https://new.example';
  f.node('code').value = '12345678';
  await f.ui.connect();
  assert.equal(f.ui.account?.address, 'GNEW');
  assert.equal(f.ui.state, 'connected');
  assert.equal(f.ui.wallet.client, f.ui.client);
  assert.equal(forgotten, 1);
  assert.match(f.node('health').textContent ?? '', /did not confirm disconnection/);
});

test('manual disconnection discards an unreachable session locally and reports unconfirmed revocation', async () => {
  const f = fixture(() => {});
  const previous = {
    token: 'session',
    url: 'https://bridge.example',
    async disconnect() {
      throw Error('Offline');
    },
    forgetConnection() {
      this.token = '';
    },
  };
  Object.assign(f.ui, {
    client: previous,
    account: { address: 'GOLD' },
    wallets: [],
    onChange() {},
    onBusyChange() {},
  });
  Object.assign(f.ui.wallet, { client: previous });
  await f.ui.disconnect();
  assert.equal(f.ui.client, null);
  assert.equal(f.ui.account, null);
  assert.match(f.node('health').textContent ?? '', /did not confirm session revocation/);
});

test('opening the connection dialog focuses Scan and leaves camera access to an explicit action', () => {
  let calls = 0;
  const f = fixture(() => {
    calls++;
    return new Promise(() => {});
  });
  f.ui.open();
  assert.equal(calls, 0);
  assert.equal(f.node('form').hidden, false);
  assert.equal(f.node('scanner').hidden, true);
  assert.equal(f.focused(), 'scan');
  f.ui.scan();
  assert.equal(calls, 1);
  assert.equal(f.node('form').hidden, true);
  assert.equal(f.node('scanner').hidden, false);
  assert.equal(f.focused(), 'stop-scan');
});

test('camera denial keeps manual entry available without input focus', async () => {
  let failure: unknown;
  const f = fixture(async () => {
    throw failure;
  });
  failure = vm.runInContext("Error('Permission denied')", f.context);
  f.ui.open();
  await f.ui.scan();
  assert.equal(f.node('form').hidden, false);
  assert.equal(f.focused(), 'scan');
  assert.equal(f.node('status').textContent, 'Permission denied. Enter the connection details instead.');
});

test('a blocked camera gets a plain message', async () => {
  let failure: unknown;
  const f = fixture(async () => {
    throw failure;
  });
  failure = vm.runInContext(
    "Object.assign(Error('Permission denied'), { name: 'NotAllowedError' })",
    f.context,
  );
  f.ui.open();
  await f.ui.scan();
  assert.equal(
    f.node('status').textContent,
    'The browser blocked the camera. Enter the connection details instead.',
  );
});

test('a successful scan fills the details and focuses Continue', async () => {
  const f = fixture(async () => ({ url: 'https://bridge.example', code: '00123456' }));
  f.ui.open();
  await f.ui.scan();
  assert.equal(f.node('url').value, 'https://bridge.example');
  assert.equal(f.node('code').value, '00123456');
  assert.equal(f.focused(), 'continue');
});

test('an old canceled scan cannot hide the camera after immediate reopening', async () => {
  const requests: AbortSignal[] = [];
  const f = fixture(
    (_video, { signal }) =>
      new Promise((_resolve, reject) => {
        requests.push(signal);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
  f.ui.open();
  f.ui.scan();
  f.ui.close();
  f.ui.open();
  f.ui.scan();
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].aborted, true);
  assert.equal(requests[1].aborted, false);
  assert.equal(f.node('scanner').hidden, false);
  f.ui.close();
  await settle();
  assert.equal(requests[1].aborted, true);
});

test('changing a wallet uses the current client and does not open the scanner', async () => {
  let scans = 0,
    refreshes = 0,
    selected: string | undefined,
    changed: Change | undefined;
  const f = fixture(() => {
    scans++;
  });
  const client = {
    token: 'session',
    selectWallet: async (address: string) => {
      selected = address;
      return { address };
    },
  };
  Object.assign(f.ui, {
    client,
    account: { address: 'GFIRST' },
    update() {},
    refresh: async () => {
      refreshes++;
    },
    onChange: (value: Change) => {
      changed = value;
    },
  });
  await f.ui.changeWallet({ public_key: 'GSECOND' });
  assert.equal(selected, 'GSECOND');
  assert.equal(scans, 0);
  assert.equal(refreshes, 0);
  assert.equal(f.ui.dialog.open, false);
  assert.equal(f.ui.client, client);
  assert.equal(changed?.wallet, f.ui.wallet);
  assert.equal(changed?.account?.address, 'GSECOND');
});

test('opening the wallet menu renders known wallets without another lookup', () => {
  const f = fixture(() => {});
  const wallets = [{ public_key: 'GFIRST' }, { public_key: 'GSECOND' }];
  let refreshes = 0,
    shown: MockSigner[] = [];
  Object.assign(f.ui, {
    account: { address: 'GFIRST' },
    wallets,
    update() {},
    rows: (_target: unknown, keys: MockSigner[]) => {
      shown = keys;
    },
    refresh: async () => {
      refreshes++;
    },
  });
  f.node('menu').hidden = true;
  f.ui.toggleMenu();
  assert.equal(refreshes, 0);
  assert.equal(shown, wallets);
  assert.equal(f.node('menu').hidden, false);
});

test('opening the wallet menu after a reload loads the wallet list once', async () => {
  const f = savedConnection();
  const requests: string[] = [];
  const wallets = [
    { public_key: 'GRECOVERED', comment: 'First' },
    { public_key: 'GSECOND', comment: 'Second' },
  ];
  Object.assign(f.context, {
    fetch: async (url: string) => {
      requests.push(new URL(url).pathname);
      return Response.json(
        url.endsWith('/v1/signers') ? { signers: wallets, grant_id: 'grant' } : recoveredAccount,
      );
    },
  });
  let shown: MockSigner[] = [];
  Object.assign(f.ui, {
    rows: (_target: unknown, keys: MockSigner[]) => {
      shown = keys;
    },
  });
  await f.ui.restoreSession();
  assert.equal(f.ui.account?.address, 'GRECOVERED');
  assert.equal(f.ui.wallets.length, 0);
  f.node('menu').hidden = true;
  f.ui.toggleMenu();
  for (let i = 0; i < 50 && !shown.length; i++) await settle();
  assert.deepEqual(requests, ['/v1/account', '/v1/signers']);
  assert.deepEqual(
    shown.map((key) => key.public_key),
    ['GRECOVERED', 'GSECOND'],
  );
  assert.equal(f.node('wallet-name').textContent, 'First');
  // The badge names the network from the account reply.
  assert.equal(f.node('network').textContent, 'Testnet');
  assert.equal(f.node('network').hidden, false);
  assert.equal(f.ui.refreshing, false);
  f.ui.toggleMenu();
  f.ui.toggleMenu();
  await settle();
  assert.deepEqual(requests, ['/v1/account', '/v1/signers']);
});

test('a failed automatic wallet lookup runs once, and Refresh retries it', async () => {
  const f = savedConnection();
  const requests: string[] = [];
  let available = false;
  Object.assign(f.context, {
    fetch: async (url: string) => {
      requests.push(new URL(url).pathname);
      if (!url.endsWith('/v1/signers')) return Response.json(recoveredAccount);
      return available
        ? Response.json({ signers: [{ public_key: 'GRECOVERED', comment: 'First' }], grant_id: 'grant' })
        : Response.json({ error: { message: '1Password did not answer.' } }, { status: 503 });
    },
  });
  let shown: MockSigner[] = [];
  Object.assign(f.ui, {
    rows: (_target: unknown, keys: MockSigner[]) => {
      shown = keys;
    },
  });
  await f.ui.restoreSession();
  f.node('menu').hidden = true;
  f.ui.toggleMenu();
  assert.equal(f.ui.refreshing, true);
  for (let i = 0; i < 50 && f.ui.refreshing; i++) await settle();
  assert.equal(f.ui.refreshing, false);
  assert.equal(f.node('menu-status').textContent, '1Password did not answer.');
  assert.equal(f.ui.account?.address, 'GRECOVERED');
  f.ui.toggleMenu();
  f.ui.toggleMenu();
  await settle();
  assert.equal(f.node('menu').hidden, false);
  assert.equal(f.ui.refreshing, false);
  assert.deepEqual(requests, ['/v1/account', '/v1/signers']);
  available = true;
  await f.ui.refresh();
  assert.deepEqual(requests, ['/v1/account', '/v1/signers', '/v1/signers']);
  assert.deepEqual(
    shown.map((key) => key.public_key),
    ['GRECOVERED'],
  );
});

for (const lock of ['setBusy', 'setWorking'] as const) {
  test(`a wallet menu opened during ${lock}(true) keeps the automatic lookup for the next opening`, async () => {
    const f = savedConnection();
    const requests: string[] = [];
    Object.assign(f.context, {
      fetch: async (url: string) => {
        requests.push(new URL(url).pathname);
        return Response.json(
          url.endsWith('/v1/signers')
            ? { signers: [{ public_key: 'GRECOVERED', comment: 'First' }], grant_id: 'grant' }
            : recoveredAccount,
        );
      },
    });
    let shown: MockSigner[] = [];
    Object.assign(f.ui, {
      rows: (_target: unknown, keys: MockSigner[]) => {
        shown = keys;
      },
    });
    await f.ui.restoreSession();
    f.node('menu').hidden = true;
    f.ui[lock](true);
    f.ui.toggleMenu();
    await settle();
    assert.equal(f.node('menu').hidden, false);
    assert.deepEqual(requests, ['/v1/account']);
    f.ui.toggleMenu();
    f.ui[lock](false);
    f.ui.toggleMenu();
    for (let i = 0; i < 50 && !shown.length; i++) await settle();
    assert.deepEqual(requests, ['/v1/account', '/v1/signers']);
    assert.deepEqual(
      shown.map((key) => key.public_key),
      ['GRECOVERED'],
    );
  });
}

test('the connection UI publishes the recovered account after a lost selection response', async () => {
  const f = fixture(() => {});
  let changed: Change | undefined;
  const client = {
    token: 'session',
    account: { address: 'GRECOVERED' },
    selectWallet: async () => {
      throw Error('Response lost');
    },
  };
  Object.assign(f.ui, {
    client,
    account: { address: 'GFIRST' },
    update() {},
    refresh: async () => {},
    onChange: (value: Change) => {
      changed = value;
    },
  });
  await f.ui.changeWallet({ public_key: 'GSECOND' });
  assert.equal(changed?.account?.address, 'GRECOVERED');
  assert.equal(f.ui.account?.address, 'GRECOVERED');
  assert.match(f.node('menu-status').textContent ?? '', /Response lost/);
});

test('Continue requires the exact tunnel URL and exactly eight digits', async () => {
  let connects = 0;
  const f = fixture(
    () => {},
    class {
      constructor() {
        connects++;
      }
    },
  );
  for (const [url, code, valid] of [
    ['', '', false],
    ['https://bridge.example', '', false],
    ['https://bridge.example', '123', false],
    ['https://bridge.example/path', '12345678', false],
    ['http://bridge.example', '12345678', false],
    ['https://user:password@bridge.example', '12345678', false],
    ['https://bridge.example?code=1', '12345678', false],
    ['https://bridge.example/', '00123456', true],
    ['http://127.0.0.1:8787', '12345678', true],
    ['https://bridge.example', '12345678 ', false],
  ] as const) {
    f.node('url').value = url;
    f.node('code').value = code;
    f.ui.update();
    assert.equal(f.node('continue').disabled, !valid, `${url} ${code}`);
    if (!valid) await f.ui.connect();
  }
  assert.equal(connects, 0);
});

test('the details help says where the values come from and names only a wrong URL', () => {
  const f = fixture(() => {});
  const source =
    'The walleterm tunnel command prints the Tunnel URL and the Connection code. The code works once and expires after 5 minutes.';
  const wrong =
    'Use the Tunnel URL exactly as walleterm tunnel prints it. It starts with https:// and has no path.';
  for (const [url, code, help] of [
    ['', '', source],
    ['https://bridge.example/', '123', source],
    ['https://bridge.example', '12345678', source],
    ['https://bridge.example/path', '12345678', wrong],
    ['http://bridge.example', '', wrong],
    ['bridge.example', '', wrong],
  ] as const) {
    f.node('url').value = url;
    f.node('code').value = code;
    f.ui.update();
    // Continue shows valid details. The help never claims readiness, so it cannot contradict an error.
    assert.equal(f.node('details-help').textContent, help, url);
  }
});

test('a failed connection shows its error without a ready hint, and a changed detail clears it', async () => {
  const f = fixture(
    () => {},
    class {
      async connect() {
        throw vm.runInContext("Error('The connection code is incorrect.')", f.context);
      }
      async disconnect() {}
    },
  );
  const wallet: Walleterm = vm.runInContext("new Walleterm({ walletScope: 'available' })", f.context);
  const { ui } = constructed(f, { wallet, header: false });
  ui.open();
  f.node('url').value = 'https://bridge.example';
  f.node('code').value = '12345678';
  ui.update();
  await ui.connect();
  assert.equal(f.node('status').textContent, 'The connection code is incorrect.');
  assert.doesNotMatch(f.node('details-help').textContent ?? '', /ready/i);
  assert.equal(f.focused(), 'code');
  f.node('code').value = '8765';
  Reflect.get(f.node('code'), 'oninput')();
  assert.equal(f.node('status').textContent, '');
  assert.equal(f.node('continue').disabled, true);
  ui.destroy();
});

test('a connection disables its inputs and prevents duplicate requests until failure settles', async () => {
  let reject: ((error: Error) => void) | undefined,
    calls = 0;
  const busy: boolean[] = [];
  const f = fixture(
    () => {},
    class {
      async connect() {
        calls++;
        await new Promise((_resolve, failed) => {
          reject = failed;
        });
      }
      async disconnect() {}
    },
  );
  f.ui.onBusyChange = (value) => {
    busy.push(value);
  };
  f.node('url').value = 'https://bridge.example';
  f.node('code').value = '12345678';
  const pending = f.ui.connect();
  assert.equal(f.node('continue').disabled, true);
  assert.equal(f.node('url').disabled, true);
  assert.equal(f.node('scan').disabled, true);
  assert.equal(f.ui.working, true);
  await f.ui.connect();
  assert.equal(calls, 1);
  assert.ok(reject);
  reject(Error('Connection failed'));
  await pending;
  assert.equal(f.ui.working, false);
  assert.equal(f.node('url').disabled, false);
  assert.equal(f.node('continue').disabled, false);
  assert.deepEqual(busy, [true, false]);
});

test('a timed-out connection returns to the connect step with a plain message', async () => {
  const deadlines: AbortController[] = [];
  const timeout = spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const controller = new AbortController();
    deadlines.push(controller);
    return controller.signal;
  });
  onTestFinished(() => timeout.mockRestore());
  const f = fixture(
    () => {},
    class {
      // Like the real client, a failure after pairing reports that the code is spent.
      async connect({ signal }: { signal: AbortSignal }) {
        await new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(Object.assign(signal.reason, { codeUsed: true })), {
            once: true,
          }),
        );
      }
      async disconnect() {}
    },
  );
  f.ui.open();
  f.node('url').value = 'https://bridge.example';
  f.node('code').value = '12345678';
  const pending = f.ui.connect();
  // The wallet picker was open when the connection window closed.
  f.node('form').hidden = true;
  f.node('picker').hidden = false;
  f.node('#wt-title').textContent = 'Choose a wallet';
  assert.equal(deadlines.length, 1);
  deadlines[0].abort();
  await pending;
  assert.equal(
    f.node('status').textContent,
    'The connection timed out after 5 minutes. Use the new code from your tunnel terminal.',
  );
  // The spent code does not stay in the field.
  assert.equal(f.node('code').value, '');
  assert.equal(f.node('#wt-title').textContent, 'Connect Walleterm');
  assert.equal(f.node('form').hidden, false);
  assert.equal(f.node('picker').hidden, true);
  assert.equal(f.focused(), 'code');
});

test('wallet selection locks immediately and accepts only the first click', async () => {
  const f = fixture(() => {});
  let choose: ((key: MockSigner) => void) | undefined;
  f.ui.rows = (_target, _keys, callback) => {
    choose = callback;
  };
  const controller = new AbortController();
  const pending = f.ui.chooseWallet(
    {},
    [{ public_key: 'GFIRST' }, { public_key: 'GSECOND' }],
    controller.signal,
  );
  assert.equal(f.ui.phase, 'choosing');
  assert.ok(choose);
  choose({ public_key: 'GFIRST' });
  choose({ public_key: 'GSECOND' });
  assert.equal(f.ui.phase, 'selecting');
  assert.equal(f.ui.selectingKey, 'GFIRST');
  assert.equal(await pending, 'GFIRST');
});

test('wallet refresh prevents overlapping discovery and blocks selection until it settles', async () => {
  let resolve: ((keys: MockSigner[]) => void) | undefined,
    calls = 0,
    selections = 0;
  const f = fixture(() => {});
  f.ui.client = {
    url: 'https://bridge.example',
    token: 'mock',
    listWallets: async () => {
      calls++;
      return new Promise<MockSigner[]>((done) => {
        resolve = done;
      });
    },
    selectWallet: async () => {
      selections++;
    },
  };
  f.ui.account = { address: 'GFIRST' };
  f.ui.wallets = [];
  f.ui.rows = () => {};
  const pending = f.ui.refresh();
  assert.equal(f.node('refresh').disabled, true);
  await f.ui.refresh();
  await f.ui.changeWallet({ public_key: 'GSECOND' });
  assert.equal(calls, 1);
  assert.equal(selections, 0);
  assert.ok(resolve);
  resolve([]);
  await pending;
  assert.equal(f.node('refresh').disabled, false);
  assert.equal(f.ui.refreshing, false);
});

test('retrying empty wallet discovery locks the retry button and restores it after failure', async () => {
  let reject: ((error: Error) => void) | undefined,
    calls = 0;
  const f = fixture(() => {});
  f.ui.rows = () => {};
  const controller = new AbortController();
  const pending = f.ui.chooseWallet(
    {
      listWallets: async () => {
        calls++;
        return new Promise((_done, failed) => {
          reject = failed;
        });
      },
    },
    [],
    controller.signal,
  );
  const retry = f.click('retry-wallets');
  const attempt = retry();
  await retry();
  assert.equal(calls, 1);
  assert.equal(f.node('retry-wallets').disabled, true);
  assert.ok(reject);
  reject(Error('Discovery failed'));
  await attempt;
  assert.equal(f.node('retry-wallets').disabled, false);
  const stopped = assert.rejects(pending);
  controller.abort();
  await stopped;
});

for (const stage of ['permission', 'video-start']) {
  test(`destroying during camera ${stage} stops the stream without updating the view`, async () => {
    const requested = Promise.withResolvers<void>(),
      grant = Promise.withResolvers<MediaStream>(),
      playing = Promise.withResolvers<void>(),
      events = new EventTarget();
    let stopped = false;
    const stream = {
      getTracks: () => [
        {
          stop() {
            stopped = true;
          },
        },
      ],
    } as MediaStream;
    const globals = {
      isSecureContext: true,
      navigator: {
        mediaDevices: {
          getUserMedia() {
            requested.resolve();
            return grant.promise;
          },
        },
      },
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
    };
    for (const [name, value] of Object.entries(globals)) {
      const original = Object.getOwnPropertyDescriptor(globalThis, name);
      Object.defineProperty(globalThis, name, { value, configurable: true });
      onTestFinished(() => {
        if (original) Object.defineProperty(globalThis, name, original);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
    const f = fixture((video, options) => scanConnection(video as HTMLVideoElement, options));
    const camera = f.node('camera');
    Object.assign(camera, {
      play() {
        playing.resolve();
        return new Promise(() => {});
      },
    });
    f.ui.open();
    const scanning = f.ui.scan();
    await requested.promise;
    if (stage === 'video-start') {
      grant.resolve(stream);
      await playing.promise;
      assert.equal(camera.srcObject, stream);
    }
    const controller = f.ui.scanning;
    assert.ok(controller);
    const view = f.view();
    f.ui.destroy();
    assert.equal(controller.signal.aborted, true);
    assert.equal(f.ui.scanning, null);
    await scanning;
    if (stage === 'permission') {
      assert.equal(stopped, false);
      // Permission can arrive after scan() has settled.
      grant.resolve(stream);
      await settle();
    }
    assert.equal(stopped, true);
    assert.equal(camera.srcObject, null);
    assert.deepEqual(f.view(), view);
    await f.ui.scan();
    assert.deepEqual(f.view(), view);
  });
}

test('a scanner that returns after destruction cannot fill connection details', async () => {
  const result = Promise.withResolvers<{ url: string; code: string }>();
  const f = fixture(() => result.promise);
  f.ui.open();
  const scanning = f.ui.scan();
  const view = f.view();
  f.ui.destroy();
  result.resolve({ url: 'https://late.example', code: '87654321' });
  await scanning;
  assert.deepEqual(f.view(), view);
  assert.equal(f.node('url').value, '');
  assert.equal(f.node('code').value, '');
});

for (const stage of ['discovery', 'wallet-choice', 'selection', 'replacement', 'replacement-failure']) {
  // Destruction stops pairing, even while the previous session is revoked.
  test(`destroying during ${stage} prevents late connection publication`, async () => {
    const f = fixture(() => {}),
      observed = observe(f),
      reached = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const oldToken = 'o'.repeat(43),
      nextToken = 'n'.repeat(43);
    const requests: { path: string; previous: boolean; destroyed: boolean }[] = [];
    let heldSignal: AbortSignal | undefined;
    Object.assign(f.context, {
      fetch: async (url: string, options: RequestInit) => {
        const path = new URL(url).pathname;
        const previous = new Headers(options.headers).get('Authorization') === `Bearer ${oldToken}`;
        requests.push({ path, previous, destroyed: f.ui.destroyed });
        if (
          (stage === 'discovery' && path === '/v1/signers') ||
          (stage === 'selection' && path === '/v1/select') ||
          (stage.startsWith('replacement') && previous && path === '/v1/disconnect')
        ) {
          assert.ok(options.signal);
          heldSignal = options.signal;
          reached.resolve();
          // Return a late response even if cancellation wins.
          await release.promise;
          if (stage === 'replacement-failure') throw Error('The previous tunnel is unavailable.');
        }
        switch (path) {
          case '/v1/connect':
            return Response.json({ token: nextToken, wallet_scope: 'available', selection_revision: 0 });
          case '/v1/signers':
            return Response.json({ signers: [{ public_key: 'GNEW' }], grant_id: 'mock-grant' });
          case '/v1/select':
            return Response.json({
              address: 'GNEW',
              network: 'TESTNET',
              network_passphrase: Networks.TESTNET,
              selection_revision: 1,
            });
          case '/v1/disconnect':
            return Response.json({ disconnected: true });
          case '/v1/account':
            assert.equal(previous, true);
            return Response.json({
              address: 'GOLD',
              network: 'TESTNET',
              network_passphrase: Networks.TESTNET,
              selection_revision: 1,
              wallet_scope: 'available',
            });
          default:
            throw Error(`Unexpected mock request: ${path}`);
        }
      },
    });
    const previous: WalletermClient = vm.runInContext(
      "new WalletermClient('https://bridge.example')",
      f.context,
    );
    previous.token = oldToken;
    const account = { address: 'GOLD', network: 'TESTNET', networkPassphrase: Networks.TESTNET };
    previous.account = account;
    Object.assign(f.ui, { client: previous, account, state: 'connected' });
    Object.assign(f.ui.wallet, { client: previous });
    let choose: ((key: MockSigner) => void) | undefined;
    f.ui.rows = (_target, keys, callback) => {
      choose = callback;
      if (stage === 'wallet-choice') reached.resolve();
      else callback(keys[0]);
    };
    f.node('url').value = 'https://bridge.example';
    f.node('code').value = '12345678';
    const pairing = f.ui.connect();
    await reached.promise;
    const controller = f.ui.connection;
    assert.ok(controller);
    const callbacks = [...observed.callbacks],
      view = f.view();
    f.ui.destroy();
    assert.equal(controller.signal.aborted, true);
    assert.equal(f.ui.connection, null);
    if (stage === 'discovery' || stage === 'selection') assert.equal(heldSignal?.aborted, true);
    if (stage === 'wallet-choice') {
      assert.ok(choose);
      choose({ public_key: 'GNEW' });
    }
    release.resolve();
    await pairing;
    const replaced = stage.startsWith('replacement');
    assert.equal(f.ui.client, previous);
    assert.equal(f.ui.account, account);
    assert.deepEqual(observed.callbacks, callbacks);
    assert.deepEqual(f.view(), view);
    assert.equal(f.ui.working, false);
    const revocations = requests.filter(({ path }) => path === '/v1/disconnect');
    assert.equal(revocations.filter(({ previous }) => previous).length, replaced ? 1 : 0);
    assert.equal(revocations.filter(({ previous }) => !previous).length, 1);
    assert.equal(
      requests.some(({ previous, destroyed }) => previous && destroyed),
      false,
    );
    if (replaced) {
      // The previous revocation had started. The wallet keeps neither session.
      assert.equal(f.ui.wallet.client, null);
      assert.equal(previous.token, null);
      assert.deepEqual(
        observed.writes.map((write) => (write as string[])[0]),
        ['remove'],
      );
    } else {
      assert.equal(f.ui.wallet.client, previous);
      assert.deepEqual(observed.writes, []);
      assert.equal(previous.token, oldToken);
      assert.equal((await previous.getAccount()).address, 'GOLD');
    }
  });
}

test('destroying an established view preserves its shared client and rejects new component work', async () => {
  const f = savedConnection();
  const requests: string[] = [];
  Object.assign(f.context, {
    fetch: async (url: string, options: RequestInit) => {
      requests.push(url);
      assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${f.token}`);
      return Response.json(recoveredAccount);
    },
  });
  await f.ui.restoreSession();
  const client = f.ui.client as WalletermClient;
  const saved = f.storage.get(f.key),
    observed = observe(f),
    view = f.view();
  f.ui.destroy();
  f.ui.destroy();
  f.ui.open();
  f.ui.close();
  f.ui.toggleMenu();
  await f.ui.scan();
  await f.ui.connect();
  await f.ui.refresh();
  await f.ui.changeWallet({ public_key: 'GOTHER' });
  await f.ui.disconnect();
  await f.ui.restoreSession();
  await f.ui.checkHealth();
  assert.equal(requests.length, 1);
  assert.equal(f.ui.client, client);
  assert.equal(client.token, f.token);
  assert.equal(f.storage.get(f.key), saved);
  assert.deepEqual(observed.writes, []);
  assert.deepEqual(observed.callbacks, []);
  assert.deepEqual(f.view(), view);
  assert.equal((await client.getAccount()).address, 'GRECOVERED');
  assert.deepEqual(requests, Array(2).fill('https://bridge.example/v1/account'));
});

test('a busy callback can destroy the component before pairing creates a client', async () => {
  let clients = 0;
  const f = fixture(
    () => {},
    class {
      constructor() {
        clients++;
      }
    },
  );
  const observed = observe(f);
  const busy: boolean[] = [];
  f.ui.onBusyChange = (value) => {
    busy.push(value);
    if (value) f.ui.destroy();
  };
  f.node('url').value = 'https://bridge.example';
  f.node('code').value = '12345678';
  await f.ui.connect();
  assert.equal(clients, 0);
  assert.equal(f.ui.destroyed, true);
  assert.equal(f.ui.connection, null);
  assert.equal(f.ui.client, null);
  assert.deepEqual(busy, [true]);
  assert.deepEqual(observed.callbacks, []);
  assert.deepEqual(observed.writes, []);
});

test('dialog focus restoration can destroy the component before connection publication', async () => {
  let next: Replacement | undefined,
    disconnected = 0;
  class Replacement {
    token: string | null = 'new-session';
    url = 'https://bridge.example';
    account: MockAccount | null = null;
    constructor() {
      next = this;
    }
    async connect() {
      this.account = { address: 'GNEW' };
      return { address: 'GNEW', networkPassphrase: 'testnet' };
    }
    async disconnect() {
      disconnected++;
      this.token = null;
    }
  }
  const f = fixture(() => {}, Replacement),
    observed = observe(f),
    host = new EventTarget(),
    changes: Change[] = [];
  Object.assign(f.ui, { onChange: (value: Change) => changes.push(value) });
  f.ui.open();
  let view: ReturnType<typeof f.view> | undefined,
    callbacks: unknown[] = [],
    writes: unknown[] = [],
    triggerWrites = 0,
    restoredFocus = 0;
  host.addEventListener('focus', () => {
    restoredFocus++;
    f.ui.destroy();
    view = f.view();
    callbacks = [...observed.callbacks];
    writes = [...observed.writes];
  });
  Object.assign(f.ui.dialog, {
    close(this: ConnectUI['dialog']) {
      this.open = false;
      // Native dialog.close() restores host focus synchronously, as verified by the review.
      host.dispatchEvent(new Event('focus'));
    },
  });
  f.node('trigger').setAttribute = () => {
    if (f.ui.destroyed) triggerWrites++;
  };
  f.node('url').value = 'https://bridge.example';
  f.node('code').value = '12345678';
  await f.ui.connect();
  assert.ok(next);
  assert.equal(restoredFocus, 1);
  assert.equal(f.ui.destroyed, true);
  assert.equal(f.ui.dialog.open, false);
  // The wallet adopted the session before the dialog closed. Destroying the view keeps it.
  assert.equal(disconnected, 0);
  assert.equal(next.token, 'new-session');
  assert.equal(f.ui.wallet.client, next);
  assert.equal(triggerWrites, 0);
  assert.deepEqual(f.view(), view);
  assert.deepEqual(observed.callbacks, callbacks);
  assert.deepEqual(observed.writes, writes);
  assert.deepEqual(changes, []);
  assert.equal(f.ui.connection, null);
  assert.equal(f.ui.working, false);
});

for (const callback of ['state', 'connection']) {
  test(`destruction from the ${callback} callback preserves connection ownership`, async () => {
    let next: Replacement | undefined,
      disconnected = 0;
    class Replacement {
      token: string | null = 'new-session';
      url = 'https://bridge.example';
      account: MockAccount | null = null;
      constructor() {
        next = this;
      }
      async connect() {
        this.account = { address: 'GNEW' };
        return { address: 'GNEW', networkPassphrase: 'testnet' };
      }
      async disconnect() {
        disconnected++;
        this.token = null;
      }
    }
    const f = fixture(() => {}, Replacement);
    const changes: Change[] = [],
      writesAfterDestroy: boolean[] = [],
      busy: boolean[] = [];
    Object.assign(f.ui, {
      onStateChange() {
        if (callback === 'state') f.ui.destroy();
      },
      onChange(value: Change) {
        changes.push(value);
        if (callback === 'connection') f.ui.destroy();
      },
      onBusyChange: (value: boolean) => busy.push(value),
    });
    Object.assign(f.context, {
      localStorage: {
        setItem: () => writesAfterDestroy.push(f.ui.destroyed),
        removeItem: () => writesAfterDestroy.push(f.ui.destroyed),
      },
    });
    f.node('url').value = 'https://bridge.example';
    f.node('code').value = '12345678';
    await f.ui.connect();
    assert.ok(next);
    assert.equal(f.ui.destroyed, true);
    assert.deepEqual(writesAfterDestroy, [false]);
    assert.deepEqual(busy, [true]);
    // The shared wallet owns the adopted session in both cases.
    assert.equal(disconnected, 0);
    assert.equal(next.token, 'new-session');
    assert.equal(f.ui.wallet.client, next);
    if (callback === 'state') assert.equal(changes.length, 0);
    else {
      assert.equal(changes.length, 1);
      assert.equal(changes[0].wallet, f.ui.wallet);
    }
  });
}

for (const operation of ['refresh', 'changeWallet', 'checkHealth']) {
  test(`a delayed ${operation} result cannot publish after destruction`, async () => {
    const f = fixture(() => {}),
      observed = observe(f),
      response = Promise.withResolvers<void>();
    const account = { address: 'GOLD' };
    const wallets = [{ public_key: 'GOLD' }];
    const client = {
      token: 'session',
      url: 'https://bridge.example',
      generation: 1,
      async listWallets() {
        await response.promise;
        return [{ public_key: 'GNEW' }];
      },
      async selectWallet() {
        await response.promise;
        return { address: 'GNEW' };
      },
      async getAccount() {
        await response.promise;
        return { address: 'GNEW' };
      },
    };
    Object.assign(f.ui, { client, account, wallets, state: 'connected' });
    const pending =
      operation === 'changeWallet'
        ? f.ui.changeWallet({ public_key: 'GNEW' })
        : operation === 'refresh'
          ? f.ui.refresh()
          : f.ui.checkHealth();
    const callbacks = [...observed.callbacks],
      view = f.view();
    f.ui.destroy();
    response.resolve();
    await pending;
    assert.equal(f.ui.client, client);
    assert.equal(client.token, 'session');
    assert.equal(f.ui.account, account);
    assert.equal(f.ui.wallets, wallets);
    assert.deepEqual(observed.callbacks, callbacks);
    assert.deepEqual(observed.writes, []);
    assert.deepEqual(f.view(), view);
  });
}

test('requestAccess opens one dialog, resolves after pairing, and rejects when closed', async () => {
  class Replacement {
    token = 'new-session';
    url = 'https://bridge.example';
    account: MockAccount | null = null;
    async connect() {
      this.account = { address: 'GNEW' };
      return { address: 'GNEW', networkPassphrase: 'testnet' };
    }
    async disconnect() {}
  }
  const f = fixture(() => {}, Replacement);
  const access = f.ui.requestAccess();
  assert.equal(f.ui.dialog.open, true);
  assert.equal(f.ui.requestAccess(), access);
  f.node('url').value = 'https://bridge.example';
  f.node('code').value = '12345678';
  await f.ui.connect();
  assert.equal(await access, 'GNEW');
  assert.equal(f.ui.dialog.open, false);
  assert.equal(f.ui.wallet.address, 'GNEW');
  const closed = f.ui.requestAccess();
  f.ui.close();
  await assert.rejects(closed, (error: { code: number; ext: string[] }) => {
    assert.equal(error.code, -4);
    assert.deepEqual([...error.ext], ['walleterm:rejected']); // The error comes from the page realm.
    return true;
  });
  Object.assign(f.ui, { busy: true });
  await assert.rejects(f.ui.requestAccess(), /Wait for the current wallet action/);
  f.ui.destroy();
  await assert.rejects(f.ui.requestAccess(), /closed/);
  assert.equal(f.ui.wallet.ui, null);
});

test('the header follows wallet changes made outside the component', () => {
  const f = fixture(() => {});
  const changes: Change[] = [];
  Object.assign(f.ui, { onChange: (value: Change) => changes.push(value), wallets: [] });
  const outside = { token: 'session', url: 'https://bridge.example', account: { address: 'GOUT' } };
  Object.assign(f.ui.wallet, { client: outside });
  f.ui.walletChanged();
  assert.equal(f.ui.client, outside);
  assert.equal(f.ui.account?.address, 'GOUT');
  assert.equal(f.ui.state, 'connected');
  assert.equal(changes.at(-1)?.wallet, f.ui.wallet);
  Object.assign(f.ui, { working: true });
  outside.account = { address: 'GIGNORED' };
  f.ui.walletChanged();
  assert.equal(f.ui.account?.address, 'GOUT');
  Object.assign(f.ui, { working: false });
  outside.token = '';
  f.ui.walletChanged();
  assert.equal(f.ui.state, 'expired');
  assert.equal(f.ui.client, null);
  Object.assign(f.ui.wallet, { client: { ...outside, token: 'session' } });
  f.ui.walletChanged();
  Object.assign(f.ui.wallet, { client: null });
  f.ui.walletChanged();
  assert.equal(f.ui.state, 'disconnected');
  assert.deepEqual(
    changes.map((change) => change.account?.address ?? null),
    ['GOUT', null, 'GIGNORED', null],
  );
});

test('a new session from another tab replaces the wallet list, and the menu loads its grant', async () => {
  const f = fixture(() => {});
  const listed: string[] = [];
  const session = (token: string) => ({
    token,
    url: 'https://bridge.example',
    account: { address: 'GSAME', networkPassphrase: Networks.TESTNET },
    async listWallets() {
      listed.push(token);
      return [{ public_key: 'GSAME' }, { public_key: `G${token.toUpperCase()}` }];
    },
  });
  const first = session('first');
  Object.assign(f.ui, { onChange() {}, client: first, account: { ...first.account }, listed: first });
  Object.assign(f.ui, { wallets: [{ public_key: 'GSAME' }, { public_key: 'GFIRST' }] });
  Object.assign(f.ui.wallet, { client: first });
  f.ui.walletChanged();
  assert.equal(f.ui.wallets.length, 2);
  // The address can stay the same. The new grant can still list other wallets.
  const next = session('next');
  Object.assign(f.ui.wallet, { client: next });
  f.ui.walletChanged();
  assert.equal(f.ui.client, next);
  assert.equal(f.ui.wallets.length, 0);
  f.node('menu').hidden = true;
  f.ui.toggleMenu();
  for (let i = 0; i < 50 && !f.ui.wallets.length; i++) await settle();
  assert.deepEqual(listed, ['next']);
  assert.deepEqual(
    f.ui.wallets.map((key) => key.public_key),
    ['GSAME', 'GNEXT'],
  );
});

test('the dialog explains the grant, the approval, and the time limit for each wallet scope', async () => {
  const f = fixture(() => {});
  f.ui.rows = () => {};
  for (const [scope, description, grant] of [
    [
      'available',
      'Next, you choose one active wallet. This website can then switch among all listed wallets.',
      'This website can switch among all listed wallets.',
    ],
    [
      'selected',
      'Next, you choose one wallet. This website can then use only that wallet.',
      'This website can use only the wallet that you select.',
    ],
  ] as const) {
    f.ui.wallet = vm.runInContext(`new Walleterm({ walletScope: '${scope}' })`, f.context);
    f.ui.open();
    assert.equal(f.node('description').textContent, description);
    const controller = new AbortController();
    const choosing = f.ui.chooseWallet({}, [{ public_key: 'GFIRST' }], controller.signal);
    // The website's request is the approval. Only 1Password can still ask.
    assert.equal(
      f.node('status').textContent,
      `${grant} Walleterm signs each request from this website. 1Password can ask you to approve. The connection lasts one hour.`,
    );
    controller.abort();
    await assert.rejects(choosing);
    f.ui.close();
  }
});

// Runs the real constructor with a mock element. The other tests assign component state directly.
function constructed(f: ReturnType<typeof fixture>, options: Record<string, unknown>) {
  const intervals: unknown[] = [];
  const dialog = {
    open: false,
    listeners: {} as Record<string, (event: object) => void>,
    addEventListener(type: string, listener: (event: object) => void) {
      this.listeners[type] = listener;
    },
    getBoundingClientRect: () => ({ left: 10, right: 110, top: 10, bottom: 110 }),
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
  };
  const element = {
    classList: { add() {} },
    innerHTML: '',
    addEventListener() {},
    contains: () => false,
    querySelectorAll: () => [],
    querySelector(selector: string) {
      if (selector === '.wt-trigger') return f.node('trigger');
      if (selector === 'dialog') return dialog;
      const name = /^\[data-wt="([^"]+)"\]$/.exec(selector)?.[1];
      return name ? f.node(name) : f.node(selector);
    },
  };
  Object.assign(f.context, {
    setInterval: (callback: unknown) => intervals.push(callback),
    mountElement: element,
    mountOptions: options,
  });
  const ui: ConnectUI = vm.runInContext('new WalletermConnect(mountElement, mountOptions)', f.context);
  return { ui, intervals, dialog };
}

test('Escape and a backdrop click close the dialog and return focus to the trigger', () => {
  const f = fixture(() => {});
  const wallet: Walleterm = vm.runInContext("new Walleterm({ walletScope: 'available' })", f.context);
  const { ui, dialog } = constructed(f, { wallet });
  // showModal() keeps focus in the dialog. The component adds no Tab handler of its own.
  assert.deepEqual(Object.keys(dialog.listeners).sort(), ['cancel', 'click']);
  ui.open();
  assert.equal(f.focused(), 'scan');
  let prevented = 0;
  // The browser sends Escape as a cancel event.
  dialog.listeners.cancel({ preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
  assert.equal(dialog.open, false);
  assert.equal(f.focused(), 'trigger');
  ui.open();
  dialog.listeners.click({ target: dialog, clientX: 50, clientY: 50 });
  assert.equal(dialog.open, true);
  dialog.listeners.click({ target: f.node('scan'), clientX: 5, clientY: 5 });
  assert.equal(dialog.open, true);
  dialog.listeners.click({ target: dialog, clientX: 5, clientY: 50 });
  assert.equal(dialog.open, false);
  assert.equal(f.focused(), 'trigger');
  ui.destroy();
});

test('a header mounted for an already connected wallet shows that connection', async () => {
  const f = fixture(() => {});
  const wallet: Walleterm = vm.runInContext("new Walleterm({ walletScope: 'available' })", f.context);
  const client = {
    token: 'session',
    url: 'https://bridge.example',
    account: { address: 'GLIVE', networkPassphrase: Networks.TESTNET },
  };
  Object.assign(wallet, { client });
  const changes: Change[] = [];
  const { ui, intervals } = constructed(f, { wallet, onChange: (value: Change) => changes.push(value) });
  assert.equal(wallet.ui, ui);
  assert.equal(intervals.length, 1);
  await settle();
  assert.equal(ui.client, client);
  assert.equal(ui.account?.address, 'GLIVE');
  assert.equal(ui.state, 'connected');
  assert.equal(changes.length, 1);
  assert.equal(changes[0].wallet, wallet);
  assert.equal(f.node('trigger').hidden, false);
  ui.destroy();
  assert.equal(wallet.ui, null);
});

test('a dialog-only component registers for access without header work', async () => {
  const f = fixture(() => {});
  const wallet: Walleterm = vm.runInContext('new Walleterm()', f.context);
  const { ui, intervals } = constructed(f, { wallet, header: false });
  await settle();
  assert.equal(wallet.ui, ui);
  assert.equal(f.node('trigger').hidden, true);
  assert.equal(intervals.length, 0);
  assert.equal(ui.client ?? null, null);
});

test('header Disconnect with the documented Kit hook clears the Kit side and opens no dialog', async () => {
  const f = fixture(() => {});
  const wallet = f.ui.wallet;
  let revoked = 0,
    accessRequests = 0;
  const client = {
    token: 'session' as string | null,
    url: 'https://bridge.example',
    account: { address: 'GLIVE', networkPassphrase: Networks.TESTNET },
    async disconnect() {
      revoked++;
      this.token = null;
    },
    forgetConnection() {
      this.token = null;
    },
  };
  Object.assign(f.ui, { wallets: [], onChange() {} });
  // The wallet publishes the connection. The header follows it.
  await wallet.adopt(client as unknown as WalletermClient);
  assert.equal(f.ui.client, client);
  const requestAccess = f.ui.requestAccess.bind(f.ui);
  f.ui.requestAccess = () => {
    accessRequests++;
    return requestAccess();
  };
  // The Kit hook calls these module methods: fetchAddress() uses getAddress(), disconnect() uses disconnect().
  const hooked: Promise<unknown>[] = [];
  wallet.onChange(({ address }) => void hooked.push(address ? wallet.getAddress() : wallet.disconnect()));
  await f.ui.disconnect();
  await settle();
  await Promise.all(hooked);
  assert.equal(hooked.length, 1);
  assert.equal(revoked, 1);
  assert.equal(accessRequests, 0);
  assert.equal(f.ui.dialog.open, false);
  assert.equal(f.ui.state, 'disconnected');
  assert.equal(wallet.client, null);
});
