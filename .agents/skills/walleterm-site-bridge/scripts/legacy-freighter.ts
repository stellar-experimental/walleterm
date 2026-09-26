#!/usr/bin/env bun
// Generate page code for a confirmed legacy Freighter message transport.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createPublicKey, verify } from 'node:crypto';

const TESTNET = 'Test SDF Network ; September 2015';
const args = process.argv.slice(2);
const command = args.shift();
const options = new Map<string, string | true>();
for (let index = 0; index < args.length; index++) {
  const key = args[index];
  if (!key.startsWith('--') || options.has(key)) throw Error(`Invalid option: ${key}`);
  if (key === '--legacy-flag') {
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

if (command === 'inject') {
  exactOptions(['--public-key', '--origin', '--legacy-flag']);
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
  const flag = options.get('--legacy-flag') === true;
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
    else if (request.type === 'REQUEST_ACCESS') response.publicKey = publicKey;
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
  const publicKey = required('--public-key');
  if (!/^G[A-Z2-7]{55}$/.test(publicKey)) throw Error('Use the full Ed25519 G-address given to inject.');
  const index = Number(required('--index'));
  if (!Number.isSafeInteger(index) || index < 0) throw Error('The request index is invalid.');
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
  const decodedKey: { public_key_ed25519?: string } = JSON.parse(
    execFileSync('stellar', ['strkey', 'decode', publicKey], { encoding: 'utf8', timeout: 30000 }),
  );
  const rawKey = decodedKey.public_key_ed25519 || '';
  const added = after.tx.signatures.at(-1);
  if (
    !/^[0-9a-f]{64}$/.test(rawKey) ||
    added?.hint !== rawKey.slice(-8) ||
    !/^[0-9a-f]{128}$/.test(added?.signature || '') ||
    !verify(
      null,
      Buffer.from(hash, 'hex'),
      createPublicKey({
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(rawKey, 'hex').toString('base64url') },
        format: 'jwk',
      }),
      Buffer.from(added?.signature ?? '', 'hex'),
    )
  ) {
    throw Error('The new signature does not verify for the selected key and reviewed hash.');
  }
  process.stdout.write(
    `window.__walletermBridge.respond(${index}, ${JSON.stringify(unsigned)}, ${JSON.stringify(signed)})\n`,
  );
} else {
  throw Error('Use inject or reply.');
}
