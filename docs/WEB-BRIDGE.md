# Independent website signing bridge

`walleterm tunnel` runs the signing bridge and its temporary HTTPS route.
`walleterm demo` runs an example website. The bridge imports no demo code.
Each command owns its own server and tunnel. Stopping one command does not stop the other.

## Run

In one terminal:

```sh
export OP_VAULT=Private
walleterm tunnel
```

The terminal shows the public bridge URL and an eight-digit connection code.
It shows a QR code when the terminal is wide enough. Otherwise, use the URL and code.
The terminal needs no input. It prints one line for each produced or withheld signature.

`OP_VAULT` accepts a vault name or ID and limits website wallets to that vault.
Save `OP_VAULT=Private` in `.env` in the directory where you start the tunnel.
The tunnel reads only `OP_VAULT` from this file. An exported shell variable overrides it.
Git ignores `.env`, and the installer does not copy it. Existing tunnels keep their startup environment.
Restart the tunnel after changing the setting. Reconnect the website with the new tunnel URL and code.
Install the 1Password CLI with `brew install --cask 1password-cli` for vault filtering.
Enable 1Password CLI integration in the desktop app, or sign in before starting the tunnel.
The bridge reads only item metadata and public keys. Lookup failures stop wallet discovery.
Public key reads run in batches of four. A failed read cancels the batch and waits for cleanup.
Opening the wallet menu shows the existing list. Use Refresh to request an updated list.
Selection and signing still check current vault membership. Switching wallets does not trigger a second refresh.
An unset or empty `OP_VAULT` lists all available Ed25519 agent keys.
The bridge permits 120 seconds for vault lookup, after the agent list completes.
The SDK permits 135 seconds for wallet discovery and selection. Caller cancellation still stops the request.
Stopping the bridge terminates its CLI child, with forced termination if needed.
SDK cancellation stops the website request. A shared bridge lookup can continue until completion or shutdown.

Vault discovery passed a live check with 1Password CLI 2.39.0 on 2026-09-26.
The check returned four available Ed25519 keys from the selected vault.
It requested no signatures and read no private key fields.
The first live recheck stopped at a 1Password CLI authorization timeout. The retry passed after user approval.
The installed browser picker showed the same four live keys and excluded one agent key.
See [vault filter validation](VAULT-FILTER-VALIDATION.md) for the review and test coverage.
See the official [item commands](https://www.1password.dev/cli/reference/management-commands/item) and [SSH key guide](https://www.1password.dev/cli/ssh-keys).

In a second terminal:

```sh
walleterm demo
```

Open the public demo URL or scan its QR code on your phone.

1. Select Connect Walleterm in the demo header. Scan the tunnel QR code or enter its URL and code.
   Scan the demo QR code with your phone camera. Use Scan tunnel QR code inside the connection dialog.
2. Select Continue. The connection dialog lists your 1Password Ed25519 keys.
3. Select a dedicated testnet wallet.
4. Create a transaction in the demo. The demo selects an existing testnet payment recipient automatically.
   It funds a new testnet account with Friendbot. The offer action needs a testnet USDC trustline.
   Cancel newest offer removes the newest open offer of the account, whatever created it.
5. Review the transaction in the demo. Select Sign to approve it, or Discard.
6. Approve the 1Password prompt on the Mac if it appears.
7. Submit the signed transaction from the demo.

The offer action needs an authorized trustline to `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
This is the testnet USDC issuer in the Stellar documentation. A new Friendbot account has no trustline.
The demo has no trustline action. Create the trustline with direct signing instead.
Build it with `stellar tx new change-trust --source-account G... --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 --network testnet --build-only`.
Then follow the [direct V1 envelope steps](../.agents/skills/walleterm/references/classic-native.md#v1-transaction-envelope) to review, sign, and submit it.

The connection code lets a website list your 1Password Ed25519 public keys and request signatures.
The website approves its own requests. The bridge signs every valid request from a connected website.
Use only dedicated testnet keys, and enter codes only into websites you trust.
Compare it with the website you opened. Do not type codes into websites you do not trust.

## Component responsibilities

| Component | Responsibilities |
| --- | --- |
| `walleterm tunnel` | Supervised tunnel, connection codes, transaction limits, verified signatures |
| `walleterm demo` | Static demo website, browser transaction construction, browser submission and recovery |
| `sdk/walleterm.ts` | SEP-43 wallet, pairing, wallet selection, request polling, cancellation, sessions, disconnection |
| `sdk/connect.ts` and `sdk/connect.css` | Header button, pairing dialog, wallet list, active wallet changes, disconnection |
| `sdk/kit.ts` | Stellar Wallets Kit module |
| `sdk/scan.ts` | Optional camera scan of the tunnel QR code |
| `walleterm sign` | Existing local 1Password signing interface; unchanged |

The bridge makes no Stellar RPC or Horizon call. It does not construct or submit a transaction.
The demo serves the pinned Stellar SDK 17.1.0 browser bundle from its installed dependencies.

## Website adapter

Walleterm is a [SEP-43](SEP-43.md) wallet. Build the [TypeScript client](../sdk/walleterm.ts) with `bun run build`.
Copy the full `dist/` directory and `sdk/connect.css` with your website, or use the package exports.
Keep the generated shared chunks beside their entry directories.

```js
import { Walleterm } from './walleterm.js';

const wallet = new Walleterm();
const { address, error } = await wallet.getAddress(); // Opens the pairing dialog once.
// The website builds and reviews an unsigned testnet transaction.
const { signedTxXdr } = await wallet.signTransaction(unsignedXdr, { networkPassphrase: Networks.TESTNET });
// The website verifies the result and asks the user before submission.
await wallet.disconnect();
```

The SEP-43 methods are `getAddress`, `signTransaction`, `signAuthEntry`, `signMessage`, and `getNetwork`.
They resolve results and never reject. A failure returns empty fields and `error: { code, message, ext }`.
`getAddress()` opens the pairing dialog when no session exists. Load `connect.css` on the page.
`signMessage` returns `-3` for now. `signTransaction` rejects `submit` with `-3`, because the bridge never submits.
The Stellar SDK contract client accepts the wallet object directly, for example `signAuthEntries({ signAuthEntry: wallet })`.

The default wallet scope is `selected`: one wallet for each connection.
`new Walleterm({ walletScope: 'available' })` permits switching among the wallets granted at first selection.
The header component uses that scope and explains the grant before selection.
See [the connection UI](CONNECTION-UI.md). `wallet.onChange(listener)` reports each switch and disconnection.

The wallet saves its bridge URL and session token in `sessionStorage` for the current tab.
A reload checks the session before it publishes an address. An expired session requires a new code.
`sessionStorageKey: null` keeps the session in memory only. Recovery never repeats signing or submission.
The SDK retries network errors and 5xx responses on the same connection. An abort or leaving the page cancels the bridge request.
After a failure, build a new transaction. `error.requestState` reports the bridge state when one exists.
`requestState: 'unknown'` means that signing started and no verified result arrived.
Preserve an unknown signing outcome. Decline the 1Password prompt if it appears.

A Stellar Wallets Kit website imports `WalletermModule` from `walleterm/kit`. See [SEP-43](SEP-43.md#7-stellar-wallets-kit-module).
The adapter is local source code. It is not a published package or a registered Kit module.

## Supported transactions

The bridge signs testnet transaction envelopes that need the selected key. It filters no operations.
The selected key must be the transaction source, an operation source, or the fee-bump fee source.
Time bounds must be valid now and end within five minutes.
Existing signatures from other keys stay in place. The bridge appends one signature.
Explicit Soroban authorization entries use `signAuthEntry` before envelope signing.
See [contract authorization](CONTRACT-AUTHORIZATION.md) for the separate authorization and transaction steps.
Mainnet and V0 envelopes fail before signing. See [the protocol contract](../bridge/PROTOCOL.md) for exact rules.
Safety comes from review of each request. An agentic review will use the bridge's `review` hook.

## Approval and recovery

Website sessions use origin-bound bearer capabilities. Websites can read only requests from their own session.
Each transaction is a separate request. Changed bytes, network, or signer require a new request.
The bridge verifies the signature independently before returning signed XDR.
The Mac can still require 1Password approval or an unlock. Cached authorization can suppress a fresh desktop prompt.

The bridge keeps sessions and requests in memory. A restart ends them and never retries a request.
The terminal prints the hash of each produced or withheld signature.
Canceling or disconnecting during signing suppresses delivery. It cannot undo a signature already produced.
A website might already have received a completed signature before disconnection.

The demo stores signed XDR and the original submitted hash in browser local storage.
Denial, expiry, cancellation, and signing failures allow a new request.
Leaving the page stops an open signing request and sends a cancel.
The demo keeps an unfinished signing record after a reload. Decline any 1Password prompt that appears, then clear the record.
The demo uses Web Locks to protect its transaction record across tabs. A browser without Web Locks cannot start a demo transaction.
A submission timeout remains unknown. The demo queries the original hash and never automatically resubmits.
A missing transaction proves failure only after a ledger closes past its time bound and the account sequence stays below its sequence. Preserve browser storage until the original outcome is known.
A new public demo hostname has different browser storage. Keep the original tab and its transaction hash during recovery.

## Tunnel lifetime

Each public command creates a private Cloudflare configuration and a separate tunnel supervisor process.
It does not inherit Cloudflare routing or credential environment settings or change existing Cloudflare configuration.
The server and metrics bind loopback.
The supervisor starts cloudflared. Both run in a new process group, outside the caller's terminal group.
Terminal signals such as Ctrl+C reach only the command. Normal shutdown or the parent pipe then stops the tunnel.
Ctrl+Z suspends only the command. The public URL stays open but does not respond. Use Ctrl+C to stop the service.
A parent pipe lets the supervisor stop cloudflared after a command crash.
When the supervisor exits, the command sends one SIGKILL to the supervisor's process group.
After a normal supervisor exit, the group is empty, and the signal has no effect.
After a supervisor crash, the signal stops cloudflared before tunnel recovery starts a replacement.
The command never signals a PID from `child.json`. macOS does not reuse a group ID while the group has a member.
Normal shutdown closes requests and terminates the supervisor with a bounded escalation deadline.
Shutdown waits up to 3.5 seconds for an active signing request to stop.

A hard crash of both the command and the supervisor can leave cloudflared running.
Its Quick Tunnel still forwards the old public URL to the local port. A later process on that port can receive this traffic.
`pgrep -fl walleterm-tunnel-` lists tunnel processes with their temporary configuration paths.
Stop a listed `cloudflared` only when its command no longer runs.

Quick Tunnels provide a temporary URL and no uptime guarantee. The URL changes on restart.
The Mac must remain awake and connected. Neither command installs a login service or automatically restarts.
Each connection code expires after five minutes. A website session lasts one hour after key selection.
Restart the bridge to revoke all website sessions.

## Future work

The Wallets Kit module ships in this repository only. An unchanged website still needs an integration.
Message signing returns `-3`. Its abuse cases and options are in [SEP-43 future work](SEP-43.md#future-work-message-signing).
A stable named tunnel, longer session management, and production availability remain future work.
Cloudflare terminates TLS and can read tokens and XDR. Add end-to-end encryption before any mainnet use.
The bridge shows the website Origin as a claim. Verified website identity remains future work.
An agentic review can later decide requests through the bridge's `review` hook, with no terminal step.
