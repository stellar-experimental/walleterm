import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function element() { return { hidden: false, disabled: false, value: '', textContent: '', children: [],
  append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, add() {} }; }
function contextFor(html, extras = {}) {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(m => [m[1], element()]));
  const context = vm.createContext({ document: { getElementById: id => elements.get(id), createElement: element }, URLSearchParams, AbortSignal, AbortController,
    location: { hash: '' }, history: { replaceState() {} }, setInterval() {}, Option: class {}, ...extras });
  return { context, elements, run: code => vm.runInContext(code, context) };
}
const ok = data => ({ ok: true, json: async () => data });
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
  f.run("pending={state:'unknown', hash:'original'}; save(); render();");
  assert.equal(f.elements.get('clear').hidden, true); assert.equal(f.elements.get('check').hidden, false);
  const restored = contextFor(html, { StellarSdk: {Networks:{TESTNET:'testnet'}}, WalletermClient: class {}, localStorage: { getItem: () => stored, setItem() {}, removeItem() {} } });
  restored.run(source); assert.equal(restored.run('pending.state'), 'unknown'); assert.equal(restored.elements.get('clear').hidden, true);
});

test('a reload ends an open signing request', () => {
  const stored = JSON.stringify({ state: 'waiting', xdr: 'mock' }); let removed = false;
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: {Networks:{TESTNET:'testnet'}}, WalletermClient: class {}, localStorage: { getItem: () => stored, setItem() {}, removeItem: () => { removed = true; } },
  });
  f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
  assert.equal(f.run('pending'), null); assert.equal(removed, true);
  assert.match(f.elements.get('status').textContent, /stopped when the page closed/);
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
  const make = closed => contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' }, TransactionBuilder: { fromXDR: () => ({ sequence: '11', timeBounds: { maxTime: String(maxTime) } }) } },
    WalletermClient: class {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    fetch: async url => {
      order.push(url.includes('/ledgers?') ? 'ledger' : url.includes('/accounts/') ? 'account' : 'hash');
      if (url.includes('/ledgers?')) return ok({ _embedded: { records: [{ closed_at: new Date(closed * 1000).toISOString() }] } });
      if (url.includes('/accounts/')) return ok({ sequence: accountSequence });
      return { ok: false, status: 404, json: async () => ({ detail: 'Not found' }) };
    },
  });
  let accountSequence;
  for (const [closed, sequence, state] of [[maxTime + 5, '10', 'expired'], [maxTime - 5, '10', 'unknown'], [maxTime + 5, '11', 'unknown']]) {
    accountSequence = sequence; const f = make(closed);
    f.run(readFileSync(new URL('../demo/site/app.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, ''));
    f.run("pending={state:'unknown', hash:'original', xdr:'mock', address:'GSOURCE'}");
    await f.elements.get('check').onclick(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.run('pending.state'), state);
  }
  assert.deepEqual(order.slice(0, 3), ['ledger', 'hash', 'account']);
});

test('a storage failure before signing leaves the demo usable', async () => {
  const f = contextFor(readFileSync(new URL('../demo/site/index.html', import.meta.url), 'utf8'), {
    StellarSdk: { Networks: { TESTNET: 'testnet' }, Account: class {}, Operation: { manageData: () => ({}) },
      TransactionBuilder: class { addOperation() { return this; } setTimeout() { return this; } build() { return { toXDR: () => 'mock', hash: () => [1] }; } } },
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
      TransactionBuilder: class { addOperation() { return this; } setTimeout() { return this; } build() { return { toXDR: () => 'mock', hash: () => [1] }; } } },
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
