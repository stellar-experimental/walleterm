# Classic envelopes and native G-account auth

## Pinned sources

- Stellar XDR commit [`68fa1ac55692f68ad2a2ca549d0a283273554439`](https://github.com/stellar/stellar-xdr/blob/68fa1ac55692f68ad2a2ca549d0a283273554439/Stellar-transaction.x).
- Protocol 28 auth preimages at Stellar protocol commit [`9cd703075d87a6ce293752b1532e7b68efe12ae1`](https://github.com/stellar/stellar-protocol/tree/9cd703075d87a6ce293752b1532e7b68efe12ae1/core).

Check `stellar --version`, the command help, and the network protocol before adapting the examples.

## V1 transaction envelope

1. Build with `stellar tx new <op> --build-only --source-account G...`, or use the relevant build-only contract command.
2. Decode with `stellar tx decode unsigned.xdr` or standard input. The file is positional; `--input` selects a format.
3. Inspect the network, source, sequence, fee, operations, operation sources, and `tx.tx.cond`.
4. Choose the time bounds that the grant needs. Walleterm refuses only a nonzero `max_time` at or before now.
   Without time bounds, an envelope stays valid until its sequence is consumed. A finite `max_time` limits that.
   For time bounds, use `{"time":{"min_time":"0","max_time":"<Unix seconds>"}}`, then re-encode and decode again.
5. Send the transaction shape to `walleterm sign`:
   `{"public_key":"G...","network_passphrase":"...","transaction_xdr":"<unsigned XDR>"}`.
6. Compare the returned `digest` with `stellar tx hash --network-passphrase "$PASSPHRASE" unsigned.xdr`.
7. `signed_transaction_xdr` is the same envelope with one appended signature. Send it to the next signer, if any.
   Check each source account's weights and thresholds. The CLI does not check the signer role, so a co-signer can sign.
8. Submit with `stellar tx send`. Fetch the result and state before claiming success.

The XDR envelope permits at most 20 signatures. Walleterm refuses a key that already signed.
The envelope signature authorizes transaction and operation sources. It does not replace Soroban auth-entry signatures.

## Native G-account Soroban authorization

1. Simulate the built transaction to collect authorization entries, invocation trees, nonces, and resources.
2. Use `address_v2` credentials. Walleterm signs only `soroban_authorization_with_address` payloads (CAP-71-02).
   SDK 17.2.0 `simulateTransaction` records `address_v2` unless `useUpgradedAuth` is `false`.
   Other tools can record the legacy `address` arm. Check the credential arm in the simulation result.
3. Choose an expiration ledger, as the skill's authorization rules describe.
4. Put that expiration in the credential. Copy the nonce and invocation exactly from simulation.
5. For one signer that owns the address, send the entry shape with the `account` adapter:
   `{"public_key":"G...","network_passphrase":"...","auth_entry_xdr":"...","address":"<same G...>","adapter":{"type":"account"}}`.
   `signed_auth_entry_xdr` holds the credential `signature.vec` with one `{public_key, signature}` map.
6. For a multisig account, build `HashIdPreimage.soroban_authorization_with_address` with the same fields and the G-address.
   Send it to each co-signer with the preimage shape: `{"public_key":"G...","network_passphrase":"...","preimage_xdr":"..."}`.
   Put each raw `signature` in a map with `public_key` bytes32 and `signature` bytes64.
   Sort the maps by increasing raw public key in the credential `signature.vec`.
7. Re-simulate with `stellar tx simulate --auth-mode enforce`. Then sign the final envelope with the transaction shape.

The credential shape is:

```json
{"credentials":{"address_v2":{"address":"G...","nonce":"<i64>","signature_expiration_ledger":123,"signature":{"vec":[{"map":[{"key":{"symbol":"public_key"},"val":{"bytes":"<64 hex>"}},{"key":{"symbol":"signature"},"val":{"bytes":"<128 hex>"}}]}]}}},"root_invocation":{"...":"copy from simulation"}}
```

Both credential arms are valid from protocol 27. They carry the same fields, but their preimages differ.
The legacy `address` arm omits the credential address from its payload and permits cross-address replay.
Walleterm refuses it. Simulate again with upgraded auth, or rebuild the entry as `address_v2`.
Do not sign an auth entry for the transaction source as if it were a separate non-invoker.
The host requires ordered public keys for multisig auth; see [`account_contract.rs`](https://github.com/stellar/rs-soroban-env/blob/v27.0.0/soroban-env-host/src/builtin_contracts/account_contract.rs).

For `address_with_delegates`, read [CAP-71 delegation](delegation.md).
Other C-account schemas need separate checks.
