# SEP-43 wallet interface

Status: decided on 2026-09-28. This branch implements it.
Walleterm is pre-1.0. It keeps one current protocol, version 3, and no compatibility paths.
Walleterm is SEP-43 compatible and Stellar Wallets Kit compatible.
After a connection, the Walleterm SDK and its header component drive the interface.

## Summary

- `Walleterm` in `sdk/walleterm.ts` has the SEP-43 methods `getAddress`, `signTransaction`, `signAuthEntry`, `signMessage`, and `getNetwork`.
  They resolve SEP-43 results. A failure resolves empty fields and `error: { code, message, ext }`, as Freighter does.
- `getAddress()` owns pairing. Without a session, it opens the Walleterm dialog.
- `signAuthEntry` signs a CAP-71 address-bound preimage and returns a Base64 Ed25519 signature.
- `signMessage` always returns `-3`. See [future work](#future-work-message-signing).
- The network is testnet only.
- The native SDK keeps wallet switching, both wallet scopes, and the `WalletermConnect` header component.
- The native SDK keeps adapter signing as `signAuthorization`, outside SEP-43.
- The bridge filters no operations. It keeps only structural invariants. An agentic review will decide requests later.
- `walleterm/kit` exports a Stellar Wallets Kit module. No upstream request exists.

## Sources

All sources were read on 2026-09-28.

| Source | Version and evidence |
| --- | --- |
| [SEP-43](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0043.md) | v1.2.1, Draft. File commit `d4d17e6c`. |
| [SEP-53](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0053.md) | v1.0.0, Final. |
| [CAP-71](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071.md), [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-01.md), [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-02.md) | Final, protocol 27. |
| [SEP-45](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0045.md) | v0.1.1, Draft. One abuse case only. |
| [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit/tree/v2.7.0) | v2.7.0, commit `4bdda712`. npm `@creit.tech/stellar-wallets-kit@2.7.0`. |
| [Freighter](https://github.com/stellar/freighter/tree/5.48.0) | Extension 5.48.0, commit `a9409f4d`, with `@stellar/freighter-api` 6.0.1. |
| `@stellar/stellar-sdk` | 17.1.0: `base/auth`, `contract/assembled_transaction`, `contract/signer`, `base/keypair`. |

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
  networkPassphrase?: string; // Default: testnet. Another value fails.
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

These methods never reject. SDK 17.1.0 `AssembledTransaction` and Freighter read `{ ..., error }`.
The SDK types a SEP-43 result as `{ signedTxXdr: string } & { error? }`. Empty strings keep that type.
So a `Walleterm` object is a Stellar SDK `contract.Signer`. Its `address` is an empty string without a session.
`signerAddress` is always the selected G-address. `opts.address` names the signing key.

| Method | Behavior |
| --- | --- |
| `getAddress()` | With a session, it confirms the session through `GET /v1/account`. Without one, it opens pairing. `skipRequestAccess: true` returns `-3 walleterm:not_connected` instead. A closed dialog returns `-4`. |
| `signTransaction()` | It checks the envelope locally, sends one request, and verifies the returned envelope. `submit: true` or `submitUrl` returns `-3`. The bridge never submits. |
| `signAuthEntry()` | Section 2. |
| `signMessage()` | It returns `-3 walleterm:unsupported`. It sends no request. |
| `getNetwork()` | It returns `{ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' }` without a session. |

### Native methods

These methods belong to the Walleterm SDK. Failures throw a `WalletermError` with `code`, `ext`, and `status`.
`WalletermClient` is the single-session client under `Walleterm`. It throws instead of returning results.

| Member | Purpose |
| --- | --- |
| `new Walleterm({ walletScope, sessionStorageKey, ui })` | `walletScope` is `selected` (default) or `available`. |
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
| `-3` | `walleterm:network_unsupported` | The passphrase or preimage network is not testnet. |
| `-3` | `walleterm:address_mismatch` | `opts.address` differs from the selected key, or the key is not a required signer. |
| `-3` | `walleterm:invalid_request` | Malformed, noncanonical, or oversized input. |
| `-3` | `walleterm:unsupported` | `signMessage`, submission, or a V1 preimage. |
| `-3` | `walleterm:conflict` | A stale wallet selection or a reused request ID. |
| `-3` | `walleterm:rate_limited` | A bridge connection or request limit. |
| `-3` | `walleterm:expired` | The request expired before signing. |
| `-4` | `walleterm:rejected` | The user closed the dialog, the website canceled, the session ended, or a review denied the request. |
| `-2` | `walleterm:bridge_unavailable` | The tunnel was unreachable for a call that does not sign. Signing retries until its deadline. |
| `-2` | `walleterm:ledger_unavailable` | The trusted ledger check failed before signing. |
| `-1` | `walleterm:result_unknown` | Signing started and no verified result arrived. `requestState` is `unknown`. |
| `-1` | `walleterm:internal` | Any other failure. |

The bridge stores the error object with each failed request. The SDK returns it unchanged.
An abort sends a cancel request. A confirmed `denied` state returns `-4`. Any other outcome returns `-1` and `unknown`.
The SDK contract client joins `ext` with commas, so `ext` stays an array.

## 2. Authorization

### SEP-43 preimage signing

`signAuthEntry(authEntry)` accepts Base64 `HashIdPreimage` XDR.
It signs `SHA-256(preimage bytes)` and returns the Base64 64-byte signature.
Freighter and SDK `KeypairSigner.signAuthEntry` use the same rule.
`AssembledTransaction.signAuthEntries({ signAuthEntry: wallet })` works for G-address entries.

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

`sdk/preimage.ts` validates each preimage in the SDK and the bridge:

1. Canonical Base64 XDR of 32768 characters or fewer.
2. Type `envelopeTypeSorobanAuthorizationWithAddress`. V1 fails, because it permits cross-address replay (CAP-71-02).
3. The network ID of testnet.
4. The bound address is the selected G-address or a C-address.
5. At most 256 invocation contexts and 32 levels.
6. An expiry 1–120 ledgers after the trusted ledger. The SDK default of 100 ledgers fits.
   The bridge reads the ledger from its fixed RPC endpoint before and after signing.

A preimage does not show the credential variant, the final signature format, account policy, or the transaction.
These gaps add no authority. The signature approves one tree for one address, network, nonce, and expiry.
A mock-key prototype showed the same digest and the same signed entries as the old `account` and `contract-ed25519` adapters.

A connected website can relay a SEP-45 challenge. The testnet network ID limits this risk to testnet services.

### Adapter signing extension

`signAuthorization(entryXdr, { address, adapter })` keeps the `account`, `contract-ed25519`, and `openzeppelin-ed25519` adapters.
It signs a complete unsigned AddressV2 entry and returns `{ signedAuthEntryXdr, signerAddress }`.
The OpenZeppelin digest differs from the preimage hash, so SEP-43 cannot carry it.
This path uses `sdk/authorization.ts`, whose expiry window stays at 60 ledgers.
`walleterm sign-auth` keeps the same adapters.

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
Grant IDs, selection revisions, and stale-result protection stay unchanged.

Kit v2.7.0 defines `ModuleInterface.onChange`, but the Kit core never calls it.
Only the Scopuly module implements it. The Kit updates its address through `authModal()` and `fetchAddress()`.
So `WalletermModule.onChange(callback)` reports each switch with `{ address, network, networkPassphrase }`.
A Kit website connects it once:

```ts
walletermModule.onChange(() => StellarWalletsKit.fetchAddress());
```

`fetchAddress()` calls the module's `getAddress()`, which returns the new address without a dialog.
A disconnection reports an empty address with a `-3` error.
Change events run after the switch settles. The Kit check found that an earlier event failed a `fetchAddress()` call.

### Sessions

The SDK saves `{ version: 3, url, token }` in `sessionStorage` under `walleterm:session`, per tab.
After pairing, the wallet owns the session. Destroying `WalletermConnect` does not revoke it.
`sessionStorageKey: null` keeps the session in memory only.
A reload checks `GET /v1/account` before it publishes an address.
A 401 removes the saved session. A network failure keeps it.

## 4. Network

`getNetwork()` returns testnet without a session.
Signing methods default to testnet. Another passphrase returns `-3` before any request.
A preimage with another network ID fails, whatever the options say.
The Kit defaults to PUBLIC. A Kit website must set `Networks.TESTNET`.

## 5. Transaction policy

Safety comes from review of each request, not from operation lists.
An automated review can use the bridge `review` hook later. It can deny a request with `-4`.
The bridge keeps only these structural invariants:

| Rule | Decision | Reason |
| --- | --- | --- |
| Network | Testnet only | The signature binds the network. |
| Envelope | Canonical V1 or fee-bump XDR. V0 fails. | The bridge must parse and hash exactly what it signs. SDK 17 builds V1. |
| Required signer | The selected key is the transaction source, an operation source, or the fee-bump fee source. Muxed accounts use their base key. | A signature must serve this envelope. It reads account fields only. |
| Existing signatures | Permitted, up to 19. The selected key must not have signed already. | Multi-party signing. The result appends one signature. |
| Time bounds | Required. They are valid now and end within five minutes. A fee bump uses its inner bounds. | They bound signature lifetime and the bridge request expiry. They read no operation. |
| Preconditions | Any, when the time bounds meet the rule. | Not an operation rule. |
| Operation types and count | No bridge rule. | Removed on user direction. |
| Fees | No cap. | A fee cap blocks nothing that a payment cannot do. |
| Embedded authorization entries | Not inspected. | The envelope signature covers them. The network enforces them. |

## 6. Protocol version 3

The QR payload is `{"walleterm":3,"url":"...","code":"...","expires_at":"..."}`. `/api/session` reports `protocol: 3`.

| Route | Contract |
| --- | --- |
| `POST /v1/connect` | `{ code, wallet_scope }`. Returns `token`, `connection_id`, `expires_at`, `wallet_scope`, `selection_revision`. |
| `GET /v1/signers` | `signers`, and `grant_id` before an `available` selection. |
| `POST /v1/select` | `{ public_key }`, plus `expected_revision` and the first `grant_id` for `available`. Returns `address`, `network`, `network_passphrase`, `selection_revision`, `expires_at`. |
| `GET /v1/account` | `connection_id`, `address`, `network`, `network_passphrase`, `expires_at`, `wallet_scope`, `selection_revision`. |
| `POST /v1/requests` | `{ id, kind, network_passphrase, address, selection_revision? }` plus `xdr` (`transaction`), `preimage_xdr` (`auth_entry`), or `auth_entry_xdr`, `auth_address`, and `adapter` (`authorization`). |
| `GET /v1/requests/:id` | `id`, `kind`, `state`, `hash`, `expires_at`, `error`. A signed request adds `signer_address` and one of `signed_tx_xdr`, `signed_auth_entry`, or `signed_auth_entry_xdr`. |
| `POST /v1/requests/:id/cancel`, `POST /v1/disconnect` | Unchanged. |

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

The module ships here only. Upstream registration would reach future Kit releases, not deployed websites.
It would not remove the tunnel or make Walleterm safe for mainnet.

`fixtures/kit/` pins Kit 2.7.0 in its own package and lockfile. The root package does not depend on the Kit.
Its check type-checks the module against the Kit `ModuleInterface`.
It then drives the real Kit SDK against an in-process bridge with random mock keys:
PUBLIC refusal, pairing, transaction and preimage signing, message refusal, network, switching, and disconnection.
Run it from the repository root:

```sh
bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts
bunx tsc --noEmit -p fixtures/kit/tsconfig.json
bun fixtures/kit/check.mts
```

CI does not run this check yet. The Kit tree adds about 500 MB to the fixture directory only.
`bridge/kit.test.ts` covers the module in CI without the Kit.

## 8. Verification

Offline tests cover each SEP-43 method, each error code, and preimage validation.
They also cover switching events, the removed operation rules, and the Kit module.
An independent reviewer checks the signing path before acceptance. Check these points:

- Every rejected request reaches no signer call.
- The bridge signs exactly the validated hash: the transaction hash or `SHA-256(preimage)`.
- Request identity binds kind, artifact, signer, network, and adapter fields.
- No path reports `-4` or `denied` after signing started.
- The SDK verifies each result before it returns it.

Live acceptance needs fresh approval and dedicated testnet keys:

1. Demo: pair, sign and submit a payment, switch wallets, and sign again.
2. Demo: increment the fixture counter through `signAuthEntry`, then `signTransaction`.
3. Kit fixture page with a real 1Password key: `authModal`, `signTransaction`, `signAuthEntries`, switch, and `disconnect`.
4. Zero signature requests for PUBLIC, a V1 preimage, `signMessage`, and `submit: true`.

## Deviations from SEP-43

| Item | Walleterm | Reason |
| --- | --- | --- |
| `signMessage` | Returns `-3` | No network binding and no trusted display |
| V1 preimages | Return `-3` | Cross-address replay |
| Networks | Testnet only | Bridge scope |
| `submit`, `submitUrl` | Return `-3` | The bridge never submits |
| Review | The website approves by sending | Existing testnet design; agentic review is planned |

## Future work: message signing

`signMessage` returns `-3` for now. Review these points before any change.

SEP-53 signs `SHA-256("Stellar Signed Message:\n" || message)`. Freighter returns Base64.

1. No network binding. Every other bridge artifact binds testnet. A message signature works on every network and service.
2. Login relay. A connected website can request another service's login challenge.
3. Key derivation. A connected website can request text that another application uses to derive keys.
4. A compromised script on a connected website gets the same power.
5. SEP-53 requires a clear display or confirmation. The bridge has no trusted display.

Options:

- Per-message confirmation in the tunnel terminal. It shows the Origin, key, full text, and digest.
  Accept UTF-8 text of 1024 bytes or fewer. A timeout denies the request.
- Agentic review of each message, with the same limits.
- Automatic signing with limits. This fails the SEP-53 display rule.

## Decisions

| Question | Decision |
| --- | --- |
| Q1 `signMessage` | Return `-3`. Future work above. |
| Q2 Expiry | 120 ledgers for preimages. |
| Q3 V1 preimages | Reject. |
| Q4 OpenZeppelin | Native `signAuthorization` extension and the CLI. |
| Q5 Switching | Keep both scopes in the native SDK. Report switches through `onChange`. |
| Q6 Sessions | `sessionStorage` by default. |
| Q7 Submission | Return `-3`. |
| Q8 Transactions | No operation filters. Structural invariants only. |
| Q9 Kit module | This repository only. |
| Q10 Kit evidence | Isolated `fixtures/kit/` package. |
| Q11 UI | Keep and extend `WalletermConnect`. `getAddress()` opens its dialog. |
| Inventory 3, 9, 10 | The demo refuses V1 entries. `selected` is a product scope. Older-bridge tolerance is removed. |
