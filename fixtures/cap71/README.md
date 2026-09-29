# CAP-71 acceptance fixtures

These contracts are immutable test fixtures. Do not use them as production accounts.
The isolated workspace pins `soroban-sdk = 27.0.2`. `Cargo.lock` pins all dependencies.
The adapter uses the JavaScript SDK `17.1.0`.

## Contracts

- `cap71-delegate` in `delegate/`: immutable address weights and a positive threshold. Unknown and empty delegates fail.
- `cap71-raw-account` in `raw-account/`: immutable Ed25519 owner. Two instances use the same public key for address-binding tests.
- `cap71-target` in `protected/`: `ping(who, n)` updates a counter. Authorization arguments contain only `n`.

The target deliberately omits `who` from the authorization arguments.
Thus, the cross-account tests isolate the credential address binding.
Delegate arrays must follow the host's strict address order.
The account validates every supplied delegate before calling `delegate_auth`.
It authenticates all supplied delegates, including delegates beyond the threshold.

## Offline checks

Run these commands from the repository root:

```sh
cargo test --offline --locked --manifest-path fixtures/cap71/Cargo.toml --workspace
cargo build --offline --locked --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none
bun test tests/cap71.test.ts
```

Rust tests exercise the local protocol-27 host with isolated mock keys.
They verify native `C→G`, `C→C→G`, address substitution, and same-key `address_v2` rejection.
They also check membership, thresholds, extra invalid signatures, ordering, expiry, and nonce reuse.
Bun tests verify SDK tree construction, signing records, error reasons, checkpoints, and mocked adapter execution.
These tests do not prove protocol-28 testnet acceptance.

## Live runner

`tests/cap71.ts` exports `runCap71(ctx)`.
It uses the `sdk`, `rpc`, `keys`, `networkPassphrase`, `record`, `signPreimage`, `sign`, `send`, and `assertClear` fields.
`signPreimage` sends the address-bound preimage to `walleterm sign`. A delegate signs the preimage of the top-level address.
Tests can override the checkpoint path with `ctx.cap71Checkpoint`.
The normal checkpoint is `evidence/live/cap71-state.json`.
Run this command after review and live authorization:

```sh
bun tests/live.ts cap71
```

| Row | Acceptance |
| --- | --- |
| CAP71-01 | Native C→G, either A or C |
| CAP71-02 | Two-of-two A+C, single delegate rejected |
| CAP71-03 | Weighted A=2/C=1, threshold=2 |
| CAP71-04 | C→C→G, empty and underweight nested delegates |
| CAP71-05 | Unauthorized B alone and beside authorized A |
| CAP71-06 | Empty root delegates; present G delegate with an empty signature vector |
| CAP71-07 | Duplicate root and nested delegate addresses |
| CAP71-08 | Unordered root and nested delegate addresses |
| CAP71-09 | Expired authorization |
| CAP71-10 | Confirmed authorization replay |
| CAP71-11 | Native same-signer root account substitution |
| CAP71-12 | Same-key address_v2 cross-account replay, with valid controls |

CAP71-01 through CAP71-12 passed on protocol 28 testnet with the earlier signer.
[The protocol record](../../evidence/protocol-acceptance.json) holds the transaction hashes and limits.
CAP71-07 and CAP71-08 returned only `Error(Auth, InvalidInput)`. The RPC gave no diagnostic reason.
Thus, the duplicate case proves that the host rejects the invalid array. It cannot show whether duplication or order caused the rejection.

All state-changing calls use enforce simulation before envelope signing.
Before auth signing, the adapter requires the exact `target.ping([u32(1)])` authorization root and an empty subtree.
Unknown row IDs fail before RPC access or checkpoint changes.
Negative cases stop after rejected enforce simulation and verify unchanged counters.
Each signature request records its preimage, digest, address, credential type, expiration, and protocol.
Successful calls preserve the signed envelope, authorization XDR, transaction hash, ledger, and counter change.
No test changes A, B, or C account configuration.

The adapter uploads three WASM files and creates seven isolated contract instances.
Deployment salts persist before use. Completed steps persist before further reads.
Checkpoint writes use an atomic rename and filesystem synchronization.
Corruption, binding changes, and unresolved steps stop the adapter.
The shared submission guard retains its own gate and append-only submission evidence.
Neither mechanism resubmits an unknown transaction.
If `inflight` remains, the parent must reconcile that original hash and review the checkpoint explicitly.
Clearing the shared gate alone does not clear the adapter checkpoint.
After a long pause, a saved replay source can expire. This causes a failure, not a passing replay result.
For recovery, first resolve every pending submission by its original hash.
Preserve the checkpoint under a unique archive name before any manual change.
For an expired source, remove that source label from both `steps` and `checks` in the working checkpoint.
Use `CAP71-replay-source`, `CAP71-substitution-source`, or `CAP71-v2-source` for rows 10, 11, or 12 respectively.
Then rerun only that incomplete row after parent review and live authorization.
Never remove a successful row or an unresolved `inflight` entry to force a retry.

## Primary sources

- [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-01.md): native delegation and sorted, unique delegate arrays.
- [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md): address-bound authorization credentials.
- [Delegate Auth example](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/delegate-auth): membership and empty-delegate checks.
- [CustomAccount 27.0.2](https://docs.rs/soroban-sdk/27.0.2/soroban_sdk/struct.CustomAccount.html): `get_delegated_signers` and `delegate_auth`.

The official example was read through Stellar Raven on 2026-09-25.
Local `soroban-env-host 27.0.1` supplies the tested host behavior.
