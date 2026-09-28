# C19 concern review — CAP-85 fixture snapshots

## Identity and scope

| Item | Value |
| --- | --- |
| Concern | `C19` |
| Verdict | **Unsupported** |
| Priority | None |
| Confidence | High |
| Model and effort | Daybreak xhigh |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Actual affected users | None demonstrated |

I reviewed only the assigned build script, ignore rule, lockfiles, tests, outputs, and SDK behavior.
I read both original `08-product` reports, but not the paired C19 report.
I used no delegation.

## Verdict

The documented build does not delete tracked files in the frozen baseline.
It deletes ignored files that the Soroban SDK generates during native tests.
The SDK writes each file after the corresponding `Env` drops.
Neither the SDK nor the fixture tests compare earlier files during `cargo test`.
The cleanup cannot weaken signer tests or contract assertions.
No production signer path uses these files.

## Reachable scenario

`docs/LIVE-TESTS.md:35-39` documents `sh fixtures/cap85/build.sh`.
The script builds both workspaces at `fixtures/cap85/build.sh:11-12`.
It runs both test suites at lines 13-14, then removes `test_snapshots` directories at line 15.
`set -eu` stops the script before cleanup when a test fails.
The `find` scope includes only `contracts` and `contracts-sdk27`.

## Evidence

The exact Git tree contains 199 tracked files and zero tracked snapshots.
The audit manifest contains 199 hashes and zero snapshot paths.
`.gitignore:27` matches `**/test_snapshots/`.
Hashes for `build.sh`, `.gitignore`, and both lockfiles matched the manifest and baseline Git blobs.
Coordinator tests generated 16 snapshot JSON files after the frozen source snapshot.
The files contain authorization records, ledger entries, events, and generated values.
The CAP-85 workspaces lock `soroban-sdk` versions `28.0.0` and `27.0.6`.
Both SDK versions enable snapshot capture by default.
The SDK documentation tells maintainers to commit snapshots and inspect later changes.
Each implementation calls `snapshot.write_file(p).unwrap()` without reading an earlier file.
SDK 28 implements this behavior at `soroban-sdk-28.0.0/src/env.rs:2108-2184`.
SDK 27 implements it at `soroban-sdk-27.0.6/src/env.rs:2034-2100`.
The fixture source contains no snapshot reader or comparison.
The Rust tests use direct assertions for contract behavior.

## Counterevidence

Soroban snapshots can become regression baselines in a repository that commits them.
Their diffs can expose behavior changes during code or protocol upgrades.
This repository does not adopt that workflow for CAP-85.
The ignore rule and empty baseline tree establish current source ownership.

## Minimum mitigation and alternatives

No mitigation is required for C19.
Do not change `fixtures/cap85/build.sh` from this concern.
Committing snapshots would create a new differential-review policy.
Current evidence does not justify that added source ownership or maintenance cost.

## Checks

| Check | Outcome |
| --- | --- |
| `git ls-tree -r --name-only 40d6cca9db73...` | passed; 199 files |
| Baseline tree search for `/test_snapshots/` | passed; zero matches |
| Manifest key count and snapshot search | passed; 199 hashes and zero matches |
| `git check-ignore -v` on a CAP-85 snapshot path | passed; `.gitignore:27` matched |
| Four scoped SHA-256 comparisons | passed; manifest, frozen source, and Git blobs matched |
| Fixture snapshot reader search | passed; no reader or comparison exists |
| SDK 27.0.6 and 28.0.0 source inspection | passed; write-only test snapshot behavior |
| Supplied CAP-85 Rust results | passed; 14 tests and zero failures |
| Cleanup execution | `not_run`; source and ownership evidence was decisive |
| Live signatures, services, and testnet actions | `not_run`; prohibited and unnecessary |

I inspected the existing reproduction evidence before running any checks.
I added no test and changed no generated output.

## Sources, research usage, and limits

The primary source is the [Stellar test snapshot guide](https://developers.stellar.org/docs/build/guides/testing/differential-tests-with-test-snapshots).
The preserved evidence accessed it on 2026-09-26.
The local locked SDK sources provide version-specific behavior.
I reused `checks/tracked-snapshot-check.json` and `checks/08-product-daybreak/build-script-cleanup.json`.
I reused `research/08-product-daybreak/soroban-test-snapshot-semantics.md`.
New research cost was **$0.00**.
Jev usage was **$0.00**.
No provider call created an unknown charge.
I did not execute the cleanup command because it would change generated files.
I did not repeat the full baseline suite.
These limits do not affect the verdict.
