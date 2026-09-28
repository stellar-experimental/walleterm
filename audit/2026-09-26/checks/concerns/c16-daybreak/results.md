# C16 Daybreak check results

Access date: 2026-09-26.

## Environment

- `sw_vers`: macOS 26.7, build `25G229`.
- `uname`: Darwin `25.6.0`, arm64.
- `bun --version`: `1.4.2`.
- `/System/Volumes/Data`: APFS, local, journaled.

## Frozen-source test

Command: `bun test tests/submission.test.ts`.

Working directory: `/private/tmp/walleterm-audit-40d6cca9db73`.

Result: **passed**, with 36 tests and zero failures.

The suite included a separate-process gate check.
It did not simulate an operating-system crash or power loss.

## Bun directory-sync capability probe

Command: `bun audit/2026-09-26/checks/concerns/c16-daybreak/directory-sync-probe.ts`.

Result: **passed** on Bun 1.4.2 and Darwin.

The file `fsyncSync` call passed.
The directory `fsyncSync` call passed after file creation.
The directory `fsyncSync` call passed after file deletion.

This probe proves API acceptance only.
It does not prove crash durability or hardware persistence.

## Native directory-sync capability probe

The probe compiled `fullfsync-directory-probe.c` into `/private/tmp`.
It opened an APFS directory with `O_DIRECTORY`.

Result: `fsync` returned zero.
Result: `fcntl(F_FULLFSYNC)` returned zero.

This probe proves API acceptance on this host only.
It does not prove persistence after a crash or power loss.

## Excluded checks

- Operating-system crash test: **not_run** by instruction.
- Power-loss test: **not_run** by instruction.
- Hardware fault test: **not_run** by instruction.
- Live signing and submission: **not_run** by instruction.
