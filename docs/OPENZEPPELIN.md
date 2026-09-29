# OpenZeppelin smart accounts: Ed25519 signing

This page states what the OpenZeppelin `stellar-accounts` library requires from an external Ed25519 signer.
The `openzeppelin-ed25519` adapter of `walleterm sign` and the SDK follows it.
Read this page before you change the adapter.
It separates the library schema, which a deployer cannot change, from the rules of one deployed account.

## 1. Pinned source

| Item | Value |
|------|-------|
| Repository | `OpenZeppelin/stellar-contracts` |
| Pinned commit | `a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640` (`main`, 2026-09-18) |
| Workspace version at the pin | `0.7.1`, with `soroban-sdk` `27.0.2` |
| Latest tag | `v0.7.2` = `a9c42169000638da937577f592ebf61a7a3c94ca`, published to crates.io as `stellar-accounts 0.7.2` |
| Later check | `main` at `b40c5eaefe6a29f0030f00bd2d730b7a91cce330` adds the `CreateContractExternalRef` rule type. The digest rule and the `Delegated` path are the same. |

`sdk/authorization.ts` holds the pin as `OPENZEPPELIN_AUTH_COMMIT`. `src/authorization.rs` uses the same schema.
All file citations below are relative to this base URL:

`https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/`

The tag `v0.7.2` has the same digest logic in `packages/accounts/src/smart_account/storage.rs` (lines 341-354 and 495).
The only account example is `examples/multisig-smart-account`. The library and the example share one `Signature` type.

External sources:

- [Soroban SDK XDR trait](https://github.com/stellar/rs-soroban-sdk/blob/v27.0.2/soroban-sdk/src/xdr.rs) (lines 34-35, 97-101)
- [`require_auth` implementation details](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization#require_auth-implementation-details)
- [Authorization entry structure](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations#auth-entry-structure)
- [Signing pitfalls](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations#common-pitfalls-and-gotchas)
- [Authorization data XDR](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction#authorization-data)
- [Delegate authorization (CAP-71)](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/delegate-auth)

## 2. Library schema

The library fixes these items. A deployer cannot change them without a fork.

### 2.1 Rust types

`packages/accounts/src/smart_account/storage.rs`:

```rust
// lines 94-100
pub enum Signer {
    Delegated(Address),
    External(Address, Bytes),   // (verifier contract, public key data)
}

// lines 131-139
pub struct AuthPayload {
    pub signers: Map<Signer, Bytes>,   // signer -> raw signature bytes
    pub context_rule_ids: Vec<u32>,    // one rule id per auth context
}

// lines 141-151
pub enum ContextRuleType {
    Default,
    CallContract(Address),
    CreateContract(BytesN<32>),
}
```

`examples/multisig-smart-account/account/src/contract.rs` line 53 sets `type Signature = AuthPayload;`.
Line 78 calls `smart_account::do_check_auth(&e, &signature_payload, &signatures, &auth_contexts)`.

### 2.2 ScVal encoding of `Signature`

The `signature` field of `SorobanAddressCredentials` must hold this `ScVal`:

```text
ScVal::Map [
  ( Symbol "context_rule_ids" , ScVal::Vec [ U32 id_for_context_0, U32 id_for_context_1, ... ] ),
  ( Symbol "signers"          , ScVal::Map [ ( <Signer ScVal>, Bytes <signature> ), ... ] ),
]

<Signer ScVal> for an external signer:
  ScVal::Vec [ Symbol "External", Address <verifier C-address>, Bytes <key_data> ]

<Signer ScVal> for a delegated signer:
  ScVal::Vec [ Symbol "Delegated", Address <G- or C-address> ]
```

Rules:

- Map keys must be in host sort order. The README example uses `ScMap::sorted_from` (`packages/accounts/README.md` lines 455-493).
- `context_rule_ids.len()` must equal `auth_contexts.len()`. A mismatch fails with error `3014` (`storage.rs` lines 468-470).
- For the Ed25519 verifier, `key_data` is exactly 32 raw bytes, and the signature is exactly 64 raw bytes.
  The verifier declares `type KeyData = BytesN<32>; type SigData = BytesN<64>;` (`examples/multisig-smart-account/ed25519-verifier/src/contract.rs` lines 15-16).
  Neither value has an SSH wrapper or a prefix.
- `stellar xdr encode --type ScVal` accepts the CLI JSON form of the same value:

```json
{"map":[
  {"key":{"symbol":"context_rule_ids"},"val":{"vec":[{"u32":0}]}},
  {"key":{"symbol":"signers"},"val":{"map":[
    {"key":{"vec":[
        {"symbol":"External"},
        {"address":"CDLDYJWEZSM6IAI4HHPEZTTV65WX4OVN3RZD3U6LQKYAVIZTEK7XYAYT"},
        {"bytes":"3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29"}]},
     "val":{"bytes":"<64-byte signature hex>"}}
  ]}}
]}
```

The verifier address and key above are the public example values from `examples/multisig-smart-account/README.md` lines 73-75 and 106.
They are not for production use.

This is the Base64 XDR of that value with a 64-byte all-zero signature.
It checks the structure only. It is not a valid signature. `tests/contracts.ts` checks the same vector.

```text
AAAAEQAAAAEAAAACAAAADwAAABBjb250ZXh0X3J1bGVfaWRzAAAAEAAAAAEAAAABAAAAAwAAAAAAAAAPAAAAB3NpZ25lcnMAAAAAEQAAAAEAAAABAAAAEAAAAAEAAAADAAAADwAAAAhFeHRlcm5hbAAAABIAAAAB1jwmxMyZ5AEcOd5MznX3bX46rdxyPdPLgrAKozMiv3wAAAANAAAAIDtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdopAAAADQAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

### 2.3 The digest that a signer must sign

Do not sign the 32-byte `signature_payload` that the host passes to `__check_auth`.
Since v0.7.0, the signer signs this digest:

```text
auth_digest = sha256( signature_payload (32 bytes) || XDR( ScVal::Vec [ U32 id_0, U32 id_1, ... ] ) )
```

`storage.rs` lines 492-495 build the preimage and hash it.
Line 504 passes `auth_digest`, not `signature_payload`, to `authenticate`.
Lines 343-352 send the `auth_digest` bytes to the verifier as the `hash` argument.
`packages/accounts/README.md` lines 495-519 and `examples/multisig-smart-account/README.md` lines 171-213 state the same rule.
`to_xdr` emits the `ScVal` XDR form (`rs-soroban-sdk` `v27.0.2` `soroban-sdk/src/xdr.rs` lines 34-35 and 97-101).

These are the exact XDR bytes of the rule ID vector:

| `context_rule_ids` | XDR hex appended to the 32-byte payload |
|--------------------|------------------------------------------|
| `[0]` | `0000001000000001000000010000000300000000` |
| `[0, 1]` | `00000010000000010000000200000003000000000000000300000001` |

Layout: `00000010` = `SCV_VEC`, `00000001` = option present, then the length.
Each element is `00000003` = `SCV_U32`, followed by the value.

A signature over the raw host payload fails with `Error(Crypto, InvalidInput)` from the example verifier.
A verifier that returns `false` can produce `3003` (`ExternalVerificationFailed`).
The library test `do_check_auth_rule_selection_downgrade_fails` shows the failure when the IDs in the digest differ from the IDs in the payload.
It is in `packages/accounts/src/smart_account/test/context_rules.rs` lines 1142-1206.

### 2.4 Verification flow

`do_check_auth` (`storage.rs` lines 462-522) runs these steps in order:

1. Reject if `context_rule_ids.len() != auth_contexts.len()` (`3014`).
2. For each context, load the rule by ID and validate it (`get_validated_context_by_id`, lines 272-330):
   - An expired rule fails with `3002`.
   - A type mismatch fails with `3002`, unless the rule is `Default`.
   - For a rule without policies, every rule signer must appear in `AuthPayload.signers`, else `3002` (lines 322-326).
   - For a rule with policies, only the intersection stays as `matched_signers` (lines 319-320).
3. Collect all signers of all selected rules. An `AuthPayload` signer outside that set fails with `3016` (lines 500-503).
4. Compute `auth_digest`. Authenticate every provided signature (line 504). One failed signature stops the whole check.
5. Call `enforce` on every policy of every selected rule (lines 508-516).

Ed25519 verification calls `e.crypto().ed25519_verify(public_key, signature_payload, signature)` and returns `true` (`packages/accounts/src/verifiers/ed25519.rs` line 37).
The host panics with `Error(Crypto, InvalidInput)` on a bad signature (`packages/accounts/src/verifiers/test/ed25519.rs` line 41).

### 2.5 Library error codes

| Code | Name | Source |
|------|------|--------|
| 3002 | `UnvalidatedContext` | `smart_account/mod.rs`, `SmartAccountError` |
| 3003 | `ExternalVerificationFailed` | same |
| 3007 | `DuplicateSigner` | same |
| 3010 | `TooManySigners` | same |
| 3011 | `TooManyPolicies` | same |
| 3013 | `KeyDataTooLarge` | same |
| 3014 | `ContextRuleIdsLengthMismatch` | same |
| 3016 | `UnauthorizedSigner` | same |
| 3200-3203 | `SimpleThresholdError` | `policies/simple_threshold.rs` lines 105-117 |
| 3210-3214 | `WeightedThresholdError` | `policies/weighted_threshold.rs` lines 157-171 |

### 2.6 Library limits

Constants in `packages/accounts/src/smart_account/mod.rs`:

| Constant | Value |
|----------|-------|
| `MAX_SIGNERS` | 15 per context rule |
| `MAX_POLICIES` | 5 per context rule |
| `MAX_NAME_SIZE` | 20 bytes |
| `MAX_EXTERNAL_KEY_SIZE` | 256 bytes |

`validate_no_canonical_duplicates` (`storage.rs` lines 543-585) rejects two external signers with the same canonical key under one verifier.
It also rejects two equal delegated addresses.

### 2.7 Account rules and policies

The deployer sets the context rules, signers, and policies. They live in contract storage, not in the library.
The adapter does not read them. The caller must check the rule IDs and run an enforcing simulation.

## 3. Envelope signature and authorization signature

A transaction envelope signature and a Soroban authorization signature approve different payloads.

A G-address signs the transaction hash for the envelope. This signature authorizes SourceAccount credentials only.
A C-address cannot sign an envelope. It signs authorization entries only.

For each `require_auth` by an address that is not the invoker, the host does these steps:

1. Match an authorized invocation tree.
2. Check `signatureExpirationLedger`. Check and consume `nonce`.
3. Build the preimage, hash it with SHA-256, and call `__check_auth` with that 32-byte `signature_payload` and the authorized contexts.

Walleterm uses the `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS` preimage of `sorobanCredentialsAddressV2`:
`{ Hash networkID; int64 nonce; uint32 signatureExpirationLedger; SCAddress address; SorobanAuthorizedInvocation invocation; }`.
The `signature` field of the credentials carries the `AuthPayload` `ScVal` from section 2.2.
OpenZeppelin then applies its own hash (section 2.3). The external signer signs `auth_digest`.
It never signs the transaction hash, and it never signs `signature_payload` directly.
See [the CLI interface](INTERFACE.md#sign) for the V2 credential rules.

## 4. Signer roles

| Role | Library path | What the 1Password key signs | Extra authorization entry |
|------|--------------|------------------------------|------------------|
| `Signer::External(ed25519_verifier, pubkey32)` | verifier contract call (`storage.rs` lines 343-352) | `auth_digest`, as a 64-byte raw Ed25519 signature in the map | none |
| `Signer::Delegated(G-address)` | `addr.require_auth_for_args((auth_digest,))` (`storage.rs` lines 353-356) | a nested entry for the G-address | yes; simulation does not return it (`packages/accounts/README.md` line 95) |
| `Signer::Delegated(C-address)` | same as above | a nested entry in the delegate's own `__check_auth` format (section 7) | yes; simulation does not return it |

Walleterm supports `Signer::External` with the shared Ed25519 verifier. It needs one entry and one raw signature.
The same 32-byte public key also defines the G-address of the key. One 1Password item can serve both roles.

- `auth_contexts` has one entry for each `require_auth` call that the account must authorize. `context_rule_ids` must have the same length.
- A `Default` rule matches any context. A `CallContract(addr)` rule matches only calls to `addr`.
  A `CreateContract(wasm)` rule matches only deployments of that Wasm (`storage.rs` lines 288-314).
- The library uses `require_auth_for_args` for delegated signers. It does not use the CAP-71 `AddressWithDelegates` credentials.

## 5. Integration with the Stellar CLI

1. `stellar contract invoke ... --build-only` produces the envelope XDR.
   Simulation returns the entry for the C-address with `signature: void`.
2. The caller sets `nonce` and `signatureExpirationLedger` on the unsigned AddressV2 entry.
3. The caller sends the entry to `walleterm sign` with the entry shape and the `openzeppelin-ed25519` adapter.
   Walleterm computes `signature_payload` (section 3), then `auth_digest` (section 2.3).
   It returns `signed_auth_entry_xdr` with the `AuthPayload` `ScVal` (section 2.2), and the raw `signature`.
4. The caller simulates again in enforce mode (`--auth-mode enforce`).
   A multi-signer rule needs one call per signer. The caller merges the raw signatures into one `AuthPayload`.
5. The fee payer signs the envelope with the transaction shape of `walleterm sign`.
   The caller submits `signed_transaction_xdr` with `stellar tx send` or the official SDK.

`stellar tx sign` signs G-address entries only. It cannot build `AuthPayload`.

## 6. The `openzeppelin-ed25519` adapter

The adapter uses the commit pinned in section 1. It supports one external Ed25519 signer per request.
It requires `verifier` and `context_rule_ids`, with one rule ID for each invocation context.
It signs `sha256(host_payload || XDR(ScVal::Vec<U32>))`. It builds the exact `AuthPayload` map from section 2.2.
The adapter does not infer rule IDs, verifier ownership, or the policy of the deployed account.
The website must check those facts and run an enforcing simulation of the result.

Request identity includes every adapter field, including the verifier address.
The verifier address does not enter the OpenZeppelin digest.
So the check of the returned artifact compares the complete signature map as well as the signature.
This check cannot stop a signature holder from building another artifact that the contract policy accepts.

`tests/contracts.ts` checks the section 2.2 vector and the section 2.3 rule ID bytes offline.
`tests/openzeppelin-auth-live.test.ts` covers the live runner's validation and control paths with mock keys.

### Live acceptance runner

`tests/openzeppelin-auth-live.ts` runs live acceptance for this adapter. It deploys nothing.
It uses the `oz_basic_a` account that the contract acceptance suite (`tests/contracts.ts`) deploys.
Rule 0 of that account holds one `External` Ed25519 signer: the dedicated key `walleterm-v2-test-a`.
The runner reads the contract IDs from `live/contracts-state.json` beside the metadata file.

Before each signing request, the runner checks the live code hashes, the rule count, and the complete rule 0.
It runs a recording simulation of one `ping` call on `auth_target_1` and builds the expected entry locally.
Any difference stops the run before the signing request.

The runner signs once with the entry shape of `walleterm sign`. It signs once with the SDK `signAuthorization` through a local bridge.
Each entry expires 200 ledgers ahead.
The runner recomputes each digest and rebuilds each returned `AuthPayload` independently. Then it verifies the signature.
Then it runs an enforcing simulation, submits through the shared submission guard, and checks that the counter increased by one.

Three negative controls reuse the signed entry. The runner never submits them.
It counts 1Password requests and RPC submissions around each control. Both counts must stay zero.
The enforcing simulation must reject each control with the listed error.

| Control | Change | Required error |
|---------|--------|----------------|
| `missing-authorization` | No authorization entry | `Error(Auth, InvalidAction)` |
| `wrong-context-rule-id` | `context_rule_ids` of `[1]` with the same signature | `Error(Contract, #3000)` |
| `changed-invocation` | Call and root use `n = 2` with the same credentials | `Error(Crypto, InvalidInput)` |

The account has one rule. The wrong-rule control therefore shows a rule lookup failure.
It does not show digest binding between two live rules.

The runner writes `openzeppelin-auth-live/` beside the metadata file.
That directory holds `events.jsonl`, `summary.json`, and the submission journals.
The runner stops on an uncertain result and keeps the journals.
See [live tests](LIVE-TESTS.md) for the command.
[The live signing record](../evidence/signing-live-2026-09-28.json) holds the latest result.

## 7. `Delegated` C-address signers

Walleterm does not support `Delegated` C-address signers. This section records what support would need.
The pinned commit and `main` at `b40c5ea` use the same code path.

### Required signing artifact

For a `Delegated` signer, `authenticate` calls `addr.require_auth_for_args((auth_digest,))`.
See `storage.rs` lines 353-356 at the pinned commit and lines 358-360 at `b40c5ea`.
The host then requires a separate authorization entry for the delegate address.
Its root invocation is `<account>.__check_auth(auth_digest)` with no sub-invocations.
It has its own nonce and expiration ledger. A recording simulation does not return it.
For a C-address delegate, the host calls the delegate's own `__check_auth` for that entry.
The delegate signs its own host payload in its own format.
For example, the Walleterm fixture account signs the raw payload. An OpenZeppelin delegate signs its own `auth_digest`.
The outer `AuthPayload` holds `Delegated(C-address)` with empty signature bytes. The library ignores those bytes.

### Current coverage

The entry shape of `walleterm sign` can sign the nested entry mechanically.
That entry is an ordinary unsigned AddressV2 entry for a C-address.
The `contract-ed25519` and `openzeppelin-ed25519` adapters accept a `__check_auth` root.
The request then shows only `__check_auth` and an opaque 32-byte argument.
Walleterm does not build the nested entry. It does not bind that argument to the outer entry.
It does not show the outer action. It does not build an outer `AuthPayload` with a `Delegated` key.
No live test covers a `Delegated` C-address signer.

### Required changes

A safe adapter needs these changes:

1. Add a request field for the unsigned outer entry and its rule IDs.
2. Recompute `auth_digest` from the outer entry. Require the nested root to be exactly `<outer>.__check_auth(auth_digest)`.
3. Require AddressV2 credentials and a set expiration for both entries.
4. Sign the nested entry with one existing adapter. Reject a nested `Delegated` chain.
5. Show the outer address, invocation, and rule IDs in the review.
6. Update the bridge request fields, `docs/INTERFACE.md`, the skill, and the offline tests.
7. Deploy a new test account whose rule holds a `Delegated` C-address signer. Then run live acceptance.

### Security review surface

- Digest binding: an incorrect recomputation lets the key approve an unknown outer action.
- Review: the person must see the outer action, not only the 32-byte digest.
- Replay: each entry has its own nonce. The nested root binds the outer digest, and that digest includes the outer nonce.
- Recursion: a delegate can also use `Delegated` signers. Limit the chain to one level.
- Mixed rules: a rule with `External` and `Delegated` signers needs a multi-signer `AuthPayload`. The current adapter builds one `External` entry only.
- Account policy: the signer makes no network calls. The caller must read the rule and run an enforcing simulation.

### Recommendation

Do not build this adapter until a user account lists a `Delegated` C-address signer.
The change adds a second request shape, a new review display, and a new live deployment.
An `External` Ed25519 signer gives the same key-to-account control with one entry and one signature.
Native CAP-71 delegation is a separate path.
Until then, do not sign a `__check_auth` root without a recomputation of its digest from the outer entry.
