# C17 — Checkpoint version identity

## Identity and scope

- Concern: `C17`.
- Model and effort: Daybreak, xhigh.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Scope: CAP-71 and CAP-85 checkpoint identity, row reuse, and acceptance wording.

## Verdict

**Conditional, Low priority, High confidence.**

Completed rows do not make a false current-run claim. They use historical statuses and set `reused_evidence: true`. The evidence guide defines historical reuse.

A narrower labeling defect exists after a partial row interruption. Cached assertions can cross a protocol or harness change.
The resumed row can record top-level `passed`. The old data remains visible, but the top-level status is too strong.

This issue affects testnet acceptance operators who resume partial CAP-71 or CAP-85 rows. It does not affect production users.

## Reachable scenario

CAP-71 binds the network, ordered keys, and current WASM hashes at `tests/cap71.ts:49-60`.
It omits assertion identity. `loadCheckpoint` accepts matching bindings at `tests/cap71.ts:83-104`.

Each completed assertion enters `state.checks` at `tests/cap71.ts:620-743`. A process can then stop before `state.done`.
A later protocol can keep the binding. Cached checks return at line 620. Lines 891-894 record `passed` with the current protocol.

CAP-85 binds the network, keys, artifacts, and baseline contracts at `tests/cap85.ts:607-619`.
It omits assertion identity. Reused steps get historical markers, but lines 1339-1357 can record top-level `passed`.

## Counterevidence and deployment reuse

Completed CAP-71 rows add `passed_previous_run`. Completed CAP-85 rows add historical status and `reused_evidence`.
See `tests/cap71.ts:885-887` and `tests/cap85.ts:1331-1337`.

`evidence/README.md:52-54` defines historical status. The protocol documents date acceptance and state protocol 28.
See `docs/PROTOCOL-UPDATES.md:47-58` and `evidence/protocol-acceptance.json:1-5`. No published summary shows this defect.

Deployment reuse is separate from assertion completion. Existing bindings protect contract identities and artifact hashes.
The mitigation must preserve deployments, unresolved submissions, and historical evidence.

## Reproduction evidence

My bounded check verifies the frozen CAP-71 source hash. It resumes protocol-28 checks under protocol 29 without `state.done`.

The row emits `passed` and protocol 29. Both nested checks retain protocol 28.
No reuse marker appears. The saved `done` row also combines protocols. No blocked live function ran.

The wider reproduction confirms completed CAP-71 and CAP-85 rows remain historical.
Reused CAP-85 steps expose `passed_previous_run` and `reused_steps`.

The protocol-29 case is hypothetical. The defect concerns future resumed output after an identity change.

## Minimum mitigation

Add an assertion identity to `done`, `checks`, and assertion `steps`.
Include the protocol, SDK version, and harness hash. Keep the existing deployment binding.

On a mismatch, preserve cached assertion evidence as historical. Require the current identity before top-level `passed`.
Otherwise, emit `passed_previous_run` or `not_run`. Never clear an `inflight` record through this migration.

Do not bind the complete checkpoint to the harness revision. That choice would block safe deployment reuse and complicate recovery.
Do not delete checkpoints because deletion would remove useful provenance.

## Verification steps

1. Save a completed row under protocol 28 and change only the protocol.
2. Confirm the row remains `passed_previous_run` with its old identity.
3. Save assertion steps without `done`, then change the harness identity.
4. Confirm old steps cannot produce a current top-level `passed`.
5. Confirm deployment calls remain zero when deployment bindings match.
6. Confirm changed keys, network, or artifacts still fail closed.
7. Confirm unresolved `inflight` state still blocks continuation.

## Checks, sources, and costs

| Check | Outcome | Evidence |
| --- | --- | --- |
| Independent CAP-71 partial-row reproduction | passed reproduction | `checks/concerns/c17-daybreak/cap71-partial-reuse.json` |
| C17 reproduction review and rerun | passed | `checks/concerns/c17-astra/checkpoint-versions.json` |
| Frozen manifest verification | passed: 199 files | Same evidence |
| Shared checkpoint tests | passed: 2, failed: 0 | `checks/concerns/c17-daybreak/commands.md` |
| CAP-71 checkpoint and restart tests | passed: 2, failed: 0 | Same command record |
| Live signing and testnet checks | `not_run` | Outside authorization |

No unresolved protocol fact required external research. The frozen source and tracked records are the primary evidence.
New research cost was `$0`. Jev cost was `$0` under the `$0.25` cap.
Other provider charges were `$0` because no query ran.

## Limits

The checks used synthetic state and a hypothetical protocol change. They do not prove current testnet behavior.
No live system or ignored checkpoint was accessed. I did not read the paired C17 report.
