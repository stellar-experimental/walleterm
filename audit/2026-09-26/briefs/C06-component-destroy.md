# C06: Camera and pairing work after connection component destruction

Read `CONCERN.md` and the named original reports.

Original reports:

- `reports/04-sdk-astra.md`
- `reports/04-sdk-daybreak.md`

Source: `sdk/connect.ts:207-214,569-607,665-720; sdk/scan.ts`.

Evidence: checks/04-sdk-astra/destroy-scan.test.ts; checks/04-sdk-daybreak/sdk-regressions.test.ts; checks/coordinator-reproductions.txt.

Resolve the severity disagreement. Check whether a late connection commit can occur. Keep the static demo and external SPA integration scopes distinct.

Write `reports/concerns/c06-component-destroy-MODEL.md`.
Use `checks/concerns/c06-MODEL/` and `research/concerns/c06-MODEL/` if needed.
Replace MODEL with your assigned `astra` or `daybreak` label.
