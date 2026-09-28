# 06 Contracts audit: Daybreak

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Conclusion

I found one confirmed defect.
The defect has medium severity and high confidence.
I found no unresolved material concern.

The shared baseline harness signs an RPC-provided authorization tree before validating that tree.
The CAP-71 and CAP-85 harnesses perform this validation before signing.

## Scope

- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Model: Daybreak.
- Effort: xhigh.
- Review mode: independent and read-only.

The snapshot has no Git metadata.
I used the coordinator revision and `checks/source-drift.json` for source identity.
I did not read paired reports or other audit conclusions.

## Code coverage

I read every Rust fixture source file.
I read every fixture Cargo manifest and lockfile.
I read the fixture build scripts, artifact manifests, and fixture documentation.
I inventoried the generated Rust test snapshots.

I traced these protocol harnesses and their direct dependencies:

- `tests/contracts.ts` and `tests/extended-contracts.ts`.
- `tests/cap71.ts` and `tests/cap71.test.ts`.
- `tests/cap85.ts` and `tests/cap85.test.ts`.
- `tests/live-utils.ts`, `tests/live.ts`, and `tests/submission.ts`.
- `tests/simulations.ts` and `tests/types.ts`.

I read `docs/OPENZEPPELIN.md` and `docs/PROTOCOL-UPDATES.md`.
I also read the interface, plan, test matrix, and live-test limits.

## Confirmed defect

### C06-D1: The shared harness signs an unverified RPC authorization tree

- Severity: medium.
- Confidence: high.
- Affected boundary: dedicated testnet acceptance keys and evidence.
- Production signer effect: none by this path.

Locations:

- `tests/contracts.ts:431-469` accepts recorded authorization entries and matches only their addresses.
- `tests/contracts.ts:456-464` signs each accepted RPC entry.
- `tests/contracts.ts:473-474` performs enforcement simulation only after signing.
- `tests/extended-contracts.ts:17` imports this shared path.
- `tests/extended-contracts.ts:696-706` uses it for OpenZeppelin delegation.

Reachable scenario:

1. The harness sends a locally built transaction to the configured testnet RPC.
2. A compromised RPC returns the expected signer address with an attacker-selected `rootInvocation`.
3. `invoke` finds the signer by address and requests a signature.
4. The harness sends the signed entry back during enforcement simulation.
5. The local operation then rejects the unrelated tree.
6. The RPC already has a valid signature for the attacker-selected tree.

Impact:

The RPC can obtain an unintended authorization signature from a dedicated testnet key.
It can consume that signature through another permitted transaction before expiration.
The signature cannot cross networks because the preimage binds the network identifier.
The configured keys and endpoint limit the impact to testnet acceptance assets and evidence.

Evidence:

- `tests/contracts.ts:21` sets a 60-ledger expiration window.
- `tests/live-utils.ts:8-18` fixes the network and RPC to official testnet values.
- `tests/live-utils.ts:52-93` sends the digest after only a pending-submission check.
- `audit/2026-09-26/checks/06-contracts-daybreak/rpc-root-injection.test.ts` reproduces the signing request.
- The test returns one signed attacker tree to the mocked enforcement RPC.

Protocol evidence:

CAP-46-11 binds `rootInvocation` into the authorization signature payload.
CAP-46-11 also permits the authorization root to differ from the transaction root.
Therefore, a failed local enforcement simulation does not revoke the disclosed signature.

Counterevidence and limits:

- The harness uses the official Stellar testnet RPC.
- The interface requires dedicated testnet keys.
- The later enforcement simulation prevents local submission of the mismatched tree.
- The signature expires after 60 ledgers.
- No mainnet path uses this harness.

The CAP-71 path already applies the required control.
`tests/cap71.ts:630-647` compares the exact expected root before signing.
`tests/cap71.test.ts:664-709` checks malicious roots and zero signing calls.

The CAP-85 path also applies the required control.
`tests/cap85.ts:249-285` defines exact root and address validation.
`tests/cap85.ts:448-457` runs that validation before signing.
`tests/cap85.ts:1638-1691` checks malformed RPC roots and zero signing calls.

Minimum mitigation:

Add a shared pre-sign root validator to `tests/contracts.ts`.
Require each row to declare its exact allowed invocation tree.
Compare the contract, function, arguments, and complete subtree before `authorizeEntry`.
Reject every unexpected address and every unexpected source-account entry.
Keep explicit `presigned` replay cases separate because they request no new signature.

Verification plan:

Move the targeted regression into the normal Bun suite.
Run the baseline and extended rows against contract, method, argument, and subtree mutations.
Assert zero digest and envelope signing calls for every mutation.
Then run the existing locked offline suite.

## Unresolved concerns

None.

## Non-issues

The G-address and C-address preimage handling matches each tested account scheme.
`tests/contracts.ts:101-129` encodes the documented OpenZeppelin payload.
`tests/contracts.ts:159-176` documents the extra OpenZeppelin digest rule.

Native CAP-71 signs one address-bound authorization preimage.
`tests/cap71.ts:205-259` records and verifies that preimage before signing.
The fixture checks membership, weight, and every supplied delegate.
See `fixtures/cap71/delegate/src/lib.rs:25-95`.

Replay tests preserve the signed credential bytes.
`tests/contracts.ts:1016-1044` checks nonce consumption before expiration.
`tests/cap71.ts:835-875` covers replay and same-key account substitution.

OpenZeppelin delegation remains distinct from native CAP-71 delegation.
`tests/extended-contracts.ts:566-663` builds the legacy `__check_auth` delegate entry.
`docs/OPENZEPPELIN.md:353-375` documents this boundary.

CAP-85 checks executable changes and preserved contract addresses.
The manager requires administrator authorization and increasing versions.
See `fixtures/cap85/contracts/manager/src/lib.rs:49-88`.

The SDK 28 account accepts only references owned by its trusted manager.
See `fixtures/cap85/contracts/account/src/lib.rs:35-80`.
The policy intentionally does not restrict a tag within that manager.

The SDK 27 decoder failure is an explicit compatibility fixture.
`fixtures/cap85/contracts-sdk27/legacy-account/src/lib.rs:1-9` states this purpose.
CAP-85 row X07 remains an observation, not a passed assertion.

All 14 artifact bytes matched their recorded hashes.
All 14 CAP-85 source files matched their recorded source hashes.
The live runners bind checkpoints to artifact hashes and public test identities.

## Feature opportunities

Use the CAP-85 root validator as the common harness control.
This change removes duplicated trust decisions across protocol suites.

Add source and toolchain hashes to the base and CAP-71 manifests.
The current hashes prove artifact identity, but not a clean source rebuild.
This improvement does not block the current fixture acceptance.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Central locked Rust tests | passed | 30 cases across four workspaces |
| Central permitted baseline | passed | Go race and Bun suite |
| Central artifact hashes | passed | 14 of 14 matched |
| CAP-85 source hashes | passed | 14 of 14 matched |
| RPC root injection regression | passed | One signature request reproduced |

I did not repeat the full offline suites.
The central checks already answered those questions.
I ran only the root-injection regression and CAP-85 source comparison.

No check used a live key, network submission, or public service.
No check changed the frozen source.

## Research sources

The primary source list is in `research/06-contracts-daybreak/sources.md`.
The list includes CAP-46-11, CAP-71, CAP-85, and official authorization documentation.
All sources were accessed on 2026-09-26.

Stellar Raven MCP returned relevant official documentation.
Parallel Search MCP used one search unit and returned primary sources.
Perplexity MCP returned a confirming challenge pass.

Jev failed before retrieval after three transport failures.
It spent `$0.008729397` under the `$1` cap.
`parallel-cli` failed with `APIConnectionError` after internal retries.
Other provider charges were not visible.

## Limits

I did not repeat live protocol acceptance.
I did not rebuild OpenZeppelin or fixture WASM.
Artifact hashes do not alone prove source-equivalent builds.

The audit accepts the documented fixture-only storage and upgrade limits.
Passkeys, CAP-72, and OpenZeppelin delegated C-address adapters remain outside this scope.
The report does not extend testnet evidence into a production claim.
