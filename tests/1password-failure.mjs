// Parent-operated live lifecycle probe. Uses only dedicated test key A.
// Arguments: evidence label, optional delay before SIGINT (milliseconds).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { homedir } from 'node:os';

const [label, cancelAfter] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(label ?? '')) throw new Error('Provide a lowercase evidence label');
const metadata = JSON.parse(readFileSync(new URL('../evidence/public-test-keys.json', import.meta.url)));
const raw = Buffer.from(metadata.keys[0].raw_public_key_hex, 'hex');
const key = 'GBSW6N4WGTIOH3ZJMFSEW4KU5RYLUP5YIK3ISNYFR4644WTSWXGMGZAA';
const digest = createHash('sha256').update(`walleterm lifecycle test: ${label}`).digest();
const file = new URL(`../evidence/live/1password-${label}.json`, import.meta.url);
const started = Date.now();
const result = { label, started_at: new Date(started).toISOString(), public_key: key, digest: digest.toString('hex'), network_calls: 0 };
const child = spawn(`${homedir()}/.local/bin/walleterm`, ['sign'], { stdio: ['pipe', 'pipe', 'pipe'] });
result.child_pid = child.pid;
writeFileSync(file, JSON.stringify({ ...result, stage: 'pending' }, null, 2) + '\n');
let stdout = '', stderr = '';
child.stdout.on('data', data => { stdout += data; });
child.stderr.on('data', data => { stderr += data; });
const cancellation = cancelAfter ? setTimeout(() => child.kill('SIGINT'), Number(cancelAfter)) : null;
const watchdog = setTimeout(() => child.kill('SIGKILL'), 135000);
child.on('error', error => { result.spawn_error = String(error); });
child.on('close', (code, signal) => {
  clearTimeout(cancellation); clearTimeout(watchdog);
  Object.assign(result, { stage: 'complete', elapsed_ms: Date.now() - started, exit_code: code, signal, stdout, stderr });
  try {
    result.response = JSON.parse(stdout);
    if (result.response.ok) {
      const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
      result.signature_verified = verify(null, digest, publicKey, Buffer.from(result.response.signature, 'hex'));
    }
  } catch { /* Interrupted processes can return no JSON. */ }
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
});
child.stdin.end(JSON.stringify({ public_key: key, digest: digest.toString('hex') }));
