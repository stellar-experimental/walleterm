# 06-contracts independent audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Result and scope

Two confirmed defects: both **Low severity, High confidence**.
The defects affect build provenance and interrupted fixture recovery.
This audit found no defect in the inspected authorization formats, delegate policy, or replay controls.
That conclusion applies only to the stated fixtures and evidence.

- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Reviewer: `gpt-6-astra`, `xhigh`; runtime session metadata confirmed both settings.
- Date: 2026-09-26 EDT; research continued into 2026-09-27 UTC.
- Independence: no other area conclusion was read before this report.
- Boundaries: no runtime edits, delegation, live keys, signing requests, submissions, or public services.
- Skills: smart-contracts, its security reference, and the requested Jev and parallel-cli instructions.

Paths and line numbers below refer to the frozen revision.
Evidence paths refer to `audit/2026-09-26/` unless an external URL appears.

## Code coverage

| Area | Inspection |
| --- | --- |
| Baseline fixtures | Both Rust contracts, both test modules, Cargo files, build script, manifest writer, manifest, and README |
| CAP-71 fixtures | Delegate, raw account, protected target, delegate tests, Cargo files, manifest, and README |
| CAP-85 fixtures | Manager, both targets, SDK-28 account, SDK-27 account, all five test modules, Cargo files, and build metadata |
| Harnesses | All of `tests/contracts.ts`, `tests/extended-contracts.ts`, `tests/cap71.ts`, and `tests/cap85.ts` |
| Supporting paths | Protocol regression tests, checkpoint test, `live.ts`, `live-utils.ts`, `submission.ts`, `simulations.ts`, and `cli-pipeline.ts` |
| Documentation | AGENTS, README, PLAN, INTERFACE, OPENZEPPELIN, PROTOCOL-UPDATES, fixture READMEs, and acceptance indexes |
| Direct dependency | Installed SDK 17.1.0 authorization construction, signing, delegation, and preimage selection |
| Provenance | All 199 tracked Git blobs; 14 CAP-85 source hashes; central checks for 14 artifacts |

All 10 fixture Rust implementation files and all eight Rust test modules received source inspection.
Lockfiles select SDK/host versions `27.0.6/27.0.1`, `27.0.2/27.0.1`, `28.0.0/28.0.2`, and `27.0.6/27.0.1`.
These pairs respectively cover baseline, CAP-71, CAP-85, and legacy CAP-85 workspaces.
Native tests do not establish fresh WASM build reproducibility or current testnet acceptance.

## Confirmed defects

### C06-A1: A dirty OpenZeppelin checkout retains a clean commit label

**Severity: Low. Confidence: High.**
Location: `fixtures/build.sh:19`, `fixtures/build.sh:23`, `fixtures/build.sh:27`, and `fixtures/manifest.ts:15`.

Scenario: a developer changes tracked source inside the cached `fixtures/.oz-src` checkout, then runs `sh fixtures/build.sh`.
The checkout still has the expected HEAD. The script accepts it and compiles its changed files.
The manifest labels the resulting OpenZeppelin artifacts with the pinned commit.
Impact: the manifest can attribute changed contract code to source that did not produce it.
Artifact hash checks cannot detect that attribution error when the same build regenerates the manifest.

Evidence: `checks/06-contracts-astra/provenance-repro.py` and `provenance-result.json` reproduce acceptance with a real dirty Git checkout.
The reproduction replaces only the commit literal and the compiler command with an isolated source-byte recording stub.
The original manifest writer labels all four changed artifact stand-ins with the unchanged commit.
Counterevidence: all current artifact hashes match. This audit found no evidence that current artifacts used modified OpenZeppelin source.
The defect requires a changed local build checkout; it does not permit an unauthenticated contract call.

Minimum mitigation: reject staged, unstaged, and untracked source changes before the build, or use a fresh isolated checkout.
Preserve developer changes instead of deleting them automatically.
Verification: change one tracked contract file without changing HEAD. The build must stop before compilation or manifest output.

### C06-A2: X06 cannot resume after its final executable change

**Severity: Low. Confidence: High.**
Location: `tests/cap85.ts:797`, `tests/cap85.ts:1201`, `tests/cap85.ts:1213`, and `tests/cap85.ts:1355`.

Scenario: X06 completes `adopt-wasm`, saves that step, then stops before saving the completed row.
A failed final state read or process interruption can cause this state.
On restart, the step cache skips `adopt-ref`, but X06 immediately checks for the earlier external-reference state.
The contract correctly uses direct v1 WASM. The earlier-state assertion therefore fails before the saved final step is reached.
Impact: repeated restarts stop fixture acceptance and require manual recovery, despite a successful final transaction.
Recovery of a successful inflight final transaction reaches the same saved-step state at `tests/cap85.ts:723`.

Evidence: `checks/06-contracts-astra/x06-recovery-repro.ts.txt` executes the exact frozen `x06` and `stepper` bodies with offline dependencies.
`x06-recovery-result.json` records a successful control and the reproduced post-final-step failure.
The failing case makes zero operation calls and zero checkpoint writes.
Counterevidence: the harness stops safely. It neither repeats the transaction nor incorrectly records a passing row.
The central recovery tests cover X02/X03 counters and shared submission gates, not this X06 phase transition.

Minimum mitigation: persist the intermediate executable observation before the final change, and resume checks from the saved phase.
Do not require the current contract to reproduce an earlier executable state.
Verification: interrupt before and after final-step persistence, including `SUCCESS` reconciliation; resume without another signature or submission.
Keep final-state mismatch rejection and label any missing historical observation explicitly.

## Authorization results and non-issues

| Subject | Result and source location |
| --- | --- |
| Host preimages | SDK 17.1.0 hashes the correct XDR arm. V1 omits address; V2 and native delegation bind the root address. |
| Preserved fields | `tests/contracts.ts:451` preserves credentials and invocation while setting explicit expiry and signature through `authorizeEntry`. |
| G signatures | `tests/contracts.ts:135` uses `Vec[Map{public_key,signature}]`; extended multisig sorts raw public keys. |
| Raw C signatures | Simple, CAP-71 raw, and CAP-85 accounts verify the host payload with `Bytes(64)`. |
| OpenZeppelin External | `tests/contracts.ts:103` binds `context_rule_ids` through `SHA256(payload || XDR(ScVal Vec<u32>))`. |
| OpenZeppelin payload | `Map{context_rule_ids,signers}` contains sorted `External(verifier,Bytes32)` keys and `Bytes64` signatures. |
| OpenZeppelin Delegated(G) | `tests/extended-contracts.ts:603` creates separate authorization rooted at `account.__check_auth([auth_digest])`. |
| Native CAP-71 | `tests/cap71.ts:205` signs one root-address-bound payload through each G delegate. This differs from OpenZeppelin delegation. |
| Delegate policy | `fixtures/cap71/delegate/src/lib.rs:78` checks membership and weight, then authenticates every supplied delegate. |
| Replay | C11 and CAP71-10 consume a nonce before replay; substitution tests preserve nonce and invocation while changing address. |
| Root validation | CAP-71 and CAP-85 compare recorded roots against expected calls before requesting signatures. |
| CAP-85 changes | Manager and target mutations require administrator authorization. X02–X04 check instance identity, reference, version, and resolved hash. |
| Legacy decoding | Context-reading SDK-27 accounts reject `ExternalRef`; context-ignoring accounts can accept it. This difference is expected. |
| Unknown outcomes | Shared submission state blocks more signing and submission until original-hash reconciliation resolves the result. |

These formats agree with the pinned OpenZeppelin source and the applicable CAP specifications.
The CAP-85 manager's increasing integer does not prove code freshness or prevent an authorized rollback to older WASM.
Its SDK-28 account trusts the manager and accepts any manager tag. It does not pin one immutable code hash.
These are explicit fixture policies, not general wallet safeguards.
The baseline and extended harnesses also rely on trusted simulation inputs; their adapters do not implement general transaction review.
The digest-only signer cannot reconstruct transaction intent. This documented boundary is not itself a defect.

## Checks and acceptance limits

| Check | Outcome | Evidence |
| --- | --- | --- |
| Frozen source and CAP-85 source manifest | **passed**: 199 blobs and 14 source hashes match | `checks/06-contracts-astra/source-verification.json` |
| Two targeted reproductions | **passed**: both defects reproduced; controls behaved as expected | `checks/06-contracts-astra/*-result.json` |
| Four locked offline Rust workspaces | **passed**, reused: 30 tests | `checks/rust-results.json`, `checks/rust-summary.json` |
| Artifact manifest comparison | **passed**, reused: 14 artifacts | `checks/fixture-hashes.json` |
| Central baseline | **passed**, reused: Go race/vet, TypeScript, 224 Bun tests, three self-tests | `checks/baseline-results.json`, `checks/baseline-permitted-results.json` |
| Fresh live 1Password or testnet acceptance | **not_run**; outside authorization | No new live evidence |
| Exact reproducible WASM rebuild | **not_run** | Existing artifact hashes alone do not prove source provenance |

Commands, outcomes, and reproduction limits appear in `checks/06-contracts-astra/COMMANDS.md`.
The historical indexes record C01–C08, C10–C13, E01–E03, CAP71-01–12, and X01–X06 acceptance.
C09 remains `covered_by`. X07 remains `observed`.
The protocol index records 38 successful transactions, including setup and controls, on 2026-09-25 testnet protocol 28.
It records earlier `.mjs` source hashes, not the current `.ts` source hashes.
Therefore, historical live acceptance is not fresh acceptance of this frozen revision.
The frozen index excludes raw live checkpoints, signed envelopes, and full RPC responses.
This audit did not independently query historical transaction receipts.
CAP71-07/08 used successful paired controls and exact array mutations, but RPC diagnostics omitted specific rejection reasons.
The duplicate mutation cannot distinguish duplicate rejection from ordering rejection.
Passkeys, CAP-72, OpenZeppelin Delegated(C), and comprehensive forced-V1 live coverage remain outside acceptance.

## Sources, research usage, and opportunities

Primary sources: [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-01.md), [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md), and [CAP-85](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0085.md).
Adapter authority: [OpenZeppelin storage](https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/packages/accounts/src/smart_account/storage.rs) at `a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640`.
The research record links the same commit's account, Ed25519 verifier, and threshold policies.
`research/06-contracts-astra/primary-source-index.json` records eight direct source reads with access timestamps and SHA-256 hashes.
The CAP master snapshots establish protocol semantics, not present network deployment.

Raven, Jev, parallel-cli, Parallel Search MCP, and Perplexity all ran.
`research/06-contracts-astra/RESEARCH.md` records questions, commands, provider evidence, versions, and applicability.
Jev reported/reserved `$0.032566751` across a transport failure and one partial retry; its allocation was `$1`.
parallel-cli reported one `sku_search`. Other provider dollar charges were unavailable.
The total dollar charge remains unknown against the `$10` allocation. No deep-research job ran.
Perplexity's challenge search was **inconclusive**. Direct primary source reads resolved the relevant protocol questions.

Useful follow-up: attach exact source and toolchain provenance to future artifact builds and acceptance indexes.
No additional runtime feature is necessary for the documented digest-signing purpose.
There are no unresolved blocking questions and no request for more research allocation.
