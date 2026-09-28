import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { parseConnection, scanConnection } from '../sdk/scan.ts';
const pairing = () => ({
  walleterm: 3,
  url: 'https://bridge.example',
  code: '00123456',
  expires_at: new Date(Date.now() + 300000).toISOString(),
});
function pixels(value: ReturnType<typeof pairing>) {
  const qr = QRCode.create(JSON.stringify(value)),
    size = (qr.modules.size + 8) * 5;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < qr.modules.size; y++)
    for (let x = 0; x < qr.modules.size; x++)
      if (qr.modules.get(y, x)) {
        for (let a = 0; a < 5; a++)
          for (let b = 0; b < 5; b++) {
            const index = (((y + 4) * 5 + a) * size + (x + 4) * 5 + b) * 4;
            data[index] = data[index + 1] = data[index + 2] = 0;
          }
      }
  return { data, size };
}
test('the QR decoder reads the tunnel payload and retains leading zeroes', () => {
  const p = pairing(),
    image = pixels(p),
    result = jsQR(image.data, image.size, image.size);
  assert.ok(result);
  assert.deepEqual(parseConnection(result.data), { url: p.url, code: p.code });
  for (const changed of [
    { ...p, walleterm: 1 },
    { ...p, code: '1234' },
    { ...p, url: 'javascript:alert(1)' },
    { ...p, url: p.url + '/path' },
    { ...p, expires_at: '2000-01-01' },
  ]) {
    assert.throws(() => parseConnection(JSON.stringify(changed)));
  }
});
// The scanner reads only these camera stream and video fields.
interface MockStream {
  getTracks(): { stop(): void }[];
}
interface MockVideo {
  videoWidth: number;
  videoHeight: number;
  readyState: number;
  play(): Promise<void>;
  srcObject?: MediaProvider | null;
}
function browser(getUserMedia?: () => Promise<MockStream>) {
  const p = pairing(),
    image = pixels(p),
    events = new EventTarget();
  let stopped = 0;
  const stream: MockStream = {
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
    ],
  };
  const values = {
    isSecureContext: true,
    jsQR,
    navigator: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } },
    document: {
      createElement: () => ({
        getContext: () => ({ drawImage() {}, getImageData: () => ({ data: image.data }) }),
      }),
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(200), 1),
    cancelAnimationFrame: clearTimeout,
  };
  for (const [key, value] of Object.entries(values)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    onTestFinished(() => {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  const mock: MockVideo = {
    videoWidth: image.size,
    videoHeight: image.size,
    readyState: 2,
    play: async () => {},
  };
  // A narrow mock stands in for the DOM element. The scanner uses only the MockVideo fields.
  return { mock, video: mock as HTMLVideoElement, stream, stopped: () => stopped, events, p };
}
// The scanner loads its decoder before it asks for the camera. Cancel only after the camera request starts.
function permission() {
  const asked = Promise.withResolvers<void>(),
    grant = Promise.withResolvers<MockStream>();
  return {
    requested: asked.promise,
    grant,
    getUserMedia: () => {
      asked.resolve();
      return grant.promise;
    },
  };
}
test('camera scan returns the connection and stops all camera tracks', async () => {
  const f = browser();
  assert.deepEqual(await scanConnection(f.video), { url: f.p.url, code: f.p.code });
  assert.ok(f.stopped());
  assert.equal(f.mock.srcObject, null);
});
test('canceling before camera permission resolves stops the late stream', async () => {
  const { requested, grant, getUserMedia } = permission();
  const f = browser(getUserMedia),
    controller = new AbortController();
  const scanning = scanConnection(f.video, { signal: controller.signal });
  await requested;
  controller.abort(Error('Canceled'));
  grant.resolve(f.stream);
  await assert.rejects(scanning, /Canceled/);
  assert.ok(f.stopped());
  assert.equal(f.mock.srcObject, null);
});
test('canceling an unanswered camera request settles before permission responds', async () => {
  const { requested, grant, getUserMedia } = permission();
  const f = browser(getUserMedia),
    controller = new AbortController();
  const scanning = scanConnection(f.video, { signal: controller.signal });
  await requested;
  controller.abort(Error('Canceled'));
  await assert.rejects(
    Promise.race([
      scanning,
      new Promise((_, reject) => setTimeout(() => reject(Error('Scan stayed open')), 100)),
    ]),
    /Canceled/,
  );
  grant.resolve(f.stream);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(f.stopped());
});
test('canceling an unanswered video start stops the camera', async () => {
  const f = browser(),
    controller = new AbortController();
  f.mock.play = () => new Promise(() => {});
  const scanning = scanConnection(f.video, { signal: controller.signal });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort(Error('Canceled'));
  await assert.rejects(
    Promise.race([
      scanning,
      new Promise((_, reject) => setTimeout(() => reject(Error('Scan stayed open')), 100)),
    ]),
    /Canceled/,
  );
  assert.ok(f.stopped());
});
test('canceling during decoder loading ends the scan before camera access', async () => {
  let requested = false;
  const f = browser(async () => {
      requested = true;
      return f.stream;
    }),
    controller = new AbortController();
  Reflect.deleteProperty(globalThis, 'jsQR');
  const scanning = scanConnection(f.video, { signal: controller.signal });
  controller.abort(Error('Canceled'));
  await assert.rejects(scanning, /Canceled/);
  assert.equal(requested, false);
});
test('leaving the page before camera permission resolves stops the late stream', async () => {
  const { requested, grant, getUserMedia } = permission();
  const f = browser(getUserMedia);
  const scanning = scanConnection(f.video);
  await requested;
  f.events.dispatchEvent(new Event('pagehide'));
  grant.resolve(f.stream);
  await assert.rejects(scanning, /page closed/);
  assert.ok(f.stopped());
});
