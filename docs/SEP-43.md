# SEP-43 wallet interface

This file describes the Walleterm browser SDK. It uses bridge protocol version 4.
Walleterm is SEP-43 compatible and Stellar Wallets Kit compatible.
After a connection, the Walleterm SDK and its header component drive the interface.

## Summary

- `Walleterm` in `sdk/walleterm.ts` has the SEP-43 methods `getAddress`, `signTransaction`, `signAuthEntry`, `signMessage`, and `getNetwork`.
  They resolve SEP-43 results. A failure resolves empty fields and `error: { code, message, ext }`, as Freighter does.
- `getAddress()` owns pairing. Without a session, it opens the Walleterm dialog.
- `signAuthEntry` signs a CAP-71 address-bound preimage and returns a Base64 Ed25519 signature.
- `signMessage` signs SEP-53 text of 1–1024 UTF-8 bytes and returns a Base64 signature. See [section 2a](#2a-message-signing).
- The network is the tunnel network: testnet, futurenet, or a local network. Each account reply names it.
- The native SDK keeps wallet switching, both wallet scopes, and the `WalletermConnect` header component.
- The native SDK keeps adapter signing as `signAuthorization`, outside SEP-43.
- The bridge filters no operations. It keeps only structural invariants.
- `walleterm/kit` exports a Stellar Wallets Kit module. It is not registered upstream.

## Sources

| Source | Version and evidence |
| --- | --- |
| [SEP-43](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0043.md) | v1.2.1, Draft. File commit `d4d17e6c`. |
| [SEP-53](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0053.md) | v1.0.0, Final. |
| [CAP-71](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071.md), [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-01.md), [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-02.md) | Final, protocol 27. |
| [SEP-45](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0045.md) | v0.1.1, Draft. One abuse case only. |
| [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit/tree/v2.7.0) | v2.7.0, commit `4bdda712`. npm `@creit.tech/stellar-wallets-kit@2.7.0`. |
| [Freighter](https://github.com/stellar/freighter/tree/5.48.0) | Extension 5.48.0, commit `a9409f4d`, with `@stellar/freighter-api` 6.0.1. |
| `@stellar/stellar-sdk` | 17.2.0: `base/auth`, `contract/assembled_transaction`, `contract/signer`, `base/keypair`. |

The `stellar-protocol` links use commit `9cd70307`. Research used Stellar Raven, GitHub, npm, and JSR.

## 1. Interface

### SEP-43 methods

```ts
type Sep43Error = {
  code: -1 | -2 | -3 | -4;
  message: string;
  ext?: string[]; // ext[0] is a stable reason, such as "walleterm:not_connected".
  requestState?: 'denied' | 'expired' | 'unknown'; // Present after a bridge request.
};
// As in Freighter, a failure returns the same fields as empty strings.
type Result<T> = T & { error?: Sep43Error };

interface SignOptions {
  networkPassphrase?: string; // Default: the tunnel network. Another value fails.
  address?: string; // Default: the selected G-address. Another value fails.
  signal?: AbortSignal; // Walleterm extension.
  onProgress?: (progress: { state: RequestState | 'retrying'; expiresAt?: string }) => void; // Walleterm extension.
}

getAddress(opts?: { skipRequestAccess?: boolean }): Promise<Result<{ address: string }>>;
signTransaction(xdr: string, opts?: SignOptions & { submit?: boolean; submitUrl?: string }):
  Promise<Result<{ signedTxXdr: string; signerAddress: string }>>;
signAuthEntry(authEntry: string, opts?: SignOptions): Promise<Result<{ signedAuthEntry: string; signerAddress: string }>>;
signMessage(message: string, opts?: SignOptions): Promise<Result<{ signedMessage: string; signerAddress: string }>>;
getNetwork(): Promise<Result<{ network: string; networkPassphrase: string }>>;
```

These methods never reject. SDK 17.2.0 `AssembledTransaction` and Freighter read `{ ..., error }`.
The SDK types a SEP-43 result as `{ signedTxXdr: string } & { error? }`. Empty strings keep that type.
So a `Walleterm` object is a Stellar SDK `contract.Signer`. Its `address` is an empty string without a session.
`signerAddress` is always the selected G-address. `opts.address` names the signing key.

| Method | Behavior |
| --- | --- |
| `getAddress()` | With a session, it confirms the session through `GET /v1/account`. Without one, it opens pairing. `skipRequestAccess: true` returns `-3 walleterm:not_connected` instead. A closed dialog returns `-4`. |
| `signTransaction()` | It checks the envelope locally, sends one request, and verifies the returned envelope. `submit: true` or `submitUrl` returns `-3`. The bridge never submits. |
| `signAuthEntry()` | Section 2. |
| `signMessage()` | Section 2a. It checks the text before any request, and the network and the address before the signing request. |
| `getNetwork()` | It returns the tunnel network, such as `{ network: 'FUTURENET', networkPassphrase: 'Test SDF Future Network ; October 2022' }`. Without a session, it returns `-3` `walleterm:not_connected`. |

### Native methods

These methods belong to the Walleterm SDK. Failures throw a `WalletermError` with `code`, `ext`, and `status`.
`WalletermClient` is the single-session client under `Walleterm`. It throws instead of returning results.

| Member | Purpose |
| --- | --- |
| `new Walleterm({ walletScope, storageKey, ui })` | `walletScope` is `selected` (default) or `available`. `storageKey` names the shared `localStorage` entry. |
| `address`, `url`, `walletScope` | Read-only state. The SDK contract client reads `address`. |
| `connect({ url, code, selectWallet, signal })` | Pairs a tunnel. A failure keeps the current session. |
| `listWallets()`, `selectWallet(publicKey)` | Discovery and switching. |
| `onChange(listener)` | Reports each address change, including disconnection, after the operation settles. Returns an unsubscribe function. |
| `signAuthorization(entryXdr, { address, adapter })` | Adapter signing for a complete AddressV2 entry. It resolves a `Result`. |
| `disconnect()`, `forgetConnection()` | Revokes the session, or discards it locally. |

### Error codes

| Code | `ext[0]` | Cause |
| --- | --- | --- |
| `-3` | `walleterm:not_connected` | No session, or the bridge returned 401. |
| `-3` | `walleterm:network_unsupported` | The passphrase or preimage network is not the tunnel network. |
| `-3` | `walleterm:address_mismatch` | `opts.address` differs from the selected key, or the key is not a required signer. |
| `-3` | `walleterm:invalid_request` | Malformed, noncanonical, or oversized input. Message text that is not well-formed or has more than 1024 UTF-8 bytes. |
| `-3` | `walleterm:unsupported` | Submission or a V1 preimage. |
| `-3` | `walleterm:conflict` | A stale wallet selection or a reused request ID. |
| `-3` | `walleterm:rate_limited` | A bridge connection or request limit. |
| `-3` | `walleterm:expired` | The request expired before signing. |
| `-4` | `walleterm:rejected` | The user closed the dialog, the website canceled, the session ended, the selected key left 1Password, or 1Password did not sign (for example, a declined prompt). |
| `-2` | `walleterm:bridge_unavailable` | The tunnel was unreachable for a call that does not sign. This includes a tunnel error page, such as a Cloudflare 524 timeout. Signing retries until its deadline. |
| `-1` | `walleterm:result_unknown` | Signing started and no verified result arrived. `requestState` is `unknown`. |
| `-1` | `walleterm:internal` | Any other failure. |

The bridge stores the error object with each failed request. The SDK returns it unchanged.
A 4xx answer to the first create attempt proves that no request exists. The SDK returns that error, such as `-3 not_connected`.
A create attempt without an HTTP answer can still have reached the bridge. That outcome stays `-1` and `unknown`.
An abort sends a cancel request. A confirmed `denied` state returns `-4`. Any other outcome returns `-1` and `unknown`.
The SDK contract client joins `ext` with commas, so `ext` stays an array.

## 2. Authorization

### SEP-43 preimage signing

`signAuthEntry(authEntry)` accepts Base64 `HashIdPreimage` XDR.
It signs `SHA-256(preimage bytes)` and returns the Base64 64-byte signature.
Freighter and SDK `KeypairSigner.signAuthEntry` use the same rule.
`AssembledTransaction.signAuthEntries({ signAuthEntry: wallet })` works for G-address entries.
An x402 client can use this method as its signer. See [agentic payments](AGENTIC-PAYMENTS.md).

```ts
const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, Networks.TESTNET);
const { signedAuthEntry, signerAddress, error } = await wallet.signAuthEntry(preimage.toXDR('base64'));
if (error) throw error;
const signature = Uint8Array.from(atob(signedAuthEntry), (c) => c.charCodeAt(0));
const signed = await authorizeEntry(
  entry,
  async () => (isContract ? { signatureScVal: xdr.ScVal.scvBytes(signature) } : { signature, publicKey: signerAddress }),
  expirationLedger,
  Networks.TESTNET,
);
```

`sdk/preimage.ts` in the SDK and `src/preimage.rs` in the bridge apply the same checks to each preimage:

1. Canonical Base64 XDR of 32768 characters or fewer.
2. Type `envelopeTypeSorobanAuthorizationWithAddress`. V1 fails, because it permits cross-address replay (CAP-71-02).
3. The network ID of the tunnel network.
4. The bound address is the selected G-address or a C-address.
5. At most 256 invocation contexts and 32 levels.
6. A set expiration. Expiration ledger 0 fails. No check reads a ledger, and the network enforces expiry.

A preimage does not show the credential variant, the final signature format, account policy, or the transaction.
These gaps add no authority. The signature approves one tree for one address, network, nonce, and expiry.

A connected website can relay a SEP-45 challenge. The network ID limits this risk to services on the tunnel network, a test network.

### Adapter signing extension

`signAuthorization(entryXdr, { address, adapter })` keeps the `account`, `contract-ed25519`, and `openzeppelin-ed25519` adapters.
It signs a complete unsigned AddressV2 entry and returns `{ signedAuthEntryXdr, signerAddress }`.
The OpenZeppelin digest differs from the preimage hash, so SEP-43 cannot carry it.
This path uses `sdk/authorization.ts`. The authorization entry shape of `walleterm sign` has the same adapters.

```ts
const result = await wallet.signAuthorization(authEntryXdr, {
  address: contractId,
  adapter: { type: 'contract-ed25519' },
  networkPassphrase: Networks.TESTNET,
  signal,
  onProgress,
});
// result: { signedAuthEntryXdr, signerAddress }, or empty fields with error.
```

`address` identifies the authorization address. `signerAddress` identifies the selected G-key.
Omitting `adapter` selects `{ type: 'account' }`. The SDK copies the adapter before asynchronous work.
No check reads a ledger. The network enforces expiry. Expiration ledger 0 fails.

### Authorization helpers

`sdk/walleterm.ts` and `sdk/authorization.ts` export these helpers:

- `createAuthEntry({ address, invocation, nonce, expirationLedger })` returns Base64 XDR with AddressV2 credentials.
- `setAuthEntryExpiration(authEntryXdr, expirationLedger)` sets expiry on an unsigned AddressV2 entry.
- `parseAuthEntry(authEntryXdr)` returns the canonical, bounded XDR entry.
- `addressCredentials(entry)` returns explicit V1 or V2 address credentials without conversion.
- `countAuthContexts(invocation)` counts the complete bounded invocation tree.
- `inspectAuthEntry(input, selectedPublicKey)` validates the request and computes the digest.
- `attachAuthSignature(input, publicKey, signatureHex)` verifies and attaches one signature.
- `verifyAuthEntrySignature(input, signedAuthEntryXdr)` returns `true` or throws.

`input` contains the five entry shape fields: `auth_entry_xdr`, `network_passphrase`, `public_key`, `address`, and `adapter`.
These helpers do not contact an RPC server or a signer.
The helpers can parse a V1 entry, because a transaction can carry signed V1 entries from other signers.
They never create, rebuild, or sign a V1 entry.

### Result verification

Each SDK signing method verifies the returned artifact before it exposes it.
Transaction verification binds the complete requested body, network hash, selected G-key, signature hint, and one valid envelope signature.
A failed verification after a signed response reports code `-1` with `requestState: "unknown"`.
The single-session `WalletermClient` throws the same outcome with `canceled: false`.
A missing signed artifact uses the same outcome metadata.
These failures do not prove that signing stopped or that no usable signature exists.
The SDK does not retry signing or claim successful cancellation after these failures.

## 2a. Message signing

`signMessage(message)` signs [SEP-53](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0053.md) text.
The key signs `SHA-256("Stellar Signed Message:\n" || UTF-8 text)`. The bridge computes that digest from the text.
No path accepts a precomputed hash or binary data.

```ts
const { signedMessage, signerAddress, error } = await wallet.signMessage(text);
if (error) throw error;
Keypair.fromPublicKey(signerAddress).verifyMessage(text, Uint8Array.from(atob(signedMessage), (c) => c.charCodeAt(0)));
```

The SDK checks these points before it sends the signing request:

1. `message` is a string, and `message.isWellFormed()` is true.
   `TextEncoder` turns a lone surrogate into U+FFFD, so the signature would cover other text.
2. The text has 1–1024 UTF-8 bytes. The limit counts bytes, not characters.
3. The network is the tunnel network.
4. `opts.address` is absent or the selected G-address.

The SDK checks points 1 and 2 before any request.
A restored session can read `GET /v1/account` before the SDK checks points 3 and 4.

The SDK sends one `message` request. It verifies the result with `Keypair.verifyMessage` before it returns it.
`signedMessage` is the Base64 64-byte signature. `signerAddress` is the selected G-address.
Stellar CLI also verifies it: `stellar message verify "<text>" --signature <Base64> --public-key G...`.

The website approves a message by sending it, as for every request. The tunnel prints the origin, key, byte count, digest, and escaped text before signing.
The line states that the signature has no network, site, or expiry binding.

A SEP-53 signature is a permanent, portable proof that the key approved the text.
It binds no network, origin, nonce, or expiry, unless the text contains them. The 1Password prompt shows no text.
So a connected website, or a compromised script on it, can try these attacks:

1. Login relay. It requests another service's login challenge, then signs in to that service as the user.
2. Key derivation. It requests a fixed text that another application hashes into a private key.
3. Claims. It requests a social-proof or agreement text of its own choice.
4. Replay. It reuses a signature at a consumer that checks no nonce or expiry.

The network rule does not limit a message signature. Connect only dedicated test keys.
Never use a Walleterm key as an identity or a key-derivation source for another service.

## 3. Pairing, switching, and sessions

### Pairing

1. `getAddress()` finds no session and calls its interface, normally `WalletermConnect`.
2. The dialog takes the tunnel URL and code, or a scanned QR code.
3. The SDK connects, lists keys, and asks the dialog for a key.
4. The SDK selects the key and resolves the address. A failed attempt keeps the dialog open.

Without a mounted `WalletermConnect`, `getAddress()` loads the component in dialog-only mode.
Load `walleterm/connect.css` on each page that uses Walleterm.

### Scopes and switching

`walletScope: 'selected'` fixes one key for the connection. It is the least-privilege default.
`walletScope: 'available'` permits changes among the keys shown before the first selection.
`WalletermConnect` uses `available` and explains that grant before selection.
Grant IDs and selection revisions protect against stale results. See [the bridge protocol](BRIDGE-PROTOCOL.md#wallet-scopes).

Kit v2.7.0 defines `ModuleInterface.onChange`, but the Kit core never calls it.
Only the Scopuly module implements it. The Kit updates its address through `authModal()` and `fetchAddress()`.
So `WalletermModule.onChange(callback)` reports each switch with `{ address, network, networkPassphrase }`.
A disconnection or an expired session reports an empty address with a `-3` error.
The hook also reports these changes from other tabs of the website. See [Sessions](#sessions).
A Kit website connects the hook once. It reads the event and acts only while Walleterm is the selected Kit wallet:

```ts
const walletermActive = () => {
  try {
    return StellarWalletsKit.selectedModule.productId === WALLETERM_ID;
  } catch {
    return false; // No Kit wallet is selected.
  }
};
walletermModule.onChange(({ address }) => {
  if (!walletermActive()) return;
  return address ? StellarWalletsKit.fetchAddress() : StellarWalletsKit.disconnect();
});
```

`fetchAddress()` calls the module's `getAddress()`, which returns the new address without a dialog.
`StellarWalletsKit.disconnect()` clears the Kit address. It calls the module's `disconnect()`, which finds no session.
A hook that always calls `fetchAddress()` would open the pairing dialog after every disconnection or expiry.
Both Kit calls use the selected Kit module. Without the guard, a Walleterm event would act on another wallet.
The other wallet could then disconnect, or open its own popup.
Change events run after the switch settles, so a `fetchAddress()` call in the hook reads the new address.

### Sessions

The SDK saves `{ version: 4, url, token, revision }` in `localStorage` under `walleterm:session`.
All tabs of one website share this session. A new tab uses it without a new code.
`revision` only tells other tabs that the wallet changed. Each tab reads the account from the bridge.
After pairing, the wallet owns the session. Destroying `WalletermConnect` does not revoke it.
`storageKey: null` keeps the session in memory only. Each tab then needs its own pairing.
A reload or a new tab checks `GET /v1/account` before it publishes an address.
A 401 removes the saved session only when this tab still holds it. A network failure keeps it.
The token stays in the browser after its tabs close. The bridge still ends it after one hour or at a tunnel restart.

A `storage` event tells each open tab about a change in another tab:

| Change in another tab | Result in this tab |
| --- | --- |
| Pairing | The tab uses the new session. It publishes the address after `GET /v1/account` confirms it. |
| Wallet change | The tab reads `GET /v1/account` and publishes the new address. A change away and back updates the revision only. |
| Disconnection, a 401, or `localStorage.clear()` | The tab discards the session locally and publishes a disconnection. It sends no second revocation. |

A tab can act before it handles an event, for example when the event arrives late.
Each tab records the saved token that it last read or wrote. It changes or removes only that saved session.
When the saved state differs, the tab follows it. It uses a newer session, or it discards its copy of a removed session.
A pairing in the tab replaces any saved session. Storage that cannot be read proves nothing, so the tab then keeps its state.
So an old session's 401 or late confirmation never removes, overwrites, or saves again a session that another tab changed.
After a 401, `getAddress()` reads the newer saved session before it opens pairing.
A signing request with an old selection revision fails with `-3 walleterm:conflict`, and the bridge signs nothing.
The tab then reads `GET /v1/account`, so its next request uses the current wallet.

`onChange` reports confirmed addresses and ended sessions only.
An account that waits for confirmation publishes nothing. An example is the account after a failed wallet change.
So a failed change or another tab's pairing never makes the Kit hook revoke the session.
After a restore, `onChange` always reports the first confirmed state, even a disconnection.
The bridge treats all tabs as one client. A wallet change cancels or withholds the requests of every tab.

## 4. Network

Each tunnel signs for one network: testnet by default, or futurenet or a local network. The tunnel does not sign for mainnet yet.
The `network` field is the Stellar SDK `Networks` key: `TESTNET`, `FUTURENET`, or `STANDALONE`.
`getNetwork()` returns the tunnel network. Without a session, the wallet knows no network, so it returns `-3` `walleterm:not_connected`.
Signing methods default to the tunnel network. Another passphrase returns `-3` before the signing request.
A preimage with another network ID fails, whatever the options say.
`onChange` reports the network with each address. A disconnection reports empty network fields.
The Kit defaults to PUBLIC and sends its own passphrase to each signing call.
A Kit website sets the Kit network to the passphrase from `getNetwork()`.

## 5. Transaction policy

Safety comes from review of each request, not from operation lists. The website does that review.
The bridge keeps only these structural invariants:

| Rule | Decision | Reason |
| --- | --- | --- |
| Network | The tunnel network only | The signature binds the network. |
| Envelope | Canonical V1 or fee-bump XDR. V0 fails. | The bridge must parse and hash exactly what it signs. SDK 17 builds V1. |
| Required signer | The selected key is the transaction source, an operation source, or the fee-bump fee source. Muxed accounts use their base key. | A signature must serve this envelope. It reads account fields only. |
| Existing signatures | Permitted, up to 19. The selected key must not have signed already. | Multi-party signing. The result appends one signature. |
| Time bounds | Optional. A nonzero `max_time` at or before now fails. A fee bump uses its inner bounds. | An expired envelope can never apply. The network enforces every other time bound. |
| Preconditions | Any. | Not an operation rule. |
| Operation types and count | No bridge rule. | Review decides content. |
| Fees | No cap. | A fee cap blocks nothing that a payment cannot do. |
| Embedded authorization entries | Not inspected. | The envelope signature covers them. The network enforces them. |

## 6. Protocol version 4

The QR payload is `{"walleterm":4,"url":"...","code":"...","expires_at":"..."}`. `/api/session` reports `protocol: 4`.

| Route | Contract |
| --- | --- |
| `POST /v1/connect` | `{ code, wallet_scope, protocol: 4 }`. Returns `token`, `connection_id`, `expires_at`, `wallet_scope`, `selection_revision`. |
| `GET /v1/signers` | `signers`, and `grant_id` before an `available` selection. |
| `POST /v1/select` | `{ public_key }`, plus `expected_revision` and the first `grant_id` for `available`. Returns `address`, `network`, `network_passphrase`, `selection_revision`, `expires_at`. |
| `GET /v1/account` | `connection_id`, `address`, `network`, `network_passphrase`, `expires_at`, `wallet_scope`, `selection_revision`. |
| `POST /v1/requests` | `{ id, kind, network_passphrase, address, selection_revision? }` plus `xdr` (`transaction`), `preimage_xdr` (`auth_entry`), `auth_entry_xdr`, `auth_address`, and `adapter` (`authorization`), or `message` (`message`). |
| `GET /v1/requests/:id` | `id`, `kind`, `state`, `hash`, `expires_at`, `error`. A signed request adds `signer_address` and one of `signed_tx_xdr`, `signed_auth_entry`, `signed_auth_entry_xdr`, or `signed_message`. |
| `POST /v1/requests/:id/cancel`, `POST /v1/disconnect` | See [the bridge protocol](BRIDGE-PROTOCOL.md#website-routes). |

Every error is `{ "error": { "code", "message", "ext" } }` with an HTTP status.

## 7. Stellar Wallets Kit module

`walleterm/kit` exports `WalletermModule` and `WALLETERM_ID`.
It uses `moduleType: 'BRIDGE_WALLET'`, as the WalletConnect module does.
`isAvailable()` returns `true` when the page has `window`, `document`, and `fetch`.
A result error becomes a rejection with the same SEP-43 object.
It omits `signAndSubmitTransaction` and `isPlatformWrapper`.

```ts
const wallet = new Walleterm({ walletScope: 'available' });
const walletermModule = new WalletermModule({ wallet });
StellarWalletsKit.init({ modules: [walletermModule, ...others], network: Networks.TESTNET });
new WalletermConnect(header, { wallet }); // Optional header for switching.
```

Kit v2.7.0 saves its active address and selected wallet in `localStorage`. It reads them once, when the page loads.
The Kit has no `storage` listener. An open tab keeps its Kit address until the page changes it.
The shared Walleterm session gives a new tab both the Kit address and a usable session.
The guarded hook keeps open tabs in agreement. Each tab's `Walleterm` follows the other tabs and reports each change.
The hook then updates or clears the Kit in that tab.
`WalletermModule.onChange()` also confirms a restored session once.
A session that ended while no tab was open then clears the restored Kit address.
Another call can find the ended session before the hook connects. The hook then receives that disconnection once.
Without a saved session, the module reports nothing. The Kit keeps a wallet that the website selected.

The module ships here only. Upstream registration would reach future Kit releases, not deployed websites.
It would not remove the tunnel or make Walleterm safe for mainnet.

`fixtures/kit/` pins Kit 2.7.0 in its own package and lockfile. The root package does not depend on the Kit.
Its check type-checks the module against the Kit `ModuleInterface`.
It then drives the real Kit SDK against the Rust bridge in `walleterm-test-host`, with random mock keys:
PUBLIC refusal, pairing, transaction, preimage, and message signing, network, switching, and disconnection.
Run it from the repository root:

```sh
make test-kit
```

`make test-kit` builds the test host and installs the Kit fixture. It type-checks `fixtures/kit/` with `tsc`.
Then it runs `fixtures/kit/check.mts`, `fixtures/kit/tabs.mts`, and `fixtures/kit/live/check.mts`.
`tabs.mts` runs each tab in a worker with its own Kit state and relays storage events between them.
It checks a new tab, signing there, a wallet change, a Kit disconnection, and a session that ended while closed.
CI runs `make test-kit`. The Kit tree adds about 500 MB to the fixture directory only.
`tests/browser/kit.test.ts` covers the module without the Kit.
`tests/browser/tabs.test.ts` covers the shared session with the Rust bridge and separate tab contexts.

## 8. Verification

Offline tests cover each SEP-43 method, each error code, and preimage validation.
They also cover switching events, the absence of operation rules, and the Kit module.
Review each change to the signing path for these points:

- Every rejected request reaches no signer call.
- The bridge signs exactly the validated hash: the transaction hash, `SHA-256(preimage)`, or the SEP-53 digest of the text.
- Request identity binds kind, artifact, signer, network, and adapter fields.
- After signing starts, only an SSH agent failure with no signature reports `-4` and `denied`. Every other ending reports `-1` and `unknown`.
- The SDK verifies each result before it returns it.

`fixtures/kit/live/` serves a loopback acceptance page with the real Kit, `WalletermModule`, and the guarded hook.
`bun fixtures/kit/live/check.mts` checks it offline with mock keys.
The live acceptance steps are in [live tests](LIVE-TESTS.md#sep-43-wallet).

## Deviations from SEP-43

| Item | Walleterm | Reason |
| --- | --- | --- |
| `signMessage` encoding | Base64 of the raw 64-byte signature | SEP-43 prose says hexadecimal. Freighter, its Kit module, and Stellar CLI use Base64. |
| `signMessage` confirmation | The connected website confirms by sending. The tunnel prints the escaped text. | The bridge has no trusted display. Dedicated test keys are required. |
| V1 preimages | Return `-3` | Cross-address replay |
| Networks | One test network for each tunnel | Bridge scope |
| `submit`, `submitUrl` | Return `-3` | The bridge never submits |
| Review | The website approves by sending | Test-network design with dedicated keys |
