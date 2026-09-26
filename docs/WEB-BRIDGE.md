# Independent website signing bridge

`walleterm tunnel` runs the signing bridge and its temporary HTTPS route.
`walleterm demo` runs an example website. The bridge imports no demo code.
Each command owns its own server and tunnel. Stopping one command does not stop the other.

## Run

In one terminal:

```sh
make install
walleterm tunnel
```

The terminal shows the public bridge URL and an eight-digit connection code.
It shows a QR code when the terminal is wide enough. Otherwise, use the URL and code.
The terminal needs no input. It prints one line for each produced or withheld signature.

In a second terminal:

```sh
walleterm demo
```

Open the public demo URL or scan its QR code on your phone.

1. In the demo, click Scan tunnel and scan the tunnel QR code. You can also type the URL and code.
   Scan the demo QR code with your phone camera. Scan the tunnel QR code only with Scan tunnel.
2. Click Connect wallet. The demo lists your 1Password Ed25519 keys.
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
| `sdk/walleterm.js` | Website connection, wallet selection, signing request and result polling, cancellation, disconnection |
| `sdk/scan.js` | Optional camera scan of the tunnel QR code |
| `walleterm sign` | Existing local 1Password signing interface; unchanged |

The bridge makes no Stellar RPC or Horizon call. It does not construct or submit a transaction.
The demo serves the pinned Stellar SDK 17.1.0 browser bundle from its installed dependencies.

## Website adapter

Copy or bundle [sdk/walleterm.js](../sdk/walleterm.js) with your website:

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

The adapter exposes `connect`, `getAddress`, `signTransaction`, and `disconnect`.
It keeps the website capability in memory. Reloading the website requires a new connection code.
The SDK retries network errors and 5xx responses on the same connection. An abort, a rejection, or leaving the page cancels the bridge request.
After a failure, build a new transaction. SDK errors include `requestState` when the bridge reports one.
`error.canceled` is false when the bridge did not confirm the cancellation. Then decline the 1Password prompt if it appears.
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
