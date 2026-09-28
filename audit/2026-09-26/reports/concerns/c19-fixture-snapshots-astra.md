# C19 — CAP-85 snapshot cleanup

| Field | Result |
| --- | --- |
| Reviewer | Astra; requested model `gpt-6-astra`, effort `xhigh`; independent runtime metadata unavailable. |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Verdict | **Unsupported. Reject tracked-file deletion and weakened-assertion claims.** |
| Priority / confidence | None / high |
| Concern count | One reviewed; zero confirmed defects; zero unresolved concerns. |
| Affected users | Fixture developers lose generated diagnostic outputs after successful builds. No defective signer behavior was demonstrated. |

## Scope and reachable behavior

Scope covers `fixtures/cap85/build.sh:7-16`, `.gitignore:27`, both CAP-85 workspaces, their five test files, and SDK snapshot behavior.
`docs/LIVE-TESTS.md:38` documents `sh fixtures/cap85/build.sh`.
The script builds WASM, runs both native test workspaces, then removes `test_snapshots` directories within those workspaces.
`set -eu` at line 7 stops the script after an ordinary build or test failure.
I did not read the paired concern report, delegate, or inspect adjacent concerns.

## Decisive evidence and counterevidence

Git and the manifest contain 199 files, zero snapshots, and matching frozen hashes; `checks/concerns/c19-astra/verification.json` independently confirms this.
The cleanup selection contains five directories and 16 JSON outputs. `.gitignore:27` ignores every output.
The lockfiles select SDK **28.0.0** and **27.0.6**; `27.0.2` is the legacy manifest requirement, not its locked version.
Both SDKs enable capture by default and write snapshots when the last eligible test environment closes.
SDK 28 references: `src/env.rs:339,2109-2190`; SDK 27.0.6 references: `src/env.rs:284,2035-2107`.
Both define `Snapshot::write_file` at `src/testutils.rs:100-107`; it replaces output through `File::create` and never compares earlier output.
All five fixture test files use direct assertions: 32 assertion calls plus two expected-panic tests.
Examples include `contracts/account/src/test.rs:39-61` and `contracts/manager/src/test.rs:25-73`, relative to `fixtures/cap85/`.
No fixture test reads or compares these snapshots. The tracked-source reference scan finds only the cleanup command.
Counterevidence: SDK guidance recommends committing snapshots for differential review. This repository deliberately ignores them and implements no comparison gate.

## Minimum mitigation and verification

**No source change is justified.** Close C19 as unsupported and retain the corrected classification.
Run `python3 audit/2026-09-26/checks/concerns/c19-astra/verify.py` from the caller repository to repeat the checks.
Result: **passed**; source ownership, ignored outputs, script syntax, assertion references, and locked SDK archive provenance match.
Exact subprocess commands and outputs appear in `verification.json`; `commands.md` records the initial check-script failures and corrections.
Preserved `checks/rust-cap85.txt` and `checks/rust-legacy27.txt` show 14 passing tests; I did not repeat them.

## Primary sources, cost, and limits

Accessed locally on 2026-09-26: [SDK 28 source](https://github.com/stellar/rs-soroban-sdk/blob/48d506712f964094d14176e2f0b02afcd1054567/soroban-sdk/src/env.rs#L2109), [SDK 27.0.6 source](https://github.com/stellar/rs-soroban-sdk/blob/60926a20d1f9f0a669d5fe551636f42a1302f0c0/soroban-sdk/src/env.rs#L2035).
I verified cached crate hashes and inspected source bytes; `research/concerns/c19-astra/sdk-provenance.json` and `sdk-source-excerpts.txt` record the evidence.
I reused the preserved [Stellar differential-testing guidance](https://developers.stellar.org/docs/build/guides/testing/differential-tests-with-test-snapshots), accessed on 2026-09-26.
Preserved summary: `research/08-product-daybreak/soroban-test-snapshot-semantics.md`. Locked SDK code supplies the decisive evidence.
New provider calls: zero. New research: **$0 total; Jev $0**. New unknown provider charges: none.
Cleanup execution, fresh Cargo tests, live signatures, and testnet acceptance remain `not_run` in this review.
I changed only assigned report and evidence files. Existing source, snapshots, build caches, and Git state remained unchanged.
Blockers: none.
