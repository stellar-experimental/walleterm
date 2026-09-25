# Pinned OpenZeppelin C-account authorization

This reference describes `OpenZeppelin/stellar-contracts` commit [`a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640`](https://github.com/OpenZeppelin/stellar-contracts/tree/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640).
The workspace reports version `0.7.1` and uses `soroban-sdk 27.0.2` at this commit.
The `v0.7.2` tag is a different source revision. Do not treat this reference as a rule for every OpenZeppelin deployment.

Check the deployed account, verifier, and policy code with [contract code](contract-code.md). Then read the rule and policy state before assembly.
The pinned `multisig_account_example.wasm` file has SHA-256 `0c20d69644a16562f98a6be92101d8d95475dd3cbc45923c2a2b5f6a5126f0d0`.
The pinned Ed25519 verifier WASM file has SHA-256 `875b095d57291172d2f103b02240cdb72bc4157fc0d5ce7dfbc934b1d84209b4`.
The pinned simple threshold policy WASM file has SHA-256 `9525e49335e2dd8bd6d547980e4273ad47104c2f1d155e49f835c452545bc16a`.
The pinned weighted threshold policy WASM file has SHA-256 `0e228b679436e405cd96ea5944ec6dfd618ce7b9ae7262864b72e0afaf792ee4`.
These file hashes came from the 2026-09-25 build manifest. Check the deployed contract code independently.
Other code hashes or policy configurations require their own checks.

## Required `AuthPayload`

The contract's `__check_auth` receives a 32-byte host `signature_payload`.
The credential `signature` is an `AuthPayload` `ScVal` map with these entries:

```text
context_rule_ids -> Vec<U32>, one id for each auth context
signers          -> Map<Signer, Bytes>, raw 64-byte signatures
External signer  -> Vec[Symbol "External", Address verifier, Bytes public_key32]
Delegated signer -> Vec[Symbol "Delegated", Address]
```

Sort map keys in host order. For `External` signers sharing one verifier, use increasing raw 32-byte public keys.
The Ed25519 verifier accepts 32-byte `key_data` and a raw 64-byte signature.
Live tests covered `External` signers and one `Delegated(G-address)` signer with an extra auth entry.

## Digest and order

1. Simulate the call and retain the C-account auth entry, invocation tree, nonce, and credential variant.
   Read the latest ledger and choose a bounded future expiration. Use it in both the preimage and credential.
2. Build the host auth preimage described in [classic and native G auth](classic-native.md). Use the C-address for `address_v2`.
3. Compute `signature_payload = SHA-256(XDR(HashIdPreimage))`.
4. Select one context rule ID for each auth context. Encode those IDs as `ScVal::Vec<U32>`.
5. Compute `auth_digest = SHA-256(signature_payload || XDR(ScVal::Vec<U32>))`.
6. Check the digest deterministically. Compare CLI and SDK encodings of the frozen preimage and rule-ID vector, then recompute both hashes.
7. Sign `auth_digest` with each selected external Ed25519 key. Signatures over `signature_payload` alone fail.
8. Put the same IDs and signatures in `AuthPayload`. Insert it into the auth credential.
9. Re-simulate in enforce mode. Compute and sign the final G-account transaction envelope separately.

Inspect the final envelope fee after enforce simulation. Repeated CLI 27.1.0 simulations can increase it.
For a confirmed return value, decode `resultMetaXdr`; `getTransaction` may not include `returnValue`.

A zero-signature enforce simulation may expose the host payload and verifier digest for comparison.
Treat that output as an optional diagnostic. The deterministic XDR and hash calculation defines the requested digest.

The pinned digest rule appears in [`storage.rs`](https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/packages/accounts/src/smart_account/storage.rs#L492-L504).
For IDs `[0]`, `XDR(ScVal::Vec<U32>)` is `0000001000000001000000010000000300000000`.
Match the serialized IDs to the IDs inside `AuthPayload` exactly.

The example's default rule may have a simple or weighted threshold policy.
Check the live rule, signer set, verifier, threshold, and weights before selecting keys.
A rule without a policy needs every rule signer. Missing one returned `3002` in the 2026-09-25 testnet run.
An extra signer outside the selected rules can fail with `3016`.
Changing signers does not update policy thresholds. Update both in one authorized transaction when required.

The [acceptance snapshot](acceptance.md) lists live coverage at the pinned code.

## Tested delegated G signer

The pinned account calls `delegate.require_auth_for_args((auth_digest,))` inside `__check_auth`.
Place the delegated G-address in `AuthPayload.signers` with empty signature bytes.
Add a separate G-account auth entry rooted at the account's `__check_auth` with `[auth_digest]` arguments.
Use a fresh nonce, a bounded expiration, and the correct preimage for that entry's credential variant.
Sign that entry's host payload with the authorized G-account signers.
Keep the account's rule IDs bound to the original host payload through `auth_digest`.
Live tests accepted both a single context and a nested two-context tree.
Wrong roots, wrong bound digests, and missing delegate entries failed enforce simulation.
This is OpenZeppelin's nested authorization scheme. For CAP-71 delegate credentials, read [CAP-71 delegation](delegation.md).
