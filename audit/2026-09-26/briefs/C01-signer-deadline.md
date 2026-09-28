# C01: Output backpressure and the advertised signer deadline

Read `CONCERN.md` and the named original reports.

Original reports:

- `reports/01-signer-astra.md`
- `reports/01-signer-daybreak.md`

Source: `main.go:113,137,169,193; docs/INTERFACE.md`.

Evidence: checks/01-signer-astra/audit_test.go; checks/01-signer-astra/audit-output-deadline.log.

Determine whether documentation clarification is sufficient. Keep normal pipe consumers and caller responsibility explicit.

Inspect the preserved 122-second reproduction first. Do not repeat the long wait unless its evidence is insufficient.

Write `reports/concerns/c01-signer-deadline-MODEL.md`.
Use `checks/concerns/c01-MODEL/` and `research/concerns/c01-MODEL/` if needed.
Replace MODEL with your assigned `astra` or `daybreak` label.
