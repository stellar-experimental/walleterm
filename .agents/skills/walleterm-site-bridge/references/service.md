# Tunnel service and browser SDK

This reference matches bridge protocol version 3. The browser SDK uses `@stellar/stellar-sdk` 17.2.0.
Check `walleterm --help` for the installed command interface.
The full guide is [WEB-BRIDGE.md](https://github.com/stellar-experimental/walleterm/blob/main/docs/WEB-BRIDGE.md).
The SDK contract is [SEP-43.md](https://github.com/stellar-experimental/walleterm/blob/main/docs/SEP-43.md).

## Start the service

Start the service on the Mac that runs 1Password. It needs the enabled 1Password SSH agent, `walleterm`, and cloudflared.
The Homebrew cask installs cloudflared. Otherwise, run `brew install cloudflared`.

```sh
walleterm tunnel
```

Run it in a persistent terminal. Keep it running while the website uses the bridge.
The default local port is 8787. Use `--port` only when another local process uses it.
The terminal prints the bridge URL, an eight-digit code, and a QR code when the terminal is wide enough.
A code works once and expires after five minutes. A selected website session lasts one hour.
The website origin must use HTTPS, or loopback HTTP for development. It must differ from the bridge origin.
Cloudflare terminates TLS and can read the XDR and credentials. The bridge supports testnet only.

To limit website wallets to one 1Password vault, pass its name or ID: `walleterm tunnel --vault <name-or-id>`.
Filtering needs the 1Password CLI. Without `--vault`, all Ed25519 agent keys are available.
Restart the tunnel after a filter change, then reconnect with the new URL and code.
Wallet discovery and selection can take up to 135 seconds. A 1Password CLI approval can appear during discovery.

## Try the demo

Run `walleterm demo` in a second persistent terminal. Its default local port is 8788.
Open its public URL. Choose **Connect Walleterm**, enter the tunnel URL and code, then select a dedicated testnet wallet.
Create and review a supported transaction. Choose **Sign**, then approve 1Password on the Mac if it asks.
Submit separately from the demo. Verify the original hash on testnet.
The demo's actions are in [DEMO.md](https://github.com/stellar-experimental/walleterm/blob/main/docs/DEMO.md). Inspect each recipient and offer before approval.

## What the bridge signs

The bridge filters no operations. Review each request against the user's grant.
It accepts canonical testnet V1 and fee-bump envelopes. V0 envelopes fail. Mainnet fails before signing.
The selected G-address must be the transaction source, an operation source, or the fee-bump fee source.
Existing signatures from other keys stay in place. The selected key must not have signed already.
A nonzero `max_time` at or before now fails. A fee bump uses its inner bounds.
The bridge does not cap fees or inspect embedded authorization entries.
A setOptions, changeTrust, or merge operation is signable. Review it with care.

## Integrate a website

The SDK is not on npm. Build it from a source checkout with `bun run build`.
Serve `dist/sdk/` and the shared `dist/chunk-*.js` and `dist/jsQR-*.js` files in the same relative layout, with `sdk/connect.css`.
Do not copy all of `dist/`. It also holds the demo build and local build paths.

```js
import { Walleterm } from './dist/sdk/walleterm.js';

const wallet = new Walleterm(); // One fixed wallet. Use { walletScope: 'available' } for switching.
const { address, error } = await wallet.getAddress(); // Opens the pairing dialog without a session.
// Build and review the unsigned transaction for address on testnet.
const result = await wallet.signTransaction(unsignedXdr, { networkPassphrase: 'Test SDF Network ; September 2015' });
if (result.error) throw result.error; // { code, message, ext, requestState? }
// Verify the signed body, hash, and signature. Submit only within the user's grant.
await wallet.disconnect();
```

SEP-43 methods resolve results and never reject. A failure returns empty fields and `error`.
`signTransaction` returns `{signedTxXdr, signerAddress}`. It does not submit. `submit: true` returns code `-3`.
`signMessage` returns a Base64 `signedMessage`. Read [message signing](message-signing.md) first.
Request `walletScope: 'available'` only when the user needs wallet switching, and explain that permission.
For a Stellar Wallets Kit website, add `WalletermModule` from `walleterm/kit`. Use the guarded `onChange` hook in SEP-43.md.

## Explicit authorization

`wallet.signAuthEntry(preimageXdr)` signs an address-bound preimage from `buildAuthorizationEntryPreimage`.
The preimage must be `envelopeTypeSorobanAuthorizationWithAddress` on testnet. V1 preimages return `-3`.
The bound address must be the selected G-address or a C-address. Expiration ledger 0 fails.
`wallet.signAuthorization(entryXdr, { address, adapter })` signs through an adapter and returns `signedAuthEntryXdr`.
The adapters are `account`, `contract-ed25519`, and the pinned `openzeppelin-ed25519`.
The website builds entries, checks invocation trees, and chooses expiry. The bridge reads no ledger.
Attach the signed entry and simulate in enforce mode before requesting the envelope signature.

## Preserve unknown results

`error.requestState === 'unknown'` (code `-1`) does not prove that no signature exists.
Code `-4` means a confirmed cancellation, a denial, or an ended session. It does not undo a delivered signature.
The SDK retries transport errors with the same request ID. Recovery never repeats signing or submission.
Restarting the bridge ends sessions and requests.
For an unfinished signing prompt, decline it on the Mac before clearing the pending record.
For an unknown submission, reconcile its original hash and expiry against ledger and account state.
