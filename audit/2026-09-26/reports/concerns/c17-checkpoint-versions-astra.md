# C17: Checkpoint version identity

## Identity and scope

| Field | Value |
| --- | --- |
| Reviewer | `gpt-6-astra`, `xhigh`, as assigned |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Scope | CAP-71/CAP-85 checkpoint identity, reused assertions, result recording, and acceptance documentation |
| Verdict | **Confirmed, narrowed: Low evidence-label defect in incomplete CAP-71 row completion** |
| Completed-row reuse | **Accepted historical limit; no false current-acceptance claim demonstrated** |
| Confidence | High for local behavior; no demonstrated live protocol incompatibility |
| Affected users | Operators who resume incomplete CAP-71 acceptance after a protocol or assertion change |

I read both assigned verification reports and both contract reports.
I did not read the paired C17 report or another concern report.
I used the smart-contracts testing guidance to separate offline checks from live acceptance.
All source references below refer to the frozen revision.

## What the reused results claim

Both bindings omit the protocol, JavaScript SDK version, and harness revision.
CAP-71 binds the network, ordered keys, and WASM hashes (`tests/cap71.ts:428`).
CAP-85 also binds baseline contract identifiers (`tests/cap85.ts:607`).
These fields establish deployment identity, not assertion freshness.

| Path | Actual claim |
| --- | --- |
| Completed CAP-71 row, `tests/cap71.ts:885` | `passed_previous_run`, `reused_evidence: true`, and the original row's protocol |
| Completed CAP-85 row, `tests/cap85.ts:1331` | `passed_previous_run` and saved details; X07 remains `observed_previous_run` |
| CAP-85 saved step, `tests/cap85.ts:797` | Historical event plus `reused_steps` in the enclosing row's details |
| Incomplete CAP-71 row, `tests/cap71.ts:620` | Cached checks can produce a new `passed` row with the current protocol |

Changing an assertion does not run it when a completed row exists.
The explicit historical status makes that behavior consistent with `evidence/README.md:53`.
CAP-85's current setup protocol does not establish the historical row's original protocol (`tests/cap85.ts:1316`).
Its missing row-level version metadata remains a provenance improvement.
The result recorder preserves these statuses and adds an event timestamp (`tests/live-utils.ts:44`).
That timestamp records reuse; it does not establish when the original assertions ran.

## Narrow confirmed defect

The historical label does not cover every CAP-71 assertion-reuse path.
`call()` saves each completed check before the enclosing row saves `done` (`tests/cap71.ts:741`, `tests/cap71.ts:892`).
A process can stop after the final check save but before the row save.
The next run can observe a different protocol while its deployment binding remains equal.
`call()` returns each cached check before its assertions (`tests/cap71.ts:620`).
The row then records `passed` with the current protocol (`tests/cap71.ts:891`, `tests/cap71.ts:894`).
It adds no `reused_evidence` or `reused_checks` marker.

The offline check seeded protocol-28 checks and mocked a protocol-29 response.
The actual frozen runner reported `passed`, protocol `29`, and two nested protocol-28 checks.
It performed zero simulations, signatures, and submissions.
This reproduces ambiguous completion evidence; it does not demonstrate a failed protocol assertion passing live.
The nested protocol fields preserve counterevidence for a careful reader.
Harness changes face the same missing identity check, but the reproduction did not mutate the harness.

## Counterevidence and limits

Completed rows retained their historical labels in both offline checks.
CAP-85 also marked reused assertion steps in an incomplete row.
Both runners rejected protocols below their minimum requirements and rejected changed checkpoint networks.
The checkpoint tests already cover binding failures and interrupted submissions; they do not establish assertion freshness.
`evidence/README.md:3` dates acceptance to 2026-09-25.
`evidence/protocol-acceptance.json:531` identifies the historical harness through source hashes.
`docs/BUN-MIGRATION.md:48` explicitly excludes fresh live acceptance of the migrated code.
These records do not claim fresh acceptance of this frozen revision.
No finding concerns the production signer, key exposure, or unauthorized submission.

## Minimum mitigation and verification

Mark CAP-71 cached checks as reused when completing an incomplete row.
Report their original protocol separately from the current environment protocol.
Use an explicit historical or mixed-evidence status when the row relies on earlier assertions.
Keep deployment receipts, salts, completed operations, and unresolved submissions intact.

If revision-specific acceptance becomes required, record assertion identity separately from deployment identity.
Include the protocol, SDK version, and relevant harness hashes in that assertion record.
Require explicit review before new acceptance after an identity change.
Do not automatically repeat state-changing steps or erase checkpoints to refresh assertions.
Verify completed-row reuse, interrupted completion, mixed old/new checks, and changed assertion identity with isolated checkpoints.
Assert clear historical labels and zero repeated submissions for saved operations.

## Checks, sources, and costs

The command and evidence index is `checks/concerns/c17-astra/COMMANDS.md`.
The result is `checks/concerns/c17-astra/checkpoint-versions.json`; its stderr file is empty.
Seven targeted checks passed, including the narrow defect reproduction.
All 199 tracked source hashes matched the audit manifest.
The CAP-85 check executed extracted frozen functions with injected dependencies; it did not run live CAP-85 acceptance.
Existing reproductions received inspection before this check; none tested changed-version row labels.
No full baseline suite, live signature, network request, or testnet transaction ran.

Preserved [CAP-71](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-01.md) and [CAP-85](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0085.md) text supplied protocol context only.
`research/concerns/c17-astra/SOURCES.md` records their access dates, hashes, applicability, and limits.
New research cost: **$0 total; $0 Jev; no unknown new provider charges**.
No unresolved fact required another provider call. No allocation increase or completion blocker remains.
