# C17: Checkpoint version identity

Read `CONCERN.md`, both `reports/07-verification-*.md`, and the relevant contract reports.
Source: CAP-71/CAP-85 checkpoint bindings, row reuse, `passed_previous_run`, and acceptance documentation.

Determine exactly what a reused row claims after a protocol or harness change.
Check whether the explicit historical status prevents a false current-acceptance claim.
Distinguish useful provenance improvement from a current correctness defect.
Keep deployment reuse separate from assertion completion.
Do not request live tests or discard existing checkpoints.

Write `reports/concerns/c17-checkpoint-versions-MODEL.md`.
Use `checks/concerns/c17-MODEL/` and `research/concerns/c17-MODEL/` when needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
