import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { parseConnection, scanConnection } from '../sdk/scan.js';
const pairing = () => ({ walleterm: 2, url: 'https://bridge.example', code: '00123456', expires_at: new Date(Date.now() + 300000).toISOString() });
function pixels(value) {
  const qr = QRCode.create(JSON.stringify(value)), size = (qr.modules.size + 8) * 5;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < qr.modules.size; y++) for (let x = 0; x < qr.modules.size; x++) if (qr.modules.get(y, x)) {
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) {
      const index = (((y + 4) * 5 + a) * size + (x + 4) * 5 + b) * 4;
      data[index] = data[index + 1] = data[index + 2] = 0;
    }
  }
  return { data, size };
}
test('the QR decoder reads the tunnel payload and retains leading zeroes', () => {
  const p = pairing(), image = pixels(p), result = jsQR(image.data, image.size, image.size);
  assert.deepEqual(parseConnection(result.data), { url: p.url, code: p.code });
  for (const changed of [{ ...p, walleterm: 1 }, { ...p, code: '1234' }, { ...p, url: 'javascript:alert(1)' }, { ...p, url: p.url + '/path' }, { ...p, expires_at: '2000-01-01' }]) {
    assert.throws(() => parseConnection(JSON.stringify(changed)));
  }
});
function browser(t, getUserMedia) {
  const p = pairing(), image = pixels(p), events = new EventTarget(); let stopped = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const values = { isSecureContext: true, jsQR, navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: image.data }) }) }) },
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    requestAnimationFrame: fn => setTimeout(() => fn(200), 1), cancelAnimationFrame: clearTimeout };
  for (const [key, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key); Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => { if (original) Object.defineProperty(globalThis, key, original); else delete globalThis[key]; });
  }
  const video = { videoWidth: image.size, videoHeight: image.size, readyState: 2, play: async () => {} };
  return { video, stream, stopped: () => stopped, events, p };
}
test('camera scan returns the connection and stops all camera tracks', async t => {
  const f = browser(t); assert.deepEqual(await scanConnection(f.video), { url: f.p.url, code: f.p.code });
  assert.ok(f.stopped()); assert.equal(f.video.srcObject, null);
});
test('canceling before camera permission resolves stops the late stream', async t => {
  let grant; const f = browser(t, () => new Promise(resolve => { grant = resolve; })), controller = new AbortController();
  const scanning = scanConnection(f.video, { signal: controller.signal }); controller.abort(Error('Canceled')); grant(f.stream);
  await assert.rejects(scanning, /Canceled/); assert.ok(f.stopped()); assert.equal(f.video.srcObject, null);
});
test('leaving the page before camera permission resolves stops the late stream', async t => {
  let grant; const f = browser(t, () => new Promise(resolve => { grant = resolve; }));
  const scanning = scanConnection(f.video); f.events.dispatchEvent(new Event('pagehide')); grant(f.stream);
  await assert.rejects(scanning, /page closed/); assert.ok(f.stopped());
});
