# C07: Credential cleanup after a non-JSON 401

Read `CONCERN.md` and the named original reports.

Original reports:

- `reports/04-sdk-daybreak.md`

Source: `sdk/walleterm.ts:85-101; sdk/connect.ts:267-313,345-355`.

Evidence: checks/04-sdk-daybreak/sdk-regressions.test.ts.

The actual bridge returns JSON errors. Establish an applicable intermediary path or classify the issue as conditional resilience work.

Write `reports/concerns/c07-unreadable-401-MODEL.md`.
Use `checks/concerns/c07-MODEL/` and `research/concerns/c07-MODEL/` if needed.
Replace MODEL with your assigned `astra` or `daybreak` label.
