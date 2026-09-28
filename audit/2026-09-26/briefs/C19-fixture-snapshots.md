# C19: CAP-85 build cleanup and tracked snapshots

Read `CONCERN.md` and both `reports/08-product-*.md` reports.
Source: `fixtures/cap85/build.sh:15`, generated `test_snapshots` outputs, and the Soroban SDK test behavior.
Evidence: `checks/08-product-daybreak/build-script-cleanup.json`.
The coordinator found zero tracked snapshots in the exact baseline tree and manifest.
Read `checks/tracked-snapshot-check.json` and verify this source-control fact independently.
The native test runs generated ignored diagnostic files after the source snapshot was created.

Verify whether the documented build deletes tracked files.
Determine whether Soroban `test_snapshots` are asserted regression baselines or generated diagnostic records.
Do not claim weakened assertions unless the actual SDK or fixture tests compare these files.
Separate repository cleanup inconsistency from signer or contract correctness.
If the files are ignored outputs, reject the alleged tracked-file deletion. Do not propose a change without another demonstrated defect.
Do not change source, tracked artifacts, or existing build caches.

Write `reports/concerns/c19-fixture-snapshots-MODEL.md`.
Use `checks/concerns/c19-MODEL/` and `research/concerns/c19-MODEL/` if needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
