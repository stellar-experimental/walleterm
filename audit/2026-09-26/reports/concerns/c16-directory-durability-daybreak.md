# C16 — Directory durability on macOS and APFS

## Assignment

| Item | Value |
| --- | --- |
| Concern | `C16` |
| Model / effort | Daybreak / xhigh |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Source scope | `tests/submission.ts`, recovery documents, and focused tests |

## Verdict

| Item | Decision |
| --- | --- |
| Verdict | **Unsupported as a confirmed defect; unproven power-loss limit** |
| Priority | None for the documented promise |
| Confidence | High |
| Actual affected users | None demonstrated within the process-restart promise |

Reject `V-07-02` as a confirmed defect.
The documented promise covers process restarts.
It does not promise operating-system crash, power-loss, or hardware-level persistence.
No macOS primary source establishes directory-entry loss from this omission.
Linux guidance and missing tests do not establish an APFS defect.

## Reachability and source trace

[`persist()`](/private/tmp/walleterm-audit-40d6cca9db73/tests/submission.ts:146) opens the gate with `wx` and mode `0600`.
It writes the complete JSON and calls `fsyncSync` before closing the file.
[`send()`](/private/tmp/walleterm-audit-40d6cca9db73/tests/submission.ts:264) completes both persistent writes before the first RPC send.
An ordinary process crash before those calls finish cannot follow with an RPC send.

[`clear()`](/private/tmp/walleterm-audit-40d6cca9db73/tests/submission.ts:230) unlinks the gate only after a terminal result.
An undurable deletion could restore a stale gate after a system crash.
That case fails closed and affects availability only.
The [README promise](/private/tmp/walleterm-audit-40d6cca9db73/README.md:142) explicitly says “across process restarts.”
The [recovery guide](/private/tmp/walleterm-audit-40d6cca9db73/docs/LIVE-TESTS.md:65) requires original-hash reconciliation.

## Fault model separation

| Event | Evidence and result |
| --- | --- |
| Process restart | **passed**: a new Bun process read the gate and blocked signing |
| Process crash | Covered by the same live kernel state after `persist()` returns |
| Operating-system crash | **unproven**: Apple gives no file-only APFS directory-entry guarantee |
| Power loss | **not guaranteed** by ordinary `fsync`, according to Apple |
| Hardware persistence | **not guaranteed** because hardware can ignore flush requests |

Apple says APFS copy-on-write metadata protects filesystem updates from crashes.
Apple does not promise that the newest gate entry survives every power failure.
Apple states that ordinary `fsync` can still lose data after an operating-system crash or power loss.
Apple directs stricter applications to `F_FULLFSYNC`, but hardware can ignore that request.
Therefore, a parent-directory `fsync` alone would not establish full power-loss durability.

## Checks and counterevidence

| Check | Outcome |
| --- | --- |
| `bun test tests/submission.test.ts` | **passed**: 36 tests, zero failures |
| Bun directory `fsyncSync` after creation | **passed capability probe** |
| Bun directory `fsyncSync` after deletion | **passed capability probe** |
| Native directory `fsync` on APFS | **passed capability probe** |
| Native directory `F_FULLFSYNC` on APFS | **passed capability probe** |
| Operating-system crash or power loss | **not_run** by instruction |

The probes used Bun 1.4.2 on macOS 26.7 with an APFS data volume.
They show that macOS accepts directory synchronization.
They do not prove what survives a crash.
See [check results](../../checks/concerns/c16-daybreak/results.md) and the two probe sources.

## Minimum mitigation and verification

Make no runtime change for C16.
Reclassify the original claim as an unproven durability limit.

The smallest optional action is a documentation sentence.
It should state that recovery covers process restarts, not power loss.

Define a stronger fault model before adding platform-specific persistence code.
Then test file creation, deletion, directory synchronization, and full device flushes separately.
Use destructive crash testing only in a disposable, authorized environment.

## Primary sources, usage, and limits

Apple documents [`fsync`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html) and [`F_FULLFSYNC`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fcntl.2.html).
Apple documents [APFS crash protection](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/Features/Features.html).
Apple publishes the [XNU `fsync` path](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/vfs/vfs_syscalls.c#L8308-L8401).
Bun documents [`node:fs` compatibility](https://bun.sh/docs/runtime/nodejs-compat).

Parallel Search MCP found the primary sources.
`parallel-cli` failed after two automatic retries and created no result file.
Charges from both providers remain unknown.
Jev usage and visible Jev cost were zero.

The review did not run destructive tests, system changes, signing, submissions, or public services.
It did not inspect the paired concern report.
No blocker remains for this bounded conclusion.
