import { spawn } from 'node:child_process';
import { StrKey } from '@stellar/stellar-sdk';
import { stopChild } from './runtime.mjs';
const MAX_BODY = 8192;
function fail(status, message) { return Object.assign(Error(message), { status }); }
function signerCommand(args, input, { signal, command = process.env.WALLETERM_BINARY || 'walleterm', spawnSigner = spawn, timeoutMs, maxOutput } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(fail(503, 'The signing service stopped.'));
    const child = spawnSigner(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let finished = false;
    let stopping = false;
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result);
    };
    const stop = error => {
      if (finished || stopping) return;
      stopping = true;
      stopChild(child).then(() => finish(error), finish);
    };
    const abort = () => stop(fail(503, 'The signing service stopped.'));
    const timer = setTimeout(() => stop(fail(504, 'The 1Password request timed out.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => {
      if (stopping) return;
      if (Buffer.byteLength(output) + chunk.length > maxOutput) return stop(fail(502, 'The signer response is too large.'));
      output += chunk.toString();
    });
    child.stderr.resume();
    child.once('error', error => finish(error));
    child.stdin.on('error', error => stop(error));
    child.once('close', code => {
      if (finished || stopping) return;
      let result;
      try { result = JSON.parse(output); } catch { return finish(fail(502, 'The signer returned invalid JSON.')); }
      if (code !== 0 || result.ok !== true) return finish(fail(502, result?.error?.message || 'The 1Password request failed.'));
      finish(null, result);
    });
    child.stdin.end(input);
  });
}

export async function signDigest(publicKey, digest, options = {}) {
  const result = await signerCommand(['sign'], JSON.stringify({ public_key: publicKey, digest }),
    { ...options, timeoutMs: 125000, maxOutput: MAX_BODY });
  if (result.public_key !== publicKey || result.digest !== digest || result.verified !== true || !/^[a-f0-9]{128}$/.test(result.signature)) {
    throw fail(502, 'The signer returned an invalid result.');
  }
  return result.signature;
}

export async function availableSigners(options = {}) {
  const result = await signerCommand(['list'], '', { ...options, timeoutMs: 10000, maxOutput: 1024 * 1024 });
  if (!Array.isArray(result.signers)) throw fail(502, 'The 1Password signer list is unavailable.');
  const signers = result.signers.filter(item => item && StrKey.isValidEd25519PublicKey(item.public_key))
    .map(({ public_key, fingerprint, comment }) => ({ public_key, fingerprint, comment }));
  if (new Set(signers.map(item => item.public_key)).size !== signers.length) throw fail(502, 'The signer list contains duplicate keys.');
  return signers;
}

