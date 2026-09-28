# C13: CAP-85 X06 interrupted recovery

Read `CONCERN.md` and both `reports/06-contracts-*.md` reports.
Source: `tests/cap85.ts:723,797,1201,1213,1355` and related checkpoint paths.
Evidence: `checks/06-contracts-astra/x06-recovery-repro.ts.txt` and `checks/coordinator-contract-2.txt`.

Check an interruption after the final executable change but before the row completes.
Assess whether cached steps require an earlier state that no longer exists.
Check both saved success and successful inflight reconciliation.
Keep safe blocking distinct from duplicate submission or false acceptance.
Specify the smallest recovery change that preserves historical evidence and final-state validation.

Write `reports/concerns/c13-x06-recovery-MODEL.md`.
Use `checks/concerns/c13-MODEL/` and `research/concerns/c13-MODEL/` if needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
