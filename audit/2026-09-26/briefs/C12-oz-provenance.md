# C12: Dirty OpenZeppelin build provenance

Read `CONCERN.md` and both `reports/06-contracts-*.md` reports.
Source: `fixtures/build.sh:19-27` and `fixtures/manifest.ts:15`.
Evidence: `checks/06-contracts-astra/provenance-repro.py` and `provenance-result.json`.

Assess the cached checkout's commit check and its handling of modified tracked files.
Distinguish wrong build attribution from evidence that current artifacts were actually altered.
Check whether a dirty-tree rejection is sufficient without deleting developer work.
Review the stubbed compiler's evidentiary limit. Do not perform network builds or modify cached source.

Write `reports/concerns/c12-oz-provenance-MODEL.md`.
Use `checks/concerns/c12-MODEL/` and `research/concerns/c12-MODEL/` if needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
