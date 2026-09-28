# OpenZeppelin Stellar Smart Accounts: Ed25519 signing compatibility

This reference pins source research and testnet acceptance from 2026-09-25.
See [the acceptance summary](../evidence/acceptance-summary.json) for tested account formats and limits.

This document records what the OpenZeppelin `stellar-accounts` crate requires
from an external Ed25519 signer, such as a key in the 1Password SSH agent.
It pins one commit. It separates the library schema from the policy of one
deployed account instance.

## 1. Pinned sources

| Item | Value |
|------|-------|
| Repository | `OpenZeppelin/stellar-contracts` |
| Branch head | `main` at `a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640` (2026-09-18, "better comments to prevent incorrect bug submission (#899)") |
| Later `main` check | `b40c5eaefe6a29f0030f00bd2d730b7a91cce330` (2026-09-26, "chore: bump soroban-sdk to v28 (#866)"), checked 2026-09-28. The accounts package adds the `CreateContractExternalRef` rule type. The digest rule and the `Delegated` path do not change. |
| Workspace version at head | `0.7.1` |
| `soroban-sdk` at head | `27.0.2` with feature `experimental_spec_shaking_v2` |
| Latest tag | `v0.7.2` = `a9c42169000638da937577f592ebf61a7a3c94ca` (`soroban-sdk 26.1.0`) |
| Latest crates.io release | `stellar-accounts 0.7.2`, published 2026-06-09 |
| Local tools used | `stellar 27.1.0 (8e402ea)`, `stellar-xdr 27.0.0`, `gh 2.101.0`, `parallel-cli` |

Base URL for all file citations below:

`https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/`

Files read at the pinned commit:

- `Cargo.toml` (lines 52-57: version and `soroban-sdk` pin)
- `packages/accounts/README.md`
- `packages/accounts/src/smart_account/mod.rs`
- `packages/accounts/src/smart_account/storage.rs`
- `packages/accounts/src/smart_account/test/context_rules.rs`
- `packages/accounts/src/verifiers/mod.rs`
- `packages/accounts/src/verifiers/ed25519.rs`
- `packages/accounts/src/verifiers/test/ed25519.rs`
- `packages/accounts/src/verifiers/webauthn.rs`
- `packages/accounts/src/policies/simple_threshold.rs`
- `packages/accounts/src/policies/weighted_threshold.rs`
- `examples/multisig-smart-account/README.md`
- `examples/multisig-smart-account/account/src/contract.rs`
- `examples/multisig-smart-account/ed25519-verifier/src/contract.rs`
- `examples/multisig-smart-account/threshold-policy/src/contract.rs`
- `examples/multisig-smart-account/weighted-threshold-policy/src/contract.rs`
- `examples/multisig-smart-account/webauthn-verifier/src/contract.rs`
- `examples/multisig-smart-account/factory/src/contract.rs`

Cross-check at the tag:

- `https://github.com/OpenZeppelin/stellar-contracts/blob/v0.7.2/packages/accounts/src/smart_account/storage.rs`
  has the same digest logic at lines 341-354 and 495.

External primary sources:

- Soroban SDK XDR trait: `https://github.com/stellar/rs-soroban-sdk/blob/v27.0.2/soroban-sdk/src/xdr.rs` (lines 34-35, 97-101)
- Stellar auth internals: `https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization#require_auth-implementation-details`
- Auth entry signing: `https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations#auth-entry-structure`
- Pitfalls: `https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations#common-pitfalls-and-gotchas`
- Credentials XDR: `https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction#authorization-data`
- Delegate auth (CAP-71): `https://developers.stellar.org/docs/build/smart-contracts/example-contracts/delegate-auth`
- SSH agent protocol: `https://www.rfc-editor.org/rfc/rfc9987` (`SSH_AGENTC_SIGN_REQUEST`)
- SSH Ed25519: `https://www.rfc-editor.org/rfc/rfc8709` (sections 4, 5, 6)
- Ed25519: `https://www.rfc-editor.org/rfc/rfc8032` (section 5.1.6)
- 1Password agent model: `https://developer.1password.com/docs/ssh/agent/security/`
- 1Password Git signing: `https://developer.1password.com/docs/ssh/git-commit-signing/`

There is no `examples/smart-account` directory at the pinned commit. The
only account example is `examples/multisig-smart-account`. The library and the
example share one `Signature` type.

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

`examples/multisig-smart-account/account/src/contract.rs` line 53 sets
`type Signature = AuthPayload;`. Line 78 calls
`smart_account::do_check_auth(&e, &signature_payload, &signatures, &auth_contexts)`.

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

- Map keys must be in host sort order. The README example uses
  `ScMap::sorted_from` (`packages/accounts/README.md` lines 455-493).
- `context_rule_ids.len()` must equal `auth_contexts.len()`. A mismatch fails
  with error `3014` (`storage.rs` lines 468-470).
- For the Ed25519 verifier, `key_data` is exactly 32 raw bytes and the
  signature is exactly 64 raw bytes. The verifier declares
  `type KeyData = BytesN<32>; type SigData = BytesN<64>;`
  (`examples/multisig-smart-account/ed25519-verifier/src/contract.rs` lines 15-16).
  No SSH wrapper. No prefix.
- The CLI JSON form of the same value is accepted by
  `stellar xdr encode --type ScVal`. Verified locally with `stellar 27.1.0`:

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

The verifier address and key above are the public example values from
`examples/multisig-smart-account/README.md` lines 73-75 and 106. They are
not for production use.

Base64 XDR of that value with a 64-byte all-zero signature (structure check
only, not a valid signature):

```text
AAAAEQAAAAEAAAACAAAADwAAABBjb250ZXh0X3J1bGVfaWRzAAAAEAAAAAEAAAABAAAAAwAAAAAAAAAPAAAAB3NpZ25lcnMAAAAAEQAAAAEAAAABAAAAEAAAAAEAAAADAAAADwAAAAhFeHRlcm5hbAAAABIAAAAB1jwmxMyZ5AEcOd5MznX3bX46rdxyPdPLgrAKozMiv3wAAAANAAAAIDtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdopAAAADQAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

### 2.3 The digest that a signer must sign

Naive assumption, which is wrong for this library: "the signer signs the
32-byte `signature_payload` that the host passes to `__check_auth`."

Correct rule since v0.7.0:

```text
auth_digest = sha256( signature_payload (32 bytes) || XDR( ScVal::Vec [ U32 id_0, U32 id_1, ... ] ) )
```

Evidence: `storage.rs` lines 492-495 build the preimage and hash it. Line 504
passes `auth_digest`, not `signature_payload`, to `authenticate`. Lines
343-352 send `auth_digest` bytes to the verifier as the `hash` argument.
The README states the same rule at `packages/accounts/README.md` lines
495-519 and `examples/multisig-smart-account/README.md` lines 171-213.
`to_xdr` emits the `ScVal` XDR form (`rs-soroban-sdk` `v27.0.2`
`soroban-sdk/src/xdr.rs` lines 34-35 and 97-101).

Exact XDR bytes of the rule id vector, verified with `stellar xdr encode`:

| `context_rule_ids` | XDR hex appended to the 32-byte payload |
|--------------------|------------------------------------------|
| `[0]` | `0000001000000001000000010000000300000000` |
| `[0, 1]` | `00000010000000010000000200000003000000000000000300000001` |

Layout: `00000010` = `SCV_VEC`, `00000001` = option present, then length,
then per element `00000003` = `SCV_U32` followed by the value.

A signature over the raw host payload failed live with `Error(Crypto, InvalidInput)` from the example verifier.
A verifier that returns `false` can produce `3003` (`ExternalVerificationFailed`). The library test
`do_check_auth_rule_selection_downgrade_fails` in
`packages/accounts/src/smart_account/test/context_rules.rs` lines 1142-1206
shows the failure when the ids in the digest differ from the ids in the
payload.

### 2.4 Verification flow

`do_check_auth` (`storage.rs` lines 462-522) runs these steps in order:

1. Reject if `context_rule_ids.len() != auth_contexts.len()` (`3014`).
2. For each context, load the rule by id and validate it
   (`get_validated_context_by_id`, lines 272-330):
   - expired rule: `3002`;
   - type mismatch, unless the rule is `Default`: `3002`;
   - rule without policies: every rule signer must appear in
     `AuthPayload.signers`, else `3002` (lines 322-326);
   - rule with policies: only the intersection is kept as
     `matched_signers` (lines 319-320).
3. Collect all signers of all selected rules. Any `AuthPayload` signer outside
   that set fails with `3016` (lines 500-503).
4. Compute `auth_digest`. Authenticate every provided signature (line 504).
   One failed signature aborts the whole check.
5. Call `enforce` on every policy of every selected rule (lines 508-516).

Ed25519 verification calls
`e.crypto().ed25519_verify(public_key, signature_payload, signature)` and
returns `true` (`packages/accounts/src/verifiers/ed25519.rs` line 37). The
host panics with `Error(Crypto, InvalidInput)` on a bad signature
(`packages/accounts/src/verifiers/test/ed25519.rs` line 41).

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

`validate_no_canonical_duplicates` (`storage.rs` lines 543-585) rejects two
external signers with the same canonical key under one verifier, and two
equal delegated addresses.

## 3. Account instance policy

The deployer chooses these items. They live in contract storage, not in the
crate.

### 3.1 The example account

`examples/multisig-smart-account/account/src/contract.rs` lines 32-41: the
constructor creates one rule of type `Default` named `multisig` with the
given signers and policies. It gets id `0`. More rules can be added later by
the account itself (`SmartAccount::add_context_rule` requires
`e.current_contract_address().require_auth()`).

The README deploy command (`examples/multisig-smart-account/README.md` lines
130-156) installs the simple threshold policy with this install parameter:

```json
{"map":[{"key":{"symbol":"threshold"},"val":{"u32":2}}]}
```

This is `SimpleThresholdAccountParams { threshold: u32 }`
(`policies/simple_threshold.rs` lines 97-102).

The factory example (`examples/multisig-smart-account/factory/src/contract.rs`
lines 76-87, 101-111) derives the account address from
`sha256(XDR((signers, policies, salt)))`. It is optional.

### 3.2 Simple threshold behavior at the pinned commit

- Install rejects `threshold == 0` and `threshold > rule.signers.len()` with
  `3201` (`simple_threshold.rs` lines 352-367).
- Enforce calls `smart_account.require_auth()`, then passes when
  `authenticated_signers.len() >= threshold`, else `3202`
  (lines 184-208).
- `authenticated_signers` is the intersection of rule signers and
  `AuthPayload` signers. Signers outside the rule never reach this point;
  they fail earlier with `3016`.
- A rule with no policy is an N-of-N rule by construction
  (`storage.rs` lines 322-326).

### 3.3 Weighted threshold behavior at the pinned commit

- Install parameter is
  `WeightedThresholdAccountParams { signer_weights: Map<Signer, u32>, threshold: u32 }`
  (`weighted_threshold.rs` lines 148-155).
- Enforce sums the weights of authenticated signers. A signer with no weight
  entry adds 0. Overflow fails with `3212`. A sum below `threshold` fails with
  `3213` (lines 272-288, 315-343).
- `set_threshold` and `set_signer_weight` each enforce
  `threshold <= total weight` on every call (module docs, lines 52-66).

### 3.4 Instance caveats

Policies do not update when signers change. Removing signers can make a
threshold unreachable. Adding signers can silently weaken a threshold
(`packages/accounts/README.md` lines 163-173). The account must call
`set_threshold` through `ExecutionEntryPoint::execute` in the same
transaction as the signer change.

## 4. Envelope hash versus Soroban auth hash

Two different signatures exist. They must not be confused.

**Transaction envelope signature.** A G-address signs the transaction hash.
This authorizes source-account credentials only. It cannot be used by a
C-address ("Wrong signer: C-accounts cannot sign envelopes, only auth
entries", Stellar docs, signing-soroban-invocations pitfalls).

**Soroban auth entry signature.** The host does this for each
`require_auth` by a non-invoker address (Stellar docs, authorization,
"require_auth implementation details"):

1. Match an authorized invocation tree.
2. Verify `signatureExpirationLedger`. Verify and consume `nonce`.
3. Build the preimage, hash it with SHA-256, and call `__check_auth` with
   that 32-byte `signature_payload` and the authorized contexts.

The credential struct is
`SorobanAddressCredentials { SCAddress address; int64 nonce; uint32 signatureExpirationLedger; SCVal signature; }`
(Stellar docs, stellar-transaction, authorization data). The `signature`
field carries the `AuthPayload` `ScVal` from section 2.2.

The OpenZeppelin library adds one more hash on top:
`auth_digest = sha256(signature_payload || ids_xdr)`. The external signer
signs `auth_digest`. It never signs the transaction hash, and it never signs
`signature_payload` directly.

### 4.1 Protocol 28 address-v2 preimage

The local `stellar-xdr 27.0.0` defines two auth preimage arms:

- `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION` with
  `{ Hash networkID; int64 nonce; uint32 signatureExpirationLedger; SorobanAuthorizedInvocation invocation; }`
- `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS` with
  `{ Hash networkID; int64 nonce; uint32 signatureExpirationLedger; SCAddress address; SorobanAuthorizedInvocation invocation; }`

The live protocol 28 tests returned `sorobanCredentialsAddressV2` for G-account and C-account authorization.
SDK 17.1.0 `authorizeEntry` selected the `WITH_ADDRESS` preimage. These signatures passed live verification.
Legacy address credentials use the other arm.
An independent installed-CLI test passed one OpenZeppelin multisig call with legacy `address` credentials.
That result does not establish coverage for every legacy account format.
OpenZeppelin consumes the resulting 32-byte host payload, then applies its additional hash.

## 5. Signer roles: G-address versus C-address

| Role | Library path | What the 1Password key signs | Extra auth entry |
|------|--------------|------------------------------|------------------|
| `Signer::External(ed25519_verifier, pubkey32)` | verifier contract call (`storage.rs` lines 343-352) | `auth_digest`, 64-byte raw Ed25519 signature in the map | none |
| `Signer::Delegated(G-address)` | `addr.require_auth_for_args((auth_digest,))` (`storage.rs` lines 353-356) | a nested auth entry for the G-address | yes, and simulation does not return it (`packages/accounts/README.md` line 95) |
| `Signer::Delegated(C-address)` | same as above | a nested auth entry in that contract's own `__check_auth` format (section 13) | yes, and simulation does not return it |

Recommendation for the companion: use `Signer::External` with the shared
Ed25519 verifier. It needs one auth entry and one raw signature. The same
32-byte public key also defines the G-address of the key, so one 1Password
item can serve both roles.

## 6. Nested auth

- `auth_contexts` has one entry per `require_auth` call that the account
  must authorize. `context_rule_ids` must have the same length.
- A `Default` rule matches any context. A `CallContract(addr)` rule matches
  only calls to `addr`. A `CreateContract(wasm)` rule matches only
  deployments of that wasm (`storage.rs` lines 288-314).
- The library uses `require_auth_for_args` for delegated signers. It does
  not use the CAP-71 `AddressWithDelegates` credentials that `soroban-sdk`
  v27 added (Stellar docs, delegate-auth example).

## 7. WebAuthn verifier source notes

From `packages/accounts/src/verifiers/webauthn.rs` and the example verifier:

- `key_data` = 65-byte uncompressed secp256r1 key, then an optional
  credential id (`examples/multisig-smart-account/webauthn-verifier/src/contract.rs`
  lines 14-18, 60-61). Total must stay within 256 bytes.
- `sig_data` = XDR of `WebAuthnSigData { signature: BytesN<64>, authenticator_data: Bytes, client_data: Bytes }`
  (`webauthn.rs` lines 92-101).
- `client_data` max 1024 bytes. `authenticator_data` min 37 bytes. Flags
  `UP` (0x01) and `UV` (0x04) must be set. `BS` without `BE` is rejected
  (lines 34-46, 320-347).
- `type` must be `webauthn.get`. `challenge` must equal base64url of the
  32-byte `auth_digest` (lines 151-163).
- Origin and rpId are not checked (lines 8-15).

Passkeys and WebAuthn signing are not planned and are out of scope.
The notes above record the pinned verifier source only.

## 8. 1Password SSH agent boundary

Verified from primary sources:

- `SSH_AGENTC_SIGN_REQUEST` carries `key blob`, `data`, `flags`. The agent
  signs `data` and returns `SSH_AGENT_SIGN_RESPONSE` with `signature`
  (RFC 9987).
- `ssh-ed25519` signs per RFC 8032 section 5.1.6, so the message is the raw
  `data` with no pre-hash (RFC 8709 section 5).
- The response is `string "ssh-ed25519"`, `string <64-byte signature>`
  (RFC 8709 section 6). The public key blob is `string "ssh-ed25519"`,
  `string <32-byte key>` (RFC 8709 section 4).
- The 1Password agent asks for approval per process session, or per request
  when configured so. Keys never leave 1Password
  (1Password agent security page).

The live signing proof verified a signature over 32 arbitrary bytes from the 1Password agent.
The local `evidence/1password-feasibility.json` records the payload and independent verification.
Git excludes raw run evidence; see [the evidence index](../evidence/README.md).

Mapping for the companion:

1. Read the `ssh-ed25519` public blob. Take the 32-byte key. Derive the
   G-address with StrKey. Use the same 32 bytes as `key_data`.
2. Send the 32-byte `auth_digest` as `data`. Take the 64 bytes after the
   `"ssh-ed25519"` string from the response.
3. Put the 64 bytes in `AuthPayload.signers` under the `External` key.

## 9. Minimal integration boundary

1. `stellar contract invoke ... --build-only` produces the envelope XDR.
   Simulation returns the auth entry for the C-address with
   `signature: void`.
2. The caller computes `signature_payload` from the preimage (section 4.1), then `auth_digest` (section 2.3).
3. The caller asks `walleterm` to sign `auth_digest` through the 1Password agent.
4. The companion builds the `AuthPayload` `ScVal` (section 2.2), sets it in
   `SorobanAddressCredentials.signature`, sets `nonce` and
   `signatureExpirationLedger`, and re-simulates in enforce mode
   (`--auth-mode enforce`).
5. The fee payer signs the envelope hash with `walleterm sign`.
   The helper inserts the signature, then submits with `stellar tx send` or the official SDK.

`stellar tx sign` signs G-address auth entries only. It cannot build
`AuthPayload`. Step 4 is custom code.

## 10. Bounded test plan

Local tests, no 1Password, no network:

- Encode the `AuthPayload` JSON from section 2.2 with
  `stellar xdr encode --type ScVal`. Decode it back. Compare.
- Sign a fixed `auth_digest` with a throwaway Ed25519 key in Rust or the CLI.
  Run `do_check_auth` with `context_rule_ids = [0]`. Expect success.
  Swap to `[1]` without re-signing. Expect `3003`.
- Sign the raw host payload instead of `auth_digest`. Expect a verifier failure. This
  test documents the naive-signing failure.

Live 1Password tests, no network:

- Send a 32-byte value through the agent socket. Record the prompt. Verify
  the 64-byte signature locally with the 32-byte public key.
- Send the same value twice. Confirm two identical or two valid signatures
  (Ed25519 is deterministic per RFC 8032).

Testnet acceptance, dedicated testnet keys only:

- Deploy the Ed25519 verifier, the simple threshold policy, and the account
  per `examples/multisig-smart-account/README.md`.
- 2-of-3 with two 1Password keys: expect success. Record the hash and ledger.
- 1-of-3: expect `3202`.
- A no-policy rule missing its required signer returned `3002` in C10.
- An extra signer outside otherwise satisfied rules can reach `3016`.
- Two contexts with one rule id: expect `3014`.
- One `Delegated(G-address)` signer with a hand-built nested entry: expect
  success. This proves the second auth entry path.

## 11. Unresolved items

- The independent installed-CLI run passed one legacy V1 OpenZeppelin multisig call.
- E01-E03 passed native G multisig, OpenZeppelin delegated G signers, and context-specific rule updates.
- These OpenZeppelin delegation results use `require_auth_for_args`, not native CAP-71 delegate credentials.
- See `PROTOCOL-UPDATES.md` for the subsequent native CAP-71 and CAP-85 compatibility work.
- Passkeys and WebAuthn are not planned and are out of scope. Section 7 keeps the verifier source notes only.
- `Delegated` C-address signers remain untested. Section 13 records the assessment.

## 12. Generic authorization API

The new `openzeppelin-ed25519` adapter uses the commit pinned in section 1.
It supports one external Ed25519 signer per request.
It requires `verifier` and `context_rule_ids`, with one rule ID per invocation context.
It signs `sha256(host_payload || XDR(ScVal::Vec<U32>))`.
It builds the exact `AuthPayload` map from section 2.2.
The adapter does not infer rule IDs, verifier ownership, or deployed account policy.
The website must verify those facts and enforce-simulate the result.

New signing APIs require AddressV2 credentials, including native G-account requests.
Legacy V1 omits the authorization address from its digest and permits cross-address replay.
The new API rejects V1 without conversion. Existing legacy fixtures remain unchanged.
The API also rejects delegated credentials and SourceAccount entries.
Normal SourceAccount authorization remains valid inside generic Soroban transaction envelopes.

Request identity includes every adapter field, including the verifier address.
The verifier address does not enter the OpenZeppelin digest.
Exact returned-artifact verification therefore checks the complete signature map as well as the signature.
This validation cannot stop a signature holder from constructing another artifact that contract policy accepts.

### Live acceptance runner

`tests/openzeppelin-auth-live.ts` prepares live acceptance for this adapter. It has not run yet.
It uses the existing `oz_basic_a` account from the 2026-09-25 acceptance run. It deploys nothing.
Rule 0 of that account holds one `External` Ed25519 signer: the dedicated key `walleterm-v2-test-a`.
The runner reads the contract IDs from `live/contracts-state.json` beside the metadata file.
Before any signing request, it checks the live code hashes, the rule count, and the complete rule 0.
It record-simulates one `ping` call on `auth_target_1` and builds the expected entry locally.
Any difference stops the run before the signing request.

The runner signs once with `walleterm sign-auth` and once with the SDK `signAuthEntry` through a local bridge.
It recomputes each digest with the SDK preimage helper and the acceptance-suite digest rule.
It rebuilds each returned `AuthPayload` independently and verifies the signature.
Then it enforce-simulates, submits through the shared submission guard, and checks that the counter increased by one.

Three negative controls reuse the signed entry. They request no signature, and the runner never submits them.
Enforcing simulation must reject each control with the listed error.

| Control | Change | Required error |
|---------|--------|----------------|
| `missing-authorization` | No authorization entry | `Error(Auth, InvalidAction)` |
| `wrong-context-rule-id` | `context_rule_ids` of `[1]` with the same signature | `Error(Contract, #3000)` |
| `changed-invocation` | Call and root use `n = 2` with the same credentials | `Error(Crypto, InvalidInput)` |

The account has one rule. The wrong-rule control therefore shows a rule lookup failure.
It does not show digest binding between two live rules.
Offline tests in `tests/openzeppelin-auth-live.test.ts` cover the validation and control paths with mock keys.

```sh
WALLETERM_BINARY=/isolated/prefix/bin/walleterm \
  bun --no-env-file tests/openzeppelin-auth-live.ts /path/to/public-test-keys.json
```

The runner writes `evidence/openzeppelin-auth-live/events.jsonl`, `summary.json`, and submission journals.
It stops on an uncertain result and preserves the journals.

## 13. `Delegated` C-address signers

This assessment is from 2026-09-28. It covers the pinned commit and `main` at `b40c5ea`.
Both commits use the same code path.

### Required signing artifact

For a `Delegated` signer, `authenticate` calls `addr.require_auth_for_args((auth_digest,))`.
See `storage.rs` lines 353-356 at the pinned commit and lines 358-360 at `b40c5ea`.
The host then requires a separate authorization entry for the delegate address.
Its root invocation is `<account>.__check_auth(auth_digest)` with no sub-invocations.
It has its own nonce and expiration ledger. Recording simulation does not return it.
For a C-address delegate, the host calls the delegate's own `__check_auth` for that entry.
The delegate signs its own host payload in its own format.
For example, the Walleterm fixture account signs the raw payload. An OpenZeppelin delegate signs its own `auth_digest`.
The outer `AuthPayload` holds `Delegated(C-address)` with empty signature bytes. The library ignores those bytes.

### Current coverage

`walleterm sign-auth` can sign the nested entry mechanically.
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
3. Require AddressV2 credentials and a bounded expiry for both entries.
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
- Account policy: the signer makes no network calls. The caller must read the rule and enforce-simulate.

### Recommendation

Do not implement this adapter now.
The change is not small. It adds a second request shape, a new review display, and a new live deployment.
The practical value is low for a single-key signing companion.
An `External` Ed25519 signer gives the same key-to-account control with one entry and one signature.
Native CAP-71 delegation is a separate path. `PROTOCOL-UPDATES.md` records its fixture tests.
Revisit this adapter when a user account lists a `Delegated` C-address signer.
Until then, do not sign a `__check_auth` root without recomputing its digest from the outer entry.
