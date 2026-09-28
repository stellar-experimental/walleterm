# Check evidence

All checks target the frozen revision in `../manifest.json`.
The coordinator separates local tests from historical live acceptance.
No check in this audit requests a live 1Password signature or submits a transaction.

## Coordinator checks

| Check | Result | Evidence |
|---|---|---|
| Go race suite | Passed | `baseline-permitted-1.txt` |
| Go vet | Passed | `baseline-results.json` |
| Strict TypeScript check | Passed | `baseline-results.json` |
| Formatting check | Passed | `format-baseline.txt` |
| Bun suite and build | 224 tests passed | `baseline-permitted-2.txt` |
| Contract harness self-tests | Three passed | `baseline-permitted-2.txt` |
| Native Rust fixture tests | 30 passed across four workspaces | `rust-summary.json`, `rust-results.json` |
| Fixture artifact hashes | 14 matched their manifests | `fixture-hashes.json` |
| Local browser flow | Connect, switch, restore, and disconnect passed | `BROWSER.md` |
| Automated accessibility | Zero violations; one incomplete check | `browser-a11y-connection.json`, `browser-a11y-connected.json` |
| SDK and demo concern checks | 16 passed; several reproduce defects | `coordinator-reproductions.txt` |
| Contract concern checks | RPC-root and X06 behavior reproduced | `coordinator-contract-1.txt`, `coordinator-contract-2.txt` |
| Verification concern checks | Two CLI failures and two safe guard controls reproduced | `coordinator-verification.txt` |
| Checkpoint label review | Incomplete CAP-71 row reused old checks with a new pass label; seven controls passed | `coordinator-checkpoint-versions.json` |
| Source and document integrity | Current result in the linked record | `audit-integrity.json` |

The first socket tests failed because the sandbox denied mock listeners.
Permitted reruns passed. These initial failures do not establish product defects.

## Interpretation

A passing reproduction can confirm a defect's current behavior.
It does not show that the defect is fixed.
Each reviewer identifies the expected behavior and the tested condition.

Reviewer check directories contain commands, logs, and focused mock scripts.
They can repeat baseline cases. Do not add their totals to claim unique test coverage.
The central 224-test result is the broad Bun baseline.

Physical camera behavior, VoiceOver, live 1Password approval, and current testnet acceptance remain `not_run`.
Mock keys exist only in offline tests.
Historical acceptance documents remain evidence for their recorded dates and source versions.

Run `python3 audit/2026-09-26/checks/verify-audit.py` from the repository to refresh artifact integrity.
The script compares all tracked baseline files and checks document links.
It also consolidates reported Jev usage. It does not claim a complete provider invoice.

`source-baseline.tar.gz` preserves all 199 tracked baseline files.
`source-archive.json` records its hash and confirms an exact match with the source manifest.
The archive excludes credentials, ignored runtime state, dependencies, and caches.
The original reproduction scripts use `/private/tmp/walleterm-audit-40d6cca9db73` for this source.
Restore the archive there before replaying evidence after temporary files expire.
Install the pinned dependencies separately. Do not run live acceptance commands during an offline replay.

## Final package verification

The final package preserves audit probes as text files.
The [probe map](source-archive-map.json) records 36 original names, archived names, and unchanged content hashes.
Original command logs retain the commands that ran.
Use an isolated copy for replay. Restore each probe's original name from the map in that copy.
Restoring source extensions can add probes to normal test discovery.

Raw provider responses reside in `../research/evidence.tar.gz`.
The archive manifest records logical paths and verified hashes.
Human source notes and usage summaries remain beside the archive.
The research record describes two irrelevant public documentation example redactions.

The [final checkout results](final-package-results.json) record four passing checks and one TypeScript failure.
Go race tests, Go vet, formatting, and the complete Bun command passed.
Bun still ran 224 tests and three contract self-tests.

The TypeScript failure came from concurrent ignored files under `evidence/pagebook-2026-09-26/`.
All 174 diagnostics refer to that directory. Its source captures are outside the frozen baseline and audit package.
The audit did not change those files or the TypeScript configuration.

The [isolated TypeScript check](isolated-package-typescript.json) passed with all 199 baseline files and the audit package.
The check verified every baseline hash before running `bun run typecheck`.
The original checkout failure remains recorded. The isolated result does not replace it.

The overall reviews finished before these packaging checks.
Their pending packaging notes refer to that earlier review state.
Some report links now identify archived probes. Reviewer input inventories describe their original prepackaging inputs.

The [format notes](artifact-format-notes.json) identify raw outputs that have JSON suffixes without valid JSON content.
These preserved CLI outputs and initial failed-probe output are not audit control metadata.

Run `python3 audit/2026-09-26/checks/verify-audit.py --final` to verify the final audit package.
Its completion result keeps the current checkout TypeScript limitation explicit.
