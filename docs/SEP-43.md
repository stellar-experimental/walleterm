# SEP-43 wallet interface design

Status: design proposal. It changes no code.
Date: 2026-09-28. Source: `main` at `aa69fb4e889b9cdf0a6aea9c5adcb662a7ac673c`.
This document defines how Walleterm becomes a SEP-43 wallet first.
Walleterm is pre-1.0. The design keeps one current protocol and removes the old surface.
Numbered questions (Q1–Q11) mark decisions that the user must make. Each question has a recommendation.

## Summary

- The browser SDK exposes one SEP-43 wallet object, `Walleterm`.
  It has `getAddress`, `signTransaction`, `signAuthEntry`, `signMessage`, `getNetwork`, and `disconnect`.
- Methods resolve with SEP-43 results. Failures resolve with `{ error: { code, message, ext } }`.
  The Stellar SDK contract client and Freighter use this shape.
- `getAddress()` owns pairing. When no session exists, it opens the Walleterm dialog for the tunnel URL, code, and key.
- `signAuthEntry` takes a CAP-71 address-bound preimage and returns a Base64 Ed25519 signature.
  The website attaches the signature. Adapters move to the website.
- `signMessage` exists but returns error `-3`. SEP-53 signatures have no network binding (Q1).
- `getNetwork()` always returns testnet. Other passphrases fail with `-3`.
- The authorization expiry limit must accept the SDK default of 100 ledgers (Q2).
- A Stellar Wallets Kit module ships in this repository as `walleterm/kit`. An upstream request waits (Q9).
- The bridge protocol becomes version 3. It removes wallet scopes, grant IDs, selection revisions, and adapters (Q4, Q5).

## Sources

All sources were read on 2026-09-28. Local copies stayed in the session scratchpad.

| Source | Version and evidence |
| --- | --- |
| [SEP-43](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0043.md) | v1.2.1, Draft. Last file commit `d4d17e6c` on 2025-06-17. Repository head `9cd70307`. |
| [SEP-53](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0053.md) | v1.0.0, Final since 2026-06-18 (commit `b1933843`). |
| [CAP-71](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071.md), [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-01.md), [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-02.md) | Final, protocol 27. Final on 2026-07-31 (commit `ae300437`). |
| [SEP-45](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0045.md) | v0.1.1, Draft. Used for one abuse case only. |
| [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit/tree/v2.7.0) | v2.7.0, tag commit `4bdda712`, 2026-09-23. npm `@creit.tech/stellar-wallets-kit@2.7.0`. Files: `src/types/mod.ts`, `src/sdk/kit.ts`, `src/sdk/modules/utils.ts`, `src/sdk/modules/freighter.module.ts`, `src/sdk/modules/ghostsig.module.ts`, `src/state/values.ts`, `docs/files/wallets/create-wallet-module.md`. |
| [Freighter](https://github.com/stellar/freighter/tree/5.48.0) | Extension 5.48.0, commit `a9409f4d`, 2026-09-02. Bundled `@stellar/freighter-api` 6.0.1. Files: `@stellar/freighter-api/src/*`, `extension/src/background/messageListener/*`, `extension/src/popup/views/SignAuthEntry/index.tsx`, `extension/src/popup/helpers/soroban.ts`. |
| `@stellar/stellar-sdk` | 17.1.0, the pinned project dependency. Files: `lib/esm/base/auth.d.ts`, `lib/esm/contract/assembled_transaction.js`, `lib/esm/contract/signer.js`, `lib/esm/base/keypair.d.ts`. |
| [Freighter auth entry guide](https://developers.stellar.org/docs/build/guides/freighter/sign-auth-entries) | Found through Stellar Raven `stellarDocs.search_wallet_dapp_docs`. |
| Prior research | `audit/2026-09-27-next-steps/OPUS.md` and `evidence/research.json` R2 and R3. |

Research used Stellar Raven, GitHub, npm, and JSR reads. No paid research tool reported a charge.

## Current surface and gaps

| Area | Current Walleterm | SEP-43 or Kit expectation |
| --- | --- | --- |
| Construction | `new WalletermClient(bridgeUrl)` | The website does not know the bridge. Pairing supplies it. |
| Access | `connect({ code, selectWallet, walletScope })` | `getAddress()` obtains access. Kit: `getAddress({ skipRequestAccess })`. |
| Address | `getAddress()` returns `{ address, networkPassphrase }` | `{ address }` |
| Transactions | `signTransaction(xdr, opts)` returns `{ signedTxXdr, signerAddress }` | Same result. Also `submit` and `submitUrl` options. |
| Authorization | `signAuthEntry(entryXdr, { address, adapter })` returns `{ signedAuthEntryXdr }` | Preimage input. Returns `{ signedAuthEntry, signerAddress }`. |
| Messages | None | `signMessage(message, opts)` |
| Network | Account field only | `getNetwork()` returns `{ network, networkPassphrase }` |
| Errors | Thrown `Error` with `status`, `requestState`, `canceled` | `{ code: -1..-4, message, ext?: string[] }` |
| UI | `WalletermConnect` header, dropdown, and switcher | The wallet owns access UI. The Kit owns its button and profile modal. |

## 1. SEP-43 surface

### Types

```ts
type Sep43Error = {
  code: -1 | -2 | -3 | -4;
  message: string; // Readable text for the user.
  ext?: string[]; // First entry: a stable Walleterm reason, such as "walleterm:not_connected".
  requestState?: 'denied' | 'expired' | 'unknown'; // Walleterm extension. Present after a bridge request.
};
// Success has no error. Failure has only `error`. Destructuring still works.
type Result<T> = (T & { error?: undefined }) | ({ [K in keyof T]?: undefined } & { error: Sep43Error });

interface SignOptions {
  networkPassphrase?: string; // Default: Networks.TESTNET. Any other value fails.
  address?: string; // Default: the selected G-address. Any other value fails.
  signal?: AbortSignal; // Walleterm extension. Aborting cancels the bridge request.
  onProgress?: (p: { state: 'pending' | 'approved' | 'signing' | 'retrying'; expiresAt?: string }) => void; // Extension.
}

class Walleterm {
  constructor(options?: {
    pair?: () => Promise<{ url: string; code: string }>; // Default: the built-in dialog.
    selectWallet?: (signers: Signer[], o: { signal: AbortSignal }) => Promise<string>; // Default: the dialog.
  });
  readonly address: string | undefined; // The selected G-address. The Stellar SDK contract client reads it.
  getAddress(opts?: { skipRequestAccess?: boolean }): Promise<Result<{ address: string }>>;
  signTransaction(
    xdr: string,
    opts?: SignOptions & { submit?: boolean; submitUrl?: string },
  ): Promise<Result<{ signedTxXdr: string; signerAddress: string }>>;
  signAuthEntry(authEntry: string, opts?: SignOptions): Promise<Result<{ signedAuthEntry: string; signerAddress: string }>>;
  signMessage(message: string, opts?: SignOptions): Promise<Result<{ signedMessage: string; signerAddress: string }>>;
  getNetwork(): Promise<Result<{ network: string; networkPassphrase: string }>>;
  disconnect(): Promise<{ error?: Sep43Error }>;
}
```

The constructor also keeps the existing test options `fetch`, `pollInterval`, and `page`.
Methods never reject. A thrown exception inside the SDK becomes code `-1`.

### Methods

| Method | Behavior |
| --- | --- |
| `getAddress()` | With a session, it confirms the session with `GET /v1/account` and returns the selected G-address. Without a session, it opens pairing. With `skipRequestAccess: true`, it returns `-3 walleterm:not_connected` instead. A closed dialog returns `-4`. |
| `signTransaction(xdr, opts)` | It checks the network, address, and envelope locally. It sends one bridge request and verifies the returned envelope. It returns `{ signedTxXdr, signerAddress }`. `submit: true` or any `submitUrl` returns `-3` (Q7). |
| `signAuthEntry(authEntry, opts)` | `authEntry` is Base64 `HashIdPreimage` XDR of type `envelopeTypeSorobanAuthorizationWithAddress`. It returns the Base64 64-byte Ed25519 signature of `SHA-256(preimage bytes)`. See section 2. |
| `signMessage(message, opts)` | It returns `-3 walleterm:unsupported` and sends no request (Q1). |
| `getNetwork()` | It returns `{ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' }`. It needs no session. |
| `disconnect()` | It clears the saved session and aborts local requests. Then it sends `POST /v1/disconnect`. It returns `{}` after confirmation or a 401. Otherwise it returns `-2`: the bridge session can remain until expiry. |

`signerAddress` is always the selected G-address.
`opts.address` names the signing key, as in the Kit and the SDK contract client.
For a C-account authorization, the preimage carries the C-address. `opts.address` stays the G-address.

### Error codes

SEP-43 defines four codes. Walleterm maps each failure to one code and one reason.

| Code | Reason in `ext[0]` | Cause |
| --- | --- | --- |
| `-3` | `walleterm:not_connected` | No session, pairing incomplete, or the bridge returned 401. |
| `-3` | `walleterm:network_unsupported` | The passphrase or preimage network is not testnet. |
| `-3` | `walleterm:address_mismatch` | `opts.address` differs from the selected G-address. |
| `-3` | `walleterm:invalid_request` | Malformed, noncanonical, or oversized XDR or options. |
| `-3` | `walleterm:unsupported` | Valid input outside bridge policy: fee bumps, unsupported operations, V1 preimages, messages, submission. |
| `-3` | `walleterm:expired` | The request expired before signing. Build a new artifact. |
| `-4` | `walleterm:rejected` | The user closed the dialog, or the website aborted, or the bridge denied the request. |
| `-2` | `walleterm:bridge_unavailable` | The tunnel stayed unreachable after the existing retries. |
| `-2` | `walleterm:ledger_unavailable` | The fixed testnet RPC failed the trusted ledger check before signing. |
| `-1` | `walleterm:result_unknown` | The bridge reported `unknown`, or local verification of a returned artifact failed. |
| `-1` | `walleterm:internal` | Any other failure. |

The bridge stores the SEP-43 error with each failed request. The SDK returns that code unchanged.
An abort sends a cancel request. A confirmed `denied` state returns `-4`.
Any other cancel outcome returns `-1` with `requestState: 'unknown'`. It never claims that signing stopped.
The SDK contract client joins `ext` entries with commas. So `ext` must stay an array.
The Kit types `ext` as a string, but its `parseError` copies the value unchanged.

## 2. `signAuthEntry`

### SEP-43 contract

SEP-43 passes an authorization preimage and returns a signed hash.
Freighter 5.48.0 signs `SHA-256(preimage XDR bytes)` and returns Base64.
The SDK `KeypairSigner.signAuthEntry` does the same.
`AssembledTransaction.signAuthEntries` calls `signAuthEntry(preimage.toXdr('base64'), { address })`.
It reads `{ signedAuthEntry, error }` and attaches the signature with `authorizeEntry`.

Freighter accepts both preimage types. It rejects a bound address that differs from the active account.
So Freighter cannot sign for a C-account. Walleterm keeps C-account support.

### Website flow

```ts
import { authorizeEntry, buildAuthorizationEntryPreimage, Networks, xdr } from '@stellar/stellar-sdk';

// The website simulated the call and reviewed `entry` and its full invocation tree.
const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, Networks.TESTNET);
const { signedAuthEntry, signerAddress, error } = await wallet.signAuthEntry(preimage.toXdr('base64'));
if (error) throw error;
const signature = Uint8Array.from(atob(signedAuthEntry), (c) => c.charCodeAt(0));
const signed = await authorizeEntry(
  entry,
  async () =>
    isContractAccount
      ? { signatureScVal: xdr.ScVal.scvBytes(signature) } // Shape required by this contract account.
      : { signature, publicKey: signerAddress }, // Native G-account signature vector.
  expirationLedger,
  Networks.TESTNET,
);
```

For a G-address entry, `AssembledTransaction.signAuthEntries({ signAuthEntry: wallet })` needs no custom code.
For a C-address entry, the website supplies the contract's signature shape.

### Bridge checks on a preimage

The bridge and the SDK share one preimage validator (`sdk/preimage.ts`).

1. The input is canonical Base64 `HashIdPreimage` XDR of 32768 characters or fewer.
2. The type is `envelopeTypeSorobanAuthorizationWithAddress`. Every other type fails, including V1 (Q3).
3. `networkId` equals `SHA-256("Test SDF Network ; September 2015")`.
4. `address` is the selected G-address or a C-address.
   Other G-addresses, muxed accounts, claimable balances, and liquidity pools fail.
5. `signatureExpirationLedger` exceeds the trusted testnet ledger by 1 to N ledgers.
   The bridge reads the ledger from its fixed RPC endpoint before and after signing. N is 60 today (Q2).
6. The invocation tree has 256 contexts or fewer and 32 levels or fewer.
7. The request ID binds the exact preimage XDR, the signer, and the network.
8. The bridge signs `SHA-256(preimage bytes)` once and verifies the signature before it returns the signature.

The terminal log line names the digest, the signer, and the bound address.

### What a preimage cannot show

- The credential type that the website will attach. V2 and `ADDRESS_WITH_DELEGATES` share this preimage.
  CAP-71-01 gives delegates the same payload as the top-level address.
- The final signature `ScVal` and whether the contract accepts it.
- C-account ownership and policy. The current design cannot check these either.
- The transaction that will carry the entry, its fee, and its other entries.
- Whether the nonce is still unused.

These gaps do not widen signing authority.
A signature on this preimage means one thing: the key approves this tree for this address, network, nonce, and expiry.
The current `account` and `contract-ed25519` adapters sign exactly this digest.

Evidence: a throwaway prototype ran on 2026-09-28 with an isolated random mock key.
It compared the current `inspectAuthEntry` and `attachAuthSignature` output with the SEP-43 path.
The SEP-43 path used `buildAuthorizationEntryPreimage`, a raw signature, and SDK `authorizeEntry`.
Both adapters produced the same digest and byte-identical signed entries.
The prototype was not committed.

### Adapters

Adapters move to the website. The bridge and browser SDK drop `adapter`, `address`, and `auth_entry_xdr`.
The OpenZeppelin adapter signs `SHA-256(payload || XDR(Vec<U32> rule IDs))`, not the preimage hash.
SEP-43 cannot express that digest. The bridge also exposes no arbitrary digest route.
So the bridge cannot serve OpenZeppelin smart accounts through SEP-43 (Q4).
The CLI `walleterm sign-auth` keeps all three adapters.

### Expiry window

The SDK contract client sets the default expiry to the latest ledger plus 100.
The current bridge permits 60 ledgers. Every default `signAuthEntries()` call would fail.
Q2 asks for a new limit. The recommendation is 120 ledgers, about ten minutes.

### Abuse case: cross-site authentication

A connected website can relay a SEP-45 challenge from another service.
The preimage contains the testnet network ID, so the risk stays on testnet services.
The bridge cannot match a `web_auth_domain` to the website Origin reliably.
This risk exists today, because the current adapters sign the same digest.
This design accepts the testnet risk and documents it.

## 3. `signMessage`

SEP-53 signs `SHA-256("Stellar Signed Message:\n" || message bytes)`.
Freighter 5.48.0 accepts UTF-8 text only and returns a Base64 signature for API 4.0.0 and later.
SEP-43 text says "HEX-encoded". Freighter and the Kit Freighter module return Base64.

### Abuse cases

1. **No network binding.** Every other bridge artifact includes the testnet network ID.
   A SEP-53 signature proves control of the G-address on every network and service.
   Message signing would move the bridge beyond testnet.
2. **Login relay.** A connected website can request another service's login challenge.
   The attacker then signs in to that service as the key owner.
3. **Key derivation.** Some applications derive keys from a deterministic signature over fixed text.
   A connected website can request the same text and take the derived key.
4. **Phishing through a trusted site.** A compromised or malicious script on a connected site gets the same power.
5. **No display.** SEP-53 says that wallets MUST clearly display or otherwise confirm the content.
   The bridge has no trusted display. The requesting website cannot act as an independent display.

### Recommendation

Keep `signMessage` in the interface. Return `-3 walleterm:unsupported` without a bridge request (Q1).
The direct `walleterm sign` path stays available for reviewed agent work.

If the user chooses terminal confirmation later, use these rules:

- Accept UTF-8 text of 1024 bytes or fewer, without control characters other than a newline.
- Show the Origin, the selected key, the full text, and the digest in the tunnel terminal.
- Sign only after the user types a confirmation in that terminal. A timeout denies the request.
- Return Base64, as Freighter does. Verify with SDK `Keypair.verifyMessage` before return.
- Keep the request, cancellation, and unknown-result rules of the other request kinds.

## 4. Connection and discovery

### Pairing through `getAddress`

SEP-43 has no connect method. `getAddress()` is the only standard access request.
The Kit calls the module's `getAddress()` after the user picks a wallet.
So `getAddress()` owns pairing:

1. Without a saved session, open the Walleterm dialog.
2. The user scans the tunnel QR code or types the URL and eight-digit code.
3. The SDK sends `POST /v1/connect`, then `GET /v1/signers`.
4. The dialog lists the 1Password Ed25519 keys. The user selects one.
5. The SDK sends `POST /v1/select` and returns `{ address }`.

The dialog is convenience UI inside the website. It is not a trusted display.
It renders in a shadow root with inline styles. So the Kit module needs no stylesheet.
The camera scanner stays lazy. The camera starts only after a button press.

A plain SEP-43 website:

```ts
import { Networks } from '@stellar/stellar-sdk';
import { Walleterm } from 'walleterm';

const wallet = new Walleterm();
const { address, error } = await wallet.getAddress(); // Opens the pairing dialog once.
const signed = await wallet.signTransaction(unsignedXdr, { networkPassphrase: Networks.TESTNET });
await wallet.disconnect();
```

A Kit website:

```ts
import { StellarWalletsKit, Networks } from '@creit.tech/stellar-wallets-kit/sdk';
import { WalletermModule } from 'walleterm/kit';

StellarWalletsKit.init({ modules: [new WalletermModule(), ...otherModules], network: Networks.TESTNET });
const { address } = await StellarWalletsKit.authModal();
```

A Freighter-style website changes only its import.
It calls the same method names and reads the same `{ ..., error }` results.
Walleterm does not copy Freighter's `window.postMessage` transport. That transport identifies another wallet.

Agents and tests pass `pair` and `selectWallet` to the constructor. Nothing else changes.

### Availability, reload, and disconnect

- `isAvailable()` in the Kit module returns `true` at once when the page has `window`, `fetch`, and `<dialog>`.
  No extension exists to detect. The Albedo module returns `true`. The GHOSTSIG module checks `window.open`.
- The Kit stores `activeAddress` in `localStorage` and restores it after reload.
  The module must restore its session too, or its next signature fails.
- The SDK saves `{ url, token }` in `sessionStorage` under one fixed key (Q6).
  The first call after reload checks `GET /v1/account` before it signs.
- A new tab has no saved session. Its first signature returns `-3 walleterm:not_connected`.
  The website then asks the user to connect again.
- `disconnect()` revokes the bridge session. The Kit calls it from its profile modal.
- A session lasts one hour after key selection, as today.

### Wallet switching

SEP-43 and the Kit have no account switch method. The Kit `onChange` hook is optional.
Q5 recommends one key for each connection. To change keys, disconnect and connect again.

## 5. Network

- `getNetwork()` returns `{ network: 'TESTNET', networkPassphrase: Networks.TESTNET }` without a session.
  Freighter uses the name `TESTNET`.
- Every signing method defaults `networkPassphrase` to testnet.
- Any other passphrase returns `-3 walleterm:network_unsupported` and sends no bridge request.
- The SDK checks that `/v1/account` reports testnet. A different value returns `-1`.
- The Kit sets its network to PUBLIC by default. A Kit website must set `Networks.TESTNET`.
  The module never switches networks silently.
- A preimage with another network ID fails, whatever `opts.networkPassphrase` says.

## 6. Removals and renames

### Bridge protocol v3

The QR payload becomes `{"walleterm":3,"url":"...","code":"...","expires_at":"..."}`.
`GET /api/session` returns `{"service":"walleterm","protocol":3}`. The SDK rejects other versions.
Route paths keep the `/v1/` prefix. Origin, CORS, code, and limit rules stay unchanged.

| Route | Version 3 contract |
| --- | --- |
| `POST /v1/connect` | Body `{ code }`. Returns `{ token, expires_at }`. |
| `GET /v1/signers` | Returns `{ signers: [{ public_key, comment, fingerprint }] }`. |
| `POST /v1/select` | Body `{ public_key }`. Once per session. Returns `{ address, network, network_passphrase, expires_at }`. |
| `GET /v1/account` | Returns `{ address, network, network_passphrase, expires_at }`. `address` is null before selection. |
| `POST /v1/requests` | `{ id, kind: "transaction", xdr, network_passphrase, address }` or `{ id, kind: "auth_entry", preimage_xdr, network_passphrase, address }`. |
| `GET /v1/requests/:id` | Returns `{ id, kind, state, hash, expires_at, error? }`. A signed request adds `signed_tx_xdr` or `signed_auth_entry`, and `signer_address`. |
| `POST /v1/requests/:id/cancel` | Unchanged. |
| `POST /v1/disconnect` | Unchanged. |

Errors become `{ "error": { "code": -3, "message": "...", "ext": ["walleterm:..."] } }`. HTTP status stays.
`hash` holds the transaction hash, or `SHA-256(preimage)` for an authorization.

Remove from the bridge (`bridge/server.ts`, `bridge/authorization.ts`, `bridge/PROTOCOL.md`):

- `wallet_scope`, `grant_id`, `expected_revision`, `selection_revision`, and the `allowed` and `offered` key sets (Q5).
- `kind: "authorization"` with `auth_entry_xdr`, `address`, and `adapter`.
- `attachAuthSignature` in the request path. The bridge returns the verified raw signature.
- The field names `transaction_xdr`, `public_key` in requests, and `signed_xdr`.

Keep the transaction limits unchanged in this change (Q8).

### Browser SDK

| Current | Change |
| --- | --- |
| `WalletermClient` | Rename to `Walleterm`. The constructor takes no bridge URL. |
| `connect()`, public `listWallets()`, public `selectWallet()`, `forgetConnection()` | Remove from the public API. Pairing and selection become private steps of `getAddress()`. |
| Public fields `token`, `account`, `walletScope`, `revision`, `generation`, `signings`, `selecting`, `selectionUncertain`, `grant` | Make private. Add the read-only `address`. |
| `getAddress()` returns `{ address, networkPassphrase }` | Return `{ address }`. Add `getNetwork()`. |
| `signAuthEntry(entryXdr, { address, adapter })` returns `signedAuthEntryXdr` | Preimage input. Return `{ signedAuthEntry, signerAddress }`. |
| Thrown `RequestError` with `status`, `code`, `exitCode`, `canceled` | Resolved `Sep43Error`. Keep `requestState`. Drop `canceled`. Code `-4` now means a confirmed cancellation. |
| `export * from './authorization.js'` | Remove from the browser entry. Move the adapter helpers beside `bridge/auth-cli.ts`. |
| `Account`, `WalletScope`, `ConnectOptions`, `Connection`, `ArtifactSigningInput`, `AuthSigningInput` | Remove. |
| Exports `./connect`, `./connect.css`, `./scan` | Remove. Add `./kit`. |

### Connection component

Replace `sdk/connect.ts` and `sdk/connect.css` with `sdk/dialog.ts`.
The dialog keeps the scan button, manual URL and code entry, the key list, and error text.
Remove the header trigger, dropdown, wallet switcher, copy button, refresh button, and 15-second health polling.
Remove `setBusy`, `sync`, `onChange`, `onBusyChange`, `onStateChange`, and `sessionStorageKey`.
Each website owns its header, as with any SEP-43 wallet (Q11).

### Demo

- Use only `Walleterm` SEP-43 methods, plus the `signal` and `onProgress` extensions.
- Add a small site header. Connect calls `getAddress()`. Disconnect calls `disconnect()`.
- Contract authorization builds each preimage with `buildAuthorizationEntryPreimage`.
  It attaches signatures with `authorizeEntry`. The fixture C-account uses `scvBytes`.
- Deployment entries use SDK `authorizeInvocation` with `authV2: true`. This replaces `createAuthEntry`.
- Read `{ error }` results. Keep the recovery journal and the `requestState: 'unknown'` protections.

### Skill and docs

- `.agents/skills/walleterm-site-bridge/references/service.md`: replace the client API and pairing text.
- `.agents/skills/walleterm-site-bridge/references/legacy-freighter.md`: `SUBMIT_AUTH_ENTRY` carries a preimage.
  Sign `SHA-256(preimage)` through the direct path after review. Return Base64.
- `docs/WEB-BRIDGE.md`, `docs/CONTRACT-AUTHORIZATION.md`, `docs/INTERFACE.md` (browser API section),
  `docs/CONNECTION-UI.md`, `docs/CONNECTION-LIFECYCLE.md`, and `README.md`: describe the SEP-43 surface.
- `docs/WALLET-SWITCH-VALIDATION.md`: mark it as a record of the removed feature, or delete it.

## 7. Stellar Wallets Kit module

### Module

`sdk/kit.ts` exports `WalletermModule` and `WALLETERM_ID = 'walleterm'`.

| Field or method | Value |
| --- | --- |
| `moduleType` | `BRIDGE_WALLET`. WalletConnect uses the same type for a remote signer. |
| `productId`, `productName` | `walleterm`, `Walleterm` |
| `productUrl` | A public documentation URL. The repository is internal today (Q9). |
| `productIcon` | An inline SVG data URI. |
| `isAvailable()` | Section 4. |
| `getAddress(params)` | Calls `Walleterm.getAddress(params)`. |
| Signing methods and `getNetwork()` | Call `Walleterm`. A result error becomes a rejection with the same object. |
| `disconnect()` | Calls `Walleterm.disconnect()`. |
| `signAndSubmitTransaction`, `onChange`, `isPlatformWrapper` | Omitted. |

The module passes the Kit `path` option nowhere. It has no hardware path.

### Location

Ship the module in this repository as `walleterm/kit`. Each website imports it and adds it to `init`.
Kit v2.7.0 takes its modules from each website's `init` call.

### Upstream registration

An upstream pull request would add the module to future Kit releases.
`defaultModules()` or `sep43Modules()` could list it after maintainer review.
The Kit wallet list and documentation would name Walleterm.

It would not:

- Change deployed websites. Each website must update the Kit, rebuild, and deploy.
- Remove the tunnel, the code, or `walleterm tunnel` on the Mac.
- Make Walleterm safe for mainnet. TLS ends at Cloudflare. No trusted review exists.
- Override a website's network. Mainnet Kit users would see only `-3` errors.

The Kit rule for default modules forbids extra configuration and polyfills.
The Walleterm module meets that rule if the dialog stays self-contained.
Only the maintainers can decide on a testnet-only remote signer.

## 8. Implementation plan

Answer Q1–Q11 first. Then freeze `bridge/PROTOCOL.md` v3 before parallel work.

| Step | Work | Owned files | Tests and checks |
| --- | --- | --- | --- |
| 1 | Protocol v3 types, shared preimage validator, and digest | `sdk/preimage.ts` (new), `sdk/types.ts` | New `bridge/preimage.test.ts`. Cases: V1 and other arms, canonical XDR, size, network, address types, tree limits, and expiry bounds. |
| 2 | Bridge protocol v3 | `bridge/server.ts`, `bridge/authorization.ts`, `bridge/transaction.ts`, `bridge/launch.ts`, `bridge/PROTOCOL.md` | `bridge/server.test.ts`, `bridge/auth-lifecycle.test.ts`, `bridge/authorization.test.ts`, `bridge/soroban-transaction.test.ts`, `bridge/launch.test.ts`. Assert zero signer calls for every rejected request. |
| 3 | SEP-43 client and dialog | `sdk/walleterm.ts`, `sdk/errors.ts`, `sdk/dialog.ts` (new), `sdk/scan.ts`, `package.json`, `scripts/build.ts`, `scripts/install.ts`; delete `sdk/connect.ts` and `sdk/connect.css` | `bridge/sdk.test.ts`, `bridge/sdk-artifact.test.ts`, `bridge/connect.test.ts` (becomes a dialog test), `bridge/scan.test.ts`. Add a conformance test for every method, result shape, and error code. |
| 4 | SDK contract client interoperability | Tests only | Run `AssembledTransaction.signAuthEntries({ signAuthEntry: wallet })` and `signAndSend` against a mock bridge and mock RPC. |
| 5 | Kit module | `sdk/kit.ts` (new), `fixtures/kit-site/` (new) | New `bridge/kit.test.ts`: `satisfies ModuleInterface` (Q10), `isAvailable` under 1000 ms, rejections carry SEP-43 objects, PUBLIC fails, `skipRequestAccess`. |
| 6 | CLI sidecar helpers | `sdk/authorization.ts` moves beside `bridge/auth-cli.ts`; `bridge/auth-cli.ts` | `scripts/auth-dispatch.test.ts`, `scripts/install.test.ts`. The CLI contract stays unchanged. |
| 7 | Demo | `demo/site/app.ts`, `demo/site/contracts.ts`, `demo/site/index.html`, `demo/site/style.css`, `demo/server.ts` | `demo/contracts.test.ts`, `bridge/site.test.ts`, `bridge/code-view.test.ts`, `tests/site-bridge.test.ts`. |
| 8 | Docs, skill, live runner | Section 6 docs, the skill files, `tests/contract-auth-demo-live.ts` | Review text for ASD-STE100. |

Assign steps 1, 2, and 6 to one bridge owner. Assign steps 3–5 to one SDK owner.
Assign step 7 to a demo owner and step 8 to a docs owner. Steps 3 and 7 start after step 1.
Run `bun run format:check`, `bun run typecheck`, the focused `bun test` files, and `make test` once at the end.

### Security review points

Review steps 1–3 independently before acceptance. Check these points:

- Every rejected preimage and transaction reaches no signer call.
- The digest equals `SHA-256` of the exact validated preimage bytes.
- Request identity binds the preimage, signer, network, and kind. A reused ID with other bytes fails.
- The trusted ledger check still runs before and after signing.
- No error path reports `-4` or `denied` after signing started. Those paths keep `unknown`.
- The removal of scopes and revisions leaves no path that signs for an unselected key.
- The SDK verifies each returned signature before it exposes the result.
- The session token stays out of logs, URLs, and the QR payload.

### Live acceptance

The coordinator runs these checks with fresh user approval and dedicated testnet keys.

1. Demo: pair through `getAddress()`, sign and submit one native payment, and verify the hash.
2. Demo: increment the fixture counter with preimage `signAuthEntry`, then `signTransaction`. Record the counter change.
3. Kit fixture: Kit 2.7.0 with `WalletermModule` and `Networks.TESTNET`.
   Run `authModal`, `signTransaction`, `signAuthEntries` for a G-address entry, and `disconnect`.
4. Negative checks with zero signature requests: PUBLIC passphrase, V1 preimage, `signMessage`, and `submit: true`.
5. Record transaction hashes, ledgers, counter values, public keys, and the source revision.

## Deviations from SEP-43

| Item | SEP-43 or reference behavior | Walleterm | Reason | Question |
| --- | --- | --- | --- | --- |
| `signMessage` | Signs a message | Returns `-3` | No network binding; no trusted display | Q1 |
| V1 preimage | SEP-43 links `HashIdPreimageSorobanAuthorization`. Freighter accepts it. | Returns `-3` | V1 permits cross-address replay (CAP-71-02) | Q3 |
| Networks | Any configured network | Testnet only | The bridge supports testnet only | None |
| `submit`, `submitUrl` | Optional submission | Returns `-3` | The bridge never submits | Q7 |
| Signing without review | Wallet shows the request | The website approves by sending | Existing testnet design | None |
| Extra fields | Not defined | `requestState`, `signal`, `onProgress`, `skipRequestAccess`, `address` | Safe recovery and SDK interoperability | None |

## Decisions that need the user

The report repeats these questions with more detail.

| Question | Recommendation |
| --- | --- |
| Q1. `signMessage` over the bridge | Return `-3`. Consider terminal confirmation later. |
| Q2. Authorization expiry limit | Raise from 60 to 120 ledgers. |
| Q3. V1 preimages | Reject. |
| Q4. OpenZeppelin adapter on the bridge | Remove from the bridge and browser SDK. Keep it in the CLI. |
| Q5. In-session wallet switching | Remove. One key for each connection. |
| Q6. Session storage | Save the session in `sessionStorage` by default. |
| Q7. `submit` and `submitUrl` | Reject with `-3`. |
| Q8. Transaction limits | Keep them in this change. Review a relaxation separately. |
| Q9. Kit module location and upstream | Ship `walleterm/kit` here. No upstream request before mainnet readiness and a public package. |
| Q10. Kit types in tests | Add an exact-pinned development dependency on Kit 2.7.0. |
| Q11. Header component and demo | Remove the header component. The demo uses `Walleterm`. A Kit fixture proves the module. |
