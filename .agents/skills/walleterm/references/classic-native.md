# Classic envelopes and native G-account auth

## Pinned sources

- Stellar CLI `v27.1.0`, commit [`8e402ea28202950b272fbabc34caad4d2f64fe87`](https://github.com/stellar/stellar-cli/tree/8e402ea28202950b272fbabc34caad4d2f64fe87).
- Stellar XDR commit [`68fa1ac55692f68ad2a2ca549d0a283273554439`](https://github.com/stellar/stellar-xdr/blob/68fa1ac55692f68ad2a2ca549d0a283273554439/Stellar-transaction.x).
- Protocol 28 auth preimages at Stellar protocol commit [`9cd703075d87a6ce293752b1532e7b68efe12ae1`](https://github.com/stellar/stellar-protocol/tree/9cd703075d87a6ce293752b1532e7b68efe12ae1/core).

These formats passed dedicated testnet cases on 2026-09-25 with CLI 27.1.0 and protocol 28.
Check current CLI output and network protocol before adapting the examples.

## V1 transaction envelope

1. Build with `stellar tx new <op> --build-only --source-account G...`, or use the relevant build-only contract command.
2. Decode with `stellar tx decode unsigned.xdr` or standard input. The file is positional; `--input` selects a format.
3. Inspect the network, source, sequence, fee, operations, operation sources, and `tx.tx.cond`.
4. If `cond` is `none`, set a suitable finite `max_time` before signing. For time bounds, use `{"time":{"min_time":"0","max_time":"<Unix seconds>"}}`.
5. Re-encode the edited envelope and decode it again. Confirm the exact bounds and every other field before hashing.
6. For a V1 envelope, run `stellar tx hash --network-passphrase "$PASSPHRASE" unsigned.xdr`.
7. Sign that lowercase 64-character digest with the exact authorized G-address.
8. Decode the public key with `stellar strkey decode G...`. Use its last four raw bytes as the eight-character signature hint.
9. Add `{"hint":"<8 hex>","signature":"<128 hex>"}` to `tx.signatures`. Re-encode with `stellar tx encode`.
10. Collect all signatures over the same transaction body. Check each source account's weights and thresholds.
11. Submit with `stellar tx send`. Fetch the result and state before claiming success.

CLI 27.1.0 cannot inject an external signature through `stellar tx sign`. Check the current command before adapting this procedure.
Use decoded envelope JSON and re-encode it. The XDR envelope permits at most 20 signatures.
The envelope digest authorizes transaction and operation sources. It does not replace Soroban auth-entry signatures.
Without time bounds, an envelope can stay valid until its sequence is consumed.

## Native G-account Soroban authorization

1. Simulate the built transaction to collect authorization entries, invocation trees, nonces, and resources.
2. Keep the simulated credential variant, `address` or `address_v2`, unless you deliberately choose the other arm.
3. For `address`, encode `HashIdPreimage.soroban_authorization` with network ID, nonce, expiration ledger, and invocation.
4. For `address_v2`, encode `HashIdPreimage.soroban_authorization_with_address` with those fields and the G-address.
5. Read the latest ledger with `stellar ledger latest` or RPC `getLatestLedger`. Choose a bounded future expiration ledger.
6. Copy the nonce and invocation exactly. Put that same expiration ledger in the preimage and credential.
7. Compute `SHA-256(XDR(HashIdPreimage))`; for example, use `stellar xdr encode --type HashIdPreimage preimage.json | base64 -d | shasum -a 256`.
8. Sign that digest. Put each raw signature in a map with `public_key` bytes32 and `signature` bytes64.
9. Put the maps in the credential `signature.vec`, sorted by increasing raw public key.
10. Re-simulate with `stellar tx simulate --auth-mode enforce`. Then compute and sign the final envelope digest.

CLI 27.1.0 can add a resource fee to the existing fee during repeated simulation. Inspect the final fee and limit before envelope signing.
After confirmation, decode `resultMetaXdr` to check contract return values. RPC `getTransaction` may omit `returnValue`.

The credential shape is:

```json
{"credentials":{"address_v2":{"address":"G...","nonce":"<i64>","signature_expiration_ledger":123,"signature":{"vec":[{"map":[{"key":{"symbol":"public_key"},"val":{"bytes":"<64 hex>"}},{"key":{"symbol":"signature"},"val":{"bytes":"<128 hex>"}}]}]}}},"root_invocation":{"...":"copy from simulation"}}
```

The simulation request sets the variant. SDK 17.1.0 `simulateTransaction` records `address_v2` unless `useUpgradedAuth` is `false`.
Stellar CLI 27.1.0 record simulation returned `address` in a 2026-09-25 check.
Both arms are valid from protocol 27. They carry the same fields, but their preimages differ.
`address_v2` binds the credential address into the payload (CAP-71-02). Sign the preimage for the arm that you submit.
Do not sign an auth entry for the transaction source as if it were a separate non-invoker.
The host requires ordered public keys for multisig auth; see [`account_contract.rs`](https://github.com/stellar/rs-soroban-env/blob/v27.0.0/soroban-env-host/src/builtin_contracts/account_contract.rs).

For `address_with_delegates`, read [CAP-71 delegation](delegation.md).
Other C-account schemas need separate checks. CAP-72 contract signers are not planned and are out of scope.
The [acceptance snapshot](acceptance.md) lists live coverage for each variant.
