# C13: X06 interrupted recovery

## Verdict and scope

**Confirmed recovery defect. Priority P3; severity Low; confidence High.**
Affected users run CAP-85 testnet acceptance and restart X06 after its final executable change.
The harness stops safely, but it cannot finish the interrupted row through an ordinary restart.
This path does not demonstrate duplicate submission, unauthorized signing, key theft, or false row acceptance.

- Concern: C13 only.
- Reviewer assignment: `gpt-6-astra`, effort `xhigh`.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Source coverage: X06, its runner, step cache, checkpoint binding, persistence, reconciliation, and target executable changes.
- Existing evidence: both assigned contracts reports, the original X06 reproduction, and `checks/coordinator-contract-2.txt`.
- No paired concern report, adjacent concern review, production edit, or delegation occurred.

Source references below use the frozen revision. Evidence paths use `audit/2026-09-26/`.

## Reachable scenario

1. X06 completes `adopt-ref`, then observes the external reference and version 2.
2. X06 completes `adopt-wasm`, which restores direct version 1 WASM.
3. A final read fails, or the process stops before the row checkpoint completes.
4. Restart reuses cached `adopt-ref`, then requires its obsolete external-reference state.
5. The correct final state fails that assertion before the final cached step or final validation.

| Frozen reference | Consequence |
| --- | --- |
| `tests/cap85.ts:548` | Saves the final transaction hash before submission. |
| `tests/cap85.ts:723` | Successful inflight reconciliation saves the final step and clears its marker. |
| `tests/cap85.ts:797` | Cached `adopt-ref` returns without restoring the earlier state. |
| `tests/cap85.ts:805` | Saves final step success before the row's final reads. |
| `tests/cap85.ts:1201` | X06 starts recovery through its earlier step. |
| `tests/cap85.ts:1213` | Rejects direct WASM because the assertion requires an external reference and version 2. |
| `tests/cap85.ts:1222` | Final reads occur after final step persistence. |
| `tests/cap85.ts:1355` | Marks the row complete only after X06 returns successfully. |

The target requires administrator authorization before changing executables: `fixtures/cap85/contracts/target-v2/src/lib.rs:54`.
Testnet and protocol checks constrain the runner: `tests/cap85.ts:1304` and `tests/cap85.ts:1311`.
The source therefore provides a reachable failure window within the supported acceptance workflow.
The reproduction supplies the chain state locally; it does not demonstrate a live interruption.

## Evidence and counterevidence

| Check actually run | Outcome |
| --- | --- |
| Existing reproduction | **passed**: control succeeds; saved final success stops with zero operation calls. |
| Saved-success extension | **passed**: injected final read failure creates a real checkpoint; two reloads reproduce the defect. |
| Inflight SUCCESS extension | **passed**: actual reconciliation queries the original mock hash and persists success; two reloads reproduce the defect. |
| Normal completion control | **passed**: one mock final operation produces a completed row. |
| Unknown-outcome control | **passed**: preserves the hash and stops before funding or row execution. |
| Final-state mismatch control | **passed**: rejects direct WASM with version 2. |
| Frozen manifest comparison | **passed**: all 199 tracked hashes match before and after checks. |

Evidence: `checks/concerns/c13-astra/existing-reproduction.json` and `checks/concerns/c13-astra/recovery-result-2.json`.
The latter uses unchanged row and runner bodies, actual checkpoint writes, and actual reconciliation with local substitutes.
Both recovery cases make zero further X06 operation calls and leave `done.X06` absent.
Per-step `passed_previous_run` records do not establish a passing X06 row.
Successful reconciliation permits startup to reach the funding helper; this check substitutes that helper.
Thus, the zero-operation result concerns repeated X06 operations, not every possible startup network action.
Existing `tests/cap85.test.ts` covers counter recovery and shared gates, but it lacks this X06 transition case.
Exact commands and the corrected check-script extraction failure appear in `checks/concerns/c13-astra/COMMANDS.md`.

## Minimum mitigation and verification

Persist X06's initial observation before its first change. Persist its validated reference observation before starting `adopt-wasm`.
Store these observations with existing X06 checkpoint evidence; no general recovery framework is necessary.
On final saved success or SUCCESS reconciliation, reuse the observations and skip the obsolete intermediate live-state assertion.
Keep both transaction results and their hashes. Re-read the final executable and version before completing the row.
Preserve the existing final rejection at `tests/cap85.ts:1226`.
Do not replace historical `before` evidence with a new read of the final state.
For old checkpoints without observations, report incomplete historical evidence instead of inventing it or silently passing.
Manual evidence review can address old checkpoints. Automatically repeating executable changes is not an acceptable recovery shortcut.

Verification must cover interruption before final-step persistence, after persistence, during final reads, and before row persistence.
Exercise saved success, successful reconciliation, unknown outcomes, absent historical observations, and mismatched final state.
Require zero additional signatures or X06 submissions after confirmed final success.
Require preserved historical observations and fresh final validation before a recovered row passes.
No additional runtime capability is necessary for this concern.

## Sources, costs, and limits

Preserved [CAP-85 primary text](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0085.md) permits switching between references and direct WASM.
Lines 238–242 specify executable replacement after successful return and switching in both directions.
Source: `research/06-contracts-astra/cap-0085.md`; original access: `2026-09-27T01:42:38.863907+00:00`.
Its SHA-256 matches the preserved index. `research/concerns/c13-astra/evidence.json` records verification and costs.
This specification supports SDK `28.0.0` fixture semantics; it does not establish current network deployment.
Research tools and CLI paths were discovered. Preserved evidence resolved the question without new provider requests.
New research: **$0 total; Jev $0; no unknown new provider charges**.
Live signing, testnet execution, and a real process interruption: **not_run**.
No full baseline rerun or implementation occurred. No blocker or additional research allocation remains.
