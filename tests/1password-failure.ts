// Parent-operated live lifecycle probe. Uses only dedicated test key A.
// Arguments: evidence label, optional delay before SIGINT (milliseconds).
// It signs one SEP-53 message: no network, no transaction, and no authorization.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { homedir } from 'node:os';
import { StrKey } from '@stellar/stellar-sdk';

const [label, cancelAfter] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label ?? '')) throw new Error('Provide a lowercase evidence label');
const metadata: { keys: { raw_public_key_hex: string }[] } = JSON.parse(
  readFileSync(new URL('../evidence/public-test-keys.json', import.meta.url), 'utf8'),
);
const first = metadata.keys[0];
if (!first) throw new Error('The public test key file lists no keys');
const raw = Buffer.from(first.raw_public_key_hex, 'hex');
const key = StrKey.encodeEd25519PublicKey(raw);
const message = `walleterm lifecycle test: ${label}`;
// SEP-53: walleterm signs SHA-256 of the prefix and the message bytes.
const digest = createHash('sha256').update(`Stellar Signed Message:\n${message}`).digest();
const file = new URL(`../evidence/live/1password-${label}.json`, import.meta.url);
mkdirSync(new URL('../evidence/live/', import.meta.url), { recursive: true });
const started = Date.now();
interface ProbeResult {
  label: string;
  started_at: string;
  public_key: string;
  message: string;
  digest: string;
  network_calls: number;
  child_pid?: number;
  spawn_error?: string;
  stage?: string;
  elapsed_ms?: number;
  exit_code?: number | null;
  signal?: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  response?: SignOutput;
  signature_verified?: boolean;
}
interface SignOutput {
  ok: boolean;
  digest: string;
  signature: string;
}
const result: ProbeResult = {
  label,
  started_at: new Date(started).toISOString(),
  public_key: key,
  message,
  digest: digest.toString('hex'),
  network_calls: 0,
};
const child = spawn(`${homedir()}/.local/bin/walleterm`, ['sign'], { stdio: ['pipe', 'pipe', 'pipe'] });
result.child_pid = child.pid;
writeFileSync(file, JSON.stringify({ ...result, stage: 'pending' }, null, 2) + '\n');
let stdout = '',
  stderr = '';
child.stdout.on('data', (data) => {
  stdout += data;
});
child.stderr.on('data', (data) => {
  stderr += data;
});
const cancellation = cancelAfter ? setTimeout(() => child.kill('SIGINT'), Number(cancelAfter)) : null;
const watchdog = setTimeout(() => child.kill('SIGKILL'), 135000);
child.on('error', (error) => {
  result.spawn_error = String(error);
});
child.on('close', (code, signal) => {
  if (cancellation) clearTimeout(cancellation);
  clearTimeout(watchdog);
  Object.assign(result, {
    stage: 'complete',
    elapsed_ms: Date.now() - started,
    exit_code: code,
    signal,
    stdout,
    stderr,
  });
  try {
    const response: SignOutput = JSON.parse(stdout);
    result.response = response;
    if (response.ok) {
      const publicKey = createPublicKey({
        key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]),
        format: 'der',
        type: 'spki',
      });
      result.signature_verified =
        response.digest === digest.toString('hex') &&
        verify(null, digest, publicKey, Buffer.from(response.signature, 'hex'));
    }
  } catch {
    /* Interrupted processes can return no JSON. */
  }
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
});
child.stdin.end(JSON.stringify({ public_key: key, message }));
