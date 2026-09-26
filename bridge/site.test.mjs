import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function element() { return { hidden: false, disabled: false, open: false, value: '', textContent: '', children: [],
  classList: { toggle() {} }, setAttribute() {}, addEventListener() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; },
  append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, add() {} }; }
function contextFor(html, extras = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], element()]));
  const context = vm.createContext({ document: { getElementById: id => elements.get(id), createElement: element }, URLSearchParams, AbortSignal, AbortController,
    createCodeView: node => text => { node.textContent = text; }, highlightConnectionCommand() {},
    createActivityLog: () => ({ record() {}, transaction() {}, wrapFetch: fetcher => fetcher }),
    WalletermConnect: class {
      constructor(_element, { onChange }) { this.onChange = onChange; }
      sync() {} setBusy() {}
      async disconnect() { await this.client.disconnect(); this.onChange({ client: null, account: null }); }
    },
    location: { hash: '' }, history: { replaceState() {} }, setInterval() {}, Option: class {},
    navigator: { locks: { request: async (_name, fn) => fn() } }, ...extras });
  return { context, elements, run: code => vm.runInContext(code, context) };
}
const ok = data => ({ ok: true, json: async () => data });
test('wallet changes preserve the original transaction journal and signer', () => {
  for (const state of ['signed', 'unknown', 'signing_unknown']) {
    let stored;
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: { Networks: { TESTNET: 'testnet' } },
      localStorage: { getItem: () => null, setItem: (_key, value) => { stored = value; } },
    });
    f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
    f.run(`pending={kind:'note', address:'GORIGINAL', hash:'original-hash', xdr:'original-xdr', signed_xdr:'original-signature', state:'${state}'}; save()`);
    const before = stored;
    f.run("connection.onChange({ client: {token:'same-session'}, account: {address:'GSECOND'} })");
    assert.equal(stored, before); assert.equal(f.run('pending.address'), 'GORIGINAL');
    assert.equal(f.run('pending.signed_xdr'), 'original-signature');
    assert.equal(f.run('connectedTo(pending.address)'), false);
  }
});

test('an unknown signing outcome remains distinct from a confirmed cancellation', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' } }, localStorage: { getItem: () => null, setItem() {} },
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  for (const error of ["{requestState:'unknown'}", "{canceled:false}"]) {
    await f.run(`pending={kind:'note', state:'waiting', address:'GORIGINAL', xdr:'original', hash:'hash'}; wallet={signTransaction: async () => {throw Object.assign(Error('Stopped'), ${error})}}; requestSignature().catch(() => {})`);
    assert.equal(f.run('pending.state'), 'signing_unknown');
  }
});
test('demo denial and expiry permit clearing; unknown submission remains protected after reload', async () => {
  const html = readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
  let stored;
  const f = contextFor(html, { StellarSdk: {Networks:{TESTNET:'testnet'}}, WalletermClient: class {}, localStorage: { getItem: () => stored || null, setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = null; } } });
  f.run(source);
  for (const state of ['denied', 'expired']) {
    await f.run(`pending = {xdr:'mock', state:'waiting'}; wallet = {token:'mock', signTransaction: async () => {throw Object.assign(Error('${state}'), {requestState:'${state}'})}}; requestSignature().catch(() => {});`);
    f.run('render()'); assert.equal(f.run('pending.state'), state); assert.equal(f.elements.get('clear').hidden, false);
  }
  f.run("pending={kind:'note', address:'GSOURCE', xdr:'mock', state:'unknown', hash:'original'}; save(); render();");
  assert.equal(f.elements.get('clear').hidden, true); assert.equal(f.elements.get('check').hidden, false);
  const restored = contextFor(html, { StellarSdk: {Networks:{TESTNET:'testnet'}}, WalletermClient: class {}, localStorage: { getItem: () => stored, setItem() {}, removeItem() {} } });
  restored.run(source); assert.equal(restored.run('pending.state'), 'unknown'); assert.equal(restored.elements.get('clear').hidden, true);
  assert.equal(restored.elements.get('review').open, true);
  const saved = stored; restored.elements.get('close-review').onclick();
  assert.equal(stored, saved); assert.equal(restored.run('pending.state'), 'unknown');
});

test('a reload preserves an open signing request until the user clears it', async () => {
  let stored = JSON.stringify({ kind: 'note', address: 'GSOURCE', hash: 'original', state: 'waiting', xdr: 'mock' });
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {Networks:{TESTNET:'testnet'}}, WalletermClient: class {}, localStorage: { getItem: () => stored, setItem() {}, removeItem: () => { stored = null; } },
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  assert.equal(f.run('pending.state'), 'waiting'); assert.ok(stored);
  assert.match(f.elements.get('status').textContent, /Decline the 1Password prompt if it appears, then clear this record/);
  await f.elements.get('clear').onclick();
  assert.equal(f.run('pending'), null); assert.equal(stored, null);
});
test('an unreadable journal blocks new transaction actions', async () => {
  for (const stored of ['{broken', JSON.stringify({ state: 'unknown', kind: 'note' })]) {
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: {}, WalletermClient: class {}, localStorage: { getItem: () => stored, setItem: () => { throw Error('must not write'); }, removeItem: () => { throw Error('must not remove'); } },
    });
    f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
    f.run("account={address:'GSOURCE'}; render()");
    assert.equal(f.elements.get('payment').disabled, true);
    assert.match(f.elements.get('status').textContent, /Preserve it before continuing/);
    await f.elements.get('payment').onclick();
    assert.equal(f.run('pending') == null, true);
  }
});
test('a damaged journal still permits disconnect without changing storage', async () => {
  const stored = '{broken'; let disconnected = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {}, WalletermClient: class {}, localStorage: { getItem: () => stored, setItem: () => { throw Error('must not write'); }, removeItem: () => { throw Error('must not remove'); } },
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.context.disconnectMock = async () => { disconnected = true; };
  f.run("wallet={token:'mock', disconnect:disconnectMock}; account={address:'GSOURCE'}; render()");
  await f.run('connection.client = wallet; connection.disconnect()');
  assert.equal(disconnected, true);
  assert.equal(f.run('account'), null);
  assert.equal(stored, '{broken');
});
test('another tab cannot overwrite an unknown submission', async () => {
  let stored = null;
  const localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = null; } };
  const html = readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8');
  const source = readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
  const first = contextFor(html, { StellarSdk: {}, WalletermClient: class {}, localStorage });
  const second = contextFor(html, { StellarSdk: {}, WalletermClient: class {}, localStorage });
  first.run(source); second.run(source);
  first.run("pending={kind:'note', address:'GSOURCE', xdr:'mock', state:'unknown', hash:'original'}; save()");
  second.run("account={address:'GSOURCE'}; render()");
  await second.elements.get('note').onclick();
  assert.equal(JSON.parse(stored).hash, 'original');
  assert.equal(second.run('pending.hash'), 'original');
  assert.equal(second.elements.get('note').disabled, true);
  assert.match(second.elements.get('status').textContent, /Another tab changed/);
});

test('demo selects an existing recent testnet account without recipient input', async () => {
  const calls = [];
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {StrKey:{isValidEd25519PublicKey: value => ['GSOURCE','GREMOVED','GRECIPIENT'].includes(value)}}, WalletermClient: class {},
    localStorage: {getItem: () => null}, fetch: async url => {
      calls.push(url);
      if (url.includes('/operations?')) return ok({_embedded:{records:[{source_account:'GSOURCE'},{source_account:'bad'},{source_account:'GREMOVED'},{source_account:'GRECIPIENT'}]}});
      if (url.endsWith('/GREMOVED')) return {ok:false,status:404,json:async()=>({detail:'Account missing'})};
      return ok({account_id:'GRECIPIENT'});
    },
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("account={address:'GSOURCE'}");
  assert.equal(await f.run('paymentRecipient()'), 'GRECIPIENT');
  assert.equal(f.elements.has('recipient'), false);
  assert.equal(calls.length, 3); assert.ok(calls.every(url => url.startsWith('https://horizon-testnet.stellar.org/')));
});

test('recipient lookup reports failure without choosing an unchecked account', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {StrKey:{isValidEd25519PublicKey: () => true}}, WalletermClient: class {}, localStorage: {getItem: () => null},
    fetch: async url => url.includes('/operations?') ? ok({_embedded:{records:[{source_account:'GCANDIDATE'}]}}) : {ok:false,status:503,json:async()=>({detail:'Horizon unavailable'})},
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("account={address:'GSOURCE'}");
  await assert.rejects(f.run('paymentRecipient()'), /Horizon unavailable/);
});

test('demo funds a missing testnet account once with Friendbot', async () => {
  const calls = []; let funded = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {}, WalletermClient: class {}, localStorage: {getItem: () => null},
    fetch: async url => {
      calls.push(url);
      if (url.startsWith('https://friendbot.stellar.org/')) { funded = true; return ok({}); }
      return funded ? ok({account_id:'GNEW', sequence:'1'}) : {ok:false,status:404,json:async()=>({detail:'Account missing'})};
    },
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("account={address:'GNEW'}");
  assert.equal((await f.run('sourceAccount()')).sequence, '1');
  assert.deepEqual(calls, ['https://horizon-testnet.stellar.org/accounts/GNEW', 'https://friendbot.stellar.org/?addr=GNEW', 'https://horizon-testnet.stellar.org/accounts/GNEW']);
});

test('demo reports a Friendbot failure and does not hide Horizon errors', async () => {
  const run = async responses => {
    const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
      StellarSdk: {}, WalletermClient: class {}, localStorage: {getItem: () => null}, fetch: async () => responses.shift(),
    });
    f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
    f.run("account={address:'GNEW'}");
    return f.run('sourceAccount()');
  };
  const missing = () => ({ok:false,status:404,json:async()=>({detail:'Account missing'})});
  await assert.rejects(run([missing(), {ok:false,status:400,json:async()=>({})}, missing()]), /Friendbot could not fund/);
  await assert.rejects(run([{ok:false,status:503,json:async()=>({detail:'Horizon unavailable'})}]), /Horizon unavailable/);
});

test('an unknown submission expires only after a ledger closes past its time bound', async () => {
  const maxTime = 1_800_000_000;
  const order = [];
  const make = closed => {
    let stored = null;
    return contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' }, TransactionBuilder: { fromXDR: () => ({ sequence: '11', timeBounds: { maxTime: String(maxTime) } }) } },
    WalletermClient: class {}, localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; }, removeItem: () => { stored = null; } },
    fetch: async url => {
      order.push(url.includes('/ledgers?') ? 'ledger' : url.includes('/accounts/') ? 'account' : 'hash');
      if (url.includes('/ledgers?')) return ok({ _embedded: { records: [{ closed_at: new Date(closed * 1000).toISOString() }] } });
      if (url.includes('/accounts/')) return ok({ sequence: accountSequence });
      return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) };
    },
    });
  };
  let accountSequence;
  for (const [closed, sequence, state] of [[maxTime + 5, '10', 'expired'], [maxTime - 5, '10', 'unknown'], [maxTime + 5, '11', 'unknown']]) {
    accountSequence = sequence; const f = make(closed);
    f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
    f.run("pending={kind:'note', state:'unknown', hash:'original', xdr:'mock', address:'GSOURCE'}; save()");
    await f.elements.get('check').onclick(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.run('pending.state'), state);
  }
  assert.deepEqual(order.slice(0, 3), ['ledger', 'hash', 'account']);
});

test('a storage failure before signing leaves the demo usable', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' }, Account: class {}, Operation: { manageData: () => ({}) },
      TransactionBuilder: class { addOperation() { return this; } setTimeout() { return this; } build() { return { toXDR: () => 'mock', hash: () => [1] }; }
      static fromXDR() { return { source: 'GSOURCE', fee: '100', sequence: '2', memo: { value: null }, timeBounds: { minTime: '0', maxTime: '1' }, operations: [{ type: 'manageData', name: 'walleterm-demo' }] }; } } },
    WalletermClient: class {}, crypto: { randomUUID: () => 'id-0000000000000000' },
    localStorage: { getItem: () => null, setItem() { throw Error('Quota'); }, removeItem() {} },
    fetch: async () => ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("account={address:'GSOURCE'}; wallet={}");
  await assert.rejects(f.run("build('note')"), /could not store/);
  assert.equal(f.run('pending'), null);
});

test('cancel removes the newest open offer from Horizon', async () => {
  let built;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' }, Account: class {}, Asset: class { constructor(code, issuer) { this.code = code; this.issuer = issuer; } static native() { return 'XLM'; } },
      Operation: { manageSellOffer: options => { built = options; return {}; } },
      TransactionBuilder: class { addOperation() { return this; } setTimeout() { return this; } build() { return { toXDR: () => 'mock', hash: () => [1] }; }
      static fromXDR() { return { source: 'GSOURCE', fee: '100', sequence: '2', memo: { value: null }, timeBounds: { minTime: '0', maxTime: '1' }, operations: [{ type: 'manageData', name: 'walleterm-demo' }] }; } } },
    WalletermClient: class {}, crypto: { randomUUID: () => 'id-0000000000000000' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async url => url.includes('/offers?') ? ok({ _embedded: { records: [{ id: '77', selling: { asset_type: 'native' },
      buying: { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GISSUER' }, price_r: { n: 10, d: 1 } }] } }) : ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("account={address:'GSOURCE'}; wallet={signTransaction: () => new Promise(() => {})}");
  f.run("build('cancel_offer')");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(built.offerId, '77'); assert.equal(built.amount, '0'); assert.equal(built.buying.code, 'USDC'); assert.equal(built.selling, 'XLM');
});

test('a built transaction waits for Sign before it is signed', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' }, Account: class {}, Operation: { manageData: () => ({}) },
      TransactionBuilder: class { addOperation() { return this; } setTimeout() { return this; } build() { return { toXDR: () => 'mock', hash: () => [1] }; }
      static fromXDR() { return { source: 'GSOURCE', fee: '100', sequence: '2', memo: { value: null }, timeBounds: { minTime: '0', maxTime: '1' }, operations: [{ type: 'manageData', name: 'walleterm-demo' }] }; } } },
    WalletermClient: class {}, crypto: { randomUUID: () => 'id-0000000000000000' },
    navigator: { locks: { request: async (_name, fn) => fn() } },
    localStorage: { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; }, removeItem() { this.value = null; } },
    fetch: async () => ok({ account_id: 'GSOURCE', sequence: '1' }),
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("account={address:'GSOURCE'}; signs=0; wallet={token:'mock', signTransaction: async () => { signs++; return new Promise(() => {}); }}");
  await f.elements.get('note').onclick();
  f.run('render()');
  assert.equal(f.elements.get('review').open, true);
  const record = f.run('JSON.stringify(pending)');
  f.elements.get('close-review').onclick();
  assert.equal(f.elements.get('review').open, false);
  assert.equal(f.run('JSON.stringify(pending)'), record);
  assert.equal(f.elements.get('transaction-record').hidden, false);
  f.elements.get('open-review').onclick();
  assert.equal(f.elements.get('review').open, true);
  assert.equal(f.run('pending.state'), 'review'); assert.equal(f.run('signs'), 0);
  assert.equal(f.elements.get('sign').hidden, false); assert.equal(f.elements.get('sign').disabled, false); assert.equal(f.elements.get('clear').textContent, 'Discard');
  assert.match(f.elements.get('details').textContent, /"name": "walleterm-demo"/);
  f.run("wallet.token=null; render()"); assert.equal(f.elements.get('sign').disabled, true); f.run("wallet.token='mock'; render()");
  f.elements.get('sign').onclick(); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.run('signs'), 1); assert.equal(f.run('pending.state'), 'waiting');
});

test('a saved review with invalid XDR blocks actions without breaking the page', () => {
  const stored = JSON.stringify({ state: 'review', kind: 'note', address: 'GSOURCE', hash: 'h', xdr: 'broken' });
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' }, TransactionBuilder: { fromXDR: () => { throw Error('bad XDR'); } } },
    WalletermClient: class {}, localStorage: { getItem: () => stored, setItem() {}, removeItem() {} },
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  assert.equal(f.run('journalBlocked'), true); assert.equal(f.run('busy'), false);
  assert.match(f.elements.get('status').textContent, /could not be read/);
});

test('the action modal opens before account lookup and keeps preparation errors visible', async () => {
  let fail;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {}, localStorage: { getItem: () => null },
    fetch: () => new Promise((_resolve, reject) => { fail = reject; }),
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("account={address:'GSOURCE'}; wallet={token:'mock'}");
  const creating = f.elements.get('payment').onclick();
  assert.equal(f.elements.get('review').open, true);
  assert.equal(f.elements.get('review-title').textContent, 'Pay 0.01 test XLM');
  assert.match(f.elements.get('review-status').textContent, /Preparing/);
  assert.equal(f.elements.get('sign').hidden, true);
  fail(Error('Horizon unavailable')); await creating;
  assert.equal(f.elements.get('review').open, true);
  assert.equal(f.elements.get('review-status').textContent, 'Horizon unavailable');
  assert.equal(f.run('pending'), null);
  assert.equal(f.elements.get('transaction-details').hidden, true);
  assert.equal(f.elements.get('sign').hidden, true);
});

test('connection work disables demo actions and signing without changing the journal', () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {}, localStorage: { getItem: () => null },
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("wallet={token:'mock'}; account={address:'GTEST'}; connection.working=true; render()");
  for (const name of ['note', 'payment', 'offer', 'cancel-offer']) assert.equal(f.elements.get(name).disabled, true);
  f.run("pending={state:'signed',kind:'note',address:'GTEST',xdr:'unsigned',signed_xdr:'signed'}; render()");
  assert.equal(f.elements.get('submit').disabled, true); assert.equal(f.elements.get('clear').disabled, true);
  f.run('connection.working=false; render()');
  assert.equal(f.elements.get('submit').disabled, false); assert.equal(f.run('pending.state'), 'signed');
});

test('only an active request shows progress; stopped signing cannot be canceled again', () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), { StellarSdk: {}, localStorage: { getItem: () => null } });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  f.run("pending={kind:'note',state:'waiting',address:'GTEST'}; render()");
  assert.equal(f.elements.get('cancel-request').hidden, true); assert.equal(f.elements.get('review-progress').hidden, true);
  f.run("busy=true; actionPhase='signing'; signingController=new AbortController(); render()");
  assert.equal(f.elements.get('cancel-request').disabled, false); assert.equal(f.elements.get('review-progress').hidden, false);
  f.elements.get('cancel-request').onclick();
  assert.equal(f.elements.get('cancel-request').disabled, true); assert.match(f.elements.get('review-progress').textContent, /Canceling/);
  f.run("busy=false; pending.state='signing_unknown'; signingController=null; render()");
  assert.equal(f.elements.get('review-progress').hidden, true);
});
