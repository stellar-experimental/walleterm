// Live check of `walleterm approve` against a running `walleterm tunnel --approve` on testnet or mainnet.
// The operator starts the tunnel, passes its port and connection code, and answers the 1Password prompt.
// This script acts as the website on loopback. It uses one dedicated test key and submits one transaction.
// Testnet (default): a manage-data entry. Mainnet: one native payment. It needs `--destination` and `--amount`,
// and the user's approval of that run. The tunnel must run with `--network mainnet`.
//
//   WALLETERM_BINARY=bin/walleterm bun --no-env-file tests/approve-live.ts --port 18787 --code 12345678 --key G...
//   WALLETERM_BINARY=bin/walleterm bun --no-env-file tests/approve-live.ts --network mainnet --port 18787 --code 12345678 \
//     --key G... --destination G... --amount 100
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
const network = option('network') ?? 'testnet';
if (network !== 'testnet' && network !== 'mainnet')
  throw new Error('Pass --network testnet or --network mainnet.');
const mainnet = network === 'mainnet';
const passphrase = mainnet ? Networks.PUBLIC : Networks.TESTNET;
const horizonUrl = mainnet ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
// The Stellar CLI has no built-in mainnet RPC. This is a public provider.
const rpcUrl = option('rpc-url') ?? 'https://mainnet.sorobanrpc.com';
const out =
  option('out') ??
  `evidence/approve-live-${mainnet ? 'mainnet-' : ''}${new Date().toISOString().slice(0, 10)}.json`;
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
const destination = option('destination');
const amountXlm = option('amount');
if (mainnet) {
  check(destination && /^G[A-Z2-7]{55}$/.test(destination), 'Mainnet needs --destination G...');
  check(destination !== key, 'The destination must differ from the source key.');
  check(
    amountXlm && /^\d{1,9}(\.\d{1,7})?$/.test(amountXlm) && Number(amountXlm) > 0,
    'Mainnet needs --amount <XLM>.',
  );
}
const stroops = (xlm: string) => {
  const [whole, fraction = ''] = xlm.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0'));
};
const lumens = (value: bigint) =>
  `${value / 10_000_000n}.${(value % 10_000_000n).toString().padStart(7, '0')}`;

/** The native balance, the spendable part of it, and the sequence of one account. Null if it does not exist. */
async function account(address: string) {
  const response = await fetch(`${horizonUrl}/accounts/${address}`);
  if (response.status === 404) return null;
  check(response.ok, `Horizon account read failed: ${response.status}`);
  const a = (await response.json()) as any;
  const native = a.balances.find((b: any) => b.asset_type === 'native');
  const balance = stroops(native.balance);
  const reserve = BigInt(2 + a.subentry_count + a.num_sponsoring - a.num_sponsored) * 5_000_000n;
  const spendable = balance - reserve - stroops(native.selling_liabilities);
  return { balance: lumens(balance), spendable, sequence: a.sequence as string };
}

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
// On mainnet, refuse before any request if the source cannot pay.
let before: Awaited<ReturnType<typeof account>> = null;
if (mainnet) {
  before = await account(key!);
  check(before, 'The source account does not exist on mainnet.');
  check(await account(destination!), 'The destination account does not exist on mainnet.');
  // The fee is at most 100 stroops at the default inclusion fee. Allow 10 000 for a surge.
  check(
    before.spendable >= stroops(amountXlm!) + 10_000n,
    `The source cannot pay ${amountXlm} XLM. Balance ${before.balance}, spendable ${lumens(before.spendable)}.`,
  );
  record.network = network;
  record.source_before = { balance: before.balance, sequence: before.sequence };
}
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
check(
  selected.body.network === (mainnet ? 'PUBLIC' : 'TESTNET'),
  `The tunnel is not on ${network}: ${selected.body.network}.`,
);

// The Stellar CLI builds the transaction. One manage-data entry on the test account.
const target = mainnet ? ['--rpc-url', rpcUrl, '--network-passphrase', passphrase] : ['--network', 'testnet'];
const operation = mainnet
  ? [
      'payment',
      '--destination',
      destination!,
      '--asset',
      'native',
      '--amount',
      stroops(amountXlm!).toString(),
    ]
  : [
      'manage-data',
      '--data-name',
      'walleterm-approve-live',
      '--data-value',
      Buffer.from(record.started_at as string)
        .toString('hex')
        .slice(0, 128),
    ];
const build = spawnSync(
  'stellar',
  ['tx', 'new', operation[0], '--source-account', key!, ...target, '--build-only', ...operation.slice(1)],
  { encoding: 'utf8' },
);
check(build.status === 0, `stellar tx new failed: ${build.stderr}`);
const unsigned = build.stdout.trim();
const hash = Buffer.from(TransactionBuilder.fromXDR(unsigned, passphrase).hash()).toString('hex');
record.unsigned_xdr = unsigned;
record.hash = hash;
const request = (id: string) => ({
  id,
  kind: 'transaction',
  xdr: unsigned,
  network_passphrase: passphrase,
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
check(first.network === network && first.public_key === key, 'The shown network or key is wrong.');
check(
  mainnet
    ? first.decoded.tx.tx.operations[0].body.payment
    : first.decoded.tx.tx.operations[0].body.manage_data,
  'The decode does not show the expected operation.',
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
const envelope = TransactionBuilder.fromXDR(signed.signed_tx_xdr, passphrase);
const verified = Keypair.fromPublicKey(key!).verify(
  envelope.hash(),
  envelope.signatures[0].signature.toBytes(),
);
check(verified, 'The returned signature does not verify.');

// Submit through the Stellar CLI and read the ledger result.
// This is the only submission of the run.
const sent = spawnSync('stellar', ['tx', 'send', ...target, signed.signed_tx_xdr], { encoding: 'utf8' });
check(sent.status === 0, `stellar tx send failed: ${sent.stderr}`);
// Horizon can trail the RPC confirmation by a few seconds.
const horizon = await until(
  async () => (await fetch(`${horizonUrl}/transactions/${hash}`)).json(),
  (h) => typeof h.successful === 'boolean',
  30,
);
record.submission = {
  successful: horizon.successful,
  ledger: horizon.ledger,
  hash: horizon.hash,
  fee_charged_stroops: horizon.fee_charged,
};
if (mainnet) {
  const afterAccounts = { source: await account(key!), destination: await account(destination!) };
  record.source_after = { balance: afterAccounts.source?.balance };
  record.destination_after = { balance: afterAccounts.destination?.balance };
  record.payment = { destination, amount_xlm: amountXlm };
}
record.signature_verified = verified;
record.finished_at = new Date().toISOString();
save();
check(horizon.successful === true, `The transaction did not succeed on ${network}.`);
await call('/v1/disconnect', {}, token);
console.log(JSON.stringify({ ok: true, out, hash, ledger: horizon.ledger }));
