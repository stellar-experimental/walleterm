# C15: Incomplete SDK distribution instructions

Read `CONCERN.md` and both `reports/08-product-*.md` reports when available.
Source: `docs/CONNECTION-UI.md:19-20`, `scripts/build.ts`, and package exports.
Evidence: `checks/08-product-astra/distribution-probe.py` and `distribution-probe.json`.

Compare the documented copy layout with the actual split browser build.
Check the complete-distribution control and the installed demo's asset handling.
Determine the smallest documentation fix and an offline verification command.
Do not publish packages or change installed files.

Write `reports/concerns/c15-sdk-distribution-MODEL.md`.
Use `checks/concerns/c15-MODEL/` and `research/concerns/c15-MODEL/` when needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
