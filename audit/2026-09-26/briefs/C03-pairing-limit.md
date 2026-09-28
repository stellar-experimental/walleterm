# C03: Shared pairing limit and repeated invalid codes

Read `CONCERN.md` and the named original reports.

Original reports:

- `reports/02-bridge-astra.md`
- `reports/02-bridge-daybreak.md`

Source: `bridge/server.ts; bridge/PROTOCOL.md`.

Evidence: checks/02-bridge-daybreak/.

Assess the documented brute-force tradeoff. Origin can be forged by non-browser clients. Assess whether proposed per-Origin limits improve the actual threat model.

Write `reports/concerns/c03-pairing-limit-MODEL.md`.
Use `checks/concerns/c03-MODEL/` and `research/concerns/c03-MODEL/` if needed.
Replace MODEL with your assigned `astra` or `daybreak` label.
