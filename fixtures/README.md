# Contract fixtures

Status: built locally on 2026-09-25T15:46:45.830Z. No key was created. No vault was read.
No signature was made. No network state was changed by the build.

## What is here

- `build.sh` fetches OpenZeppelin/stellar-contracts at commit
  `a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640` into `.oz-src/` (one shallow git fetch) and builds
  four example packages with `stellar contract build`. It then builds the two
  local contracts in `contracts/` and writes `wasm/manifest.json`.
- `contracts/` is a small Cargo workspace with two fixture contracts.
- `wasm/` holds the six artifacts and the manifest.
- `.oz-src/` is a build cache. It is not vendored source. Delete it freely.

The OpenZeppelin source is not copied into this repository. The example
package names are `multisig-account-example`,
`multisig-ed25519-verifier-example`, `multisig-threshold-policy-example`,
and `multisig-weighted-threshold-policy-example`.

## Artifacts

| File | Bytes | SHA-256 | Source |
|------|-------|---------|--------|
| `multisig_account_example.wasm` | 41363 | `0c20d69644a16562f98a6be92101d8d95475dd3cbc45923c2a2b5f6a5126f0d0` | OpenZeppelin, pinned |
| `multisig_ed25519_verifier_example.wasm` | 1780 | `875b095d57291172d2f103b02240cdb72bc4157fc0d5ce7dfbc934b1d84209b4` | OpenZeppelin, pinned |
| `multisig_threshold_policy_example.wasm` | 11600 | `9525e49335e2dd8bd6d547980e4273ad47104c2f1d155e49f835c452545bc16a` | OpenZeppelin, pinned |
| `multisig_weighted_threshold_policy_example.wasm` | 14246 | `0e228b679436e405cd96ea5944ec6dfd618ce7b9ae7262864b72e0afaf792ee4` | OpenZeppelin, pinned |
| `walleterm_auth_target.wasm` | 1865 | `04a9a33cd3f56a0f16aca0db6b18e4b624416f3393cfeb1e0ce8bcc0d47fcdf5` | local |
| `walleterm_simple_account.wasm` | 1420 | `87248e34b98c4acc825f68ea8b4666c9e8b89b43ef7cdf86ef9f284ad08a823d` | local |

The OpenZeppelin account wasm differs from the binary committed at
`examples/multisig-smart-account/factory/testdata/multisig_account_example.wasm`
in that repository. The size is equal. The bytes are not. The manifest hash
above is the one the runner uploads.

## Local contracts

### `walleterm_simple_account` (rows C02, C06, C13)

One Ed25519 owner. `__check_auth` verifies a 64-byte signature over the raw
32-byte host `signature_payload`. The signature ScVal is `Bytes(64)`.
`set_owner(new)` rotates the owner and requires the account's own auth.

### `walleterm_auth_target` (rows C01, C06, C07, C08, C09, C10, C11, C12)

- `ping(who, n)`: `who` must authorize. Adds `n` to the counter of `who`.
- `ping2(a, b, n)`: both must authorize.
- `outer(who, inner, n)`: `who` authorizes the root call and the nested
  `inner.ping(who, n)` call. This makes a two-context auth tree.
- `count(who)`: read-only counter used for unchanged-state checks.

## Build and test

```sh
sh fixtures/build.sh                       # rebuilds all six wasm files and the manifest
(cd fixtures/contracts && cargo test)      # 8 unit tests, no network
node tests/contracts.mjs                   # offline self-test of the runner, no agent, no network
```

Toolchain used: `stellar 27.1.0`, `rustc 1.93.0`, target `wasm32v1-none`,
`soroban-sdk 27.0.2` (same major as the pinned OpenZeppelin workspace).

## Runner

`tests/contracts.mjs` exports `runContracts(ctx)` for `tests/live.mjs`.
It uses `ctx.sdk`, `ctx.rpc`, `ctx.networkPassphrase`, `ctx.keys.a/b/c`,
`ctx.signDigest`, `ctx.sign`, `ctx.send`, `ctx.record`, and `ctx.fund`.
Key A pays for every transaction. Keys B and C, and the deployed C-accounts,
sign the auth entries.

- Row selection: `WALLETERM_ROWS=C01,C04 node tests/live.mjs contracts`
  or `ctx.rows`. Default is all rows C01 to C13.
- Deployed ids and finished rows persist in `evidence/live/contracts-state.json`.
  A rerun reuses verified deployments and executes each selected baseline row again.
  The checkpoint binds the network, public keys, source revision, and WASM hashes.
  `C-run-scope` records the selected rows and fresh execution scope.
- C09 is a coverage reference. It is recorded as `covered_by`, not `passed`.
- Every signed entry records its credential variant as returned by the RPC.
  SDK 17.1.0 simulates with `useUpgradedAuth` on, so expect `address_v2`.
  The runner makes no V1 credential claim.
- Positive cases: record simulation, sign each address entry, enforce
  simulation, envelope signature by A, submit, then check the counter.
- Negative cases: enforce simulation must fail with the expected error text.
  The counter must be unchanged. Nothing is submitted.
- An unknown submission status (`NOT_FOUND`, `TRY_AGAIN_LATER`, transport
  timeout) records the row as `blocked` with the transaction hash and stops
  the run. Query that hash before any new submission.
  `pending-submission.json` blocks signing, funding, and submission across process restarts.
  Run `node tests/live.mjs reconcile` to query the original hash without resubmitting.
  Reconciliation clears the block only after `SUCCESS` or `FAILED`.
  Each submission attempt has a separate `submission-UUID.jsonl` archive.

Expected error codes per case are in `ERR` at the top of the runner.
All negative cases assert exact errors. Expiry returns `Error(Auth, InvalidInput)`.
Duplicate or unsorted ScMap keys return `Error(Object, InvalidInput)`.
A missing required signer in the no-policy rule returns `Error(Contract, #3002)`. Signature-binding
cases change both the call arguments and the entry after signing and expect
`Error(Crypto, InvalidInput)`. Tree-mismatch cases change only the entry and
expect `Error(Auth, InvalidAction)`.

## Extended coverage

`node tests/live.mjs extended` passed E01-E03 on testnet.
These rows cover native G multisig, OpenZeppelin delegated G signers, and contract-specific rules.
They also cover threshold updates, rule removal, and nested delegated calls.
The extended runner keeps a separate checkpoint and labels reused evidence `passed_previous_run`.
It preserves account B's original settings and restores them after E01.
The separate `cap71/` fixtures cover native delegated credentials, including nested C-address delegates.
CAP71-01 through CAP71-12 passed on protocol 28 testnet.
See `../docs/PROTOCOL-UPDATES.md` for evidence and diagnostic limits.
The `cap85/` fixtures cover external executable references and account context compatibility.
Passkeys remain outside these Ed25519 claims.
