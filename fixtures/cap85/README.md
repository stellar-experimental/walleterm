# CAP-85 fixtures: externally managed contract executables

Status: built locally. No key was created. No vault was read. No signature was
made. No network state was changed by the build. Live rows run only through the
parent harness (`node tests/live.mjs cap85`) inside a granted live window.

Specification: CAP-0085 (cached at `/tmp/walleterm-protocol-review/cap-0085.txt`).
Testnet reports protocol 28, which activates CAP-85. The installed
`@stellar/stellar-sdk` 17.1.0 carries the CAP-85 XDR
(`contractExecutableExternalRef`, `scvExecutableTag`, `createContractV2`).
The local `stellar` CLI is 27.1.0; its XDR lacks CAP-85, so the runner never
uses it for these types.

## Layout

- `contracts/` soroban-sdk 28.0.0 workspace: `manager`, `target-v1`,
  `target-v2`, `account`.
- `contracts-sdk27/` soroban-sdk 27 workspace: `legacy-account`, a custom
  account that decodes every authorization context.
- `wasm/` five artifacts and `manifest.json` (toolchain, SDK versions, source
  and `Cargo.lock` hashes, artifact hashes).
- `build.sh` builds both workspaces with `stellar contract build` (soroban-sdk
  28 refuses a plain `cargo build` for wasm), runs both test suites, and writes
  the manifest.

## Contracts

`cap85_manager` (SDK 28). Owns executable reference entries under
`ExecutableTag` keys. `set_executable(tag, wasm_hash, version)` needs admin
auth and a strictly increasing version (stale code guard, `#2`). The protocol
itself rejects a hash that is not uploaded Wasm and never removes an entry.
`deploy(tag, salt, args)` deploys through `ContractExecutable::ExternalRef`.
`resolved_wasm(address)` returns what `get_address_executable` resolves.

`cap85_target_v1` and `cap85_target_v2` (SDK 28). `version()` returns 1 or 2.
`ping(who, n)` adds `n` (v1) or `2n` (v2) to a counter. `adopt_ref(owner,
tag)` and `adopt_wasm(hash)` call `update_current_contract` with an
`ExternalRef` or a Wasm hash. Admin auth.

`cap85_account` (SDK 28). Ed25519 owner over the raw host payload, signature
ScVal `Bytes(64)`. Creation contexts must carry `ExternalRef` owned by the
trusted manager: Wasm gives `#2`, another owner gives `#3`.

`cap85_legacy_account` (SDK 27). Same signature scheme. It matches every
context, so an `ExternalRef` creation context fails to decode.

## Observed legacy limits (offline, SDK 28 test host)

`contracts/account/src/test.rs` runs the SDK 27 wasm binaries inside the
protocol 28 test host:

- `cap85_legacy_account` rejects an `ExternalRef` creation context and
  accepts a Wasm one.
- The existing `fixtures/wasm/walleterm_simple_account.wasm` (SDK 27, never
  decodes its contexts) accepts an `ExternalRef` creation context.

So "SDK 27 account" is not one behavior. Accounts that decode contexts break.
Accounts that ignore contexts do not. Row X05 records the live outcome for
both, plus the OpenZeppelin 0.7.x account (decodes contexts).

## Rows (`tests/cap85.mjs`)

| Row | Content |
|-----|---------|
| X01 | Upload five wasm files, deploy the manager (admin key B), point `target` at v1 with B's auth entry. Read the entry through the contract and through the ledger. Negatives: stale version `Error(Contract, #2)`; unknown Wasm hash `Error(Storage, MissingValue)` with host diagnostic `Wasm does not exist`; key C signing B's admin entry `Error(Contract, #5)` with `signer does not belong to account`. |
| X02 | Deploy a target through `ExternalRef` with deployer A. Check the derived address, the instance executable (owner and tag), `version() == 1`, the resolved Wasm hash, and one `ping` with its before and after counts. |
| X03 | B moves the reference to v2. Same address reports `version() == 2`, the resolved hash is v2, and one `ping` grows the counter by 2. |
| X04 | The SDK 28 account (owner key C) authorizes a creation through `ExternalRef`. The same account rejects a Wasm creation with `Error(Contract, #2)`. |
| X05 | The SDK 27 context-reading account rejects an `ExternalRef` creation with `Error(Value, MissingValue)` and accepts a Wasm creation. |
| X06 | A Wasm-deployed target adopts the reference (`version` becomes 2), then adopts v1 Wasm again. |
| X07 | Observation only, status `observed`: `simple_account_b` (ignores contexts, expected to accept) and `oz_basic_a` (matches contexts, expected to reject) with an `ExternalRef` creation. Outcomes are recorded, not asserted. |

Expected error texts come from the local protocol 28 test host
(`fixtures/cap85` unit tests) and from `soroban-env-host` v27.0.0
`account_contract.rs`. Every rejection must contain the expected error and,
where listed, the host diagnostic.

## Submission path and safety

One local path handles every submission, including uploads and deploys:
record simulation, root verification, entry signing through
`ctx.signDigest`, enforce simulation, `ctx.assertClear`, envelope signature
by A, send. Root verification builds the expected `SorobanAuthorizedInvocation`
from the local operation (direct call or direct contract creation) and
requires every recorded entry to match it byte for byte, to carry no
sub-invocations, and to name an expected address. A mismatch stops the step
before any signing request. The offline self-test feeds malformed RPC
responses (extra subtree, changed arguments, unexpected address, entry on an
upload) and checks that zero signing calls happen. Before each
signing request the runner records the preimage XDR, payload digest, address,
nonce, expiration, and the authorized executable under `<label>.preimage`.

Checkpoint: `evidence/live/cap85-state.json`, bound to network, keys,
artifact hashes, and baseline instance ids, written atomically. Each step sets
an inflight marker before it runs and stores the transaction hash before the
send. A rerun that finds a marker queries that hash: `SUCCESS` reconciles the
step from the network, `FAILED` clears it for a rerun, anything else fails
closed. Finished steps and rows are reported as `passed_previous_run`.

The runner accepts the testnet passphrase only, checks the RPC network and
protocol 28, and stops at the first failed row.

## Build and test

```sh
sh fixtures/cap85/build.sh      # both workspaces, tests, manifest
node tests/cap85.mjs            # offline self-test, no agent, no network
```
