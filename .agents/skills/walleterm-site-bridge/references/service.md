# Tunnel service and browser SDK

This reference matches bridge protocol version 3 in Walleterm source on 2026-09-28.
The `walleterm` binary runs the bridge natively and embeds the demo website. The browser SDK uses Stellar SDK 17.1.0.
Check `walleterm --help` for the installed command interface.
Installing this skill does not install the binary, service assets, or dependencies.
Start the service on the Mac that hosts 1Password. A cloud execution environment cannot use its local SSH socket.

## Start the service

The tunnel needs macOS, the enabled 1Password SSH agent, cloudflared, and the installed `walleterm` binary.
The demo needs cloudflared and the same binary.
The Homebrew cask installs `walleterm` and cloudflared. A source checkout installs `walleterm` with `make install`.
Do not rebuild the service merely to install or edit these skills.

```sh
walleterm --help
walleterm tunnel
```

Run the command in a persistent terminal. Keep it running while the website uses the bridge.
The default local port is 8787. Use `--port` only when another local process occupies it.
The terminal prints the bridge URL, an eight-digit code, and a QR code when the terminal is wide enough.
The QR payload is `{"walleterm":3,"url":"...","code":"...","expires_at":"..."}`.
A code works once and expires after five minutes. A selected website session lasts one hour.
The website origin must use HTTPS, or loopback HTTP for development. It must differ from the bridge origin.
Cloudflare terminates TLS and can read the XDR and credentials. This bridge supports testnet only.

If the user selects a vault, set `OP_VAULT` in the shell that starts the tunnel.

```sh
OP_VAULT=Private walleterm tunnel
```

`Private` is an example vault name. Use the user's selected vault name or ID.
Filtering needs the 1Password CLI and its desktop integration or an existing sign-in.
The bridge reads item metadata and public keys only. Lookup errors stop discovery and signing.
An empty vault returns no wallets. An unset or empty `OP_VAULT` exposes all available Ed25519 agent keys.
The bridge checks vault membership again before signing.
`walleterm list` and `walleterm sign` do not use this filter.
Restart the tunnel after changing the filter. Reconnect with its new URL and code.
Discovery and selection can need 135 seconds. A 1Password CLI approval can appear during vault discovery.

## Connect the demo

Run `walleterm demo` in a second persistent terminal. Its default local port is 8788.
Open its public URL. The demo QR opens the website; the tunnel QR connects the signer.
Choose **Connect Walleterm**, enter the tunnel URL and code, then select a dedicated testnet wallet.
Review the permission for the displayed wallets before selection.
Create and review a supported transaction. Choose **Sign**, then approve 1Password on the Mac if it asks.
Submit separately from the demo. Verify the original hash on testnet.
The sell-offer action needs an authorized trustline to `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
The demo has no trustline action. Create the trustline with the direct `walleterm` skill first.
The demo uses Friendbot for new testnet accounts and selects an existing payment recipient.
Inspect the displayed recipient and offer terms before approving the action.

## Supported XDR

The bridge filters no operations. Review each request against the user's grant.
It accepts canonical testnet V1 and fee-bump envelopes. V0 envelopes fail.
The selected G-address must be the transaction source, an operation source, or the fee-bump fee source.
Existing signatures from other keys stay in place. The selected key must not have signed already.
A nonzero `max_time` at or before now fails. A fee bump uses its inner bounds. Time bounds are otherwise optional.
The bridge does not cap fees or inspect embedded authorization entries.
Mainnet fails before signing. A setOptions, changeTrust, or merge operation is signable. Review it with care.

## Integrate a website

Walleterm is a SEP-43 wallet. This private package is not a published npm wallet module.
From the source checkout, `bun run build` produces `dist/` JavaScript and declarations.
Copy the full `dist/` tree to the website. Preserve the shared chunks beside the SDK modules.
Copy `sdk/connect.css` too. The pairing dialog needs it.
The package also provides exports for the wallet, connection component, Kit module, scanner, and stylesheet.

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
`getAddress` returns `{address}`. `getNetwork` returns testnet. `signMessage` returns `-3`.
`signTransaction` returns `{signedTxXdr, signerAddress}`. It does not submit. `submit: true` returns `-3`.
The SDK independently verifies the unchanged body and the selected key's appended signature.
`listWallets`, `selectWallet`, `onChange`, and `disconnect` manage the connection. They throw on failure.
The default `walletScope` is `selected`. It fixes one wallet for that connection.
For wallet switching, request `walletScope: 'available'` explicitly and explain that permission before selection.
`WalletermConnect` displays the grant explanation and the wallet menu.
The first selection fixes the displayed eligible key set. Later keys need a new connection.
The SDK manages grant IDs and selection revisions. Wallet changes cancel pending requests and withhold old results.
`WalletermClient` is the single-session client under `Walleterm`. It throws instead of returning results.
For a Stellar Wallets Kit website, use `WalletermModule` from `walleterm/kit`.
Connect `module.onChange` once. Act only when `StellarWalletsKit.selectedModule.productId === WALLETERM_ID`.
Then call `StellarWalletsKit.fetchAddress()` for an address, or `StellarWalletsKit.disconnect()` for none.
The guarded hook is in `docs/SEP-43.md`. Without the guard, the hook acts on another selected Kit wallet.

## Explicit authorization

SEP-43 `wallet.signAuthEntry(preimageXdr)` signs an address-bound authorization preimage.
Build it with `buildAuthorizationEntryPreimage(entry, expirationLedger, networkPassphrase)`.
The result `signedAuthEntry` is a Base64 64-byte signature. Attach it with `authorizeEntry` in the account's format.
The preimage must be `envelopeTypeSorobanAuthorizationWithAddress` on testnet. V1 preimages return `-3`.
The bound address must be the selected G-address or a C-address. Expiration ledger 0 fails.
For an adapter digest, use `wallet.signAuthorization(entryXdr, { address, adapter })`.
Its result contains `signedAuthEntryXdr` and `signerAddress`.
Supported adapters are `account`, `contract-ed25519`, and the pinned `openzeppelin-ed25519` adapter.
Review the contract's signature format before selecting an adapter or attaching a signature.
The bridge reads no ledger and applies no expiry window. The network enforces expiry.
The website builds entries, checks invocation trees, and chooses expiry before requesting a signature.
Attach the signed entry, run enforcing simulation, and assemble the final transaction before requesting its envelope signature.
Invalid returned artifacts preserve `requestState: 'unknown'`. Keep the original request and expiry protected.
Switching away and back does not restore a canceled request or undo a delivered signature.
Use the SDK instead of duplicating its session, revision, request-ID, and cancellation logic.

## Preserve unknown results

The wallet saves its bridge URL and session token in `localStorage` under `walleterm:session`. All tabs of the website share them.
`storageKey: null` keeps them in memory only. A reload or a new tab checks `/v1/account` before it publishes an address.
Recovery never repeats signing or submission. Disconnect and 401 responses clear the saved session.
Network failures retain the saved session. Expired sessions require a new connection code.
Restarting the bridge ends sessions and requests. It never retries signing.
The SDK retries transport errors with the same request ID while that session remains valid.
`error.requestState === 'unknown'` (code `-1`) does not prove that no signature exists.
Code `-4` means a confirmed cancellation, a denial, or an ended session. It does not undo a delivered signature.
The demo keeps signed XDR and submission hashes in browser local storage and uses Web Locks across tabs.
Do not clear an unresolved journal or replace its transaction automatically.
A new demo hostname has different storage. Keep the original tab and hash during recovery.
For an unfinished signing prompt, decline it on the Mac before clearing the corresponding pending record.
For an unknown submission, reconcile its original hash and expiry against ledger and account state.
