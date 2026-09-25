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

The terminal shows the public bridge URL, an eight-digit connection code, and a QR code.
Keep this terminal visible. It reviews every signing request.

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
   It funds a new testnet account with Friendbot. The offer action also needs a testnet USDC trustline.
5. Review the transaction and signing key in the tunnel terminal. Type the displayed `sign` challenge to approve it, or press Enter to deny it.
6. Approve the 1Password prompt on the Mac if it appears.
7. Return to the demo. Submit the signed transaction separately.

The connection code lets a website list your 1Password Ed25519 public keys and request signatures. It cannot approve them.
Only the tunnel terminal and 1Password can approve a signature.
The displayed website origin is a caller claim, not verified website identity.
Compare it with the website you opened. Do not type codes into websites you do not trust.

## Component responsibilities

| Component | Responsibilities |
| --- | --- |
| `walleterm tunnel` | Supervised tunnel, connection codes, request journal, terminal review, verified signatures |
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

The adapter exposes `connect`, `getAddress`, `signTransaction`, `cancel`, and `disconnect`.
It keeps the website capability in memory. Reloading the website requires a new connection code.
Reuse the same request ID and exact XDR within the same connection to retrieve a result after a transport failure.
The client exposes `connectionId`. Never replay a saved request through a new connection.
A changed transaction with the same ID fails. The bridge never signs twice for an identical request ID in one session.
SDK errors preserve `requestId` and a known terminal `requestState`.
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
Each transaction needs separate terminal approval. Changed bytes, network, or signer require a new request.
The bridge verifies the signature independently before returning signed XDR.
The Mac can still require 1Password approval or an unlock. Cached authorization can suppress a fresh desktop prompt.

The bridge writes private request records before signing and before returning a signed result.
It flushes each record and its directory. Restart invalidates all sessions and preserves request records.
Interrupted signing becomes unknown. Pending requests expire. The bridge never retries them automatically.
Old signed records remain private on disk; new sessions cannot retrieve them automatically.
Canceling or disconnecting during signing suppresses delivery. It cannot undo a signature already produced.
A website might already have received a completed signature before disconnection.

The demo stores signed XDR and the original submitted hash in browser local storage.
Denial and expiry allow a new request. Signing transport failures permit checking the same request ID.
A submission timeout remains unknown. The demo queries the original hash and never automatically resubmits.
A missing transaction does not prove failure. Preserve browser storage until the original outcome is known.
A new public demo hostname has different browser storage. Keep the original tab and its transaction hash during recovery.

## Tunnel lifetime

Each public command creates a private Cloudflare configuration and a separate supervised process.
It does not inherit Cloudflare routing or credential environment settings or change existing Cloudflare configuration.
The server and metrics bind loopback. A parent pipe terminates the child after a parent crash.
Normal shutdown closes requests and terminates the child with a bounded escalation deadline.
The bridge journal lock stays until signing jobs settle or the process exits.
After a hard crash, verify the recorded parent and tunnel processes stopped before removing only `.web-lock`.

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
