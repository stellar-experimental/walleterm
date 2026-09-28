# C16 — Directory durability

## Decision

| Field | Result |
| --- | --- |
| Model / effort | Astra / xhigh, as requested |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Scope | Shared submission persistence, recovery documentation, and relevant macOS/APFS semantics |
| Verdict | Unsupported as a confirmed defect; retain an unproven host-failure persistence limit |
| Priority | Optional documentation or verification; no justified medium finding or release block |
| Confidence | High that the cited evidence does not establish the claimed APFS failure |
| Affected users | None demonstrated; the conditional scenario concerns dedicated testnet harness operators |
| Counts | Zero confirmed defects; one unproven limit |

The code omits directory synchronization, but that omission does not establish an actual defect under the documented recovery promise.
Reject V-07-02's confirmed medium classification and high-confidence power-loss scenario.
This conclusion does not certify power-loss safety.

## Source coverage and reachable scenario

The [manifest](../../checks/concerns/c16-astra/source-manifest.json) confirms nine reviewed files match the baseline.
I read both original `07-verification` reports and the assigned briefs.
I did not read the paired C16 report or another concern report.

- `tests/submission.ts:146-153` creates or opens each file, writes JSON, calls `fsyncSync`, and closes the descriptor.
- `:275-277` persists the prepared archive and exclusive pending gate before the RPC send at `:285`.
- `:278-281` propagates gate-persistence failures before that send.
- `:155-167` treats `ENOENT` as no gate; malformed content and other read failures block recovery through `:196-200`.
- `:203-205` blocks further work when a gate exists; `tests/live-utils.ts:53,97` checks this before signing.
- `:230-234` removes the gate; `:250-260` records a terminal outcome before removal.
- `:320-335` reconciles the saved hash and preserves unresolved outcomes.

The disputed scenario requires APFS to lose the completed gate creation after the network receives the transaction.
The next run would then see `ENOENT` and permit further work.
The source establishes that conditional consequence, but no evidence establishes its missing APFS premise.
Losing a deletion alone would restore an old gate and block work; it does not demonstrate an absent unresolved gate.

## Recovery promise and failure boundaries

`README.md:142` expressly promises protection across process restarts.
`docs/PLAN.md:37-40` requires original-hash recovery and journal preservation.
`docs/LIVE-TESTS.md:59-73` describes interrupted-run recovery and retained journals.
These passages do not expressly promise survival after power loss or hardware failure.

| Boundary | Evidence and limit |
| --- | --- |
| Process restart | Three focused tests passed, including a separate-process reader that blocks on the original gate. |
| Process crash | No forced crash ran. A process ending does not itself discard the running kernel's filesystem state. |
| Operating-system crash | Untested. Apple documents possible data loss after an OS crash; this does not isolate directory-entry loss. |
| Power loss | Untested. Apple distinguishes host writeback from device-cache persistence. Linux rules cannot establish this APFS failure. |
| Hardware persistence | `F_FULLFSYNC` requests a stronger device flush. Device behavior remains distinct from directory operation support. |

Apple documents APFS metadata crash protection, but this does not specify when this application's latest gate becomes persistent.
The reviewed Apple sources establish neither mandatory parent synchronization here nor automatic survival without it.
The installed manual explicitly includes APFS support for `F_FULLFSYNC`; the older archived manual predates APFS.
The installed manual also distinguishes `F_BARRIERFSYNC` ordering from persistence when the call returns.
Bun's `node:fs` API name alone does not establish its native call sequence.
Version-specific Bun source retrieval failed; I do not assume Node/libuv behavior applies to Bun.

## Checks and counterevidence

The host runs Bun `1.4.2+744846f84`, macOS `26.7` build `25G229`, and Darwin `25.6.0`.
The probe directory and checkout use the same APFS Data volume.

| Check | Result | Evidence under `checks/concerns/c16-astra/` |
| --- | --- | --- |
| Gate ordering, recreated guard, separate-process reader | Passed: 3 tests, 0 failures, 33 filtered tests | `focused-tests.stderr` |
| Bun regular-file synchronization | Passed | `directory-api-result.json` |
| Bun directory synchronization after creation and deletion | Accepted both calls | `directory-api-result.json` |
| Native `fsync` and `F_FULLFSYNC` on a file and directory | Accepted all four calls | `native-api-result.json` |
| Baseline identity and platform | Passed | `source-manifest.json`, `platform.json` |
| OS crash, power loss, hardware failure, live signing | `not_run` | Prohibited or outside scope |

Successful synchronization calls prove API acceptance on this host, not persistence after a failure.
The separate-process test keeps the parent alive; it does not simulate a process crash or host failure.
The [command record](../../checks/concerns/c16-astra/commands.md) lists commands, outcomes, and probe boundaries.

## Smallest justified action

Make no persistence code change for C16 on this evidence.
Optionally add: “Recovery covers process restarts. Recovery after an operating-system crash, power loss, or storage failure remains unverified.”
If a stronger promise becomes necessary, first verify Bun's native calls and obtain APFS-specific persistence semantics.
Then test the selected protocol against that promise, including newly created parent directories and device-flush behavior.
Directory synchronization alone is not an established fix for the complete power-loss claim.
Ordered mock assertions can check implementation order, but they cannot establish APFS persistence.

## Primary sources, usage, and completion

Access date: 2026-09-26. The [source record](../../research/concerns/c16-astra/sources.md) records applicability and retrieval limits.
Sources: [Apple `fsync`](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/fsync.2.html), installed `fsync(2)` and `fcntl(2)`, [Apple APFS guide](https://developer.apple.com/library/archive/documentation/FileManagement/Conceptual/APFS_Guide/Features/Features.html), and [Apple DTS discussion](https://developer.apple.com/forums/thread/800906).
Parallel MCP returned one search; `parallel-cli` failed with `APIConnectionError` after two automatic retries.
Web discovery and direct primary-source retrieval also ran; GitHub could not return the requested Bun source.
Jev usage was zero dollars. Other provider dollar charges were unavailable; no tool reported a charge.
Raven, Jev, and Perplexity were unnecessary for the bounded platform question; no paid deep-research processor ran.
The allocation was $1, including at most $0.25 for Jev. Unknown provider charges prevent an invoice-level total.
No source edits, system changes, keys, signing, submissions, public services, or delegation occurred.
The evidence bounds the claim. No completion blocker remains. No further allocation is needed.
