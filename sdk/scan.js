// Camera access starts only when the calling site asks to scan.
export function parseConnection(value) {
  let data;
  try { data = JSON.parse(value); } catch { throw Error('Scan a Walleterm tunnel QR code.'); }
  if (!data || data.walleterm !== 2 || typeof data.code !== 'string' || !/^\d{8}$/.test(data.code)) throw Error('Scan a Walleterm tunnel QR code.');
  const url = new URL(data.url);
  if (url.origin !== data.url || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw Error('The tunnel URL is invalid.');
  if (!Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) throw Error('This QR code expired. Use the current code from the tunnel terminal.');
  return { url: data.url, code: data.code };
}
export async function scanConnection(video, { signal } = {}) {
  const lifetime = new AbortController();
  signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(120000), ...(signal ? [signal] : [])]);
  if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error('Camera access requires HTTPS. Enter the tunnel URL and code instead.');
  signal?.throwIfAborted();
  if (!globalThis.jsQR) await import('./jsqr.js');
  signal?.throwIfAborted();
  let stream, frame;
  const stop = () => { if (frame) cancelAnimationFrame(frame); stream?.getTracks().forEach(track => track.stop()); video.srcObject = null; };
  const pageGone = () => lifetime.abort(Error('The page closed.'));
  globalThis.addEventListener('pagehide', pageGone, { once: true });
  signal?.addEventListener('abort', stop, { once: true });
  try {
    // A late camera permission response must also stop its tracks after cancellation.
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    signal?.throwIfAborted();
    video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play();
    signal?.throwIfAborted();
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
    return await new Promise((resolve, reject) => {
      const aborted = () => reject(signal.reason || Error('Scanning stopped.'));
      signal?.addEventListener('abort', aborted, { once: true });
      const finish = (error, value) => { signal?.removeEventListener('abort', aborted); error ? reject(error) : resolve(value); };
      let last = 0;
      const scan = time => {
        if (signal?.aborted) return finish(signal.reason);
        try {
          if (video.readyState >= 2 && video.videoWidth && time - last >= 150) {
            last = time;
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = globalThis.jsQR(pixels.data, canvas.width, canvas.height);
            if (code) return finish(null, parseConnection(code.data));
          }
          frame = requestAnimationFrame(scan);
        } catch (error) { finish(error); }
      };
      frame = requestAnimationFrame(scan);
    });
  } finally { stop(); signal?.removeEventListener('abort', stop); globalThis.removeEventListener('pagehide', pageGone); }
}
