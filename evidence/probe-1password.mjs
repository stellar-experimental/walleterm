// Feasibility probe only. It uses one dedicated public test key.
import net from 'node:net';
import os from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';

const key = JSON.parse(readFileSync(new URL('./public-test-keys.json', import.meta.url))).keys[0];
const publicKey = Buffer.from(key.raw_public_key_hex, 'hex');
const keyBlob = Buffer.from(key.ssh_public_key.split(' ')[1], 'base64');
const digest = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 17) & 255));
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const field = b => Buffer.concat([u32(b.length), b]);
const socketPath = `${os.homedir()}/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock`;
const body = Buffer.concat([Buffer.from([13]), field(keyBlob), field(digest), u32(0)]);
console.error(`Requesting one test signature: ${key.name}; digest=${digest.toString('hex')}`);
const reply = await new Promise((resolve, reject) => {
  const socket = net.createConnection(socketPath);
  let bytes = Buffer.alloc(0);
  const timer = setTimeout(() => { socket.destroy(); reject(new Error('Approval timeout')); }, 120000);
  socket.on('connect', () => socket.write(Buffer.concat([u32(body.length), body])));
  socket.on('error', e => { clearTimeout(timer); reject(e); });
  socket.on('data', chunk => {
    bytes = Buffer.concat([bytes, chunk]);
    if (bytes.length < 4) return;
    const size = bytes.readUInt32BE();
    if (size > 1024 || size < 1) { clearTimeout(timer); socket.destroy(); reject(new Error('Invalid frame')); return; }
    if (bytes.length < size + 4) return;
    clearTimeout(timer); socket.destroy();
    if (bytes.length !== size + 4) reject(new Error('Trailing frame data'));
    else resolve(bytes.subarray(4));
  });
  socket.on('end', () => { clearTimeout(timer); reject(new Error('Agent closed connection')); });
});
if (reply[0] !== 14) throw new Error(`Agent response type ${reply[0]}`);
let offset = 1;
const take = () => {
  if (offset + 4 > reply.length) throw new Error('Truncated field');
  const n = reply.readUInt32BE(offset); offset += 4;
  if (offset + n > reply.length) throw new Error('Truncated value');
  const b = reply.subarray(offset, offset + n); offset += n; return b;
};
const signatureBlob = take();
if (offset !== reply.length || signatureBlob.length !== 83) throw new Error('Invalid signature blob');
if (signatureBlob.readUInt32BE(0) !== 11 || signatureBlob.subarray(4, 15).toString() !== 'ssh-ed25519') throw new Error('Wrong algorithm');
if (signatureBlob.readUInt32BE(15) !== 64) throw new Error('Wrong signature size');
const signature = signatureBlob.subarray(19);
const spki = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]), format: 'der', type: 'spki' });
const valid = verify(null, digest, spki, signature);
const altered = Buffer.from(digest); altered[0] ^= 1;
const alteredValid = verify(null, altered, spki, signature);
if (!valid || alteredValid) throw new Error('Independent verification failed');
const result = { status: 'passed', timestamp: new Date().toISOString(), key: key.name, socket: socketPath, public_key_hex: publicKey.toString('hex'), digest: digest.toString('hex'), signature: signature.toString('hex'), verified: valid, altered_payload_verified: alteredValid, verifier: `Node.js ${process.version} crypto.verify Ed25519` };
writeFileSync(new URL('./1password-feasibility.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
