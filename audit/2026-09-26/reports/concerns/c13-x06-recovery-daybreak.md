# C13: CAP-85 X06 interrupted recovery

## Assignment

- Concern: C13, CAP-85 X06 recovery.
- Assigned model and effort: Daybreak, xhigh.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Source scope: `tests/cap85.ts` checkpoint, reconciliation, X06, and row completion paths.

I read both assigned `06-contracts` reports, but I did not read the paired C13 report.

## Verdict

- Verdict: **confirmed**, with **low** severity and priority.
- Confidence: **high**.
- Affected users: testnet fixture operators who resume X06 during the narrow final-step window.

The production signer, bridge, and ordinary wallet users are unaffected.
The defect blocks acceptance evidence recovery after a successful final transaction.

## Reachable scenario

1. X06 validates `adopt-ref` at `tests/cap85.ts:1201-1214`.
2. X06 submits `adopt-wasm` at `tests/cap85.ts:1215-1221`.
3. An interruption occurs before row persistence at `tests/cap85.ts:1355-1356`.
4. The final step is saved at `tests/cap85.ts:805-807`, or it remains inflight.
5. `SUCCESS` reconciliation caches an inflight final step at `tests/cap85.ts:710-726`.
6. The cached `adopt-ref` returns at `tests/cap85.ts:795-800`.
7. The current final state then fails the earlier-phase assertion at `tests/cap85.ts:1208-1214`.

## Impact and safety result

The runner records X06 as failed at `tests/cap85.ts:1352-1353`.
This result is a safe halt, not an unknown-submission block.
The resume requests no signature and sends no duplicate transaction.
X06 throws before row completion, so it cannot report a false pass.

## Evidence

The preserved reproduction confirms saved success with zero resumed operations.
See `checks/06-contracts-astra/x06-recovery-result.json`.
The new reproduction executes the frozen reconciliation, stepper, and X06 bodies.
It confirms saved and reconciled success with zero resumed operations.
See `checks/concerns/c13-daybreak/x06-inflight-result.json`.
The frozen `tests/cap85.ts` SHA-256 is `1bebefc34f0532eef91e7854cc70320f43cb0899a915a8c56237a691a9da1a45`.

## Counterevidence

Normal uninterrupted X06 execution completes.
Historical evidence records a completed X06 row, but it does not test this restart window.
The checkpoint logic prevents duplicate submission and false acceptance.
The mocks establish control flow, not a new live testnet result.

## Minimum mitigation

Persist one validated phase record after `tests/cap85.ts:1213` and before `adopt-wasm`.
Store the intermediate executable, version, resolved WASM, and validation result.
Reuse that record instead of querying current state for an earlier phase.
Always repeat `tests/cap85.ts:1222-1227` before row completion.
For older checkpoints, label the missing intermediate values as unavailable.
Do not invent values or delete historical steps.
Require final-state validation before completing X06.

Alternatives either discard evidence, lose the earlier observation, or omit current final validation.

## Verification plan

1. Interrupt before final submission, then resume with exactly one submission.
2. Interrupt after final submission, then reconcile `SUCCESS`.
3. Confirm the resume makes zero signing and submission calls.
4. Repeat after final step persistence but before row persistence.
5. Make the final state mismatch and confirm X06 fails.
6. Return an unknown status and confirm the inflight hash remains.

## Checks and costs

| Check | Outcome | Evidence |
| --- | --- | --- |
| Frozen source inspection | passed | Exact paths and lines above |
| Preserved saved-success reproduction | passed | `checks/06-contracts-astra/x06-recovery-result.json` |
| First new harness run | failed | Syntax error before concern execution |
| Corrected saved and inflight reproduction | passed | `checks/concerns/c13-daybreak/x06-inflight-result.json` |
| Central Go race and Bun baseline | passed, reused | `checks/baseline-permitted-results.json` |
| Fresh live 1Password or testnet check | not_run | Outside this review authorization |

`checks/concerns/c13-daybreak/COMMANDS.md` records the exact commands and outcomes.
No provider call occurred.
Jev cost was `$0.00` against the `$0.25` cap.
Total known research cost was `$0.00` against the `$1` cap.
Unknown provider charges were none.

## Sources and limits

The frozen source and preserved reproductions decisively answer the concern.
No external factual question remained unresolved.
Therefore, Raven, Jev, Parallel Search, `parallel-cli`, and Perplexity did not run.

I did not edit production source or run the full baseline suite.
I did not request signatures, access keys, use a network, or start a public service.
