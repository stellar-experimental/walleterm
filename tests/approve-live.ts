// Live check of `walleterm approve` against a running `walleterm tunnel --approve` on testnet.
// The operator starts the tunnel, passes its port and connection code, and answers the 1Password prompt.
// This script acts as the website on loopback. It uses one dedicated test key and submits one testnet transaction.
//
//   WALLETERM_BINARY=bin/walleterm bun --no-env-file tests/approve-live.ts --port 18787 --code 12345678 --key G...
//   (stop the tunnel with Ctrl+C)
//   WALLETERM_BINARY=bin/walleterm bun --no-env-file tests/approve-live.ts --port 18787 --after
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const argv = process.argv.slice(2);
const option = (name: string) => {
  const index = argv.indexOf(`--${name}`);
  return index < 0 ? undefined : argv[index + 1];
};
const port = option('port') ?? '18787';
const after = argv.includes('--after');
const binary = process.env.WALLETERM_BINARY ?? 'walleterm';
const out = option('out') ?? `evidence/approve-live-${new Date().toISOString().slice(0, 10)}.json`;
const dir = `${homedir()}/Library/Application Support/walleterm`;
const socket = `${dir}/approve-${port}.sock`;
const bridge = `http://127.0.0.1:${port}`;
const origin = 'http://localhost:5173';

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

/** `walleterm approve --port <port> ...`: its exit code and its one JSON line. */
function approve(...args: string[]) {
  const run = spawnSync(binary, ['approve', '--port', port, ...args], { encoding: 'utf8' });
  return { exit: run.status, json: JSON.parse(run.stdout) };
}

if (after) {
  // After Ctrl+C, the tunnel removed its socket, and the command finds no tunnel.
  const gone = (() => {
    try {
      lstatSync(socket);
      return false;
    } catch {
      return true;
    }
  })();
  const missing = approve();
  const record = JSON.parse(readFileSync(out, 'utf8'));
  record.after_stop = { socket_removed: gone, approve: missing };
  writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
  check(gone, 'The tunnel left its approval socket.');
  check(
    missing.exit === 1 && missing.json.error.code === 'tunnel_unavailable',
    'A stopped tunnel still answered.',
  );
  console.log(JSON.stringify(record.after_stop));
  process.exit(0);
}

const code = option('code');
const key = option('key');
check(code && /^\d{8}$/.test(code), 'Pass --code with the eight digits from the tunnel terminal.');
check(key, 'Pass --key with the G-address of the dedicated test key.');

async function call(path: string, body?: unknown, token?: string) {
  const response = await fetch(bridge + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function until<T>(read: () => Promise<T> | T, done: (value: T) => boolean, seconds: number) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    check(Date.now() < end, 'The wait timed out.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const record: Record<string, unknown> = { started_at: new Date().toISOString(), port, public_key: key };
const save = () => writeFileSync(out, JSON.stringify(record, null, 2) + '\n');

// The private directory and the socket exist while the tunnel runs.
const folder = lstatSync(dir);
const file = lstatSync(socket);
record.socket = { directory_mode: (folder.mode & 0o777).toString(8), is_socket: file.isSocket() };
check(folder.isDirectory() && (folder.mode & 0o077) === 0, 'The approval directory is not private.');
check(file.isSocket(), 'The approval socket is missing.');
const idle = approve();
check(idle.exit === 0 && idle.json.request === null, 'A request waited before the website connected.');

// Connect as the website, select the test key, and confirm the network.
const connected = await call('/v1/connect', { code, wallet_scope: 'selected', protocol: 4 });
check(connected.body.token, `The connection failed: ${JSON.stringify(connected.body)}`);
const token = connected.body.token as string;
const selected = await call('/v1/select', { public_key: key }, token);
check(selected.status === 200, `The selection failed: ${JSON.stringify(selected.body)}`);
check(selected.body.network === 'TESTNET', 'The tunnel is not on testnet.');

// The Stellar CLI builds the transaction. One manage-data entry on the test account.
const build = spawnSync(
  'stellar',
  [
    'tx',
    'new',
    'manage-data',
    '--source-account',
    key!,
    '--network',
    'testnet',
    '--build-only',
    '--data-name',
    'walleterm-approve-live',
    '--data-value',
    Buffer.from(record.started_at as string)
      .toString('hex')
      .slice(0, 128),
  ],
  { encoding: 'utf8' },
);
check(build.status === 0, `stellar tx new failed: ${build.stderr}`);
const unsigned = build.stdout.trim();
const hash = Buffer.from(TransactionBuilder.fromXDR(unsigned, Networks.TESTNET).hash()).toString('hex');
record.unsigned_xdr = unsigned;
record.hash = hash;
const request = (id: string) => ({
  id,
  kind: 'transaction',
  xdr: unsigned,
  network_passphrase: Networks.TESTNET,
  address: key,
});
const shown = () =>
  until(
    () => approve(),
    (r) => r.exit === 0 && r.json.request !== null,
    30,
  );
const result = (id: string) =>
  until(
    async () => (await call(`/v1/requests/${id}`, undefined, token)).body,
    (b) => !['pending', 'approved', 'signing'].includes(b.state),
    150,
  );

// A denial ends the request without a 1Password prompt.
check((await call('/v1/requests', request('deny-1'), token)).status === 201, 'The first request failed.');
const first = (await shown()).json.request;
check(first.kind === 'transaction' && first.hash === hash, 'The shown request is not the sent transaction.');
check(first.network === 'testnet' && first.public_key === key, 'The shown network or key is wrong.');
check(
  first.decoded.tx.tx.operations[0].body.manage_data,
  'The decode does not show the manage-data operation.',
);
const denied = approve(first.id, '--deny');
check(
  denied.exit === 0 && denied.json.approved === false,
  `The denial failed: ${JSON.stringify(denied.json)}`,
);
const deniedResult = await result('deny-1');
record.deny = { id: first.id, answer: denied.json, result: deniedResult };
save();
check(
  deniedResult.state === 'denied' && deniedResult.error.code === -4,
  'The denied request did not end denied.',
);

// An approval lets 1Password sign. The operator approves the prompt on the Mac.
check((await call('/v1/requests', request('approve-1'), token)).status === 201, 'The second request failed.');
const second = (await shown()).json.request;
check(
  second.id !== first.id && second.hash === hash,
  'The second request needs its own ID and the same hash.',
);
check(approve(first.id).json.error.code === 'not_found', 'The old ID answered the new request.');
console.error('Approve the 1Password prompt on the Mac if it appears.');
const approved = approve(second.id);
check(
  approved.exit === 0 && approved.json.approved === true,
  `The approval failed: ${JSON.stringify(approved.json)}`,
);
const signed = await result('approve-1');
record.approve = { id: second.id, answer: approved.json, state: signed.state };
save();
check(
  signed.state === 'signed',
  `The approved request ended ${signed.state}: ${JSON.stringify(signed.error)}`,
);
const envelope = TransactionBuilder.fromXDR(signed.signed_tx_xdr, Networks.TESTNET);
const verified = Keypair.fromPublicKey(key!).verify(
  envelope.hash(),
  envelope.signatures[0].signature.toBytes(),
);
check(verified, 'The returned signature does not verify.');

// Submit through the Stellar CLI and read the ledger result.
const sent = spawnSync('stellar', ['tx', 'send', '--network', 'testnet', signed.signed_tx_xdr], {
  encoding: 'utf8',
});
check(sent.status === 0, `stellar tx send failed: ${sent.stderr}`);
// Horizon can trail the RPC confirmation by a few seconds.
const horizon = await until(
  async () => (await fetch(`https://horizon-testnet.stellar.org/transactions/${hash}`)).json(),
  (h) => typeof h.successful === 'boolean',
  30,
);
record.submission = { successful: horizon.successful, ledger: horizon.ledger, hash: horizon.hash };
record.signature_verified = verified;
record.finished_at = new Date().toISOString();
save();
check(horizon.successful === true, 'The transaction did not succeed on testnet.');
await call('/v1/disconnect', {}, token);
console.log(JSON.stringify({ ok: true, out, hash, ledger: horizon.ledger }));
