import { WalletermError, requestError, sep43Error, walletermError } from '../sdk/errors.ts';
import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Networks } from '@stellar/stellar-sdk';
import { availableSigners, signDigest } from './signer.ts';
import {
  attachAuthSignature,
  attachPreimageSignature,
  inspectAuthPreimageRequest,
  inspectAuthorization,
  latestTestnetLedger,
} from './authorization.ts';
import { attachSignature, inspectTransaction } from './transaction.ts';

import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Sep43Error, Sep43Reason } from '../sdk/errors.ts';
import type { AuthorizationInput, RequestState, Signer, SigningInput, WalletScope } from '../sdk/types.ts';

// Artifact fields for each request kind. `address` always names the signing key.
const requestFields: Record<SigningInput['kind'], string[]> = {
  transaction: ['xdr'],
  auth_entry: ['preimage_xdr'],
  authorization: ['auth_entry_xdr', 'auth_address', 'adapter'],
};

function requestIdentity(input: object): string {
  return JSON.stringify(input, (key, value) => {
    if (key === 'id') return undefined;
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    return value;
  });
}
interface Session {
  id: string;
  token: string;
  origin: string;
  public_key: string | null;
  wallet_scope: WalletScope;
  selection_revision: number;
  allowed: Set<string> | null;
  expires: number;
  revoked: boolean;
  canceled: Set<string>;
  key?: Signer;
  offered?: { id: string; keys: Set<string> };
}
interface SigningRecord {
  record_id: string;
  session_id: string;
  origin: string;
  id: string;
  public_key: string;
  signer: Signer;
  input: SigningInput;
  details:
    | ReturnType<typeof inspectTransaction>['details']
    | ReturnType<typeof inspectAuthPreimageRequest>['details']
    | ReturnType<typeof inspectAuthorization>['details'];
  expires: number;
  state: RequestState;
  logged?: RequestState;
  delivered?: boolean;
  // The one signed artifact for this request kind, keyed by its protocol field name.
  result?: { signed_tx_xdr: string } | { signed_auth_entry: string } | { signed_auth_entry_xdr: string };
  error?: Sep43Error;
}
export interface BridgeOptions {
  port?: number;
  publicOrigin?: string;
  listSigners?: typeof availableSigners;
  sign?: typeof signDigest;
  review?: (
    record: Pick<SigningRecord, 'origin' | 'signer' | 'details'>,
    options: { signal: AbortSignal },
  ) => Promise<boolean>;
  log?: (line: string) => unknown;
  now?: () => number;
  latestLedger?: typeof latestTestnetLedger;
}

const token = () => randomBytes(32).toString('base64url');
const fail = (reason: Sep43Reason, message: string, status?: number) =>
  walletermError(reason, message, { status });
// Each ended request keeps one SEP-43 error. The website receives it unchanged.
const ended = (reason: Sep43Reason, message: string, requestState?: RequestState) =>
  sep43Error(walletermError(reason, message, { requestState }));
const equal = (a: unknown, b: unknown) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  a.length === b.length &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const active = (r: SigningRecord) => ['pending', 'approved', 'signing'].includes(r.state);
const iso = (time: number) => new Date(time).toISOString();
export function validOrigin(value: unknown): value is string {
  try {
    if (typeof value !== 'string') return false;
    const u = new URL(value);
    return (
      u.origin === value &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
export function sendJson(
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: OutgoingHttpHeaders = {},
) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
    throw fail('invalid_request', 'Use application/json.', 415);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 393216) throw fail('invalid_request', 'The request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw Error();
    return data;
  } catch {
    throw fail('invalid_request', 'Send one JSON object.');
  }
}
// The website approves a request by sending it. `review` is the hook for a later automated policy check.
const approveAll = async () => true;
// State stays in memory. A restart ends all sessions and requests.
// Stellar sequence numbers and the five-minute expiry keep a signature from applying twice.
export function createBridge({
  port = 8787,
  publicOrigin,
  listSigners = availableSigners,
  sign = signDigest,
  review = approveAll,
  log = (line) => process.stdout.write(line),
  now = Date.now,
  latestLedger = latestTestnetLedger,
}: BridgeOptions = {}) {
  const records = new Map<string, SigningRecord>(),
    sessions = new Map<string, Session>();
  const controller = new AbortController(),
    jobs = new Set<Promise<unknown>>();
  let origin = publicOrigin || `http://127.0.0.1:${port}`;
  let pairExpires: number,
    pairTimer: ReturnType<typeof setTimeout>,
    pairCode = newCode(),
    attempts = 0,
    lockedUntil = 0,
    closing = false;
  let closePromise: Promise<void> | undefined;
  let pairingChanged = () => {},
    queue = Promise.resolve();
  const reviews = new Map<string, AbortController>();
  // Concurrent website calls share one agent and vault lookup.
  let listing: Promise<Signer[]> | undefined;
  function keys() {
    listing ??= listSigners({ signal: controller.signal }).finally(() => {
      listing = undefined;
    });
    return listing;
  }
  function newCode() {
    return String(randomInt(100000000)).padStart(8, '0');
  }
  function restartCodeTimer() {
    pairExpires = now() + 300000;
    clearTimeout(pairTimer);
    pairTimer = setTimeout(rotateCode, 300000);
    pairTimer.unref();
  }
  function rotateCode() {
    pairCode = newCode();
    attempts = 0;
    restartCodeTimer();
    pairingChanged();
  }
  restartCodeTimer();
  // The terminal records each produced or withheld signature.
  function logResult(r: SigningRecord) {
    if (r.logged === r.state) return;
    r.logged = r.state;
    const about =
      'sequence' in r.details
        ? `${r.details.hash} (account ${r.public_key}, sequence ${r.details.sequence})`
        : `${r.details.hash} (signer ${r.public_key}, authorization ${r.details.address})`;
    if (r.state === 'signed') log(`Signed ${about} for ${r.origin}.\n`);
    if (r.state === 'unknown') log(`Signature withheld or stopped for ${about}: ${r.error?.message}\n`);
  }
  // End a request with its SEP-43 error. A request that started signing stays unknown.
  function end(
    r: SigningRecord,
    state: 'denied' | 'expired' | 'unknown',
    message: string,
    error?: Sep43Error,
  ) {
    r.state = state;
    r.error = error
      ? { ...error, requestState: state }
      : ended(
          state === 'unknown' ? 'result_unknown' : state === 'expired' ? 'expired' : 'rejected',
          message,
          state,
        );
    delete r.result;
    logResult(r);
  }
  function website(req: IncomingMessage) {
    const s = sessions.get(req.headers.authorization?.replace(/^Bearer /, '') || '');
    if (!s || s.revoked || s.origin !== req.headers.origin || now() >= s.expires)
      throw fail('not_connected', 'Connect this website with a new code from the tunnel terminal.');
    return s;
  }
  function summary(r: SigningRecord) {
    if (r.state === 'signed') r.delivered = true;
    return {
      id: r.id,
      kind: r.input.kind,
      state: r.state,
      hash: r.details.hash,
      expires_at: iso(r.expires),
      ...(r.error ? { error: r.error } : {}),
      ...(r.state === 'signed' ? { signer_address: r.public_key, ...r.result } : {}),
    };
  }
  function expire() {
    for (const r of records.values())
      if (r.state === 'pending' && now() >= r.expires) {
        end(r, 'expired', 'The signing request expired.');
        reviews.get(r.record_id)?.abort();
      }
    // Memory keeps live sessions and records that are active or belong to them.
    const live = new Set();
    for (const [key, s] of sessions) {
      if (s.revoked || now() >= s.expires) {
        revoke(s);
        sessions.delete(key);
      } else live.add(s.id);
    }
    for (const [id, r] of records) if (!active(r) && !live.has(r.session_id)) records.delete(id);
  }
  function revoke(s: Session) {
    s.revoked = true;
    for (const r of records.values())
      if (r.session_id === s.id && (active(r) || r.state === 'signed')) {
        end(r, r.state === 'signing' ? 'unknown' : 'denied', 'The website connection was revoked.');
        reviews.get(r.record_id)?.abort();
      }
  }
  // Any ledger lookup failure before signing is an external service error.
  async function trustedLedger(signal: AbortSignal) {
    try {
      return await latestLedger({ signal });
    } catch (error) {
      if (signal.aborted || error instanceof WalletermError) throw error;
      throw walletermError('ledger_unavailable', 'The trusted testnet ledger is unavailable.');
    }
  }
  function scheduleReview(r: SigningRecord, s: Session) {
    const canceled = new AbortController();
    reviews.set(r.record_id, canceled);
    const job = queue.then(async () => {
      expire();
      if (closing || r.state !== 'pending' || s.revoked || now() >= s.expires) {
        reviews.delete(r.record_id);
        if (r.state === 'pending') end(r, 'expired', 'The signing request expired.');
        return;
      }
      const signal = AbortSignal.any([
        controller.signal,
        canceled.signal,
        AbortSignal.timeout(Math.max(1, Math.min(r.expires, s.expires) - now())),
      ]);
      try {
        const approved = await review(
          { origin: r.origin, signer: { ...r.signer }, details: structuredClone(r.details) },
          { signal },
        );
        if (signal.aborted || r.state !== 'pending' || s.revoked || now() >= s.expires || now() >= r.expires)
          return;
        if (!approved) {
          end(r, 'denied', 'The review denied this request.');
          return;
        }
        if (r.input.kind === 'transaction') inspectTransaction(r.input, r.public_key, now());
        r.state = 'approved';
        logResult(r);
        const keys = await listSigners({ signal });
        if (signal.aborted || r.state !== 'approved' || s.revoked || now() >= s.expires || now() >= r.expires)
          throw Error('The signing approval expired or was canceled.');
        if ((s.allowed && !s.allowed.has(r.public_key)) || !keys.some((k) => k.public_key === r.public_key))
          throw Error('The selected key is no longer available.');
        let authLedger: number | undefined;
        if (r.input.kind !== 'transaction') {
          authLedger = await trustedLedger(signal);
          if (r.input.kind === 'auth_entry')
            inspectAuthPreimageRequest(r.input, r.public_key, now(), authLedger);
          else inspectAuthorization(r.input, r.public_key, now(), authLedger);
        }
        if (signal.aborted || r.state !== 'approved' || s.revoked || now() >= s.expires || now() >= r.expires)
          throw Error('The signing approval expired or was canceled.');
        r.state = 'signing';
        logResult(r);
        const signature = await sign(r.public_key, r.details.hash, { signal });
        if (r.state !== 'signing')
          log(`1Password returned a signature after cancellation. Withheld ${r.details.hash}.\n`);
        if (r.input.kind !== 'transaction') authLedger = await trustedLedger(signal);
        const result =
          r.input.kind === 'transaction'
            ? { signed_tx_xdr: attachSignature(r.input, r.public_key, signature) }
            : r.input.kind === 'auth_entry'
              ? { signed_auth_entry: attachPreimageSignature(r.input, r.public_key, authLedger!, signature) }
              : { signed_auth_entry_xdr: attachAuthSignature(r.input, r.public_key, authLedger!, signature) };
        if (signal.aborted || r.state !== 'signing' || s.revoked || now() >= s.expires || now() >= r.expires)
          throw Error('The signing result is withheld because approval expired or was canceled.');
        r.result = result;
        r.state = 'signed';
        logResult(r);
      } catch (errorValue) {
        const error = requestError(errorValue);
        if (['signing', 'signed'].includes(r.state)) end(r, 'unknown', error.message);
        else if (['pending', 'approved'].includes(r.state)) {
          if (now() >= r.expires) end(r, 'expired', error.message);
          else end(r, 'denied', error.message, sep43Error(error));
        }
      } finally {
        if (r.state === 'pending')
          end(r, now() >= r.expires ? 'expired' : 'denied', 'The signing request ended before review.');
        reviews.delete(r.record_id);
      }
    });
    queue = job.catch(() => {});
    jobs.add(job);
    job.finally(() => jobs.delete(job)).catch(() => {});
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || '/', origin),
      route = url.pathname;
    const host = req.headers.host;
    if (
      ![
        new URL(origin).host,
        `127.0.0.1:${(server.address() as AddressInfo | null)?.port}`,
        `localhost:${(server.address() as AddressInfo | null)?.port}`,
      ].includes(host || '')
    )
      throw fail('invalid_request', 'The request host is invalid.', 403);
    if (closing) throw fail('bridge_unavailable', 'The bridge is stopping.');
    expire();
    if (route.startsWith('/v1/')) {
      const siteOrigin = req.headers.origin;
      if (!validOrigin(siteOrigin) || siteOrigin === origin)
        throw fail('invalid_request', 'Use a separate website Origin.', 403);
      res.setHeader('Access-Control-Allow-Origin', siteOrigin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '300',
        });
        return res.end();
      }
      if (route === '/v1/connect' && req.method === 'POST') {
        const data = await body(req);
        if (now() < lockedUntil)
          throw fail(
            'rate_limited',
            'Too many incorrect codes. Wait one minute, then use the new code in the tunnel terminal.',
          );
        if (now() >= pairExpires) {
          rotateCode();
          throw fail(
            'invalid_request',
            'The connection code expired. Use the new code in the tunnel terminal.',
            403,
          );
        }
        if (
          Object.keys(data).some((k) => !['code', 'wallet_scope'].includes(k)) ||
          (data.wallet_scope !== 'selected' && data.wallet_scope !== 'available')
        )
          throw fail('invalid_request', 'The connection fields are invalid.');
        if (!equal(data.code, pairCode)) {
          // Five failures replace the code and pause connection for one minute.
          if (++attempts >= 5) {
            lockedUntil = now() + 60000;
            rotateCode();
          }
          throw fail('invalid_request', 'The connection code is incorrect.', 403);
        }
        if (sessions.size >= 64)
          throw fail(
            'rate_limited',
            'The connection limit was reached. Disconnect a website or restart the tunnel.',
          );
        const s: Session = {
          id: randomUUID(),
          token: token(),
          origin: siteOrigin,
          public_key: null,
          wallet_scope: data.wallet_scope,
          selection_revision: 0,
          allowed: null,
          expires: now() + 300000,
          revoked: false,
          canceled: new Set(),
        };
        sessions.set(s.token, s);
        rotateCode();
        return sendJson(res, 201, {
          token: s.token,
          connection_id: s.id,
          expires_at: iso(s.expires),
          wallet_scope: s.wallet_scope,
          selection_revision: s.selection_revision,
        });
      }
      const s = website(req);
      if (route === '/v1/signers' && req.method === 'GET') {
        const signers = await keys();
        website(req);
        if (s.wallet_scope === 'available' && !s.allowed)
          s.offered = { id: token(), keys: new Set(signers.map((k) => k.public_key)) };
        return sendJson(res, 200, {
          signers: s.allowed ? signers.filter((k) => s.allowed!.has(k.public_key)) : signers,
          ...(!s.allowed && s.offered ? { grant_id: s.offered.id } : {}),
        });
      }
      if (route === '/v1/select' && req.method === 'POST') {
        const data = await body(req);
        const scoped = s.wallet_scope === 'available';
        const validRevision = () => {
          if (
            scoped &&
            (!Number.isSafeInteger(data.expected_revision) || data.expected_revision !== s.selection_revision)
          )
            throw fail('conflict', 'The wallet selection changed. Refresh the active wallet.');
          if (!scoped && s.public_key)
            throw fail(
              'conflict',
              'This connection already has a wallet. Disconnect to select another wallet.',
            );
        };
        if (
          Object.keys(data).some(
            (k) =>
              ![
                'public_key',
                ...(scoped ? ['expected_revision', ...(!s.allowed ? ['grant_id'] : [])] : []),
              ].includes(k),
          )
        )
          throw fail('invalid_request', 'The selection fields are invalid.');
        website(req);
        validRevision();
        const offered = s.offered;
        if (scoped && !s.allowed && (!offered || !equal(data.grant_id, offered.id)))
          throw fail('conflict', 'Refresh the wallet list before selecting a wallet.');
        const signers = await keys();
        website(req);
        validRevision();
        if (scoped && !s.allowed && s.offered !== offered)
          throw fail('conflict', 'The wallet list changed. Review it again.');
        const key = signers.find(
          (k) =>
            k.public_key === data.public_key && (!scoped || (s.allowed || offered!.keys).has(k.public_key)),
        );
        if (!key) throw fail('invalid_request', 'Select an available key from this connection.');
        if (s.public_key !== key.public_key) {
          // Cancel and replace the selection together. No await can admit an old request between them.
          for (const r of records.values())
            if (r.session_id === s.id && (active(r) || r.state === 'signed')) {
              end(
                r,
                ['signing', 'signed'].includes(r.state) ? 'unknown' : 'denied',
                r.delivered
                  ? 'The bridge sent the signature before the wallet changed.'
                  : 'The active wallet changed.',
              );
              reviews.get(r.record_id)?.abort();
            }
          if (!s.public_key) {
            s.allowed = scoped
              ? new Set(signers.filter((k) => offered!.keys.has(k.public_key)).map((k) => k.public_key))
              : null;
            delete s.offered;
            s.expires = now() + 3600000;
          }
          s.public_key = key.public_key;
          s.key = { public_key: key.public_key, comment: key.comment, fingerprint: key.fingerprint };
          s.selection_revision++;
        }
        return sendJson(res, 200, {
          address: s.public_key,
          network: 'TESTNET',
          network_passphrase: Networks.TESTNET,
          selection_revision: s.selection_revision,
          expires_at: iso(s.expires),
        });
      }
      if (route === '/v1/account' && req.method === 'GET')
        return sendJson(res, 200, {
          connection_id: s.id,
          address: s.public_key,
          network: 'TESTNET',
          network_passphrase: Networks.TESTNET,
          expires_at: iso(s.expires),
          wallet_scope: s.wallet_scope,
          selection_revision: s.selection_revision,
        });
      if (route === '/v1/disconnect' && req.method === 'POST') {
        await body(req);
        revoke(s);
        return sendJson(res, 200, { disconnected: true });
      }
      if (route === '/v1/requests' && req.method === 'POST') {
        if (!s.public_key) throw fail('not_connected', 'Select a wallet first.', 409);
        const input = await body(req);
        website(req);
        const fields = requestFields[input.kind as SigningInput['kind']];
        if (
          typeof input.id !== 'string' ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(input.id || '') ||
          !fields ||
          Object.keys(input).some(
            (k) =>
              ![
                'id',
                'kind',
                ...fields,
                'network_passphrase',
                'address',
                ...(s.wallet_scope === 'available' ? ['selection_revision'] : []),
              ].includes(k),
          )
        )
          throw fail('invalid_request', 'The signing request fields are invalid.');
        if (
          s.wallet_scope === 'available' &&
          (!Number.isSafeInteger(input.selection_revision) ||
            input.selection_revision !== s.selection_revision)
        )
          throw fail('conflict', 'The wallet selection changed. Build a new signing request.');
        const key = `${s.id}:${input.id}`,
          prior = records.get(key);
        if (s.canceled.has(input.id))
          throw fail('rejected', 'The website canceled this request before it arrived.', 409);
        if (prior) {
          if (requestIdentity(prior.input) !== requestIdentity(input))
            throw fail('conflict', 'This request ID already identifies a different request.');
          return sendJson(res, 200, summary(prior));
        }
        const all = [...records.values()];
        if (all.filter((r) => r.session_id === s.id).length >= 1000)
          throw fail(
            'rate_limited',
            'This connection reached its request limit. Disconnect and connect again.',
          );
        if (all.filter((r) => active(r)).length >= 32)
          throw fail('rate_limited', 'The signing request limit was reached.');
        if (
          fields.some((k) => k !== 'adapter' && typeof input[k] !== 'string') ||
          typeof input.network_passphrase !== 'string' ||
          typeof input.address !== 'string'
        )
          throw fail('invalid_request', 'The signing request fields are invalid.');
        const common = {
          network_passphrase: input.network_passphrase,
          address: input.address,
          ...(typeof input.selection_revision === 'number'
            ? { selection_revision: input.selection_revision }
            : {}),
        };
        const signingInput: SigningInput =
          input.kind === 'authorization'
            ? {
                ...common,
                kind: 'authorization',
                auth_entry_xdr: input.auth_entry_xdr as string,
                auth_address: input.auth_address as string,
                adapter: input.adapter as AuthorizationInput['adapter'],
              }
            : input.kind === 'auth_entry'
              ? { ...common, kind: 'auth_entry', preimage_xdr: input.preimage_xdr as string }
              : { ...common, kind: 'transaction', xdr: input.xdr as string };
        const checked =
          signingInput.kind === 'transaction'
            ? inspectTransaction(signingInput, s.public_key, now())
            : signingInput.kind === 'auth_entry'
              ? inspectAuthPreimageRequest(signingInput, s.public_key, now())
              : inspectAuthorization(signingInput, s.public_key, now());
        const record: SigningRecord = {
          record_id: randomUUID(),
          session_id: s.id,
          origin: s.origin,
          id: input.id,
          public_key: s.public_key,
          signer: { ...s.key! },
          input: signingInput,
          details: checked.details,
          expires: checked.expires,
          state: 'pending',
        };
        logResult(record);
        records.set(key, record);
        scheduleReview(record, s);
        return sendJson(res, 201, summary(record));
      }
      const match = route.match(/^\/v1\/requests\/([A-Za-z0-9_-]{1,64})(\/cancel)?$/);
      if (match) {
        let r = records.get(`${s.id}:${match[1]}`);
        if (match[2] && req.method === 'POST') {
          await body(req);
          website(req);
          r = records.get(`${s.id}:${match[1]}`);
          // A cancel can arrive before a delayed create. Block that ID for this session.
          if (!r) {
            if (s.canceled.size >= 1000)
              throw fail(
                'rate_limited',
                'This connection reached its request limit. Disconnect and connect again.',
              );
            s.canceled.add(match[1]);
            return sendJson(res, 200, {
              id: match[1],
              state: 'denied',
              error: ended('rejected', 'The website canceled this request.', 'denied'),
            });
          }
          // A signed result can race the cancellation. Withhold it, as a revocation does.
          if (active(r) || r.state === 'signed') {
            end(
              r,
              ['signing', 'signed'].includes(r.state) ? 'unknown' : 'denied',
              r.delivered
                ? 'The bridge sent the signature, then the website canceled.'
                : 'The website canceled this request.',
            );
            reviews.get(r.record_id)?.abort();
          }
          return sendJson(res, 200, summary(r));
        }
        if (!r) throw fail('invalid_request', 'The request does not exist in this website session.', 404);
        if (req.method === 'GET') return sendJson(res, 200, summary(r));
      }
      throw fail('invalid_request', 'The route does not exist.', 404);
    }
    if (route === '/api/session' && req.method === 'GET')
      return sendJson(res, 200, { service: 'walleterm', protocol: 3 }); // Startup readiness probe.
    throw fail('invalid_request', 'Use this tunnel URL in a Walleterm-compatible website.', 404);
  }

  const server = createServer((req, res) => {
    const job = handle(req, res).catch((error) => {
      if (!res.headersSent && !res.destroyed)
        sendJson(res, error.status || 500, {
          error: error.status
            ? sep43Error(error)
            : sep43Error(
                walletermError('internal', 'The bridge could not complete this request. Check its terminal.'),
              ),
        });
      else res.destroy();
    });
    jobs.add(job);
    job.finally(() => jobs.delete(job));
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.setTimeout(150000);
  return {
    service: 'walleterm',
    server,
    get pairing() {
      return { walleterm: 3, url: origin, code: pairCode, expires_at: iso(pairExpires) };
    },
    onPairingChanged(callback: () => void) {
      pairingChanged = callback;
    },
    setPublicOrigin(value: string) {
      if (!validOrigin(value)) throw Error('Use an HTTPS or loopback origin.');
      origin = value;
      restartCodeTimer();
    },
    async listen() {
      if (closing) throw Error('The bridge is stopping.');
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
      if (closing) server.close();
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      controller.abort();
      clearTimeout(pairTimer);
      closePromise = (async () => {
        server.close();
        server.closeAllConnections();
        await Promise.allSettled([...jobs]);
      })();
      return closePromise;
    },
  };
}
