import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture(scanConnection) {
  let focused;
  const nodes = new Map();
  const node = name => {
    if (!nodes.has(name)) nodes.set(name, { hidden: false, value: '', setAttribute() {}, removeAttribute() {}, focus() { focused = name; } });
    return nodes.get(name);
  };
  const context = vm.createContext({ scanConnection, AbortController });
  const source = readFileSync(new URL('../sdk/connect.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replace('export class', 'class');
  vm.runInContext(source, context);
  const ui = vm.runInContext('Object.create(WalletermConnect.prototype)', context);
  Object.assign(ui, { $: node, element: { querySelector: node }, trigger: node('trigger'),
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
