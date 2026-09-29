# Website signing bridge

`walleterm tunnel` runs the signing bridge and its temporary HTTPS route.
`walleterm demo` runs an example website. The bridge imports no demo code.
Each command owns its own server and tunnel. Stopping one command does not stop the other.
Both commands need cloudflared. The bridge also needs macOS and the 1Password SSH agent.

## Run the bridge

```sh
walleterm tunnel --vault Private
```

The terminal shows the public bridge URL and an eight-digit connection code.
It shows a QR code with both when the terminal is wide enough. A narrow terminal shows the required width instead.
The terminal needs no input. Ctrl+C stops the bridge.

The terminal prints one line for each produced or withheld signature.
Before it signs a message, it prints one line with the origin, key, byte count, digest, and escaped text:

```text
Message request from https://example.com for G... (43 bytes, digest <hex>, no network, site, or expiry binding): "example.com asks..."
```

Each code works once and expires after five minutes. The bridge then prints a new code.
Five incorrect codes replace the code and pause connection for one minute.
A website session lasts one hour after the first key selection. Wallet changes do not renew it.
Restart the bridge to revoke all website sessions.

## Limit the wallets to one vault

`--vault` accepts a vault name or ID and limits the website wallets to SSH keys in that vault.
Omit it to offer all available Ed25519 agent keys. `walleterm list` always lists all agent keys.
The tunnel prints the active filter at startup. Shell variables such as `OP_VAULT` and `.env` files do not select a vault.
Restart the tunnel to change the vault. Then reconnect the website with the new URL and code.

- Vault filtering needs the 1Password CLI: `brew install --cask 1password-cli`.
  Turn on 1Password CLI integration in the desktop app, or sign in before you start the tunnel.
- The bridge reads only item metadata and public keys. It matches the full public key against the SSH agent list.
  Comments never establish vault membership.
- A lookup failure stops wallet discovery. It never returns an unfiltered list. An empty vault returns no wallets.
- Selection and signing check vault membership again.
- Agent discovery permits 10 seconds. The vault lookup then permits 120 seconds, including the public key reads.
  Public key reads run in batches of four. A failed read cancels the batch and waits for cleanup.
- The SDK permits 135 seconds for discovery and selection. Caller cancellation still stops the website request.
- The bridge stops a slow `op` process with SIGTERM, then SIGKILL after 1.5 seconds.

See the 1Password [item commands](https://www.1password.dev/cli/reference/management-commands/item) and [SSH key guide](https://www.1password.dev/cli/ssh-keys).

## Use the demo

In a second terminal:

```sh
walleterm demo
```

The demo listens on `127.0.0.1` port 8788 by default and prints its own public URL and QR code.

1. Open the demo URL, or scan the demo QR code with your phone.
2. Select Connect Walleterm. Select Scan tunnel QR code, or type the tunnel URL and code.
3. Select Continue. The dialog lists your 1Password Ed25519 keys. Select a dedicated testnet wallet.
4. Create a transaction. The demo pays the source account of a recent testnet operation.
   It funds a new testnet account with Friendbot.
5. Review the transaction in the demo. Select Sign to approve it, or Discard.
6. Approve the 1Password prompt on the Mac if it appears.
7. Submit the signed transaction from the demo.

The offer action needs an authorized trustline to `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
This is the testnet USDC issuer in the Stellar documentation. A new Friendbot account has no trustline.
The demo has no trustline action. Create the trustline with direct signing:
build it with `stellar tx new change-trust --source-account G... --line USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5 --network testnet --build-only`.
Then follow the [direct V1 envelope steps](../.agents/skills/walleterm/references/classic-native.md#v1-transaction-envelope).
See [the demo guide](DEMO.md) for each action and the activity log.

The connection code lets a website list your 1Password Ed25519 public keys and request signatures.
The website approves its own requests. The bridge signs every valid request from a connected website.
Use only dedicated testnet keys. Enter codes only into websites that you trust.

## Components

| Component | Responsibilities |
| --- | --- |
| `walleterm tunnel` | Supervised tunnel, connection codes, structural checks, verified signatures |
| `walleterm demo` | Static demo website, browser transaction construction, browser submission and recovery |
| `sdk/walleterm.ts` | SEP-43 wallet, pairing, wallet selection, request polling, cancellation, sessions, disconnection |
| `sdk/connect.ts` and `sdk/connect.css` | Header button, pairing dialog, wallet list, active wallet changes, disconnection |
| `sdk/kit.ts` | Stellar Wallets Kit module |
| `sdk/scan.ts` | Optional camera scan of the tunnel QR code |
| `walleterm sign` | Local 1Password signing for agents. See [INTERFACE.md](INTERFACE.md) |

The bridge makes no Stellar RPC or Horizon call. It does not construct or submit a transaction.
The demo build bundles the pinned Stellar SDK 17.1.0.

## Integrate a website

Walleterm is a [SEP-43](SEP-43.md) wallet. An unchanged website does not discover Walleterm. It needs an integration.
Build the [TypeScript client](../sdk/walleterm.ts) with `bun run build`.
Serve `dist/sdk/` and the shared `dist/chunk-*.js` and `dist/jsQR-*.js` files in the same relative layout, with `sdk/connect.css`.
Do not copy all of `dist/`. It also holds the demo build and `routes.tsv`, which lists local build paths.
A bundler can import the package exports `walleterm`, `walleterm/connect`, `walleterm/kit`, `walleterm/scan`, and `walleterm/connect.css` instead.

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
`signTransaction` rejects `submit` with `-3`, because the bridge never submits.
The Stellar SDK contract client accepts the wallet object directly, for example `signAuthEntries({ signAuthEntry: wallet })`.
A Stellar Wallets Kit website imports `WalletermModule` from `walleterm/kit`. See [SEP-43](SEP-43.md#7-stellar-wallets-kit-module).
The Kit module is local source code. It is not a published package or a registered Kit module.

The default wallet scope is `selected`: one wallet for each connection.
`new Walleterm({ walletScope: 'available' })` permits changes among the wallets granted at the first selection.
See [the connection component](CONNECTION-UI.md) for scopes, sessions, and tabs.

## Supported transactions

The bridge signs testnet transaction envelopes that need the selected key. It filters no operations.
The selected key must be the transaction source, an operation source, or the fee-bump fee source.
A nonzero `max_time` at or before now fails. Time bounds are otherwise optional.
Existing signatures from other keys stay in place. The bridge appends one signature.
Explicit Soroban authorization entries use `signAuthEntry` before envelope signing.
See [contract authorization](CONTRACT-AUTHORIZATION.md) for the separate authorization and transaction steps.
Mainnet and V0 envelopes fail before signing. See [the bridge protocol](BRIDGE-PROTOCOL.md) for the exact rules.

## Approval and recovery

Website sessions use origin-bound bearer tokens. A website can read only the requests of its own session.
Each transaction is a separate request. Changed bytes, network, or signer need a new request.
The bridge verifies each signature independently before it returns the signed XDR.
The Mac can still require 1Password approval or an unlock. Cached approval can skip a fresh desktop prompt.

The bridge keeps sessions and requests in memory. A restart ends them and never retries a request.
Canceling or disconnecting during signing suppresses delivery. It cannot undo a signature already produced.
A website can already have received a completed signature before a disconnection.
`requestState: 'unknown'` means that signing started and no verified result arrived.
Preserve an unknown signing outcome. Decline the 1Password prompt if it appears. Then build a new transaction.
See [the demo guide](DEMO.md) for how the demo keeps its transaction records.

## Tunnel lifetime

Each public command creates a private Cloudflare configuration and a separate tunnel supervisor process.
Only `PATH`, `HOME`, `TMPDIR`, and `LANG` enter the tunnel environment. Existing Cloudflare configuration stays unchanged.
The server and the tunnel metrics bind loopback.
The supervisor starts cloudflared. Both run in a new process group, outside the caller's terminal group.
Terminal signals such as Ctrl+C reach only the command. Normal shutdown or the parent pipe then stops the tunnel.
A closed terminal stops the service as Ctrl+C does. The command removes its private configuration.
Ctrl+Z suspends only the command. The public URL stays open but does not respond. Use Ctrl+C to stop the service.
A parent pipe lets the supervisor stop cloudflared after a command crash.
When the supervisor exits, the command sends one SIGKILL to the supervisor's process group.
After a normal exit, the group is empty, and the signal has no effect.
After a supervisor crash, the signal stops cloudflared before recovery starts a replacement.
The command never signals a PID from `child.json`. macOS does not reuse a group ID while the group has a member.
Shutdown waits up to 3.5 seconds for an active signing request to stop.

A hard crash of both the command and the supervisor can leave cloudflared running.
Its Quick Tunnel still forwards the old public URL to the local port. A later process on that port can receive this traffic.
`pgrep -fl walleterm-tunnel-` lists tunnel processes with their temporary configuration paths.
Stop a listed `cloudflared` only when its command does not run.

Startup waits up to 45 seconds for the public URL to answer.
Each service checks its public URL every 15 seconds and replaces a failed tunnel with bounded retries.
Each replacement prints a new URL and QR code. See [connection recovery](CONNECTION-LIFECYCLE.md).
Quick Tunnels give a temporary URL and no uptime guarantee.
The Mac must stay awake and connected. Neither command installs a login service.

## Limits

- Cloudflare terminates TLS and can read tokens and XDR. Add end-to-end encryption before any mainnet use.
- The bridge shows the website Origin as a claim. It does not verify the website identity.
- A stable named tunnel and longer sessions are not supported.
