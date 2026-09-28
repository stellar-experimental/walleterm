import { onTestFinished, test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import jsQR from 'jsqr';
import { parseConnection, scanConnection } from '../../sdk/scan.ts';

// The tunnel's own terminal QR code, written by src/qr.rs tests. Line 1 is its payload.
const [payload, ...rows] = readFileSync(new URL('./pairing-qr.txt', import.meta.url), 'utf8').split('\n');
const pairing = () =>
  JSON.parse(payload) as { walleterm: number; url: string; code: string; expires_at: string };
function pixels(value: ReturnType<typeof pairing>) {
  assert.equal(JSON.stringify(value), payload);
  // Each character holds two modules: top and bottom half. Five pixels per module, four more quiet modules.
  const lines = rows.filter(Boolean).map((line) => [...line.replace(/\x1b\[[0-9;]*m/g, '')]);
  const width = lines[0].length,
    height = lines.length * 2,
    size = (Math.max(width, height) + 8) * 5;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const dark = (x: number, y: number) => {
    const cell = lines[y >> 1][x];
    return cell === '\u2588' || cell === (y % 2 ? '\u2584' : '\u2580');
  };
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (dark(x, y)) {
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
