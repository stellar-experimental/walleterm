import { inspectAuthEntry, attachAuthSignature } from '../sdk/authorization.ts';
import { signDigest } from './signer.ts';
import type { AuthEntryInput } from '../sdk/authorization.ts';

export interface AuthCLIInput extends AuthEntryInput {
  latest_ledger: number;
}
const invalid = (message: string) => Object.assign(Error(message), { code: 'invalid_input' });
export function parseAuthJSON(text: string): AuthCLIInput {
  if (new TextEncoder().encode(text).length > 49152) throw invalid('The authorization request is too large.');
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw invalid('Send one JSON object.');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('Send one JSON object.');
  // JSON.parse accepts duplicate keys. Scan its valid token stream to reject them at every depth.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) || [];
  const objects: (Set<string> | null)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{') objects.push(new Set());
    else if (token === '[') objects.push(null);
    else if (token === '}' || token === ']') objects.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const key = JSON.parse(token),
        keys = objects.at(-1)!;
      if (keys.has(key)) throw invalid('Duplicate JSON fields are not supported.');
      keys.add(key);
    }
  }
  const fields = [
    'auth_entry_xdr',
    'public_key',
    'network_passphrase',
    'address',
    'adapter',
    'latest_ledger',
  ];
  if (Object.keys(input).some((k) => !fields.includes(k)) || fields.some((k) => !(k in input)))
    throw invalid('The authorization request fields are invalid.');
  return input;
}
export async function signAuthRequest(input: AuthCLIInput, sign: typeof signDigest, signal: AbortSignal) {
  // Freeze caller-owned objects before crossing an asynchronous signer boundary.
  input = structuredClone(input);
  const checked = inspectAuthEntry(input, input.public_key, input.latest_ledger);
  signal.throwIfAborted();
  const signature = await sign(input.public_key, checked.details.hash, { signal });
  signal.throwIfAborted();
  return {
    ok: true,
    public_key: input.public_key,
    digest: checked.details.hash,
    signed_auth_entry_xdr: attachAuthSignature(input, input.public_key, input.latest_ledger, signature),
    verified: true,
  };
}
if (import.meta.main) {
  const shutdown = new AbortController();
  const signal = AbortSignal.any([shutdown.signal, AbortSignal.timeout(120000)]);
  const interrupt = () => shutdown.abort(Error('The authorization request stopped.'));
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const stop = () => {
    if (!process.stdin.readableEnded)
      process.stdin.destroy(Error('The authorization request stopped or timed out.'));
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 49152) throw invalid('The authorization request is too large.');
      chunks.push(Buffer.from(chunk));
    }
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw invalid('Use valid UTF-8 JSON.');
    }
    const input = parseAuthJSON(text);
    const checked = inspectAuthEntry(input, input.public_key, input.latest_ledger);
    await new Promise<void>((resolve, reject) => {
      const failed = () =>
        reject(Object.assign(Error('The signing notice could not be written.'), { code: 'output_error' }));
      process.stderr.once('error', failed);
      process.stderr.write(
        `Sign authorization ${input.address} with ${input.public_key}: ${checked.details.hash}\n`,
        (error) => {
          if (error) failed();
          else {
            process.stderr.removeListener('error', failed);
            resolve();
          }
        },
      );
    });
    const result = await signAuthRequest(
      input,
      (publicKey, digest, options) => signDigest(publicKey, digest, { ...options, command: process.argv[2] }),
      signal,
    );
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const code = signal.aborted
      ? 'timeout'
      : error instanceof Error && 'code' in error
        ? String(error.code)
        : 'signing_failed';
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: { code, message: error instanceof Error ? error.message : 'Authorization failed.' },
      }) + '\n',
    );
    process.exitCode = code === 'invalid_input' ? 2 : 1;
  } finally {
    signal.removeEventListener('abort', stop);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}
