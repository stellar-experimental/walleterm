import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture(scanConnection, WalletermClient) {
  let focused;
  const nodes = new Map();
  const node = name => {
    if (!nodes.has(name)) nodes.set(name, { hidden: false, value: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, querySelector() {}, focus() { focused = name; } });
    return nodes.get(name);
  };
  const context = vm.createContext({ scanConnection, WalletermClient, AbortController, AbortSignal, URL });
  const source = readFileSync(new URL('../sdk/connect.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace('export class', 'class');
  vm.runInContext(source, context);
  const ui = vm.runInContext('Object.create(WalletermConnect.prototype)', context);
  Object.assign(ui, { $: node, element: { querySelector: node, querySelectorAll: () => [] }, trigger: node('trigger'),
    dialog: { open: false, showModal() { this.open = true; node('close').focus(); }, close() { this.open = false; } } });
  return { ui, node, focused: () => focused };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('opening the connection dialog focuses Scan and leaves camera access to an explicit action', () => {
  let calls = 0;
  const f = fixture(() => { calls++; return new Promise(() => {}); });
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
  const f = fixture(async () => { throw Error('Permission denied'); });
  f.ui.open(); await f.ui.scan();
  assert.equal(f.node('form').hidden, false);
  assert.equal(f.focused(), 'scan');
  assert.match(f.node('status').textContent, /Permission denied/);
});

test('a successful scan fills the details and focuses Continue', async () => {
  const f = fixture(async () => ({ url: 'https://bridge.example', code: '00123456' }));
  f.ui.open(); await f.ui.scan();
  assert.equal(f.node('url').value, 'https://bridge.example');
  assert.equal(f.node('code').value, '00123456');
  assert.equal(f.focused(), 'continue');
});

test('an old canceled scan cannot hide the camera after immediate reopening', async () => {
  const requests = [];
  const f = fixture((_video, { signal }) => new Promise((_resolve, reject) => {
    requests.push(signal); signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  f.ui.open(); f.ui.scan(); f.ui.close(); f.ui.open(); f.ui.scan(); await settle();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].aborted, true);
  assert.equal(requests[1].aborted, false);
  assert.equal(f.node('scanner').hidden, false);
  f.ui.close(); await settle();
  assert.equal(requests[1].aborted, true);
});

test('changing a wallet uses the current client and does not open the scanner', async () => {
  let scans = 0, selected, changed;
  const f = fixture(() => { scans++; });
  const client = { token: 'session', selectWallet: async address => { selected = address; return { address }; } };
  Object.assign(f.ui, { client, account: { address: 'GFIRST' }, update() {}, refresh: async () => {}, onChange: value => { changed = value; } });
  await f.ui.changeWallet({ public_key: 'GSECOND' });
  assert.equal(selected, 'GSECOND'); assert.equal(scans, 0); assert.equal(f.ui.dialog.open, false);
  assert.equal(f.ui.client, client); assert.equal(changed.client, client); assert.equal(changed.account.address, 'GSECOND');
});

test('the connection UI publishes the recovered account after a lost selection response', async () => {
  const f = fixture(() => {}); let changed;
  const client = { token: 'session', account: { address: 'GRECOVERED' }, selectWallet: async () => { throw Error('Response lost'); } };
  Object.assign(f.ui, { client, account: { address: 'GFIRST' }, update() {}, refresh: async () => {}, onChange: value => { changed = value; } });
  await f.ui.changeWallet({ public_key: 'GSECOND' });
  assert.equal(changed.account.address, 'GRECOVERED'); assert.equal(f.ui.account.address, 'GRECOVERED');
  assert.match(f.node('menu-status').textContent, /Response lost/);
});

test('Continue requires an allowed origin and exactly eight digits', async () => {
  let connects = 0;
  const f = fixture(() => {}, class { constructor() { connects++; } });
  for (const [url, code, valid] of [
    ['', '', false], ['https://bridge.example', '', false], ['https://bridge.example', '123', false],
    ['https://bridge.example/path', '12345678', false], ['http://bridge.example', '12345678', false],
    ['https://user:password@bridge.example', '12345678', false], ['https://bridge.example?code=1', '12345678', false],
    ['https://bridge.example/', '00123456', true], ['http://127.0.0.1:8787', '12345678', true],
    ['https://bridge.example', '12345678 ', false],
  ]) {
    f.node('url').value = url; f.node('code').value = code; f.ui.update();
    assert.equal(f.node('continue').disabled, !valid, `${url} ${code}`);
    if (!valid) await f.ui.connect();
  }
  assert.equal(connects, 0);
});

test('a connection disables its inputs and prevents duplicate requests until failure settles', async () => {
  let reject, calls = 0; const busy = [];
  const f = fixture(() => {}, class {
    async connect() { calls++; await new Promise((_resolve, failed) => { reject = failed; }); }
    async disconnect() {}
  });
  f.ui.onBusyChange = value => busy.push(value);
  f.node('url').value = 'https://bridge.example'; f.node('code').value = '12345678';
  const pending = f.ui.connect();
  assert.equal(f.node('continue').disabled, true); assert.equal(f.node('url').disabled, true);
  assert.equal(f.node('scan').disabled, true); assert.equal(f.ui.working, true);
  await f.ui.connect(); assert.equal(calls, 1);
  reject(Error('Connection failed')); await pending;
  assert.equal(f.ui.working, false); assert.equal(f.node('url').disabled, false);
  assert.equal(f.node('continue').disabled, false); assert.deepEqual(busy, [true, false]);
});

test('wallet selection locks immediately and accepts only the first click', async () => {
  const f = fixture(() => {}); let choose;
  f.ui.rows = (_target, _keys, callback) => { choose = callback; };
  const controller = new AbortController();
  const pending = f.ui.chooseWallet({}, [{ public_key: 'GFIRST' }, { public_key: 'GSECOND' }], controller.signal);
  assert.equal(f.ui.phase, 'choosing');
  choose({ public_key: 'GFIRST' }); choose({ public_key: 'GSECOND' });
  assert.equal(f.ui.phase, 'selecting'); assert.equal(f.ui.selectingKey, 'GFIRST');
  assert.equal(await pending, 'GFIRST');
});

test('wallet refresh prevents overlapping discovery and blocks selection until it settles', async () => {
  let resolve, calls = 0, selections = 0;
  const f = fixture(() => {});
  f.ui.client = { url: 'https://bridge.example', token: 'mock', listWallets: async () => { calls++; return new Promise(done => { resolve = done; }); }, selectWallet: async () => { selections++; } };
  f.ui.account = { address: 'GFIRST' }; f.ui.wallets = []; f.ui.rows = () => {};
  const pending = f.ui.refresh();
  assert.equal(f.node('refresh').disabled, true);
  await f.ui.refresh(); await f.ui.changeWallet({ public_key: 'GSECOND' });
  assert.equal(calls, 1); assert.equal(selections, 0);
  resolve([]); await pending;
  assert.equal(f.node('refresh').disabled, false); assert.equal(f.ui.refreshing, false);
});

test('retrying empty wallet discovery locks the retry button and restores it after failure', async () => {
  let reject, calls = 0; const f = fixture(() => {}); f.ui.rows = () => {};
  const controller = new AbortController();
  const pending = f.ui.chooseWallet({ listWallets: async () => { calls++; return new Promise((_done, failed) => { reject = failed; }); } }, [], controller.signal);
  const retry = f.node('retry-wallets').onclick;
  const attempt = retry(); await retry();
  assert.equal(calls, 1); assert.equal(f.node('retry-wallets').disabled, true);
  reject(Error('Discovery failed')); await attempt;
  assert.equal(f.node('retry-wallets').disabled, false);
  const stopped = assert.rejects(pending); controller.abort(); await stopped;
});
