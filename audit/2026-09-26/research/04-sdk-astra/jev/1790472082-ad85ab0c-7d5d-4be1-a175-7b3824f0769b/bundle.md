# Evidence for: What does SEP-43 require for Stellar browser wallet signTransaction inputs, outputs, and wallet discovery? Use the primary specification.

Contents (section: first line):
- Rank 1: js-stellar-sdk v16.2.0: line 6

## Rank 1: js-stellar-sdk v16.2.0
url: https://github.com/stellar/js-stellar-sdk/releases/tag/v16.2.0 | scope: research_chunk | date: 2026-07-29 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/04-sdk-astra/jev/1790472082-ad85ab0c-7d5d-4be1-a175-7b3824f0769b/search-documents/0019.txt

## [v16.2.0](https://github.com/stellar/js-stellar-sdk/compare/v16.1.0...v16.2.0)

### Added
- `rpc.Server.simulateTransaction` accepts an optional `useUpgradedAuth` flag, and `contract.AssembledTransaction` accepts it as a method option (`useUpgradedAuth`) or per-call (`tx.simulate({ useUpgradedAuth: true })`). When set, RPC simulation records v2 address credentials (CAP-71) instead of the legacy v1 credentials. It only affects the recording auth modes and is silently ignored on hosts that cannot emit v2 credentials. The flag is deprecated from the start: it is transitional and becomes a no-op once the network returns v2 credentials by default (protocol 28) ([#1562](https://github.com/stellar/js-stellar-sdk/issues/1562)).
- `@stellar/stellar-sdk/base` subpath export: import offline primitives like `StrKey` and `Keypair` without loading Horizon, RPC, or the SEP helpers and their networking dependencies ([#1550](https://github.com/stellar/js-stellar-sdk/pull/1550)).
- `authorizeEntry` / `authorizeInvocation` signing callbacks now receive the 32-byte signing payload (`hash(preimage.toXDR())`) as a second argument alongside the preimage, so signers — including HSMs and remote signers that only accept a digest — never have to re-derive it. Existing single-argument callbacks are unaffected ([#1532](https://github.com/stellar/js-stellar-sdk/issues/1532)).
- `authorizeEntry` / `authorizeInvocation` now support non-Ed25519 signers: the signing callback may return `{ signatureScVal: xdr.ScVal, address?: string }`, and the given `ScVal` is written verbatim as the credentials' signature — no Ed25519 verification, no `{public_key, signature}` map, no `scvVec` wrapping. This lets smart-wallet / custom-account contracts (whose `__check_auth` expects its own signature structure) use the helper instead of hand-rolling preimage construction and credential assembly. The optional `address` routes the signature to a specific credential node, like `forAddress` ([#1530](https://github.com/stellar/js-stellar-sdk/issues/1530)).
- `contract.Signer`: an interface pairing an `address` with the SEP-43 `signTransaction` and optional `signAuthEntry` methods, plus `contract.KeypairSigner`, a `Keypair`-backed implementation. The `signTransaction` and `signAuthEntry` options — on `ClientOptions`, `MethodOptions`, and `AssembledTransaction`'s `sign` / `signAndSend` / `signAuthEntries` — now accept a `Signer` or a bare `Keypair` in addition to a callback. Adds the `contract.SignTransactionLike` and `contract.SignAuthEntryLike` types. When `signAuthEntries` gets a `Signer` or `Keypair`, its default target `address` is now the signer's own address rather than `publicKey`. Existing callbacks work unchanged; one type-only caveat: the option fields are no longer plain function types, so derive callback shapes from `contract.SignTransaction` / `contract.SignAuthEntry` instead of the option field ([#1567](https://github.com/stellar/js-stellar-sdk/pull/1567)).
- `contract.Spec` now reads SEP-48 event declarations: `events()` and `findEvent(name, occurrence?)` list a contract's declared events, `parseEvent(topics, data)` decodes a fired event into `{ name, data }`, with topic-carried params merged into `data` (returns `undefined` when nothing matches), and `eventTopicFilter(name, topicValues?, occurrence?)` builds a `getEvents` filter row, with `"*"` for any topic param left unset. Generated client bindings gain a typed `<Name>Event` interface per event, a `ContractEvent` union, a `parseEvent()` method, and per-event `<name>EventFilter()` methods. A contract may declare the same event name more than once (composed modules each emitting their own `transfer`); each declaration gets its own interface and filter method, and `occurrence` — a 0-based index in declaration order — selects among them. Generated names receive a numeric suffix when needed to avoid a collision, and `stellar-sdk bindings` warns about duplicate declarations and renames. Adds the `contract.ParsedEvent` type ([#1556](https://github.com/stellar/js-stellar-sdk/pull/1556), [#1565](https://github.com/stellar/js-stellar-sdk/pull/1565), [#1572](https://github.com/stellar/js-stellar-sdk/pull/1572)).

### Fixed
- `Spec.scValToNative` now handles contract values typed as `Val`
 (`scSpecTypeVal`) by delegating to the generic `scValToNative` converter,
 mirroring the encoding-side support added in [#1485]. Decoding a response
 containing a `Val`-typed string, symbol, vec, or map — e.g. a struct with a
 `Vec<Val>` field — no longer throws
 `ScSpecType scSpecTypeVal was not string or symbol`; each value decodes to
 its natural native representation (`Address` → string, `u32` → number,
 `Symbol` → string, vecs/maps recurse).
 ([#1551](https://github.com/stellar/js-stellar-sdk/pull/1551))


**Full Changelog**: https://github.com/stellar/js-stellar-sdk/compare/v16.1.0...v16.2.0

