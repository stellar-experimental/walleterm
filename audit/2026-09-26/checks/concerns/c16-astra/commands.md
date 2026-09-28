# C16 check record

Source root: `/private/tmp/walleterm-audit-40d6cca9db73`.
Evidence root: `/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26`.
All mutations stayed inside the assigned evidence directories or disposable temporary probe directories.
No command read signer metadata, opened a signing socket, or contacted Stellar.

## Source inspection

Read the three assigned briefs, snapshot `AGENTS.md`, `README.md`, `docs/PLAN.md`, and `docs/INTERFACE.md`.
Read both original `reports/07-verification-*.md` reports and their source records.
Read `tests/submission.ts`, relevant `tests/submission.test.ts` cases, `docs/LIVE-TESTS.md`, and the signer gates in `tests/live-utils.ts`.
Read `sdk/errors.ts`, the guard's runtime import.
Used `rg`, `nl -ba`, `sed`, and `cat` for those reads.
No paired concern report or other concern report entered the review.
A narrow memory search returned no relevant durability entry; no memory informed the conclusion.

## Platform and identity

```sh
bun --revision
sw_vers
uname -r
df -T apfs /private/tmp /Users/kalepail/Desktop/walleterm-v2
```

All commands passed. `platform.json` retains commands, exit codes, and output.
`bun-revision.txt` retains the separate Bun identity check.
A Python check compared each reviewed file with `git -C /Users/kalepail/Desktop/walleterm-v2 show REVISION:FILE`.
It used revision `40d6cca9db732a0db16d154c80d4a153bf33c6b7` and SHA-256 for nine files.
All files matched. See `source-manifest.json`.

## Targeted existing tests

Working directory: the frozen source root.

```sh
bun --no-env-file test tests/submission.test.ts --test-name-pattern 'gate and envelope persist|a recreated guard remains blocked|a separate process reads'
```

Outcome: exit 0; 3 passed; 33 filtered; 0 failed.
Evidence: `focused-tests.stdout` and `focused-tests.stderr`.
The tests use fake RPC handlers, mock envelope strings, temporary directories, and no signing keys.
The separate-process test starts a child reader while the parent remains alive.
These tests establish ordering and restart visibility, not physical persistence.

## Safe operation-support probes

Working directory: the caller repository.

```sh
bun --no-env-file run audit/2026-09-26/checks/concerns/c16-astra/directory-api-probe.ts
python3 audit/2026-09-26/checks/concerns/c16-astra/native-api-probe.py
```

Both commands exited 0.
Bun accepted file synchronization and directory synchronization after creation and deletion.
Native `fsync` and `F_FULLFSYNC` accepted both the file and directory descriptors.
Evidence: `directory-api-result.json`, `native-api-result.json`, and the retained scripts.
Each script removed its own temporary directory under `/private/tmp`.
The probes did not crash a process, reboot, detach storage, interrupt power, or inject filesystem loss.

## Platform documentation

```sh
MANPAGER=cat man 2 fsync | col -bx
MANPAGER=cat man 2 fcntl | col -bx
rg -n 'F_FULLFSYNC|F_BARRIERFSYNC' /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/sys/fcntl.h
```

All reads passed. The research directory retains both manual pages.
The header defines `F_FULLFSYNC` as `51` and `F_BARRIERFSYNC` as `85`.
The native probe uses the first definition; it does not change any system setting.

## Research command

Read the parallel-web-search skill and `parallel-cli search --help` before this invocation.

```sh
parallel-cli search 'Find primary Apple documentation about APFS fsync of a newly created file, parent directory entry persistence, and F_FULLFSYNC power loss guarantees. Distinguish directory fsync support from guarantees.' -q 'site:developer.apple.com APFS fsync directory F_FULLFSYNC' -q 'site:developer.apple.com fsync directory durability crash' --json --max-results 6 --excerpt-max-chars-total 16000 -o audit/2026-09-26/research/concerns/c16-astra/parallel-cli.json
```

Outcome: exit 4, `APIConnectionError`, two automatic retries, and no result JSON file.
The named research directory retains stdout and stderr.
Parallel MCP subsequently supplied the scoped discovery result without repeating the CLI call.
Web and GitHub retrieval records retain their successes and failures.
See the research `sources.md` file for exact URLs, applicability, charges, and remaining limits.
