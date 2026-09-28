# Tunnel service and browser SDK

This reference matches bridge protocol v2 in Walleterm source on 2026-09-26.
The project uses Bun 1.4.2 or later and Stellar SDK 17.1.0.
Check `walleterm --help` for the installed command interface.
Installing this skill does not install the binary, service assets, or dependencies.
Start the service on the Mac that hosts 1Password. A cloud execution environment cannot use its local SSH socket.

## Start the service

The tunnel needs macOS, the enabled 1Password SSH agent, Bun, cloudflared, and installed Walleterm service assets.
The demo needs Bun, cloudflared, and installed website assets.
Run `make install` from the Walleterm source checkout when those assets need installation or an update.
Do not rebuild the service merely to install or edit these skills.

```sh
walleterm --help
walleterm tunnel
```

Run the command in a persistent terminal. Keep it running while the website uses the bridge.
The default local port is 8787. Use `--port` only when another local process occupies it.
The terminal prints the bridge URL, an eight-digit code, and a QR code when the terminal is wide enough.
The QR payload is `{"walleterm":2,"url":"...","code":"...","expires_at":"..."}`.
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
The bridge cannot sign `changeTrust`. Create the trustline with the direct `walleterm` skill first.
The demo uses Friendbot for new testnet accounts and selects an existing payment recipient.
Inspect the displayed recipient and offer terms before approving the action.

## Supported XDR

The bridge accepts canonical unsigned V1 testnet envelopes with exactly one operation.
Classic operations include:

- A native XLM payment to a G-address.
- A `manageData` operation to set or delete a data entry.
- A `manageSellOffer` operation with explicit assets and a positive rational price.
  A zero amount cancels the named offer. A nonzero amount can trade immediately.

The transaction source and any operation source must match the selected G-address.
Classic fees must be 100–100000 stroops. Soroban fees must be 100–100000000 stroops.
The positive sequence must come from live account state.
Only time preconditions are accepted. The transaction must be valid now and expire within five minutes.
Soroban operations include invocation, upload, deployment, TTL extension, and restoration.
Fee bumps, existing envelope signatures, additional preconditions, and unsupported operations fail before signing.
Use direct `walleterm sign` with the matching core reference when an authorized task needs another format.
Do not expand the public bridge's limits to work around a rejected transaction.

## Integrate a website

Use the local `WalletermClient` browser module. This private package is not a published npm wallet module.
From the source checkout, `bun run build` produces `dist/` JavaScript and declarations.
Copy the full `dist/` tree to the website. Preserve the shared chunks beside the SDK modules.
Copy `sdk/connect.css` too when using `WalletermConnect` from `dist/sdk/connect.js`.
The package also provides exports for the client, connection component, scanner, and stylesheet.

```js
import { WalletermClient } from './dist/sdk/walleterm.js';

const wallet = new WalletermClient(bridgeUrl); // Exact origin, without a trailing slash or path.
const { address, networkPassphrase } = await wallet.connect({
  code,
  selectWallet: async signers => chooseWallet(signers), // Return a displayed full public_key.
});
// Build and review the unsigned supported transaction for address and networkPassphrase.
const { signedTxXdr, signerAddress } = await wallet.signTransaction(unsignedXdr);
// Verify the signed body, hash, and signature. Submit only within the user's grant.
await wallet.disconnect();
```

`connect` and `getAddress` return `{address, networkPassphrase}`.
`signTransaction` returns `{signedTxXdr, signerAddress}`. It does not submit.
The SDK independently verifies the unchanged body and selected key's signature.
`listWallets`, `selectWallet`, and `disconnect` manage the connection.
The default `walletScope` is `selected`. It fixes one wallet for that connection.
For wallet switching, request `walletScope: 'available'` explicitly and explain that permission before selection.
`WalletermConnect` uses this broader scope and displays the grant explanation.
The first selection fixes the displayed eligible key set. Later keys need a new connection.
The SDK manages grant IDs and selection revisions. Wallet changes cancel pending requests and withhold old results.

## Explicit authorization

Use `client.signAuthEntry(entryXdr, { address, adapter })` for an unsigned AddressV2 entry.
The result contains `signedAuthEntryXdr` and `signerAddress`.
The bridge obtains current ledger evidence from its fixed testnet RPC endpoint.
The SDK independently verifies the exact returned entry and signature.
Supported adapters are `account`, `contract-ed25519`, and the pinned `openzeppelin-ed25519` adapter.
Review the contract's signature format before selecting an adapter.
The website builds entries, checks invocation trees, and chooses expiry before requesting a signature.
Attach the signed entry, run enforcing simulation, and assemble the final transaction before requesting its envelope signature.
Standalone signing rejects V1, SourceAccount, and delegated credentials.
General transaction envelopes permit normal SourceAccount authorization.
Invalid returned artifacts preserve `requestState: 'unknown'`. Keep the original request and expiry protected.
Switching away and back does not restore a canceled request or undo a delivered signature.
Use the SDK instead of duplicating its session, revision, request-ID, and cancellation logic.

## Preserve unknown results

The standalone SDK keeps credentials in memory.
The connection component can enable reload recovery with a website-specific `sessionStorageKey`.
The demo saves its bridge URL and session token in `sessionStorage` and checks `/v1/account` after reload.
Recovery never repeats signing or submission. Disconnect and 401 responses clear the saved session.
Network failures retain the saved session. Expired sessions require a new connection code.
Restarting the bridge ends sessions and requests. It never retries signing.
The SDK retries transport errors with the same request ID while that session remains valid.
`error.requestState === 'unknown'` does not prove that no signature exists.
`error.canceled` describes cancellation or lost session access. It does not prove that signing stopped.
The demo keeps signed XDR and submission hashes in browser local storage and uses Web Locks across tabs.
Do not clear an unresolved journal or replace its transaction automatically.
A new demo hostname has different storage. Keep the original tab and hash during recovery.
For an unfinished signing prompt, decline it on the Mac before clearing the corresponding pending record.
For an unknown submission, reconcile its original hash and expiry against ledger and account state.
