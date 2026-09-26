# Independent website signing bridge

`walleterm tunnel` runs the signing bridge and its temporary HTTPS route.
`walleterm demo` runs an example website. The bridge imports no demo code.
Each command owns its own server and tunnel. Stopping one command does not stop the other.

## Run

In one terminal:

```sh
make install
export OP_VAULT=Private
walleterm tunnel
```

The terminal shows the public bridge URL and an eight-digit connection code.
It shows a QR code when the terminal is wide enough. Otherwise, use the URL and code.
The terminal needs no input. It prints one line for each produced or withheld signature.

`OP_VAULT` accepts a vault name or ID and limits website wallets to that vault.
Save `OP_VAULT=Private` in `.env` in the directory where you start the tunnel.
Bun loads this file automatically. An exported shell variable overrides it.
Git ignores `.env`, and the installer does not copy it. Existing tunnels keep their startup environment.
Restart the tunnel after changing the setting. Reconnect the website with the new tunnel URL and code.
Install the 1Password CLI with `brew install 1password-cli` for vault filtering.
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

The connection code lets a website list your 1Password Ed25519 public keys and request signatures.
The website approves its own requests. The bridge signs every valid request from a connected website.
Use only dedicated testnet keys, and enter codes only into websites you trust.
Compare it with the website you opened. Do not type codes into websites you do not trust.

## Component responsibilities

| Component | Responsibilities |
| --- | --- |
| `walleterm tunnel` | Supervised tunnel, connection codes, transaction limits, verified signatures |
| `walleterm demo` | Static demo website, browser transaction construction, browser submission and recovery |
| `sdk/walleterm.ts` | Website connection, wallet selection, signing request and result polling, cancellation, disconnection |
| `sdk/connect.ts` and `sdk/connect.css` | Header button, connection dialog, wallet list, active wallet changes, disconnection |
| `sdk/scan.ts` | Optional camera scan of the tunnel QR code |
| `walleterm sign` | Existing local 1Password signing interface; unchanged |

The bridge makes no Stellar RPC or Horizon call. It does not construct or submit a transaction.
The demo serves the pinned Stellar SDK 17.1.0 browser bundle from its installed dependencies.

## Website adapter

For the ready-made header component, see [the connection UI](CONNECTION-UI.md).
The component keeps connection controls separate from website transactions.
The component explains a grant for the displayed wallets before the first selection.
Wallet changes use the same session and need no new scan or code.
The first selection fixes the grant. Later keys require a new connection.
The standalone client defaults to one wallet. Use `walletScope: 'available'` for explicit wallet switching.


Build the [TypeScript client](../sdk/walleterm.ts) with `bun run build`.
Copy the full `dist/` directory with your website, or use the package exports.
Keep the generated shared chunks beside their entry directories.
The demo serves the client at `/sdk/walleterm.js`:

```js
import { WalletermClient } from './walleterm.js';

const wallet = new WalletermClient(bridgeUrl);
const { address, networkPassphrase } = await wallet.connect({
  code,                                    // Eight digits from the tunnel terminal.
  selectWallet: signers => chooseKey(signers), // Return one public_key.
});

// The website builds and reviews an unsigned supported testnet transaction.
// The address and network default to the connected account, as in SEP-43.
const { signedTxXdr } = await wallet.signTransaction(unsignedXdr);
// The website verifies the result and asks the user before submission.
await wallet.disconnect();
```

The adapter exposes `connect`, `listWallets`, `selectWallet`, `getAddress`, `signTransaction`, and `disconnect`.
It keeps the website capability in memory. Reloading the website requires a new connection code.
The SDK retries network errors and 5xx responses on the same connection. An abort, a rejection, or leaving the page cancels the bridge request.
After a failure, build a new transaction. SDK errors include `requestState` when the bridge reports one.
`error.canceled` reports cancellation or lost session access. It does not prove that signing stopped.
A cancellation 401 sets `canceled: true` and `requestState: 'unknown'` because the session cannot deliver its result.
If cancellation fails without confirming lost session access, `error.canceled` is false.
Preserve an unknown signing outcome. Decline the 1Password prompt if it appears.
The adapter is local source code. It is not a published package or a registered Stellar Wallets Kit module.

## Supported transactions

The bridge supports Stellar testnet and one unsigned classic operation per transaction:

- Native XLM payment to a G-address.
- Set or delete a data entry.
- Create, update, or cancel a sell offer with explicit assets and an exact rational price.

Mainnet, Soroban, fee bumps, and other operations fail before approval.
See [the protocol contract](../bridge/PROTOCOL.md) for exact limits.

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

Each public command creates a private Cloudflare configuration and a separate supervised process.
It does not inherit Cloudflare routing or credential environment settings or change existing Cloudflare configuration.
The server and metrics bind loopback. A parent pipe terminates the child after a parent crash.
Normal shutdown closes requests and terminates the child with a bounded escalation deadline.
Shutdown waits up to 3.5 seconds for an active signing request to stop.

Quick Tunnels provide a temporary URL and no uptime guarantee. The URL changes on restart.
The Mac must remain awake and connected. Neither command installs a login service or automatically restarts.
Each connection code expires after five minutes. A website session lasts one hour after key selection.
Restart the bridge to revoke all website sessions.

## Future work

A future Wallets Kit module can wrap this client and provide its connection UI and metadata.
The upstream kit exposes `getAddress` and `signTransaction`, with `signedTxXdr` results.
See the [upstream repository](https://github.com/Creit-Tech/Stellar-Wallets-Kit), checked on 2026-09-25.
That API similarity supports the adapter direction. It does not prove full Kit compatibility.
An unchanged website still needs an integration or wallet-provider adapter.
A stable named tunnel, longer session management, and production availability remain future work.
Cloudflare terminates TLS and can read tokens and XDR. Add end-to-end encryption before any mainnet use.
The bridge shows the website Origin as a claim. Verified website identity remains future work.
An automated policy review can later decide requests through the bridge's `review` hook, with no terminal step.
