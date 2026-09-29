import { deadline, requestError } from './errors.js';
// Camera access starts only when the calling site asks to scan.
import type { Connection, SignalOptions } from './types.js';

export function parseConnection(value: string): Connection {
  let data;
  try {
    data = JSON.parse(value);
  } catch {
    throw Error('Scan a Walleterm tunnel QR code.');
  }
  if (!data || data.walleterm !== 3 || typeof data.code !== 'string' || !/^\d{8}$/.test(data.code))
    throw Error('Scan a Walleterm tunnel QR code.');
  const url = new URL(data.url);
  if (
    url.origin !== data.url ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
  )
    throw Error('The tunnel URL is invalid.');
  if (!Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now())
    throw Error('This QR code expired. Use the current code from the tunnel terminal.');
  return { url: data.url, code: data.code };
}
export async function scanConnection(
  video: HTMLVideoElement,
  { signal: callerSignal }: SignalOptions = {},
): Promise<Connection> {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([
    lifetime.signal,
    deadline(120000, 'The camera found no tunnel QR code in 2 minutes.'),
    ...(callerSignal ? [callerSignal] : []),
  ]);
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw Error('Camera access requires HTTPS.');
  signal?.throwIfAborted();
  const abortable = <T>(promise: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const aborted = () => {
        signal.removeEventListener('abort', aborted);
        reject(signal.reason || Error('Scanning stopped.'));
      };
      if (signal.aborted) return aborted();
      signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve(promise).then(
        (value) => {
          signal.removeEventListener('abort', aborted);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener('abort', aborted);
          reject(error);
        },
      );
    });
  let stream: MediaStream | undefined, frame: number | undefined;
  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  const pageGone = () => lifetime.abort(Error('The page closed.'));
  globalThis.addEventListener('pagehide', pageGone, { once: true });
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const { default: jsQR } = await abortable(import('jsqr'));
    signal?.throwIfAborted();
    // A late camera permission response must also stop its tracks after cancellation.
    const acquiring = navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    acquiring.then(
      (late) => {
        if (signal.aborted) late.getTracks().forEach((track) => track.stop());
      },
      () => {},
    );
    stream = await abortable(acquiring);
    signal?.throwIfAborted();
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await abortable(video.play());
    signal?.throwIfAborted();
    const canvas = document.createElement('canvas'),
      context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw Error('The camera canvas is unavailable.');
    return await new Promise<Connection>((resolve, reject) => {
      const aborted = () => reject(signal.reason || Error('Scanning stopped.'));
      signal?.addEventListener('abort', aborted, { once: true });
      const finish = (error: unknown, value?: Connection) => {
        signal?.removeEventListener('abort', aborted);
        error ? reject(error) : value && resolve(value);
      };
      let last = 0;
      const scan = (time: number) => {
        if (signal?.aborted) return finish(signal.reason);
        try {
          if (video.readyState >= 2 && video.videoWidth && time - last >= 150) {
            last = time;
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(pixels.data, canvas.width, canvas.height);
            if (code) return finish(null, parseConnection(code.data));
          }
          frame = requestAnimationFrame(scan);
        } catch (errorValue) {
          const error = requestError(errorValue);
          finish(error);
        }
      };
      frame = requestAnimationFrame(scan);
    });
  } finally {
    stop();
    signal?.removeEventListener('abort', stop);
    globalThis.removeEventListener('pagehide', pageGone);
  }
}
