# C14 — CLI acceptance submission

| Field | Result |
| --- | --- |
| Model / effort | Astra / xhigh, as assigned |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Assigned source | `tests/cli-pipeline.ts`, `tests/live-utils.ts`, `tests/submission.ts` |
| Verdict | **Confirmed** recovery defect |
| Priority / confidence | **P3 / low; high confidence** |
| Affected users | Operators who explicitly run the CLI01 testnet acceptance script |

The CLI pipeline submits without creating the shared pending record.
A later process can pass the signing check before anyone reconciles the original hash.
This violates the documented recovery requirement; it is not an accepted signer limitation.
The scope remains the testnet acceptance harness. The evidence does not establish unauthorized signing or mainnet loss.

## Reachability and impact

All source references below use the frozen baseline.

1. `tests/cli-pipeline.ts:8–24` builds a testnet payment for `100` stroops (`0.0000100` XLM) and checks its digest.
2. `tests/live-utils.ts:52–54` checks existing pending state before the pipeline signs at `tests/cli-pipeline.ts:34`.
3. `tests/cli-pipeline.ts:42` directly launches `stellar tx send --network testnet`.
4. The command wrapper imposes `timeout: 60000` at `tests/cli-pipeline.ts:6–7`.
5. A send exception exits before the original-hash lookup at `tests/cli-pipeline.ts:43`.
6. A successful send followed by a lookup exception or `NOT_FOUND` also exits without creating pending state.
7. A fresh guard accepts the absent record (`tests/submission.ts:155–162`, `:203–205`).
8. Reconciliation returns `null` without querying anything (`tests/submission.ts:320–322`; `tests/live.ts:5–7`).

A network can accept a transaction before the local process loses its result.
A later operator run can therefore sign another payment while the first outcome remains unresolved.
After completion, a transaction with the next sequence can repeat the `100` stroops (`0.0000100` XLM) payment.
This is a possible repeated testnet payment and an acceptance-recovery failure, not a demonstrated duplicate payment.
The script does not automatically restart or request a second signature after failure.
Each later live signature still follows the normal 1Password authorization path.
The corrected amount lowers practical priority to P3 / low because exposure involves a tiny, manually rerun testnet payment.
The recovery invariant failure remains confirmed, with high confidence.

## Evidence and counterevidence

The review read both original verification reports and the named offline probes.
It did not read the paired C14 report or other concern reports.
The existing probes establish the missing record and permit a second mocked signature within one process.
The additional check resolves the separate question about a fresh process.

| Injected condition | Lookups before exit | Pending record | Fresh process |
| --- | --- | --- | --- |
| Send timeout after possible acceptance | 0 | Absent before send and after failure | Signing check passes; reconciliation returns `null` |
| Successful CLI return, then `NOT_FOUND` | 1 | Absent before send and after failure | Same result |
| Successful CLI return, then lookup transport failure | 1 | Absent before send and after failure | Same result |

The check executes the frozen pipeline body with command, signer, RPC, and evidence-write mocks.
Separate Bun processes use the actual frozen submission guard against the same isolated directory.
The check verifies all three assigned source files against the baseline with `git show`.
It ran on macOS with Bun `1.4.2`; all three cases passed their reproduction assertions.
The mock signer only exercises the pre-sign check. No signer process or cryptographic signing runs.

Counterevidence limits the finding:

- Existing pending records block signing through `tests/live-utils.ts:53`.
- The normal guarded send persists the envelope and pending record before transport (`tests/submission.ts:275–285`).
- Unknown guarded outcomes retain that record (`tests/submission.ts:308–309`).
- The CLI pipeline checks digest agreement and requires `SUCCESS` before recording a pass (`:24`, `:41`, `:44–52`).
- Its unsigned artifact and signature journal retain useful recovery data, but automatic reconciliation does not consume them.
- The mock `NOT_FOUND` case does not establish that condition after a successful CLI return against the same service.
- The finding does not require the CLI to return before confirmation; lost results and later lookup failures suffice.

## Minimum mitigation and verification

Use a small CLI transport adapter with `createSubmissionGuard`, the shared evidence directory, network, and recorder.
Keep the actual `stellar tx send` invocation inside that adapter and retain its stdout for CLI01 evidence.
Before invocation, the guard must persist the original hash, signed envelope, network, and attempt identity.
Treat CLI completion conservatively as nonterminal until original-hash lookup establishes the outcome.
Keep pending state after command exceptions, uncertain lookup results, or interrupted evidence recording.
Use the existing reconciliation command to resolve that state without another submission.
This retains CLI construction, hashing, decoding, encoding, and actual submission coverage.
A narrow transport callback in the existing guard is an alternative if it reduces adapter duplication.
Manual recovery instructions alone do not enforce the documented requirement.

Verify pending persistence before the mocked CLI starts, then repeat the three failure cases across process restarts.
Require zero additional mock signer calls while unresolved; reconcile only the original hash.
Require terminal `SUCCESS` or `FAILED` to permit later signing, without resubmission during reconciliation.
Verify one actual CLI transport call on the successful adapter path. Live acceptance remains separately authorized.

## Checks, primary sources, and limits

Command: `bun audit/2026-09-26/checks/concerns/c14-astra/restart-probe.ts` — **passed**, exit `0`.
Artifacts: [script](../../checks/concerns/c14-astra/restart-probe.ts.txt), [results and source hashes](../../checks/concerns/c14-astra/restart-probe.json).
Reused evidence: `checks/07-verification-astra/offline-probes.ts.txt` and `offline-probes.json`; no full suite rerun.
The frozen recovery contract requires original-hash reconciliation (`docs/PLAN.md`, `docs/LIVE-TESTS.md:59–73`).
Preserved [getTransaction documentation](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) defines lookup outcomes and bounded history.
Preserved [sendTransaction documentation](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction) distinguishes RPC submission from terminal confirmation.
Source text: `research/07-verification-astra/perplexity.json` and `parallel-cli.json`; original access date: `2026-09-26`.
These sources apply to RPC behavior; they do not establish Stellar CLI polling behavior.
The baseline pins SDK `17.1.0`; the original review recorded CLI `28.0.0`, which this review did not recheck.
Amount evidence: `checks/stellar-payment-help.txt` defines stroops; `evidence/acceptance-summary.json:224–225` records sender `-200` and recipient `100` stroops.
New research calls: **0**. New provider charges: **$0**; Jev: **$0**, within the `$2` / `$0.50` allocation.
Live CLI execution, signatures, submissions, and current testnet acceptance: **not_run**.
Runtime source changes: **none**. Completion blockers: **none**. Concern count: **1**.
