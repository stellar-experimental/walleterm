import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Networks } from '@stellar/stellar-sdk';
import { availableSigners, signDigest } from './signer.mjs';
import { attachSignature, inspectTransaction } from './transaction.mjs';

const token = () => randomBytes(32).toString('base64url');
const fail = (status, message) => Object.assign(Error(message), { status });
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const active = r => ['pending', 'approved', 'signing'].includes(r.state);
const iso = time => new Date(time).toISOString();
export function validOrigin(value) {
  try {
    const u = new URL(value);
    return u.origin === value && (u.protocol === 'https:' || u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
  } catch { return false; }
}
export function sendJson(res, status, value, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'Use application/json.');
  let length = 0; const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 49152) throw fail(413, 'The request is too large.');
    chunks.push(chunk);
  }
  try { const data = JSON.parse(Buffer.concat(chunks)); if (!data || Array.isArray(data) || typeof data !== 'object') throw Error(); return data; }
  catch { throw fail(400, 'Send one JSON object.'); }
}
// The website approves a request by sending it. `review` is the hook for a later automated policy check.
const approveAll = async () => true;
// State stays in memory. A restart ends all sessions and requests.
// Stellar sequence numbers and the five-minute expiry keep a signature from applying twice.
export function createBridge({ port = 8787, publicOrigin, listSigners = availableSigners, sign = signDigest, review = approveAll,
  log = line => process.stdout.write(line), now = Date.now } = {}) {
  const records = new Map(), sessions = new Map();
  const controller = new AbortController(), jobs = new Set();
  let origin = publicOrigin || `http://127.0.0.1:${port}`;
  let pairExpires, pairTimer, pairCode = newCode(), attempts = 0, lockedUntil = 0, closing = false, closePromise;
  let pairingChanged = () => {}, queue = Promise.resolve();
  const reviews = new Map();
  // Concurrent website calls share one `walleterm list` process.
  let listing;
  function keys() {
    listing ??= listSigners({ signal: controller.signal }).finally(() => { listing = undefined; });
    return listing;
  }
  function newCode() { return String(randomInt(100000000)).padStart(8, '0'); }
  function restartCodeTimer() {
    pairExpires = now() + 300000; clearTimeout(pairTimer);
    pairTimer = setTimeout(rotateCode, 300000); pairTimer.unref();
  }
  function rotateCode() { pairCode = newCode(); attempts = 0; restartCodeTimer(); pairingChanged(); }
  restartCodeTimer();
  // The terminal records each produced or withheld signature.
  function logResult(r) {
    if (r.logged === r.state) return;
    r.logged = r.state;
    const about = `${r.details.hash} (account ${r.public_key}, sequence ${r.details.sequence})`;
    if (r.state === 'signed') log(`Signed ${about} for ${r.origin}.\n`);
    if (r.state === 'unknown') log(`Signature withheld or stopped for ${about}: ${r.message}\n`);
  }
  function website(req) {
    const s = sessions.get(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!s || s.revoked || s.origin !== req.headers.origin || now() >= s.expires) throw fail(401, 'Connect this website with a new code from the tunnel terminal.');
    return s;
  }
  function summary(r) {
    if (r.state === 'signed') r.delivered = true;
    return { id: r.id, state: r.state, hash: r.details.hash, expires_at: iso(r.expires), message: r.message,
      ...(r.state === 'signed' ? { signed_xdr: r.signed_xdr } : {}) };
  }
  function expire() {
    for (const r of records.values()) if (r.state === 'pending' && now() >= r.expires) { r.state = 'expired'; logResult(r); reviews.get(r.record_id)?.abort(); }
    // Memory keeps live sessions and records that are active or belong to them.
    const live = new Set();
    for (const [key, s] of sessions) { if (s.revoked || now() >= s.expires) sessions.delete(key); else live.add(s.id); }
    for (const [id, r] of records) if (!active(r) && !live.has(r.session_id)) records.delete(id);
  }
  function revoke(s) {
    s.revoked = true;
    for (const r of records.values()) if (r.session_id === s.id && (active(r) || r.state === 'signed')) {
      r.state = r.state === 'signing' ? 'unknown' : 'denied'; r.message = 'The website connection was revoked.'; delete r.signed_xdr; logResult(r); reviews.get(r.record_id)?.abort();
    }
  }
  function scheduleReview(r, s) {
    const canceled = new AbortController(); reviews.set(r.record_id, canceled);
    const job = queue.then(async () => {
      expire();
      if (closing || r.state !== 'pending' || s.revoked || now() >= s.expires) {
        reviews.delete(r.record_id);
        if (r.state === 'pending') { r.state = 'expired'; logResult(r); }
        return;
      }
      const signal = AbortSignal.any([controller.signal, canceled.signal, AbortSignal.timeout(Math.max(1, r.expires - now()))]);
      try {
        const approved = await review({ origin: r.origin, signer: { ...s.key }, details: structuredClone(r.details) }, { signal });
        if (signal.aborted || r.state !== 'pending' || s.revoked || now() >= s.expires || now() >= r.expires) return;
        if (!approved) { r.state = 'denied'; logResult(r); return; }
        inspectTransaction(r.input, r.public_key, now());
        r.state = 'approved'; logResult(r);
        const keys = await listSigners({ signal });
        if (signal.aborted || r.state !== 'approved' || s.revoked || now() >= s.expires || now() >= r.expires) throw Error('The signing approval expired or was canceled.');
        if (!keys.some(k => k.public_key === r.public_key)) throw Error('The selected key is no longer available.');
        r.state = 'signing'; logResult(r);
        const signature = await sign(r.public_key, r.details.hash, { signal });
        if (r.state !== 'signing') log(`1Password returned a signature after cancellation. Withheld ${r.details.hash}.\n`);
        const signed = attachSignature(r.input, r.public_key, signature);
        if (signal.aborted || r.state !== 'signing' || s.revoked || now() >= s.expires || now() >= r.expires) throw Error('The signing result is withheld because approval expired or was canceled.');
        r.signed_xdr = signed; r.state = 'signed'; logResult(r);
      } catch (error) {
        if (['pending', 'approved', 'signing', 'signed'].includes(r.state)) {
          r.state = ['signing', 'signed'].includes(r.state) ? 'unknown' : now() >= r.expires ? 'expired' : 'denied';
          delete r.signed_xdr; r.message = error.message; logResult(r);
        }
      } finally {
        if (r.state === 'pending') { r.state = now() >= r.expires ? 'expired' : 'denied'; logResult(r); }
        reviews.delete(r.record_id);
      }
    });
    queue = job.catch(() => {}); jobs.add(job); job.finally(() => jobs.delete(job)).catch(() => {});
  }
  async function handle(req, res) {
    const url = new URL(req.url, origin), route = url.pathname;
    const host = req.headers.host;
    if (![new URL(origin).host, `127.0.0.1:${server.address()?.port}`, `localhost:${server.address()?.port}`].includes(host)) throw fail(403, 'The request host is invalid.');
    if (closing) throw fail(503, 'The bridge is stopping.');
    expire();
    if (route.startsWith('/v1/')) {
      const siteOrigin = req.headers.origin;
      if (!validOrigin(siteOrigin) || siteOrigin === origin) throw fail(403, 'Use a separate website Origin.');
      res.setHeader('Access-Control-Allow-Origin', siteOrigin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '300' }); return res.end();
      }
      if (route === '/v1/connect' && req.method === 'POST') {
        const data = await body(req);
        if (now() < lockedUntil) throw fail(429, 'Too many incorrect codes. Wait one minute, then use the new code in the tunnel terminal.');
        if (now() >= pairExpires) { rotateCode(); throw fail(403, 'The connection code expired. Use the new code in the tunnel terminal.'); }
        if (Object.keys(data).length !== 1 || !equal(data.code, pairCode)) {
          // Five failures replace the code and pause connection for one minute.
          if (++attempts >= 5) { lockedUntil = now() + 60000; rotateCode(); }
          throw fail(403, 'The connection code is incorrect.');
        }
        if (sessions.size >= 64) throw fail(429, 'The connection limit was reached. Disconnect a website or restart the tunnel.');
        const s = { id: randomUUID(), token: token(), origin: siteOrigin, public_key: null, expires: now() + 300000, revoked: false, canceled: new Set() };
        sessions.set(s.token, s); rotateCode();
        return sendJson(res, 201, { token: s.token, connection_id: s.id, expires_at: iso(s.expires) });
      }
      const s = website(req);
      if (route === '/v1/signers' && req.method === 'GET') {
        const signers = await keys(); website(req);
        return sendJson(res, 200, { signers });
      }
      if (route === '/v1/select' && req.method === 'POST') {
        const data = await body(req);
        if (s.public_key) throw fail(409, 'This connection already has a wallet. Disconnect to select another wallet.');
        const signers = await keys(); website(req);
        if (s.public_key) throw fail(409, 'This connection already has a wallet.');
        const key = Object.keys(data).length === 1 && signers.find(k => k.public_key === data.public_key);
        if (!key) throw fail(400, 'Select an available 1Password key.');
        s.public_key = key.public_key; s.key = { public_key: key.public_key, comment: key.comment, fingerprint: key.fingerprint }; s.expires = now() + 3600000;
        return sendJson(res, 200, { public_key: s.public_key, network_passphrase: Networks.TESTNET });
      }
      if (route === '/v1/account' && req.method === 'GET') return sendJson(res, 200, { connection_id: s.id, public_key: s.public_key, network_passphrase: Networks.TESTNET, expires_at: iso(s.expires) });
      if (route === '/v1/disconnect' && req.method === 'POST') { await body(req); revoke(s); return sendJson(res, 200, { disconnected: true }); }
      if (route === '/v1/requests' && req.method === 'POST') {
        if (!s.public_key) throw fail(409, 'Select a wallet first.');
        const input = await body(req);
        website(req);
        if (typeof input.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.id || '') || Object.keys(input).some(k => !['id', 'transaction_xdr', 'network_passphrase', 'public_key'].includes(k))) throw fail(400, 'The signing request fields are invalid.');
        const key = `${s.id}:${input.id}`, prior = records.get(key);
        if (s.canceled.has(input.id)) throw fail(409, 'The website canceled this request before it arrived.');
        if (prior) {
          if (['transaction_xdr', 'network_passphrase', 'public_key'].some(k => prior.input[k] !== input[k])) throw fail(409, 'This request ID already identifies a different transaction.');
          return sendJson(res, 200, summary(prior));
        }
        const all = [...records.values()];
        if (all.filter(r => r.session_id === s.id).length >= 1000) throw fail(429, 'This connection reached its request limit. Disconnect and connect again.');
        if (all.filter(r => active(r)).length >= 32) throw fail(429, 'The signing request limit was reached.');
        const checked = inspectTransaction(input, s.public_key, now());
        const record = { record_id: randomUUID(), session_id: s.id, origin: s.origin, id: input.id, public_key: s.public_key,
          input, details: checked.details, expires: checked.expires, state: 'pending' };
        logResult(record); records.set(key, record); scheduleReview(record, s);
        return sendJson(res, 201, summary(record));
      }
      const match = route.match(/^\/v1\/requests\/([A-Za-z0-9_-]{1,64})(\/cancel)?$/);
      if (match) {
        let r = records.get(`${s.id}:${match[1]}`);
        if (match[2] && req.method === 'POST') {
          await body(req); website(req);
          r = records.get(`${s.id}:${match[1]}`);
          // A cancel can arrive before a delayed create. Block that ID for this session.
          if (!r) {
            if (s.canceled.size >= 1000) throw fail(429, 'This connection reached its request limit. Disconnect and connect again.');
            s.canceled.add(match[1]); return sendJson(res, 200, { id: match[1], state: 'denied', message: 'The website canceled this request.' });
          }
          // A signed result can race the cancellation. Withhold it, as a revocation does.
          if (active(r) || r.state === 'signed') {
            r.message = r.delivered ? 'The bridge sent the signature, then the website canceled.' : 'The website canceled this request.';
            r.state = ['signing', 'signed'].includes(r.state) ? 'unknown' : 'denied';
            delete r.signed_xdr; logResult(r); reviews.get(r.record_id)?.abort();
          }
          return sendJson(res, 200, summary(r));
        }
        if (!r) throw fail(404, 'The request does not exist in this website session.');
        if (req.method === 'GET') return sendJson(res, 200, summary(r));
      }
      throw fail(404, 'The route does not exist.');
    }
    if (route === '/api/session' && req.method === 'GET') return sendJson(res, 200, { service: 'walleterm', protocol: 2 }); // Startup readiness probe.
    throw fail(404, 'Use this tunnel URL in a Walleterm-compatible website.');
  }

  const server = createServer((req, res) => {
    const job = handle(req, res).catch(error => { if (!res.headersSent && !res.destroyed) sendJson(res, error.status || 500, { error: { message: error.status ? error.message : 'The bridge could not complete this request. Check its terminal.' } }); else res.destroy(); });
    jobs.add(job); job.finally(() => jobs.delete(job));
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.setTimeout(150000);
  return {
    service: 'walleterm', server, get pairing() { return { walleterm: 2, url: origin, code: pairCode, expires_at: iso(pairExpires) }; },
    onPairingChanged(callback) { pairingChanged = callback; },
    setPublicOrigin(value) { if (!validOrigin(value)) throw Error('Use an HTTPS or loopback origin.'); origin = value; restartCodeTimer(); },
    async listen() { if (closing) throw Error('The bridge is stopping.'); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); if (closing) server.close(); },
    close() {
      if (closePromise) return closePromise; closing = true; controller.abort(); clearTimeout(pairTimer);
      closePromise = (async () => { server.close(); server.closeAllConnections(); await Promise.allSettled([...jobs]); })();
      return closePromise;
    },
  };
}
