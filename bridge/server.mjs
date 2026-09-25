import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { Networks } from '@stellar/stellar-sdk';
import { lockJournal } from './runtime.mjs';
import { availableSigners, signDigest } from './signer.mjs';
import { attachSignature, inspectTransaction } from './transaction.mjs';
import { reviewInTerminal } from './terminal.mjs';

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
function save(directory, record) {
  const target = join(directory, `request-${record.record_id}.json`), temporary = `${target}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(record) + '\n'); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, target);
    fd = openSync(directory, 'r'); fsyncSync(fd);
  } finally { if (fd !== undefined) closeSync(fd); try { unlinkSync(temporary); } catch {} }
}
export function createBridge({ port = 8787, stateDir, publicOrigin, listSigners = availableSigners, sign = signDigest, review = reviewInTerminal, now = Date.now } = {}) {
  const journal = lockJournal(stateDir);
  const records = new Map(), sessions = new Map();
  const controller = new AbortController(), jobs = new Set();
  let origin = publicOrigin || `http://127.0.0.1:${port}`;
  let pairExpires, pairTimer, pairCode = newCode(), attempts = 0, closing = false, closePromise;
  let pairingChanged = () => {}, queue = Promise.resolve(), reviewing = false, pairingDeferred = false;
  const reviews = new Map();
  function newCode() { return String(randomInt(100000000)).padStart(8, '0'); }
  function restartCodeTimer() {
    pairExpires = now() + 300000; clearTimeout(pairTimer);
    pairTimer = setTimeout(rotateCode, 300000); pairTimer.unref();
  }
  // Keep an open terminal review readable. Print a new code after the review ends.
  function announcePairing() { if (reviewing) pairingDeferred = true; else pairingChanged(); }
  function rotateCode() { pairCode = newCode(); restartCodeTimer(); announcePairing(); }
  restartCodeTimer();
  try {
    for (const name of readdirSync(stateDir)) {
      if (!/^request-[a-f0-9-]{36}\.json$/.test(name)) continue;
      const file = join(stateDir, name), info = lstatSync(file);
      if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 131072) throw Error('A bridge journal file is not private or valid.');
      const r = JSON.parse(readFileSync(file, 'utf8'));
      if (`request-${r.record_id}.json` !== name) throw Error('A bridge journal record has an invalid identity.');
      if (active(r)) { r.state = r.state === 'signing' ? 'unknown' : 'expired'; r.message = 'The bridge restarted. This request will not be retried.'; save(stateDir, r); }
    }
  } catch (error) { journal.release(); throw error; }
  function persist(r) { save(stateDir, r); }
  function website(req) {
    const s = sessions.get(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!s || s.revoked || s.origin !== req.headers.origin || now() >= s.expires) throw fail(401, 'Connect this website with a new code from the tunnel terminal.');
    return s;
  }
  function summary(r) {
    return { id: r.id, state: r.state, hash: r.details.hash, expires_at: iso(r.expires), message: r.message,
      ...(r.state === 'signed' ? { signed_xdr: r.signed_xdr } : {}) };
  }
  function expire() {
    for (const r of records.values()) if (r.state === 'pending' && now() >= r.expires) { r.state = 'expired'; persist(r); reviews.get(r.record_id)?.abort(); }
    // Records stay on disk. Memory keeps live sessions and records that are active or belong to them.
    const live = new Set();
    for (const [key, s] of sessions) { if (s.revoked || now() >= s.expires) sessions.delete(key); else live.add(s.id); }
    for (const [id, r] of records) if (!active(r) && !live.has(r.session_id)) records.delete(id);
  }
  function revoke(s) {
    s.revoked = true;
    for (const r of records.values()) if (r.session_id === s.id && (active(r) || r.state === 'signed')) {
      r.state = r.state === 'signing' ? 'unknown' : 'denied'; r.message = 'The website connection was revoked.'; delete r.signed_xdr; persist(r); reviews.get(r.record_id)?.abort();
    }
  }
  function scheduleReview(r, s) {
    const canceled = new AbortController(); reviews.set(r.record_id, canceled);
    const job = queue.then(async () => {
      expire();
      if (closing || r.state !== 'pending' || s.revoked || now() >= s.expires) {
        reviews.delete(r.record_id);
        if (r.state === 'pending') { r.state = 'expired'; persist(r); }
        return;
      }
      const signal = AbortSignal.any([controller.signal, canceled.signal, AbortSignal.timeout(Math.max(1, r.expires - now()))]);
      try {
        let approved;
        reviewing = true;
        try { approved = await review({ origin: r.origin, signer: { ...s.key }, details: structuredClone(r.details) }, { signal }); }
        finally { reviewing = false; if (pairingDeferred) { pairingDeferred = false; await pairingChanged(); } }
        if (signal.aborted || r.state !== 'pending' || s.revoked || now() >= s.expires || now() >= r.expires) return;
        if (!approved) { r.state = 'denied'; persist(r); return; }
        inspectTransaction(r.input, r.public_key, now());
        r.state = 'approved'; persist(r);
        const keys = await listSigners({ signal });
        if (signal.aborted || r.state !== 'approved' || s.revoked || now() >= s.expires || now() >= r.expires) throw Error('The signing approval expired or was canceled.');
        if (!keys.some(k => k.public_key === r.public_key)) throw Error('The selected key is no longer available.');
        r.state = 'signing'; persist(r);
        const signature = await sign(r.public_key, r.details.hash, { signal });
        const signed = attachSignature(r.input, r.public_key, signature);
        if (signal.aborted || r.state !== 'signing' || s.revoked || now() >= s.expires || now() >= r.expires) throw Error('The signing result is withheld because approval expired or was canceled.');
        r.signed_xdr = signed; r.state = 'signed'; persist(r);
      } catch (error) {
        if (['pending', 'approved', 'signing', 'signed'].includes(r.state)) {
          r.state = ['signing', 'signed'].includes(r.state) ? 'unknown' : now() >= r.expires ? 'expired' : 'denied';
          delete r.signed_xdr; r.message = error.message; persist(r);
        }
      } finally {
        if (r.state === 'pending') { r.state = now() >= r.expires ? 'expired' : 'denied'; persist(r); }
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
        if (attempts >= 5) throw fail(429, 'Too many incorrect codes. Restart the tunnel for a new code.');
        if (now() >= pairExpires) { rotateCode(); throw fail(403, 'The connection code expired. The tunnel terminal shows a new code after any open review.'); }
        if (Object.keys(data).length !== 1 || !equal(data.code, pairCode)) {
          attempts++; throw fail(403, 'The connection code is incorrect.');
        }
        if (sessions.size >= 64) throw fail(429, 'The connection limit was reached. Disconnect a website or restart the tunnel.');
        const s = { id: randomUUID(), token: token(), origin: siteOrigin, public_key: null, expires: now() + 300000, revoked: false };
        sessions.set(s.token, s); rotateCode();
        return sendJson(res, 201, { token: s.token, connection_id: s.id, expires_at: iso(s.expires) });
      }
      const s = website(req);
      if (route === '/v1/signers' && req.method === 'GET') {
        const keys = await listSigners({ signal: controller.signal }); website(req);
        return sendJson(res, 200, { signers: keys });
      }
      if (route === '/v1/select' && req.method === 'POST') {
        const data = await body(req);
        if (s.public_key) throw fail(409, 'This connection already has a wallet. Disconnect to select another wallet.');
        const keys = await listSigners({ signal: controller.signal }); website(req);
        if (s.public_key) throw fail(409, 'This connection already has a wallet.');
        const key = Object.keys(data).length === 1 && keys.find(k => k.public_key === data.public_key);
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
        if (prior) {
          if (['transaction_xdr', 'network_passphrase', 'public_key'].some(k => prior.input[k] !== input[k])) throw fail(409, 'This request ID already identifies a different transaction.');
          return sendJson(res, 200, summary(prior));
        }
        const all = [...records.values()];
        if (all.filter(r => r.session_id === s.id).length >= 1000) throw fail(429, 'This connection reached its request limit. Disconnect and connect again.');
        if (all.filter(r => active(r)).length >= 32) throw fail(429, 'The signing request limit was reached.');
        const checked = inspectTransaction(input, s.public_key, now());
        const record = { record_id: randomUUID(), session_id: s.id, origin: s.origin, id: input.id, public_key: s.public_key,
          input, details: checked.details, expires: checked.expires, state: 'pending', created_at: iso(now()) };
        persist(record); records.set(key, record); scheduleReview(record, s);
        return sendJson(res, 201, summary(record));
      }
      const match = route.match(/^\/v1\/requests\/([A-Za-z0-9_-]{1,64})(\/cancel)?$/);
      if (match) {
        const r = records.get(`${s.id}:${match[1]}`); if (!r) throw fail(404, 'The request does not exist in this website session.');
        if (!match[2] && req.method === 'GET') return sendJson(res, 200, summary(r));
        if (match[2] && req.method === 'POST') {
          await body(req); website(req);
          if (active(r)) { r.state = r.state === 'signing' ? 'unknown' : 'denied'; r.message = 'The website canceled this request.'; persist(r); reviews.get(r.record_id)?.abort(); }
          return sendJson(res, 200, summary(r));
        }
      }
      throw fail(404, 'The route does not exist.');
    }
    if (route === '/api/session' && req.method === 'GET') return sendJson(res, 200, { paired: false, service: 'walleterm', protocol: 2 });
    // No HTTP route can approve a signature. Only the local review callback can approve it.
    throw fail(404, 'Use this tunnel URL in a Walleterm-compatible website.');
  }

  const server = createServer((req, res) => {
    const job = handle(req, res).catch(error => { if (!res.headersSent && !res.destroyed) sendJson(res, error.status || 500, { error: { message: error.status ? error.message : 'The bridge could not complete this request. Check its terminal and journal.' } }); else res.destroy(); });
    jobs.add(job); job.finally(() => jobs.delete(job));
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.setTimeout(150000);
  return {
    server, get pairing() { return { walleterm: 2, url: origin, code: pairCode, expires_at: iso(pairExpires) }; },
    onPairingChanged(callback) { pairingChanged = callback; },
    setPublicOrigin(value) { if (!validOrigin(value)) throw Error('Use an HTTPS or loopback origin.'); origin = value; restartCodeTimer(); },
    setTunnelProcess: details => journal.record({ tunnel: details }),
    async listen() { if (closing) throw Error('The bridge is stopping.'); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); if (closing) server.close(); },
    close() {
      if (closePromise) return closePromise; closing = true; controller.abort(); clearTimeout(pairTimer);
      closePromise = (async () => { server.close(); server.closeAllConnections(); await Promise.allSettled([...jobs]); journal.release(); })();
      return closePromise;
    },
  };
}
