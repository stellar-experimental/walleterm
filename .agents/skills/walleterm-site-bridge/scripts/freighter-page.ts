#!/usr/bin/env bun
// Generate page code that answers Freighter's window.postMessage transport and captures signing requests.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';

const TESTNET = 'Test SDF Network ; September 2015';
const args = process.argv.slice(2);
const command = args.shift();
const options = new Map<string, string | true>();
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (!key.startsWith('--') || options.has(key)) throw Error(`Invalid option: ${key}`);
  if (key === '--window-flag') {
    options.set(key, true);
    continue;
  }
  const value = args[++index];
  if (!value || value.startsWith('--')) throw Error(`Set a value for ${key}.`);
  options.set(key, value);
}
function required(key: string) {
  const value = options.get(key);
  if (typeof value !== 'string') throw Error(`Set ${key}.`);
  return value;
}
function exactOptions(allowed: string[]) {
  for (const key of options.keys()) if (!allowed.includes(key)) throw Error(`Unknown option: ${key}`);
}
function readXdr(path: string) {
  const value = readFileSync(path, 'utf8').trim();
  if (value.length < 8 || value.length > 1_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw Error('The XDR file must contain one base64 envelope.');
  }
  return value;
}
function stellarXdr(operation: string, xdr: string, options: string[] = []) {
  return execFileSync('stellar', ['tx', operation, ...options], {
    input: xdr + '\n',
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 3_000_000,
  }).trim();
}
function selectedKey() {
  const publicKey = required('--public-key');
  if (!/^G[A-Z2-7]{55}$/.test(publicKey)) throw Error('Use the full Ed25519 G-address given to inject.');
  return publicKey;
}
function requestIndex() {
  const index = Number(required('--index'));
  if (!Number.isSafeInteger(index) || index < 0) throw Error('The request index is invalid.');
  return index;
}
function rawPublicKey(publicKey: string) {
  const decodedKey: { public_key_ed25519?: string } = JSON.parse(
    execFileSync('stellar', ['strkey', 'decode', publicKey], { encoding: 'utf8', timeout: 30000 }),
  );
  return decodedKey.public_key_ed25519 || '';
}
// True when signatureHex is the raw key's Ed25519 signature over the 32 digest bytes.
function signatureVerifies(rawKey: string, digestHex: string, signatureHex: string) {
  return (
    /^[0-9a-f]{64}$/.test(rawKey) &&
    /^[0-9a-f]{128}$/.test(signatureHex) &&
    verify(
      null,
      Buffer.from(digestHex, 'hex'),
      createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(rawKey, 'hex').toString('base64url') },
        format: 'jwk',
      }),
      Buffer.from(signatureHex, 'hex'),
    )
  );
}

if (command === 'inject') {
  exactOptions(['--public-key', '--origin', '--window-flag']);
  const key = required('--public-key');
  if (!/^G[A-Z2-7]{55}$/.test(key)) throw Error('Use a full Ed25519 G-address.');
  const expectedOrigin = required('--origin');
  const parsedOrigin = new URL(expectedOrigin);
  if (
    parsedOrigin.origin !== expectedOrigin ||
    !['https:', 'http:'].includes(parsedOrigin.protocol) ||
    (parsedOrigin.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsedOrigin.hostname))
  ) {
    throw Error('Use an exact HTTPS origin or a loopback HTTP origin.');
  }
  const flag = options.get('--window-flag') === true;
  process.stdout.write(`(() => {
  const publicKey = ${JSON.stringify(key)};
  const origin = location.origin;
  if (origin !== ${JSON.stringify(expectedOrigin)}) throw Error('The page origin changed.');
  if (window.__walletermBridge) throw Error('The bridge already exists on this page.');
  if (window.freighter) throw Error('A Freighter provider already exists on this page.');
  const bridge = {
    publicKey, origin, requests: [], unsupported: [],
    pending() { return this.requests.map((entry, index) => ({ index, type: entry.type,
      messageId: entry.messageId, payloadLength: (entry.transactionXdr ?? entry.blob ?? entry.entryXdr).length,
      network: entry.network, networkPassphrase: entry.networkPassphrase,
      accountToSign: entry.accountToSign, apiVersion: entry.apiVersion,
      responded: entry.responded })); },
    respond(index, originalXdr, signedXdr) {
      const entry = this.requests[index];
      if (!entry || entry.responded || entry.type !== 'SUBMIT_TRANSACTION') throw Error('No pending signing request at that index.');
      if (entry.transactionXdr !== originalXdr) throw Error('The pending XDR changed.');
      if (typeof signedXdr !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signedXdr)) throw Error('The signed XDR is invalid.');
      window.postMessage({ source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
        messagedId: entry.messageId, signedTransaction: signedXdr }, origin);
      entry.responded = true;
      return { returned: true, index, messageId: entry.messageId };
    },
    respondMessage(index, originalBlob, signedBlob) {
      const entry = this.requests[index];
      if (!entry || entry.responded || entry.type !== 'SUBMIT_BLOB') throw Error('No pending message request at that index.');
      if (entry.blob !== originalBlob) throw Error('The pending message changed.');
      if (!(Number.parseInt(String(entry.apiVersion), 10) >= 4)) throw Error('Freighter API before 4 expects another message result.');
      if (typeof signedBlob !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signedBlob)) throw Error('The signature is invalid.');
      window.postMessage({ source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
        messagedId: entry.messageId, signedBlob, signerAddress: publicKey }, origin);
      entry.responded = true;
      return { returned: true, index, messageId: entry.messageId };
    }
  };
  Object.defineProperty(window, '__walletermBridge', { value: bridge, configurable: false });
  ${flag ? 'window.freighter = true;' : ''}
  window.addEventListener('message', event => {
    const request = event.data;
    if (event.source !== window || event.origin !== origin || request?.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;
    if (request.messageId === undefined || request.messageId === null) return;
    const response = { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: request.messageId };
    if (request.type === 'REQUEST_CONNECTION_STATUS') response.isConnected = true;
    else if (request.type === 'REQUEST_ACCESS' || request.type === 'REQUEST_PUBLIC_KEY') response.publicKey = publicKey;
    else if (request.type === 'REQUEST_ALLOWED_STATUS' || request.type === 'SET_ALLOWED_STATUS') response.isAllowed = true;
    else if (request.type === 'REQUEST_NETWORK') response.network = 'TESTNET';
    else if (request.type === 'REQUEST_NETWORK_DETAILS') response.networkDetails = {
      network: 'TESTNET', networkName: 'Testnet', networkUrl: 'https://horizon-testnet.stellar.org',
      networkPassphrase: ${JSON.stringify(TESTNET)} };
    else if (request.type === 'SUBMIT_TRANSACTION') {
      if (typeof request.transactionXdr !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(request.transactionXdr)) {
        bridge.unsupported.push({ type: request.type, messageId: request.messageId, reason: 'invalid_xdr' });
        return;
      }
      bridge.requests.push({ type: request.type, messageId: request.messageId,
        transactionXdr: request.transactionXdr, network: request.network,
        networkPassphrase: request.networkPassphrase, accountToSign: request.accountToSign,
        responded: false, capturedAt: new Date().toISOString() });
      return;
    } else if (request.type === 'SUBMIT_BLOB' || request.type === 'SUBMIT_AUTH_ENTRY') {
      const field = request.type === 'SUBMIT_BLOB' ? 'blob' : 'entryXdr';
      const payload = request[field];
      if (typeof payload !== 'string' || payload.length === 0 || payload.length > 1_500_000) {
        bridge.unsupported.push({ type: request.type, messageId: request.messageId, reason: 'invalid_payload' });
        return;
      }
      bridge.requests.push({ type: request.type, messageId: request.messageId,
        [field]: payload, accountToSign: request.accountToSign,
        networkPassphrase: request.networkPassphrase, apiVersion: request.apiVersion,
        responded: false, capturedAt: new Date().toISOString() });
      return;
    } else { bridge.unsupported.push({ type: request.type, messageId: request.messageId }); return; }
    window.postMessage(response, origin);
  });
  return { ready: true, publicKey, origin, network: 'TESTNET' };
})()\n`);
} else if (command === 'reply') {
  exactOptions(['--index', '--public-key', '--unsigned-xdr', '--signed-xdr', '--expected-hash']);
  const publicKey = selectedKey();
  const index = requestIndex();
  const hash = required('--expected-hash');
  if (!/^[0-9a-f]{64}$/.test(hash)) throw Error('The expected hash is invalid.');
  const unsigned = readXdr(required('--unsigned-xdr'));
  const signed = readXdr(required('--signed-xdr'));
  const beforeHash = stellarXdr('hash', unsigned, ['--network-passphrase', TESTNET]);
  const afterHash = stellarXdr('hash', signed, ['--network-passphrase', TESTNET]);
  if (beforeHash !== hash || afterHash !== hash)
    throw Error('The unsigned and signed hashes must match the reviewed hash.');
  // Stellar CLI JSON. A V1 envelope has tx.tx and tx.signatures.
  interface DecodedEnvelope {
    tx?: { tx?: unknown; signatures?: { hint?: string; signature?: string }[] };
  }
  const before: DecodedEnvelope = JSON.parse(stellarXdr('decode', unsigned));
  const after: DecodedEnvelope = JSON.parse(stellarXdr('decode', signed));
  if (
    !before.tx?.tx ||
    !after.tx?.tx ||
    !Array.isArray(before.tx.signatures) ||
    !Array.isArray(after.tx.signatures)
  ) {
    throw Error('Use this reply helper only for V1 envelopes.');
  }
  if (
    JSON.stringify(before.tx.tx) !== JSON.stringify(after.tx.tx) ||
    after.tx.signatures.length !== before.tx.signatures.length + 1 ||
    JSON.stringify(after.tx.signatures.slice(0, -1)) !== JSON.stringify(before.tx.signatures)
  ) {
    throw Error('The signed envelope changed the transaction body or existing signatures.');
  }
  const rawKey = rawPublicKey(publicKey);
  const added = after.tx.signatures.at(-1);
  if (added?.hint !== rawKey.slice(-8) || !signatureVerifies(rawKey, hash, added?.signature ?? '')) {
    throw Error('The new signature does not verify for the selected key and reviewed hash.');
  }
  process.stdout.write(
    `window.__walletermBridge.respond(${index}, ${JSON.stringify(unsigned)}, ${JSON.stringify(signed)})\n`,
  );
} else if (command === 'reply-message') {
  exactOptions(['--index', '--public-key', '--message-json', '--result']);
  const publicKey = selectedKey();
  const index = requestIndex();
  // The captured blob, saved as the JSON string that `agent-browser eval` prints. JSON keeps every byte exact.
  const message: unknown = JSON.parse(readFileSync(required('--message-json'), 'utf8'));
  const bytes = typeof message === 'string' ? Buffer.byteLength(message, 'utf8') : 0;
  if (typeof message !== 'string' || bytes < 1 || bytes > 1024) {
    throw Error('The message file must hold one JSON string of 1 to 1024 UTF-8 bytes.');
  }
  // The `walleterm sign` result for that exact message.
  const result: {
    ok?: unknown;
    verified?: unknown;
    public_key?: unknown;
    digest?: unknown;
    signature?: unknown;
  } = JSON.parse(readFileSync(required('--result'), 'utf8'));
  const digest = createHash('sha256')
    .update('Stellar Signed Message:\n')
    .update(message, 'utf8')
    .digest('hex');
  if (
    result.ok !== true ||
    result.verified !== true ||
    result.public_key !== publicKey ||
    result.digest !== digest
  ) {
    throw Error(
      'The result must be a verified walleterm signature by the selected key over the SEP-53 digest of this message.',
    );
  }
  const signature = typeof result.signature === 'string' ? result.signature : '';
  if (!signatureVerifies(rawPublicKey(publicKey), digest, signature)) {
    throw Error('The signature does not verify for the selected key and message.');
  }
  const signedBlob = Buffer.from(signature, 'hex').toString('base64');
  process.stdout.write(
    `window.__walletermBridge.respondMessage(${index}, ${JSON.stringify(message)}, ${JSON.stringify(signedBlob)})\n`,
  );
} else {
  throw Error('Use inject, reply, or reply-message.');
}
