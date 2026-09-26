import { spawn } from 'node:child_process';
import { StrKey } from '@stellar/stellar-sdk';
import { stopChild } from './runtime.ts';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithStdioTuple } from 'node:child_process';
import type { Signer, SignalOptions } from '../sdk/types.ts';

export interface SignerOptions extends SignalOptions {
  command?: string;
  spawnSigner?: (
    command: string,
    args: string[],
    options: SpawnOptionsWithStdioTuple<'pipe', 'pipe', 'pipe'>,
  ) => ChildProcessWithoutNullStreams;
  vault?: string;
  readVault?: (args: string[], options: { signal: AbortSignal }) => Promise<string>;
}
interface CommandOptions extends SignerOptions {
  timeoutMs: number;
  maxOutput: number;
  rawOutput?: boolean;
}
interface SignResult {
  public_key: string;
  digest: string;
  verified: boolean;
  signature: string;
}
const MAX_BODY = 8192;
function fail(status: number, message: string) {
  return Object.assign(Error(message), { status });
}
function signerCommand(
  args: string[],
  input: string,
  {
    signal,
    command = process.env.WALLETERM_BINARY || 'walleterm',
    spawnSigner = spawn,
    timeoutMs,
    maxOutput,
    rawOutput = false,
  }: CommandOptions,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) return reject(fail(503, 'The signing service stopped.'));
    const child = spawnSigner(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let finished = false;
    let stopping = false;
    const finish = (error: unknown, result?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(result ?? '');
    };
    const stop = (error: unknown) => {
      if (finished || stopping) return;
      stopping = true;
      stopChild(child).then(() => finish(error), finish);
    };
    const abort = () => stop(fail(503, 'The signing service stopped.'));
    const timer = setTimeout(() => stop(fail(504, 'The 1Password request timed out.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (stopping) return;
      if (Buffer.byteLength(output) + chunk.length > maxOutput)
        return stop(fail(502, 'The signer response is too large.'));
      output += chunk.toString();
    });
    child.stderr.resume();
    child.once('error', (error) => finish(error));
    child.stdin.on('error', (error) => stop(error));
    child.once('close', (code) => {
      if (finished || stopping) return;
      if (rawOutput)
        return code === 0 ? finish(null, output) : finish(fail(502, 'The 1Password CLI request failed.'));
      let result: { ok?: boolean; error?: { message?: string } } | null;
      try {
        result = JSON.parse(output);
      } catch {
        return finish(fail(502, 'The signer returned invalid JSON.'));
      }
      if (code !== 0 || result?.ok !== true)
        return finish(fail(502, result?.error?.message || 'The 1Password request failed.'));
      finish(null, output);
    });
    child.stdin.end(input);
  });
}

export async function signDigest(publicKey: string, digest: string, options: SignerOptions = {}) {
  const result: SignResult = JSON.parse(
    await signerCommand(['sign'], JSON.stringify({ public_key: publicKey, digest }), {
      ...options,
      timeoutMs: 125000,
      maxOutput: MAX_BODY,
    }),
  );
  if (
    result.public_key !== publicKey ||
    result.digest !== digest ||
    result.verified !== true ||
    !/^[a-f0-9]{128}$/.test(result.signature)
  ) {
    throw fail(502, 'The signer returned an invalid result.');
  }
  return result.signature;
}

export async function availableSigners(options: SignerOptions = {}): Promise<Signer[]> {
  const result: { signers?: Signer[] } = JSON.parse(
    await signerCommand(['list'], '', { ...options, timeoutMs: 10000, maxOutput: 1024 * 1024 }),
  );
  if (!Array.isArray(result.signers)) throw fail(502, 'The 1Password signer list is unavailable.');
  const signers = result.signers
    .filter((item) => item && StrKey.isValidEd25519PublicKey(item.public_key))
    .map(({ public_key, fingerprint, comment }) => ({ public_key, fingerprint, comment }));
  if (new Set(signers.map((item) => item.public_key)).size !== signers.length)
    throw fail(502, 'The signer list contains duplicate keys.');
  const vault = options.vault ?? process.env.OP_VAULT;
  if (vault === undefined || vault === '') return signers;
  if (!vault.trim()) throw fail(502, 'Set OP_VAULT to a 1Password vault name or ID.');
  const controller = new AbortController();
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    controller.signal,
    AbortSignal.timeout(120000),
  ]);
  const read = (args: string[]) => (options.readVault || readVault)(args, { signal });
  let items;
  try {
    items = JSON.parse(
      await read(['item', 'list', '--vault', vault, '--categories', 'SSH Key', '--format', 'json']),
    );
  } catch {
    throw fail(502, 'The selected 1Password vault is unavailable. Check OP_VAULT and the 1Password CLI.');
  }
  if (!Array.isArray(items) || items.length > 1024)
    throw fail(502, 'The selected vault returned an invalid key list.');
  const references = items.map((item) => {
    // References use IDs, never item titles or agent comments.
    if (
      !/^[a-z2-7]{26}$/.test(item?.id || '') ||
      !/^[a-z2-7]{26}$/.test(item?.vault?.id || '') ||
      item.category !== 'SSH_KEY' ||
      !(
        item.vault.id === vault ||
        (typeof item.vault.name === 'string' && item.vault.name.toLowerCase() === vault.toLowerCase())
      )
    ) {
      throw fail(502, 'The selected vault returned an invalid key item.');
    }
    return `op://${item.vault.id}/${item.id}/public key`;
  });
  const allowed = new Set<string>();
  // Bound CLI processes without retaining vault permissions between requests.
  for (let offset = 0; offset < references.length; offset += 4) {
    signal.throwIfAborted();
    const reads = references.slice(offset, offset + 4).map(async (reference) => {
      let publicKey;
      try {
        publicKey = await read(['read', '--no-newline', reference]);
      } catch {
        throw fail(502, 'A public key in the selected vault is unavailable.');
      }
      const [algorithm, encoded] = publicKey.trim().split(/\s+/);
      if (algorithm !== 'ssh-ed25519') return;
      const blob = Buffer.from(encoded || '', 'base64');
      if (
        blob.length !== 51 ||
        blob.toString('base64') !== encoded ||
        blob.readUInt32BE(0) !== 11 ||
        blob.toString('ascii', 4, 15) !== 'ssh-ed25519' ||
        blob.readUInt32BE(15) !== 32
      ) {
        throw fail(502, 'An Ed25519 public key in the selected vault is invalid.');
      }
      allowed.add(StrKey.encodeEd25519PublicKey(blob.subarray(19)));
    });
    try {
      await Promise.all(reads);
    } catch (error) {
      controller.abort();
      await Promise.allSettled(reads);
      throw error;
    }
  }
  signal.throwIfAborted();
  return signers.filter((item) => allowed.has(item.public_key));
}

function readVault(args: string[], { signal }: { signal: AbortSignal }) {
  // Reuse bounded output and shutdown escalation. Never return CLI diagnostics on failure.
  return signerCommand(args, '', {
    command: 'op',
    signal,
    timeoutMs: 120000,
    maxOutput: 1024 * 1024,
    rawOutput: true,
  });
}
