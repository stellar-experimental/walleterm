import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { availableSigners } from './signer.mjs';
import { createBridge } from './server.mjs';

// These keys and CLI programs exist only inside this offline test fixture.
const vaultID = 'aaaaaaaaaaaaaaaaaaaaaaaaaa', itemID = 'bbbbbbbbbbbbbbbbbbbbbbbbbb';
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'walleterm-vault-test-'));
  const inside = Keypair.random(), outside = Keypair.random();
  const blob = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), inside.rawPublicKey()]);
  const stateFile = join(directory, 'state.json'), callsFile = join(directory, 'calls.jsonl'), pidFile = join(directory, 'op.pid');
  const state = { items: [{ id: itemID, vault: { id: vaultID, name: 'Private' }, category: 'SSH_KEY' }],
    publicKey: `ssh-ed25519 ${blob.toString('base64')} mock`,
    signers: [inside, outside].map(key => ({ public_key: key.publicKey(), fingerprint: 'mock', comment: 'Same name' })) };
  const write = () => writeFileSync(stateFile, JSON.stringify(state)); write();
  // Use an absolute Node path. The test does not depend on another shell's PATH.
  const prelude = `#!${process.execPath}\nimport fs from 'node:fs';\nconst state=JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)},'utf8'));\n`;
  writeFileSync(join(directory, 'op'), prelude + `
const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)},JSON.stringify(args)+'\\n');
if(args.join(' ').includes('private')) process.exit(99);
if(state.oversize) { process.stdout.write('x'.repeat(1024*1024+1)); }
if(state.fail) { console.log('DIAGNOSTIC_CANARY'); console.error('DIAGNOSTIC_CANARY'); process.exit(1); }
if(state.stall) {
  process.on('SIGTERM',()=>{});
  fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
  setInterval(()=>{},1000);
} else if(args[0]==='item') {
  if(args[3]!==${JSON.stringify(vaultID)} && args[3]!=='Private') process.exit(2);
  console.log(state.invalidJSON ? 'invalid' : JSON.stringify(state.items));
} else if(args[0]==='read' && args[2]===${JSON.stringify(`op://${vaultID}/${itemID}/public key`)}) {
  console.log(state.publicKey);
} else process.exit(3);
`, { mode: 0o700 });
  const command = join(directory, 'walleterm');
  writeFileSync(command, prelude + `if(process.argv[2]!=='list') process.exit(99); console.log(JSON.stringify({ok:true,signers:state.signers}));\n`, { mode: 0o700 });
  const previousPath = process.env.PATH, previousVault = process.env.OP_VAULT;
  process.env.PATH = `${directory}:${previousPath}`; process.env.OP_VAULT = vaultID;
  t.after(() => {
    if (existsSync(pidFile)) { try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {} }
    process.env.PATH = previousPath;
    if (previousVault === undefined) delete process.env.OP_VAULT; else process.env.OP_VAULT = previousVault;
    rmSync(directory, { recursive: true, force: true });
  });
  return { inside, outside, state, write, pidFile, command,
    calls: () => existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [] };
}

async function until(check) {
  for (let i = 0; i < 200; i++) { const result = await check(); if (result) return result; await delay(10); }
  throw Error('The fixture did not reach the expected state.');
}

test('real CLI subprocesses filter UUIDs and names using public fields only', async t => {
  const f = fixture(t);
  for (const vault of [vaultID, 'Private']) {
    const result = await availableSigners({ command: f.command, vault });
    assert.deepEqual(result, [f.state.signers[0]]);
  }
  assert.equal(f.calls().length, 4);
  assert.ok(f.calls().every(args => args[0] === 'item' || args.join(' ') === `read --no-newline op://${vaultID}/${itemID}/public key`));
});

test('CLI failures and invalid JSON never return agent identities or diagnostics', async t => {
  const f = fixture(t);
  for (const field of ['fail', 'invalidJSON', 'oversize']) {
    f.state[field] = true; f.write();
    await assert.rejects(availableSigners({ command: f.command }), error => error.status === 502 && !error.message.includes('CANARY'));
    delete f.state[field];
  }
});

test('canceling vault discovery stops a CLI process that ignores SIGTERM', async t => {
  const f = fixture(t); f.state.stall = true; f.write();
  const controller = new AbortController();
  const pending = availableSigners({ command: f.command, signal: controller.signal });
  const pid = await until(() => existsSync(f.pidFile) && Number(readFileSync(f.pidFile, 'utf8')));
  controller.abort(); await assert.rejects(pending);
  let running = true;
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') running = false; else throw error; }
  assert.equal(running, false, 'The canceled vault CLI process must stop.');
});

test('a missing 1Password CLI stops vault discovery without returning agent keys', async t => {
  const f = fixture(t);
  process.env.PATH = '';
  await assert.rejects(availableSigners({ command: f.command }), /selected 1Password vault is unavailable/);
});

test('bridge discovery, selection, and signing rechecks enforce the vault through real CLI processes', async t => {
  const f = fixture(t); let signs = 0;
  const bridge = createBridge({ port: 0, log: () => {},
    listSigners: options => availableSigners({ ...options, command: f.command }),
    sign: async (_key, digest) => { signs++; return Buffer.from(f.inside.sign(Buffer.from(digest, 'hex'))).toString('hex'); } });
  await bridge.listen(); t.after(() => bridge.close());
  const origin = `http://127.0.0.1:${bridge.server.address().port}`; bridge.setPublicOrigin(origin);
  let token;
  const request = async (path, data) => {
    const response = await fetch(origin + path, { method: data === undefined ? 'GET' : 'POST', headers: {
      Origin: 'https://vault-test.example', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, data: await response.json() };
  };
  token = (await request('/v1/connect', { code: bridge.pairing.code })).data.token;
  const listings = await Promise.all(Array.from({ length: 8 }, () => request('/v1/signers')));
  assert.ok(listings.every(result => result.status === 200 && JSON.stringify(result.data.signers) === JSON.stringify([f.state.signers[0]])));
  assert.equal(f.calls().length, 2, 'Concurrent requests share one vault discovery.');
  assert.equal((await request('/v1/select', { public_key: f.outside.publicKey() })).status, 400);
  assert.equal((await request('/v1/select', { public_key: f.inside.publicKey() })).status, 200);
  const tx = new TransactionBuilder(new Account(f.inside.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.manageData({ name: 'offline-vault-test', value: 'mock' })).setTimeout(180).build();
  const input = { id: 'allowed', public_key: f.inside.publicKey(), network_passphrase: Networks.TESTNET, transaction_xdr: tx.toXDR() };
  assert.equal((await request('/v1/requests', input)).status, 201);
  const signed = await until(async () => { const result = await request('/v1/requests/allowed'); return !['pending', 'approved', 'signing'].includes(result.data.state) && result; });
  assert.equal(signed.data.state, 'signed', signed.data.message);
  const envelope = TransactionBuilder.fromXDR(signed.data.signed_xdr, Networks.TESTNET);
  assert.ok(f.inside.verify(envelope.hash(), envelope.signatures[0].signature.toBytes()));
  assert.equal(signs, 1);
  for (const fail of [false, true]) {
    f.state.items = []; f.state.fail = fail; f.write();
    const id = fail ? 'lookup-failed' : 'removed';
    await request('/v1/requests', { ...input, id });
    const denied = await until(async () => { const result = await request(`/v1/requests/${id}`); return result.data.state === 'denied' && result; });
    assert.equal(denied.data.signed_xdr, undefined);
    assert.equal(signs, 1);
    assert.ok(!JSON.stringify(denied.data).includes('CANARY'));
  }
});

test('SDK wallet discovery and selection accept vault responses after fifteen seconds', { timeout: 40000 }, async () => {
  const { WalletermClient } = await import('../sdk/walleterm.js');
  const publicKey = Keypair.random().publicKey(); // Isolated offline mock key only.
  await Promise.all(['/v1/signers', '/v1/select'].map(async delayedRoute => {
    const client = new WalletermClient('http://127.0.0.1:8787', { fetch: async (url, options) => {
      if (url.endsWith(delayedRoute)) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(done, 16000);
          function done() { options.signal.removeEventListener('abort', abort); resolve(); }
          function abort() { clearTimeout(timer); reject(options.signal.reason); }
          options.signal.addEventListener('abort', abort, { once: true });
          if (options.signal.aborted) abort();
        });
      }
      if (url.endsWith('/v1/signers')) return Response.json({ signers: [{ public_key: publicKey }] });
      if (url.endsWith('/v1/connect')) return Response.json({ token: 'mock-token' });
      if (url.endsWith('/v1/select')) return Response.json({ public_key: publicKey, network_passphrase: Networks.TESTNET });
      return Response.json({ disconnected: true });
    } });
    const account = await client.connect({ code: '01234567', selectWallet: async keys => keys[0].public_key });
    assert.equal(account.address, publicKey);
    await client.disconnect();
  }));
});

test('caller cancellation still stops SDK vault discovery immediately', async () => {
  const { WalletermClient } = await import('../sdk/walleterm.js');
  const controller = new AbortController();
  let entered;
  const listing = new Promise(resolve => { entered = resolve; });
  const client = new WalletermClient('http://127.0.0.1:8787', { fetch: async (url, options) => {
    if (url.endsWith('/v1/signers')) {
      entered();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        if (options.signal.aborted) reject(options.signal.reason);
      });
    }
    return Response.json(url.endsWith('/v1/connect') ? { token: 'mock-token' } : { disconnected: true });
  } });
  const pending = client.connect({ code: '01234567', selectWallet: () => { throw Error('The picker must not open.'); }, signal: controller.signal });
  await listing; controller.abort(Error('Caller canceled discovery.'));
  await assert.rejects(pending, /Caller canceled discovery/);
  assert.equal(client.token, null);
});
