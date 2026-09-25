import { createServer } from 'node:http';
import { createPublicKey, randomBytes, randomUUID, timingSafeEqual, verify } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Asset, Networks, Operation, StrKey, TransactionBuilder, rpc,
} from '@stellar/stellar-sdk';
import { createSubmissionGuard } from '../tests/submission.mjs';
import { USDC_ISSUER, listOffers, lookupOffer, offerEffect, offerPreflight } from './testnet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 8 * 1024;
const REQUEST_MS = 3 * 60 * 1000;
const PAIR_MS = 5 * 60 * 1000;
const COOKIE = 'walleterm_demo';

function token() { return randomBytes(32).toString('base64url'); }
function equal(a, b) {
  const aa = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function verifySignature(publicKey, digest, signature) {
  const raw = StrKey.decodeEd25519PublicKey(publicKey);
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const key = createPublicKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(digest, 'hex'), key, Buffer.from(signature, 'hex'));
}
function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(value));
}
async function body(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw fail(413, 'The request is too large.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw fail(400, 'The request must contain one JSON object.'); }
}
function cookie(req) {
  const part = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  return part?.slice(COOKIE.length + 1) || '';
}
function operation(kind, config, id) {
  if (kind === 'note') {
    return {
      operation: Operation.manageData({ name: 'walleterm-poc', value: Buffer.from(id.slice(0, 16)) }),
      details: { action: 'Write a test note', data_name: 'walleterm-poc', data_value: id.slice(0, 16) },
    };
  }
  if (kind === 'payment') {
    return {
      operation: Operation.payment({ destination: config.recipient, asset: Asset.native(), amount: '0.0100000' }),
      details: { action: 'Pay 0.01 test XLM', destination: config.recipient, amount: '0.0100000', asset: 'XLM' },
    };
  }
  if (kind === 'offer') {
    return {
      operation: Operation.manageSellOffer({
        selling: Asset.native(), buying: new Asset('USDC', USDC_ISSUER),
        amount: '0.1000000', price: '10', offerId: '0',
      }),
      details: { action: 'Open a testnet limit offer' },
    };
  }
  if (kind === 'cancel_offer' && config.offerId) {
    return {
      operation: Operation.manageSellOffer({
        selling: Asset.native(), buying: new Asset('USDC', USDC_ISSUER),
        amount: '0', price: '10', offerId: config.offerId,
      }),
    };
  }
  throw fail(400, 'Choose a supported testnet action.');
}
function review(tx, kind, signer, recipient, id, offerId) {
  if (tx.source !== signer || tx.operations.length !== 1 || tx.signatures.length || tx.fee !== '100' || tx.operations[0].source) {
    throw fail(500, 'The prepared transaction is outside the demo limits.');
  }
  const op = tx.operations[0];
  let detail;
  if (kind === 'note' && op.type === 'manageData' && op.name === 'walleterm-poc' && Buffer.from(op.value).toString() === id.slice(0, 16)) {
    detail = { action: 'Write a test note', data_name: op.name, data_value: Buffer.from(op.value).toString() };
  } else if (kind === 'payment' && op.type === 'payment' && op.destination === recipient && op.asset.isNative() && op.amount === '0.0100000') {
    detail = { action: 'Pay 0.01 test XLM', destination: op.destination, amount: op.amount, asset: 'XLM' };
  } else if (kind === 'offer' && op.type === 'manageSellOffer' && op.selling.isNative() && op.buying.code === 'USDC' && op.buying.issuer === USDC_ISSUER && op.amount === '0.1000000' && op.price === '10' && op.offerId === '0') {
    detail = { action: 'Open a testnet limit offer', selling: `${op.amount} XLM`, buying: `USDC:${op.buying.issuer}`, price: `${op.price} USDC per XLM` };
  } else if (kind === 'cancel_offer' && op.type === 'manageSellOffer' && op.selling.isNative() && op.buying.code === 'USDC' && op.buying.issuer === USDC_ISSUER && op.amount === '0.0000000' && op.price === '10' && op.offerId === offerId) {
    detail = { action: 'Cancel the demo DEX offer', offer_id: op.offerId, selling: 'XLM', buying: `USDC:${op.buying.issuer}` };
  } else throw fail(500, 'The prepared operation changed.');
  return { ...detail, signer: tx.source, network: 'TESTNET', fee_stroops: tx.fee,
    sequence: tx.sequence, valid_until: new Date(Number(tx.timeBounds.maxTime) * 1000).toISOString(),
    hash: Buffer.from(tx.hash()).toString('hex') };
}
function signDigest(publicKey, digest, command = 'walleterm') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['sign'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errorOutput = '';
    const timer = setTimeout(() => { child.kill(); reject(fail(504, 'The 1Password signing request timed out.')); }, 125000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > MAX_BODY) child.kill();
    });
    child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk.toString()).slice(0, 2048); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      let result;
      try { result = JSON.parse(output); } catch { return reject(fail(502, 'The signer returned invalid JSON.')); }
      if (code !== 0 || result.ok !== true) return reject(fail(502, result?.error?.message || errorOutput || 'The signing request failed.'));
      if (result.public_key !== publicKey || result.digest !== digest || result.verified !== true || !/^[a-f0-9]{128}$/.test(result.signature)) {
        return reject(fail(502, 'The signer returned an invalid result.'));
      }
      resolve(result.signature);
    });
    child.stdin.end(JSON.stringify({ public_key: publicKey, digest }));
  });
}

export function createDemo({
  signer, recipient, publicOrigin, port = 8787, stateDir = join(here, '.state'),
  rpcUrl = 'https://soroban-testnet.stellar.org', rpcClient, sign = signDigest,
  offerChecks = { offerPreflight, listOffers, lookupOffer, offerEffect },
} = {}) {
  if (!StrKey.isValidEd25519PublicKey(signer) || !StrKey.isValidEd25519PublicKey(recipient)) {
    throw Error('Set DEMO_SIGNER and DEMO_RECIPIENT to testnet G-addresses.');
  }
  const origin = publicOrigin || `http://localhost:${port}`;
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedOrigin.hostname))) {
    throw Error('PUBLIC_ORIGIN must be one HTTPS origin or a loopback HTTP origin.');
  }
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const offerFile = join(stateDir, 'demo-offer.json');
  const requestFile = join(stateDir, 'submitted-request.json');
  let trackedOfferId = null;
  let trackedOfferLedger = null;
  try {
    const saved = JSON.parse(readFileSync(offerFile, 'utf8'));
    if (saved.signer === signer && /^\d+$/.test(saved.offer_id)) {
      trackedOfferId = saved.offer_id;
      trackedOfferLedger = Number.isSafeInteger(saved.ledger) ? saved.ledger : null;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const client = rpcClient || new rpc.Server(rpcUrl);
  function submittedContext() {
    try { return JSON.parse(readFileSync(requestFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  const guard = createSubmissionGuard({
    rpc: client, directory: stateDir, networkPassphrase: Networks.TESTNET,
    record: (label, status, details) => audit(label, { status, ...details }),
  });
  const pairCode = token();
  const pairExpires = Date.now() + PAIR_MS;
  let paired = false;
  let session = '';
  let sessionExpires = 0;
  let pending = null;
  let lastResult = null;
  let busy = false;
  function audit(event, details = {}) {
    appendFileSync(join(stateDir, 'events.jsonl'), `${JSON.stringify({ time: new Date().toISOString(), event, ...details })}\n`, { mode: 0o600 });
  }
  function authenticated(req) { return session && Date.now() < sessionExpires && equal(cookie(req), session); }
  function current() {
    if (!pending) {
      const submitted = submittedContext();
      if (submitted) return { state: 'unknown', hash: submitted.hash, id: submitted.id };
      const gate = guard.pending();
      return gate ? { state: 'unknown', hash: gate.hash } : null;
    }
    return { id: pending.id, kind: pending.kind, state: pending.state, details: pending.details,
      hash: pending.hash, expires_at: new Date(pending.expires).toISOString(),
      error: pending.error,
      signed_xdr: pending.state === 'signed' ? pending.signedXdr : undefined };
  }
  function finishLedger(item, result) {
    if ((result.hash || result.txHash) !== item.hash) throw Error('The ledger returned a different transaction hash.');
    if (result.status !== 'SUCCESS' && result.status !== 'FAILED') throw Error('The ledger result is not final.');
    const finished = { hash: item.hash, status: result.status, ledger: result.ledger };
    const resultXdr = result.result?.resultXdr || result.resultXdr;
    if (result.status === 'SUCCESS' && item.kind === 'offer') {
      const effect = offerChecks.offerEffect(resultXdr);
      if (effect.type === 'created' && /^\d+$/.test(effect.id)) {
        trackedOfferId = effect.id;
        trackedOfferLedger = result.ledger;
        writeFileSync(offerFile, JSON.stringify({ signer, offer_id: effect.id, ledger: result.ledger, tx_hash: item.hash }), { mode: 0o600, flush: true });
        finished.offer_id = effect.id;
        finished.offer_amount = effect.amount;
      } else if (effect.type === 'deleted') finished.offer_status = 'The offer crossed fully. No resting offer remains.';
      else throw Error('The ledger returned an unexpected offer effect.');
    }
    if (result.status === 'SUCCESS' && item.kind === 'cancel_offer') {
      const effect = offerChecks.offerEffect(resultXdr);
      if (effect.type !== 'deleted') throw Error('The ledger did not confirm offer cancellation.');
      trackedOfferId = null;
      trackedOfferLedger = null;
      rmSync(offerFile, { force: true });
      finished.offer_status = 'The demo offer was canceled.';
    }
    lastResult = finished;
    rmSync(requestFile, { force: true });
    pending = null;
    audit('ledger_final', { id: item.id, ...finished });
    return finished;
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (req.headers.host !== parsedOrigin.host && req.headers.host !== `localhost:${port}` && req.headers.host !== `127.0.0.1:${port}`) throw fail(403, 'The host is not allowed.');
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/pair')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
        res.end(readFileSync(join(here, 'site', 'index.html')));
        return;
      }
      if (req.method === 'GET' && ['/app.js', '/style.css'].includes(url.pathname)) {
        const name = url.pathname.slice(1);
        res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(readFileSync(join(here, 'site', name)));
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/session') {
        json(res, 200, { paired: !!authenticated(req), signer: authenticated(req) ? signer : undefined, recipient: authenticated(req) ? recipient : undefined, offer_id: authenticated(req) ? trackedOfferId : undefined, current: authenticated(req) ? current() : undefined, last_result: authenticated(req) ? lastResult : undefined });
        return;
      }
      if (req.method !== 'POST') throw fail(404, 'The route does not exist.');
      if (req.headers.origin !== origin) throw fail(403, 'The request origin is not allowed.');
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'Use application/json.');
      const input = await body(req);
      if (url.pathname === '/api/pair') {
        if (paired || Date.now() >= pairExpires || typeof input.code !== 'string' || !equal(input.code, pairCode)) throw fail(403, 'The pairing link is invalid or expired.');
        paired = true;
        session = token();
        sessionExpires = Date.now() + 3600000;
        audit('paired');
        json(res, 200, { paired: true }, { 'Set-Cookie': `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${parsedOrigin.protocol === 'https:' ? '; Secure' : ''}` });
        return;
      }
      if (!authenticated(req)) throw fail(401, 'Scan the desktop pairing link first.');
      if (url.pathname === '/api/prepare') {
        if (busy || pending || submittedContext()) throw fail(409, 'Finish the current request first.');
        busy = true;
        try {
          guard.assertClear();
          if (typeof input.kind !== 'string' || Object.keys(input).length !== 1) throw fail(400, 'Choose one supported action.');
          const id = token();
          if (input.kind === 'offer') {
            if (trackedOfferId) throw fail(409, 'Cancel the current demo offer before opening another.');
            await offerChecks.offerPreflight(signer);
          }
          if (input.kind === 'cancel_offer') {
            if (!trackedOfferId) throw fail(409, 'No demo offer needs cancellation.');
            const found = await offerChecks.lookupOffer(signer, trackedOfferId, client);
            if (!found.exists) {
              if (!trackedOfferLedger || found.latestLedger <= trackedOfferLedger) throw fail(409, 'RPC has not passed the offer ledger. Try again later.');
              audit('offer_no_longer_resting', { offer_id: trackedOfferId, ledger: found.latestLedger });
              trackedOfferId = null;
              trackedOfferLedger = null;
              rmSync(offerFile, { force: true });
              throw fail(409, 'The offer no longer rests on testnet. Choose another action.');
            }
          }
          const { operation: op } = operation(input.kind, { recipient, offerId: trackedOfferId }, id);
          const account = await client.getAccount(signer);
          const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: Networks.TESTNET })
            .addOperation(op).setTimeout(600).build();
          const details = review(tx, input.kind, signer, recipient, id, trackedOfferId);
          const hash = details.hash;
          pending = { id, kind: input.kind, state: 'prepared', unsignedXdr: tx.toXDR(), hash, offerId: trackedOfferId,
            details, expires: Date.now() + REQUEST_MS };
          audit('prepared', { id, kind: input.kind, hash });
          json(res, 200, current());
        } finally { busy = false; }
        return;
      }
      if (url.pathname === '/api/cancel') {
        if (!pending || !['prepared', 'sign_failed', 'submit_failed'].includes(pending.state) || input.id !== pending.id) throw fail(409, 'The request cannot be canceled.');
        audit('canceled', { id: pending.id, hash: pending.hash });
        pending = null;
        json(res, 200, { canceled: true });
        return;
      }
      if (url.pathname === '/api/approve') {
        if (!pending || pending.state !== 'prepared' || input.id !== pending.id || busy) throw fail(409, 'The request is not ready.');
        if (Date.now() >= pending.expires) { pending = null; throw fail(410, 'The request expired.'); }
        busy = true;
        pending.state = 'signing';
        const item = pending;
        void (async () => {
          try {
            const tx = TransactionBuilder.fromXDR(item.unsignedXdr, Networks.TESTNET);
            if (tx.toXDR() !== item.unsignedXdr || Buffer.from(tx.hash()).toString('hex') !== item.hash || tx.signatures.length !== 0) throw fail(500, 'The prepared transaction changed.');
            const signature = await sign(signer, item.hash);
            if (!/^[a-f0-9]{128}$/.test(signature) || !verifySignature(signer, item.hash, signature)) {
              throw fail(502, 'The signer returned an invalid signature.');
            }
            tx.addSignature(signer, Buffer.from(signature, 'hex').toString('base64'));
            item.signedXdr = tx.toXDR();
            item.state = 'signed';
            audit('signed', { id: item.id, hash: item.hash, signer });
          } catch (error) {
            item.state = 'sign_failed';
            item.error = error.message;
            audit('sign_failed', { id: item.id, hash: item.hash, error: String(error.message).slice(0, 120) });
          } finally { busy = false; }
        })();
        json(res, 202, current());
        return;
      }
      if (url.pathname === '/api/submit') {
        if (!pending || pending.state !== 'signed' || input.id !== pending.id || busy) throw fail(409, 'The signed transaction is not ready.');
        if (submittedContext()) throw fail(409, 'The original submission still needs reconciliation.');
        busy = true;
        const item = pending;
        const attempt = randomUUID();
        try {
          writeFileSync(requestFile, JSON.stringify({ id: item.id, kind: item.kind, hash: item.hash, offerId: item.offerId, attempt }), { flag: 'wx', mode: 0o600, flush: true });
        } catch (error) { busy = false; throw error; }
        item.state = 'submitting';
        void (async () => {
          try {
            const tx = TransactionBuilder.fromXDR(item.signedXdr, Networks.TESTNET);
            if (Buffer.from(tx.hash()).toString('hex') !== item.hash) throw Error('The signed transaction changed.');
            const result = await guard.send(tx, `mobile-${item.kind}`, { attempt });
            audit('submitted', { id: item.id, hash: item.hash, status: result.status, ledger: result.ledger });
            finishLedger(item, result);
          } catch (error) {
            if (error.code === 'known_rejection') {
              lastResult = { hash: item.hash, status: error.outcome.status, ledger: error.outcome.ledger ?? null,
                error: 'Testnet rejected this transaction.' };
              rmSync(requestFile, { force: true });
              pending = null;
              audit('known_rejection', { id: item.id, ...lastResult });
            } else {
              item.state = 'unknown';
              item.error = error.message;
            }
            audit('submit_error', { id: item.id, hash: item.hash, error: String(error.message).slice(0, 120) });
          } finally { busy = false; }
        })();
        json(res, 202, current());
        return;
      }
      if (url.pathname === '/api/reconcile') {
        const gate = guard.pending();
        const context = submittedContext();
        if (!context || (gate && gate.hash !== context.hash) || (pending && pending.state !== 'unknown' && pending.state !== 'effect_unknown') || busy) throw fail(409, 'No unknown submission needs reconciliation.');
        busy = true;
        if (pending) { pending.state = 'reconciling'; pending.error = undefined; }
        void (async () => {
          try {
            const known = guard.recoverKnownRejection(context.hash, context.attempt);
            if (known) {
              lastResult = { ...known, error: 'Testnet rejected this transaction.' };
              rmSync(requestFile, { force: true });
              pending = null;
              audit('recovered_rejection', { id: context.id, ...lastResult });
              return;
            }
            const result = gate ? await guard.reconcile() : await client.getTransaction(context.hash);
            finishLedger(context, result);
            audit('reconciled', { hash: context.hash, status: result.status, ledger: result.ledger });
          } catch (error) {
            if (pending) { pending.state = 'unknown'; pending.error = error.message; }
            audit('reconcile_error', { hash: context.hash, error: String(error.message).slice(0, 120) });
          } finally { busy = false; }
        })();
        json(res, 202, current());
        return;
      }
      throw fail(404, 'The route does not exist.');
    } catch (error) {
      json(res, error.status || (error.code === 'unknown_submission' ? 409 : 500), {
        error: error.code === 'unknown_submission' ? 'The submission outcome is unknown. Reconcile the original hash.' : error.message,
      });
    }
  });
  return {
    server,
    pairUrl: `${origin}/pair#code=${pairCode}`,
    listen: async () => {
      if (!rpcClient) {
        const network = await client.getNetwork();
        if (network.passphrase !== Networks.TESTNET) throw Error('The RPC endpoint is not Stellar testnet.');
      }
      return new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    },
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const demo = createDemo({
    signer: process.env.DEMO_SIGNER,
    recipient: process.env.DEMO_RECIPIENT,
    publicOrigin: process.env.PUBLIC_ORIGIN,
    port: Number(process.env.PORT || 8787),
    stateDir: process.env.DEMO_STATE_DIR,
  });
  await demo.listen();
  console.log(`Demo: ${process.env.PUBLIC_ORIGIN || 'http://localhost:8787'}`);
  console.log(`Pairing link: ${demo.pairUrl}`);
}
