# Test fixtures

| Folder | Contents |
| --- | --- |
| `contracts/`, `wasm/`, `build.sh` | The OpenZeppelin and local contracts for the classic and contract live suites. This file describes them. |
| `cap71/` | Native CAP-71 delegation fixtures. See [the CAP-71 README](cap71/README.md). |
| `cap85/` | CAP-85 external executable fixtures. See [the CAP-85 README](cap85/README.md). |
| `parity/` | Frozen signer vectors and CLI transcripts. See [the parity README](parity/README.md). |
| `kit/` | Offline Stellar Wallets Kit 2.7.0 checks against the Rust test host, and the `live/` page for SEP-43 testnet runs. |

After you change a fixture contract, run `make test-fixtures`. It runs the Rust tests of the four fixture workspaces.

## Contract fixtures

- `build.sh` fetches OpenZeppelin/stellar-contracts at commit `a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640` into `.oz-src/`.
  It uses one shallow Git fetch. It builds four example packages with `stellar contract build`.
  It then builds the two local contracts in `contracts/`.
  It writes `wasm/manifest.json` with `cargo run -q -p walleterm-tools -- fixture-manifest`.
- `contracts/` is a small Cargo workspace with two fixture contracts.
- `wasm/` holds the six artifacts and the manifest.
- `.oz-src/` is a build cache, not vendored source. You can delete it.

The repository does not copy the OpenZeppelin source.
The example packages are `multisig-account-example`, `multisig-ed25519-verifier-example`,
`multisig-threshold-policy-example`, and `multisig-weighted-threshold-policy-example`.

## Artifacts

| File | Bytes | SHA-256 | Source |
|------|-------|---------|--------|
| `multisig_account_example.wasm` | 41363 | `0c20d69644a16562f98a6be92101d8d95475dd3cbc45923c2a2b5f6a5126f0d0` | OpenZeppelin, pinned |
| `multisig_ed25519_verifier_example.wasm` | 1780 | `875b095d57291172d2f103b02240cdb72bc4157fc0d5ce7dfbc934b1d84209b4` | OpenZeppelin, pinned |
| `multisig_threshold_policy_example.wasm` | 11600 | `9525e49335e2dd8bd6d547980e4273ad47104c2f1d155e49f835c452545bc16a` | OpenZeppelin, pinned |
| `multisig_weighted_threshold_policy_example.wasm` | 14246 | `0e228b679436e405cd96ea5944ec6dfd618ce7b9ae7262864b72e0afaf792ee4` | OpenZeppelin, pinned |
| `walleterm_auth_target.wasm` | 1865 | `04a9a33cd3f56a0f16aca0db6b18e4b624416f3393cfeb1e0ce8bcc0d47fcdf5` | local |
| `walleterm_simple_account.wasm` | 1420 | `87248e34b98c4acc825f68ea8b4666c9e8b89b43ef7cdf86ef9f284ad08a823d` | local |

The OpenZeppelin account wasm is not the binary at
`examples/multisig-smart-account/factory/testdata/multisig_account_example.wasm` in that repository.
The sizes are equal, but the bytes are different. The runner uploads the file with the hash above.

The committed artifacts were built with `stellar 27.1.0`, `rustc 1.93.0`, target `wasm32v1-none`, and `soroban-sdk 27.0.2`.
That SDK has the same major version as the pinned OpenZeppelin workspace.

## Local contracts

### `walleterm_simple_account` (rows C02, C06, C13)

The account has one Ed25519 owner.
`__check_auth` verifies a 64-byte signature over the raw 32-byte host `signature_payload`. The signature ScVal is `Bytes(64)`.
`set_owner(new)` rotates the owner. It requires the account's own authorization.

### `walleterm_auth_target` (rows C01, C06, C07, C08, C09, C10, C11, C12)

- `ping(who, n)`: `who` must authorize. It adds `n` to the counter of `who`.
- `ping2(a, b, n)`: both addresses must authorize.
- `outer(who, inner, n)`: `who` authorizes the root call and the nested `inner.ping(who, n)` call. This makes a two-context authorization tree.
- `count(who)`: a read-only counter for unchanged-state checks.

## Build and test

```sh
sh fixtures/build.sh                       # rebuilds all six wasm files and the manifest
(cd fixtures/contracts && cargo test)      # 8 unit tests, no network
bun tests/contracts.ts                     # offline self-test of the runner, no agent, no network
```

## Runner

`tests/contracts.ts` exports `runContracts(ctx)` for `tests/live.ts`.
The context fields are in `LiveContext` in `tests/types.ts`.
Each signing function sends an artifact to `walleterm sign`, which computes the digest.
Key A pays for every transaction. Keys B and C, and the deployed C-accounts, sign the authorization entries.

- Row selection: `WALLETERM_ROWS=C01,C04 bun tests/live.ts contracts`, or `ctx.rows`. The default is all rows, C01 to C13.
- Deployed IDs and finished rows persist in `evidence/live/contracts-state.json`.
  A rerun reuses verified deployments and runs each selected baseline row again.
  The checkpoint binds the network, public keys, source revision, and WASM hashes.
  `C-run-scope` records the selected rows and the fresh execution scope.
- C09 is a coverage reference. The runner records it as `covered_by`, not `passed`.
- Each signed entry records the credential variant that the RPC returned.
  SDK 17.1.0 simulates with upgraded authorization, so expect `address_v2`.
  The runner makes no V1 credential claim.
- Positive cases: record simulation, sign each address entry, enforce simulation, sign the envelope with A, submit, then check the counter.
- Negative cases: enforce simulation must fail with the expected error text.
  The counter must not change. The runner submits nothing.
- An unknown submission status (`NOT_FOUND`, `TRY_AGAIN_LATER`, or a transport timeout) records the row as `blocked`.
  The record holds the transaction hash, and the run stops. Query that hash before any new submission.
  `pending-submission.json` blocks signing, funding, and submission across process restarts.
  Run `bun tests/live.ts reconcile` to query the original hash without a new submission.
  Reconciliation clears the block only after `SUCCESS` or `FAILED`.
  Each submission attempt has a separate `submission-UUID.jsonl` archive.

`ERR` at the top of the runner holds the expected error for each case. All negative cases assert exact errors.
An expired entry returns `Error(Auth, InvalidInput)`.
Duplicate or unsorted ScMap keys return `Error(Object, InvalidInput)`.
A missing required signer in the no-policy rule returns `Error(Contract, #3002)`.
Signature-binding cases change the call arguments and the entry after signing. They expect `Error(Crypto, InvalidInput)`.
Tree-mismatch cases change only the entry. They expect `Error(Auth, InvalidAction)`.

## Extended rows

`bun tests/live.ts extended` runs rows E01-E03. The repository holds no live record for these rows.
The rows cover native G multisig, OpenZeppelin delegated G signers, and contract-specific rules.
They also cover threshold updates, rule removal, and nested delegated calls.
The extended runner keeps a separate checkpoint. It labels reused evidence `passed_previous_run`.
It saves account B's original settings and restores them after E01.

The `cap71/` fixtures cover native delegated credentials, including nested C-address delegates.
The `cap85/` fixtures cover external executable references and account context compatibility.
Passkeys are not planned and are out of scope.
