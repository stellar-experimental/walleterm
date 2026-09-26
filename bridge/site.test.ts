import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { browserScript } from './test/support.ts';

// The page reads and writes only these element members.
interface MockElement {
  hidden: boolean;
  disabled: boolean;
  open: boolean;
  value: string;
  textContent: string;
  children: unknown[];
  onclick?: () => unknown;
  classList: { toggle(): void };
  setAttribute(): void;
  addEventListener(): void;
  focus(): void;
  showModal(): void;
  close(): void;
  append(...nodes: unknown[]): void;
  replaceChildren(...nodes: unknown[]): void;
  add(): void;
}
function element(): MockElement {
  return {
    hidden: false,
    disabled: false,
    open: false,
    value: '',
    textContent: '',
    children: [],
    classList: { toggle() {} },
    setAttribute() {},
    addEventListener() {},
    focus() {},
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    add() {},
  };
}
interface ConnectionChange {
  client: unknown;
  account: unknown;
}
function contextFor(html: string, extras: Record<string, unknown> = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map((m) => [m[1], element()]));
  const context = vm.createContext({
    document: { getElementById: (id: string) => elements.get(id), createElement: element },
    URLSearchParams,
    AbortSignal,
    AbortController,
    createCodeView: (node: MockElement) => (text: string) => {
      node.textContent = text;
    },
    highlightConnectionCommand() {},
    createActivityLog: () => ({ record() {}, transaction() {}, wrapFetch: (fetcher: unknown) => fetcher }),
    WalletermConnect: class {
      onChange: (value: ConnectionChange) => void;
      client?: { disconnect(): Promise<void> };
      constructor(_element: unknown, { onChange }: { onChange: (value: ConnectionChange) => void }) {
        this.onChange = onChange;
      }
      sync() {}
      setBusy() {}
      async disconnect() {
        assert.ok(this.client);
        await this.client.disconnect();
        this.onChange({ client: null, account: null });
      }
    },
    location: { hash: '' },
    history: { replaceState() {} },
    setInterval() {},
    clearInterval() {},
    Option: class {},
    navigator: { locks: { request: async (_name: string, fn: () => unknown) => fn() } },
    ...extras,
  });
  // Errors must come from the page realm. A test-realm requestError fails its instanceof check and drops fields.
  vm.runInContext(browserScript(new URL('../sdk/errors.ts', import.meta.url)), context);
  const run = (code: string): unknown => vm.runInContext(code, context);
  const el = (id: string) => {
    const node = elements.get(id);
    assert.ok(node, `Missing element ${id}.`);
    return node;
  };
  const click = (id: string) => {
    const handler = el(id).onclick;
    assert.ok(handler, `Element ${id} has no click handler.`);
    return handler();
  };
  return { context, elements, el, click, run, promise: (code: string) => Promise.resolve(run(code)) };
}
const app = () => browserScript(new URL('../demo/site/app.ts', import.meta.url));
const ok = (data: unknown) => ({ ok: true, json: async () => data });
test('signing shows retry progress and stops at the server expiry after the page wakes', async () => {
  let now = Date.now(),
    tick: (() => void) | undefined,
    cleared = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    Date: class extends Date {
      static override now() {
        return now;
      }
    },
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      TransactionBuilder: { fromXDR: () => ({ timeBounds: { maxTime: Math.floor(now / 1000) + 180 } }) },
    },
    localStorage: { getItem: () => null, setItem() {} },
    setInterval(fn: () => void) {
      tick = fn;
      return 1;
    },
    clearInterval() {
      cleared = true;
    },
  });
  f.run(app());
  const signing = f.promise(`
    pending={kind:'note', state:'waiting', address:'GORIGINAL', xdr:'mock', hash:'hash'};
    busy=true; actionPhase='signing';
    wallet={signTransaction: (_xdr, options) => new Promise((_resolve,reject) => {
      options.onProgress({state:'retrying', expiresAt:new Date(Date.now()+10000).toISOString()});
      options.signal.addEventListener('abort', () => reject(Object.assign(Error('Timed out'),{canceled:false})),{once:true});
    })};
    requestSignature().catch(() => {});
  `);
  assert.match(f.el('review-progress-state').textContent, /Retrying the same request/);
  assert.equal(f.el('review-status').hidden, true);
  assert.match(f.el('review-countdown').textContent, /10s remaining/);
  const announcement = f.el('review-progress-state').textContent;
  now += 1000;
  assert.ok(tick);
  tick();
  assert.equal(f.el('review-progress-state').textContent, announcement);
  assert.match(f.el('review-countdown').textContent, /9s remaining/);
  now += 10001;
  assert.ok(tick);
  tick();
  await signing;
  assert.equal(f.run('pending.state'), 'signing_unknown');
  assert.equal(f.run('signingController'), null);
  assert.equal(cleared, true);
});
test('wallet changes preserve the original transaction journal and signer', () => {
  for (const state of ['signed', 'unknown', 'signing_unknown']) {
    let stored: string | null | undefined;
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: { Networks: { TESTNET: 'testnet' } },
      localStorage: {
        getItem: () => null,
        setItem: (_key: string, value: string) => {
          stored = value;
        },
      },
    });
    f.run(app());
    f.run(
      `pending={kind:'note', address:'GORIGINAL', hash:'original-hash', xdr:'original-xdr', signed_xdr:'original-signature', state:'${state}'}; save()`,
    );
    const before = stored;
    f.run("connection.onChange({ client: {token:'same-session'}, account: {address:'GSECOND'} })");
    assert.equal(stored, before);
    assert.equal(f.run('pending.address'), 'GORIGINAL');
    assert.equal(f.run('pending.signed_xdr'), 'original-signature');
    assert.equal(f.run('connectedTo(pending.address)'), false);
  }
});

test('an unknown signing outcome remains distinct from a confirmed cancellation', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      TransactionBuilder: {
        fromXDR: () => ({ timeBounds: { maxTime: Math.floor(Date.now() / 1000) + 180 } }),
      },
    },
    localStorage: { getItem: () => null, setItem() {} },
  });
  f.run(app());
  for (const error of ["{requestState:'unknown'}", '{canceled:false}']) {
    await f.run(
      `pending={kind:'note', state:'waiting', address:'GORIGINAL', xdr:'original', hash:'hash'}; wallet={signTransaction: async () => {throw Object.assign(Error('Stopped'), ${error})}}; requestSignature().catch(() => {})`,
    );
    assert.equal(f.run('pending.state'), 'signing_unknown');
  }
});
test('demo denial and expiry finish the request; unknown submission remains protected after reload', async () => {
  const html = readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8');
  const source = app();
  let stored: string | null | undefined;
  const f = contextFor(html, {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      TransactionBuilder: {
        fromXDR: () => ({ timeBounds: { maxTime: Math.floor(Date.now() / 1000) + 180 } }),
      },
    },
    WalletermClient: class {},
    localStorage: {
      getItem: () => stored || null,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
      removeItem: () => {
        stored = null;
      },
    },
  });
  f.run(source);
  for (const state of ['denied', 'expired']) {
    await f.run(
      `pending = {xdr:'mock', state:'waiting'}; wallet = {token:'mock', signTransaction: async () => {throw Object.assign(Error('${state}'), {requestState:'${state}'})}}; requestSignature().catch(() => {});`,
    );
    f.run('render()');
    assert.equal(f.run('pending.state'), state);
    assert.equal(f.el('clear').hidden, true);
    assert.equal(f.el('check').hidden, true);
  }
  f.run(
    "pending={kind:'note', address:'GSOURCE', xdr:'mock', state:'unknown', hash:'original'}; save(); render();",
  );
  assert.equal(f.el('clear').hidden, true);
  assert.equal(f.el('check').hidden, false);
  const restored = contextFor(html, {
    StellarSdk: { Networks: { TESTNET: 'testnet' } },
    WalletermClient: class {},
    localStorage: { getItem: () => stored, setItem() {}, removeItem() {} },
  });
  restored.run(source);
  assert.equal(restored.run('pending.state'), 'unknown');
  assert.equal(restored.el('clear').hidden, true);
  assert.equal(restored.el('review').open, true);
  const saved = stored;
  restored.click('close-review');
  assert.equal(stored, saved);
  assert.equal(restored.run('pending.state'), 'unknown');
});

test('a reload preserves an open signing request until the user clears it', async () => {
  let stored: string | null = JSON.stringify({
    kind: 'note',
    address: 'GSOURCE',
    hash: 'original',
    state: 'waiting',
    xdr: 'mock',
  });
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' } },
    WalletermClient: class {},
    localStorage: {
      getItem: () => stored,
      setItem() {},
      removeItem: () => {
        stored = null;
      },
    },
  });
  f.run(app());
  assert.equal(f.run('pending.state'), 'waiting');
  assert.ok(stored);
  assert.match(
    f.el('status').textContent,
    /Decline the 1Password prompt if it appears, then clear this record/,
  );
  await f.click('clear');
  assert.equal(f.run('pending'), null);
  assert.equal(stored, null);
});
test('an unreadable journal blocks new transaction actions', async () => {
  for (const stored of ['{broken', JSON.stringify({ state: 'unknown', kind: 'note' })]) {
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: {},
      WalletermClient: class {},
      localStorage: {
        getItem: () => stored,
        setItem: () => {
          throw Error('must not write');
        },
        removeItem: () => {
          throw Error('must not remove');
        },
      },
    });
    f.run(app());
    f.run("account={address:'GSOURCE'}; render()");
    assert.equal(f.el('payment').disabled, true);
    assert.match(f.el('status').textContent, /Preserve it before continuing/);
    await f.click('payment');
    assert.equal(f.run('pending') == null, true);
  }
});
test('a damaged journal still permits disconnect without changing storage', async () => {
  const stored = '{broken';
  let disconnected = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    WalletermClient: class {},
    localStorage: {
      getItem: () => stored,
      setItem: () => {
        throw Error('must not write');
      },
      removeItem: () => {
        throw Error('must not remove');
      },
    },
  });
  f.run(app());
  f.context.disconnectMock = async () => {
    disconnected = true;
  };
  f.run("wallet={token:'mock', disconnect:disconnectMock}; account={address:'GSOURCE'}; render()");
  await f.run('connection.client = wallet; connection.disconnect()');
  assert.equal(disconnected, true);
  assert.equal(f.run('account'), null);
  assert.equal(stored, '{broken');
});
test('another tab cannot overwrite an unknown submission', async () => {
  let stored: string | null = null;
  const localStorage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
    removeItem: () => {
      stored = null;
    },
  };
  const html = readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8');
  const source = app();
  const first = contextFor(html, { StellarSdk: {}, WalletermClient: class {}, localStorage });
  const second = contextFor(html, { StellarSdk: {}, WalletermClient: class {}, localStorage });
  first.run(source);
  second.run(source);
  first.run("pending={kind:'note', address:'GSOURCE', xdr:'mock', state:'unknown', hash:'original'}; save()");
  second.run("account={address:'GSOURCE'}; render()");
  await second.click('note');
  const saved: { hash?: string } = JSON.parse(stored ?? 'null');
  assert.equal(saved.hash, 'original');
  assert.equal(second.run('pending.hash'), 'original');
  assert.equal(second.el('note').disabled, true);
  assert.match(second.el('status').textContent, /Another tab changed/);
});

test('demo selects an existing recent testnet account without recipient input', async () => {
  const calls: string[] = [];
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      StrKey: {
        isValidEd25519PublicKey: (value: string) => ['GSOURCE', 'GREMOVED', 'GRECIPIENT'].includes(value),
      },
    },
    WalletermClient: class {},
    localStorage: { getItem: () => null },
    fetch: async (url: string) => {
      calls.push(url);
      if (url.includes('/operations?'))
        return ok({
          _embedded: {
            records: [
              { source_account: 'GSOURCE' },
              { source_account: 'bad' },
              { source_account: 'GREMOVED' },
              { source_account: 'GRECIPIENT' },
            ],
          },
        });
      if (url.endsWith('/GREMOVED'))
        return { ok: false, status: 404, json: async () => ({ detail: 'Account missing' }) };
      return ok({ account_id: 'GRECIPIENT' });
    },
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}");
  assert.equal(await f.run('paymentRecipient()'), 'GRECIPIENT');
  assert.equal(f.elements.has('recipient'), false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((url) => url.startsWith('https://horizon-testnet.stellar.org/')));
});

test('recipient lookup reports failure without choosing an unchecked account', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { StrKey: { isValidEd25519PublicKey: () => true } },
    WalletermClient: class {},
    localStorage: { getItem: () => null },
    fetch: async (url: string) =>
      url.includes('/operations?')
        ? ok({ _embedded: { records: [{ source_account: 'GCANDIDATE' }] } })
        : { ok: false, status: 503, json: async () => ({ detail: 'Horizon unavailable' }) },
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}");
  await assert.rejects(f.promise('paymentRecipient()'), /Horizon unavailable/);
});

test('demo funds a missing testnet account once with Friendbot', async () => {
  const calls: string[] = [];
  let funded = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    WalletermClient: class {},
    localStorage: { getItem: () => null },
    fetch: async (url: string) => {
      calls.push(url);
      if (url.startsWith('https://friendbot.stellar.org/')) {
        funded = true;
        return ok({});
      }
      return funded
        ? ok({ account_id: 'GNEW', sequence: '1' })
        : { ok: false, status: 404, json: async () => ({ detail: 'Account missing' }) };
    },
  });
  f.run(app());
  f.run("account={address:'GNEW'}");
  assert.equal(await f.run('sourceAccount().then(account => account.sequence)'), '1');
  assert.deepEqual(calls, [
    'https://horizon-testnet.stellar.org/accounts/GNEW',
    'https://friendbot.stellar.org/?addr=GNEW',
    'https://horizon-testnet.stellar.org/accounts/GNEW',
  ]);
});

test('demo reports a Friendbot failure and does not hide Horizon errors', async () => {
  const run = async (responses: unknown[]) => {
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: {},
      WalletermClient: class {},
      localStorage: { getItem: () => null },
      fetch: async () => responses.shift(),
    });
    f.run(app());
    f.run("account={address:'GNEW'}");
    return f.run('sourceAccount()');
  };
  const missing = () => ({ ok: false, status: 404, json: async () => ({ detail: 'Account missing' }) });
  await assert.rejects(
    run([missing(), { ok: false, status: 400, json: async () => ({}) }, missing()]),
    /Friendbot could not fund/,
  );
  await assert.rejects(
    run([{ ok: false, status: 503, json: async () => ({ detail: 'Horizon unavailable' }) }]),
    /Horizon unavailable/,
  );
});

test('an unknown submission expires only after a ledger closes past its time bound', async () => {
  const maxTime = 1_800_000_000;
  const order: string[] = [];
  const make = (closed: number) => {
    let stored: string | null = null;
    return contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: {
        Networks: { TESTNET: 'testnet' },
        TransactionBuilder: { fromXDR: () => ({ sequence: '11', timeBounds: { maxTime: String(maxTime) } }) },
      },
      WalletermClient: class {},
      localStorage: {
        getItem: () => stored,
        setItem: (_key: string, value: string) => {
          stored = value;
        },
        removeItem: () => {
          stored = null;
        },
      },
      fetch: async (url: string) => {
        order.push(url.includes('/ledgers?') ? 'ledger' : url.includes('/accounts/') ? 'account' : 'hash');
        if (url.includes('/ledgers?'))
          return ok({ _embedded: { records: [{ closed_at: new Date(closed * 1000).toISOString() }] } });
        if (url.includes('/accounts/')) return ok({ sequence: accountSequence });
        return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) };
      },
    });
  };
  let accountSequence: string | undefined;
  for (const [closed, sequence, state] of [
    [maxTime + 5, '10', 'expired'],
    [maxTime - 5, '10', 'unknown'],
    [maxTime + 5, '11', 'unknown'],
  ] as const) {
    accountSequence = sequence;
    const f = make(closed);
    f.run(app());
    f.run("pending={kind:'note', state:'unknown', hash:'original', xdr:'mock', address:'GSOURCE'}; save()");
    await f.click('check');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.run('pending.state'), state);
  }
  assert.deepEqual(order.slice(0, 3), ['ledger', 'hash', 'account']);
});

test('a storage failure before signing leaves the demo usable', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      Account: class {},
      Operation: { manageData: () => ({}) },
      TransactionBuilder: class {
        addOperation() {
          return this;
        }
        setTimeout() {
          return this;
        }
        build() {
          return { toXDR: () => 'mock', hash: () => [1] };
        }
        static fromXDR() {
          return {
            source: 'GSOURCE',
            fee: '100',
            sequence: '2',
            memo: { value: null },
            timeBounds: { minTime: '0', maxTime: '1' },
            operations: [{ type: 'manageData', name: 'walleterm-demo' }],
          };
        }
      },
    },
    WalletermClient: class {},
    crypto: { randomUUID: () => 'id-0000000000000000' },
    localStorage: {
      getItem: () => null,
      setItem() {
        throw Error('Quota');
      },
      removeItem() {},
    },
    fetch: async () => ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}; wallet={}");
  await assert.rejects(f.promise("build('note')"), /could not store/);
  assert.equal(f.run('pending'), null);
});

test('cancel removes the newest open offer from Horizon', async () => {
  interface OfferOptions {
    offerId?: string;
    amount?: string;
    buying?: { code?: string };
    selling?: unknown;
  }
  let built: OfferOptions | undefined;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      Account: class {},
      Asset: class {
        code: string;
        issuer: string;
        constructor(code: string, issuer: string) {
          this.code = code;
          this.issuer = issuer;
        }
        static native() {
          return 'XLM';
        }
      },
      Operation: {
        manageSellOffer: (options: OfferOptions) => {
          built = options;
          return {};
        },
      },
      TransactionBuilder: class {
        addOperation() {
          return this;
        }
        setTimeout() {
          return this;
        }
        build() {
          return { toXDR: () => 'mock', hash: () => [1] };
        }
        static fromXDR() {
          return {
            source: 'GSOURCE',
            fee: '100',
            sequence: '2',
            memo: { value: null },
            timeBounds: { minTime: '0', maxTime: '1' },
            operations: [{ type: 'manageData', name: 'walleterm-demo' }],
          };
        }
      },
    },
    WalletermClient: class {},
    crypto: { randomUUID: () => 'id-0000000000000000' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async (url: string) =>
      url.includes('/offers?')
        ? ok({
            _embedded: {
              records: [
                {
                  id: '77',
                  selling: { asset_type: 'native' },
                  buying: { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER' },
                  price_r: { n: 10, d: 1 },
                },
              ],
            },
          })
        : ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}; wallet={signTransaction: () => new Promise(() => {})}");
  f.run("build('cancel_offer')");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(built);
  assert.equal(built.offerId, '77');
  assert.equal(built.amount, '0');
  assert.equal(built.buying?.code, 'USDC');
  assert.equal(built.selling, 'XLM');
});

test('a built transaction waits for Sign before it is signed', async () => {
  const storage: {
    value: string | null;
    getItem(): string | null;
    setItem(_key: string, value: string): void;
    removeItem(): void;
  } = {
    value: null,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
    removeItem() {
      this.value = null;
    },
  };
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      Account: class {},
      Asset: class {},
      Operation: { manageData: () => ({}) },
      TransactionBuilder: class {
        addOperation() {
          return this;
        }
        setTimeout() {
          return this;
        }
        build() {
          return { toXDR: () => 'mock', hash: () => [1] };
        }
        static fromXDR() {
          return {
            source: 'GSOURCE',
            fee: '100',
            sequence: '2',
            memo: { value: null },
            timeBounds: { minTime: '0', maxTime: '1' },
            operations: [{ type: 'manageData', name: 'walleterm-demo' }],
          };
        }
      },
    },
    WalletermClient: class {},
    crypto: { randomUUID: () => 'id-0000000000000000' },
    navigator: { locks: { request: async (_name: string, fn: () => unknown) => fn() } },
    localStorage: storage,
    fetch: async () => ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(app());
  f.run(
    "account={address:'GSOURCE'}; signs=0; wallet={token:'mock', signTransaction: async () => { signs++; return new Promise(() => {}); }}",
  );
  await f.click('note');
  f.run('render()');
  assert.equal(f.el('review').open, true);
  const record = f.run('JSON.stringify(pending)');
  f.click('close-review');
  assert.equal(f.el('review').open, false);
  assert.equal(f.run('JSON.stringify(pending)'), record);
  assert.equal(f.el('transaction-record').hidden, false);
  f.click('open-review');
  assert.equal(f.el('review').open, true);
  assert.equal(f.run('pending.state'), 'review');
  assert.equal(f.run('signs'), 0);
  assert.equal(f.el('sign').hidden, false);
  assert.equal(f.el('sign').disabled, false);
  assert.equal(f.el('clear').textContent, 'Discard');
  assert.match(f.el('details').textContent, /"name": "walleterm-demo"/);
  f.run('wallet.token=null; render()');
  assert.equal(f.el('sign').disabled, true);
  f.run("wallet.token='mock'; render()");
  f.click('sign');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.run('signs'), 1);
  assert.equal(f.run('pending.state'), 'waiting');
});

test('a saved review with invalid XDR blocks actions without breaking the page', () => {
  const stored = JSON.stringify({
    state: 'review',
    kind: 'note',
    address: 'GSOURCE',
    hash: 'h',
    xdr: 'broken',
  });
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {
      Networks: { TESTNET: 'testnet' },
      TransactionBuilder: {
        fromXDR: () => {
          throw Error('bad XDR');
        },
      },
    },
    WalletermClient: class {},
    localStorage: { getItem: () => stored, setItem() {}, removeItem() {} },
  });
  f.run(app());
  assert.equal(f.run('journalBlocked'), true);
  assert.equal(f.run('busy'), false);
  assert.match(f.el('status').textContent, /could not be read/);
});

test('the action modal opens before account lookup and keeps preparation errors visible', async () => {
  let fail: ((error: unknown) => void) | undefined;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    localStorage: { getItem: () => null },
    fetch: () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  });
  f.run(app());
  f.run("account={address:'GSOURCE'}; wallet={token:'mock'}");
  const creating = f.click('payment');
  assert.equal(f.el('review').open, true);
  assert.equal(f.el('review-title').textContent, 'Pay 0.01 test XLM');
  assert.match(f.el('review-status').textContent, /Preparing/);
  assert.equal(f.el('sign').hidden, true);
  // A page fetch rejects with a page-realm error.
  assert.ok(fail);
  fail(f.run("Error('Horizon unavailable')"));
  await creating;
  assert.equal(f.el('review').open, true);
  assert.equal(f.el('review-status').textContent, 'Horizon unavailable');
  assert.equal(f.run('pending'), null);
  assert.equal(f.el('transaction-details').hidden, true);
  assert.equal(f.el('sign').hidden, true);
});

test('connection work disables demo actions and signing without changing the journal', () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    localStorage: { getItem: () => null },
  });
  f.run(app());
  f.run("wallet={token:'mock'}; account={address:'GTEST'}; connection.working=true; render()");
  for (const name of ['note', 'payment', 'offer', 'cancel-offer']) assert.equal(f.el(name).disabled, true);
  f.run("pending={state:'signed',kind:'note',address:'GTEST',xdr:'unsigned',signed_xdr:'signed'}; render()");
  assert.equal(f.el('submit').disabled, true);
  assert.equal(f.el('clear').disabled, true);
  f.run('connection.working=false; render()');
  assert.equal(f.el('submit').disabled, false);
  assert.equal(f.run('pending.state'), 'signed');
});

test('only an active request shows progress; stopped signing cannot be canceled again', () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {},
    localStorage: { getItem: () => null },
  });
  f.run(app());
  f.run("pending={kind:'note',state:'waiting',address:'GTEST'}; render()");
  assert.equal(f.el('cancel-request').hidden, true);
  assert.equal(f.el('review-progress').hidden, true);
  f.run("busy=true; actionPhase='signing'; signingController=new AbortController(); render()");
  assert.equal(f.el('cancel-request').disabled, false);
  assert.equal(f.el('review-progress').hidden, false);
  f.click('cancel-request');
  assert.equal(f.el('cancel-request').disabled, true);
  assert.match(f.el('review-progress-state').textContent, /Canceling/);
  f.run("busy=false; pending.state='signing_unknown'; signingController=null; render()");
  assert.equal(f.el('review-progress').hidden, true);
  f.run("busy=true; pending.state='submitting'; actionPhase='submitting'; render()");
  assert.equal(f.el('check').hidden, true);
  f.run("pending.state='unknown'; actionPhase='checking'; render()");
  assert.equal(f.el('check').hidden, false);
  assert.equal(f.el('check').disabled, true);
  assert.equal(f.el('check').textContent, 'Checking…');
});

async function completedFixture(state = 'submitted') {
  const sdk = await import('@stellar/stellar-sdk');
  const original = sdk.Keypair.random().publicKey(),
    next = sdk.Keypair.random().publicKey();
  const tx = new sdk.TransactionBuilder(new sdk.Account(original, '1'), {
    fee: '100',
    networkPassphrase: sdk.Networks.TESTNET,
  })
    .addOperation(sdk.Operation.manageData({ name: 'previous', value: 'done' }))
    .setTimeout(180)
    .build();
  const previous = {
    kind: 'note',
    state,
    address: original,
    hash: Buffer.from(tx.hash()).toString('hex'),
    xdr: tx.toXDR(),
    result: { successful: true },
  };
  const store = {
    value: JSON.stringify(previous) as string | null,
    getItem() {
      return this.value;
    },
    setItem(_key: string, value: string) {
      this.value = value;
    },
    removeItem() {
      this.value = null;
    },
  };
  const events: { hash: string; state: string }[] = [];
  let reads = 0,
    signs = 0;
  const client = {
    token: 'mock-session',
    signTransaction() {
      signs++;
    },
  };
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: sdk,
    crypto: globalThis.crypto,
    localStorage: store,
    client,
    next,
    fetch: async () => {
      reads++;
      return ok({ sequence: '10' });
    },
    createActivityLog: () => ({
      record() {},
      transaction(value: { hash: string; state: string } | null) {
        if (value) events.push(JSON.parse(JSON.stringify(value)));
      },
      wrapFetch: (fetcher: unknown) => fetcher,
    }),
  });
  f.run(app());
  f.run('connection.onChange({client, account:{address:next}})');
  return { ...f, store, events, previous, next, reads: () => reads, signs: () => signs };
}

test('completed transactions permit another action after wallet switching without a separate clear step', async () => {
  for (const state of ['submitted', 'canceled', 'denied', 'expired', 'failed']) {
    const f = await completedFixture(state);
    for (const name of ['note', 'payment', 'offer', 'cancel-offer'])
      assert.equal(f.el(name).disabled, false, state);
    assert.equal(f.el('clear').hidden, true);
    assert.equal(f.el('check').hidden, true, state);
    assert.equal(f.el('review').open, false);
    assert.equal(f.el('transaction-record').hidden, false);
    f.click('open-review');
    assert.equal(f.el('review').open, true);
    f.click('close-review');
    await f.click('note');
    assert.equal(f.run('pending.state'), 'review');
    assert.equal(f.run('pending.address'), f.next);
    assert.notEqual(f.run('pending.hash'), f.previous.hash);
    assert.equal(JSON.parse(f.store.value ?? 'null').address, f.next);
    assert.ok(f.events.some((event) => event.hash === f.previous.hash && event.state === state));
    assert.equal(f.signs(), 0);
    assert.equal(f.reads(), 1);
  }
});

test('unfinished transactions still prevent replacement after wallet switching', async () => {
  for (const state of ['review', 'signed', 'waiting', 'signing_unknown', 'submitting', 'unknown']) {
    const f = await completedFixture(state),
      before = f.store.value;
    const needsStatusCheck = ['submitting', 'unknown'].includes(state);
    assert.equal(f.el('check').hidden, !needsStatusCheck, state);
    if (needsStatusCheck) {
      assert.equal(f.el('check').textContent, 'Check transaction status');
      assert.equal(
        f.el('review-note').textContent,
        'We could not confirm the result. Check before trying another transaction.',
      );
    }
    for (const name of ['note', 'payment', 'offer', 'cancel-offer'])
      assert.equal(f.el(name).disabled, true, state);
    await f.click('note');
    assert.equal(f.store.value, before);
    assert.equal(f.run('pending.hash'), f.previous.hash);
    assert.equal(f.reads(), 0);
    assert.equal(f.signs(), 0);
  }
});

test('another tab changing a completed record prevents its automatic replacement', async () => {
  const f = await completedFixture();
  const changed = JSON.stringify({ ...f.previous, state: 'unknown' });
  f.context.navigator.locks.request = async (_name: string, fn: () => unknown) => {
    f.store.value = changed;
    return fn();
  };
  await f.click('note');
  assert.equal(f.store.value, changed);
  assert.equal(f.run('pending.state'), 'unknown');
  assert.equal(f.reads(), 0);
  assert.equal(f.signs(), 0);
  assert.match(f.el('status').textContent, /Another tab changed/);
});

test('a storage failure preserves the completed record and prevents a new build', async () => {
  const f = await completedFixture(),
    before = f.store.value;
  f.store.removeItem = () => {
    throw Error('Storage unavailable');
  };
  await f.click('note');
  assert.equal(f.store.value, before);
  assert.equal(f.run('pending.hash'), f.previous.hash);
  assert.equal(f.reads(), 0);
  assert.equal(f.signs(), 0);
  assert.match(f.el('status').textContent, /Storage unavailable/);
});
