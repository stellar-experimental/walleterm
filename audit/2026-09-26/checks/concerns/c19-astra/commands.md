# C19 check record

Caller: `/Users/kalepail/Desktop/walleterm-v2`.
Source: `/private/tmp/walleterm-audit-40d6cca9db73`.
Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Decisive command

```sh
python3 audit/2026-09-26/checks/concerns/c19-astra/verify.py
```

Final result: passed, exit 0.
The script only reads source, cached crates, the baseline Git tree, and existing outputs.
It writes evidence within the assigned C19 Astra directories.

`verification.json` records exact arguments, working directories, return codes, and outputs for these subprocesses:

```sh
git ls-tree -rz --full-tree 40d6cca9db732a0db16d154c80d4a153bf33c6b7
find fixtures/cap85/contracts fixtures/cap85/contracts-sdk27 -type d -name test_snapshots -prune -print
git check-ignore --no-index -v --stdin
sh -n fixtures/cap85/build.sh
```

The `find` and `sh` commands use the frozen source directory.
Git commands use the caller repository. The script first verifies both `.gitignore` copies match.
The ignore check receives the 16 generated paths listed in `verification.json`.
The script compares all frozen file hashes against Git and the audit manifest.
It scans tracked Rust, TypeScript, shell, YAML, and Makefile source for snapshot inputs or comparison references.
Manual inspection covers all five CAP-85 test files and SDK capture, output, and file-reading methods.
The SDK check hashes both cached crate archives and compares inspected source bytes with their archive members.
It extracts evidence text without extracting archive files or changing caches.

## Initial check-script failures

The same Python command failed twice before the final passing run.

1. Exit 1: `ModuleNotFoundError: No module named 'tomllib'` under Python 3.9.
   I removed that dependency and parsed only the exact locked package block.
2. Exit 1: `.cargo-checksum.json` was absent from the cached SDK directory.
   I verified the cached `.crate` archive against the lockfile checksum instead.

Both failures came from the review script. Neither established a product failure.
An initial `nl` read also failed for two incorrect manifest paths.
Those paths were `fixtures/cap85/Cargo.toml` and `fixtures/cap85/sdk27/Cargo.toml`.
I then read `fixtures/cap85/contracts/Cargo.toml` and `fixtures/cap85/contracts-sdk27/Cargo.toml` successfully.

## Preserved checks and research

I inspected `checks/08-product-daybreak/build-script-cleanup.json` before creating the verification script.
It contains a corrected static classification, not an executed deletion reproduction.
I inspected `checks/tracked-snapshot-check.json` and independently verified its ownership claim.
I read the relevant central logs and command records:

```sh
cargo test --locked --offline --manifest-path fixtures/cap85/contracts/Cargo.toml --workspace
cargo test --locked --offline --manifest-path fixtures/cap85/contracts-sdk27/Cargo.toml --workspace
```

Those preserved runs passed 13 and one tests, respectively. This review did not execute them again.
Evidence: `checks/rust-cap85.txt`, `checks/rust-legacy27.txt`, `checks/rust-results.json`, and `checks/rust-summary.json`.
I read the preserved snapshot semantics summary and the exact locked SDK sources.
The existing Raven JSON contains CLI evidence, so it does not independently prove snapshot behavior.
No new provider call, paid search, key access, signing, submission, public service, or cleanup execution occurred.
New research cost is $0, including Jev $0. No new provider charge remains unknown.
