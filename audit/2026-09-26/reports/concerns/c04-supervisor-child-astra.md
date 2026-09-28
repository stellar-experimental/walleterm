# C04: Child survival after supervisor SIGKILL

## Identity and scope

| Field | Value |
| --- | --- |
| Reviewer | Fresh `gpt-6-astra`, `xhigh`, as assigned |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Review date | 2026-09-26 America/New_York; checks and source access occurred 2026-09-27 UTC |
| Assigned coverage | `bridge/launch.ts:1-463`; `bridge/tunnel-child.ts:1-58` |
| Supporting coverage | `bridge/runtime.ts:1-19`; `bridge/tunnel-child.test.ts:1-67`; narrow host and listener checks below |
| Original reports | `reports/03-runtime-astra.md`; `reports/03-runtime-daybreak.md` |

I read the required project documents and both assigned original reports.
I did not read the paired concern report or delegate work.
All 199 tracked snapshot files matched the manifest and baseline commit before the checks.
Their hashes remained unchanged afterward.

## Verdict

**Conditional concern; low severity, P3 priority.** One conditional concern remains; no confirmed production defect is established.
Confidence is high for the mock ownership gap and the documented main-process crash behavior.
Confidence is limited for real cloudflared persistence and its duration.
Potentially affected users run `walleterm tunnel` or `walleterm demo` on macOS.
Their supervisor must die abruptly, and cloudflared must remain alive afterward.
No affected live user, remote trigger, unauthorized signature, or additional public exposure was demonstrated.

The accepted main-parent crash promise remains supported.
Supervisor crash tolerance is an additional capability, outside that demonstrated promise.
Thus, C04 does not justify a release blocker or mandatory process-group redesign.

## Reachable path and evidence

1. `bridge/launch.ts:185-189` starts the supervisor with a parent-owned stdin pipe.
2. `bridge/tunnel-child.ts:6` starts cloudflared with ignored stdin and piped output.
3. Supervisor `SIGKILL` prevents its cleanup path at `bridge/tunnel-child.ts:8-18` from running.
4. `bridge/launch.ts:300-305` marks the supervisor exit as a lost tunnel.
5. Recovery calls `stopChild()` at `bridge/launch.ts:399`, then starts another supervisor at `bridge/launch.ts:404`.
6. `bridge/runtime.ts:4` returns immediately for the exited supervisor; it does not terminate surviving descendants.

The PID record at `bridge/tunnel-child.ts:22-31` provides no second cleanup owner in the launch code.
Both preserved reproductions passed unchanged on Darwin arm64 with Bun 1.4.2 (`744846f84`).
The direct reproduction found the mock child alive 100 milliseconds after supervisor death.
The integrated reproduction started two supervisors while the first mock child remained alive.
It replaces the listener, readiness, and health probes with mocks, and uses shorter recovery delays.
Both mock children print once, then remain idle. Neither exercises cloudflared's later output or connection behavior.
The checks therefore establish the local ownership gap, without establishing an unmanaged live tunnel.

## Counterevidence and limits

`docs/INTERFACE.md:47` promises cleanup through a parent pipe after a parent crash.
`bridge/tunnel-child.ts:46-57` handles that pipe and ordinary termination signals while the supervisor remains alive.
The existing main-parent `SIGKILL` test passed and removed the supervisor and its stubborn mock child.
Supervisor failure is a different failure point.

Installed cloudflared reports version `2026.9.3`; neither reproduction executes that binary.
Its versioned shutdown handler listens for `SIGTERM` and `SIGINT`. [Cloudflare source](https://raw.githubusercontent.com/cloudflare/cloudflared/2026.9.3/cmd/cloudflared/tunnel/signal.go)
Go normally exits after a broken-pipe write to stdout or stderr, unless signal handling changes that behavior. [Go documentation](https://pkg.go.dev/os/signal#hdr-SIGPIPE)
Consequently, a later cloudflared write could terminate it; the silent Bun mocks cannot exclude this possibility.
The logger source retrieval returned HTTP 404, so this review does not assert cloudflared's exact logging behavior.
Pipe closure alone also provides no measured upper bound on persistence.

Replacement updates the accepted origin at `bridge/launch.ts:313`.
Requests retaining the old host fail the checks at `bridge/server.ts:290-298` and `demo/server.ts:35-45`.
Shutdown closes listeners at `bridge/server.ts:611-619` and `demo/server.ts:88-91`.
These source checks limit the inferred impact to possible leftover processes and connections.
They do not prove Cloudflare forwarding behavior or constitute live acceptance.

## Minimum mitigation and alternatives

Clarify the documented limit: main-process crash cleanup requires a responsive supervisor.
Preserve the existing parent pipe and its passing regression test.
No runtime change is required to preserve that accepted guarantee.

If supervisor crash tolerance becomes required, isolate each supervisor and tunnel in a dedicated process group.
Terminate that owned group with bounded escalation before replacement and during shutdown.
Verify Bun's macOS group behavior and preserve separation between the demo, bridge, and caller terminal.
Do not use the caller's existing process group.
Reading `child.json` and signaling its PID alone risks PID reuse and provides no child-exit wait relationship.
These alternatives add lifecycle complexity; the mock alone does not justify that cost.

## Exact checks and verification

Run `python3 audit/2026-09-26/checks/concerns/c04-astra/run_checks.py` from the caller repository.
`checks/concerns/c04-astra/results.json` records exact child commands, working directories, timestamps, exit codes, and reproduction hashes.

| Status | Check | Evidence under `checks/concerns/c04-astra/` |
| --- | --- | --- |
| passed | Manifest and baseline verification; 199 files | `source-verification.json` |
| passed | `bun test bridge/tunnel-child.test.ts`; 1 test | `parent-crash.log` |
| passed | Preserved `orphan-supervisor-check.ts`; mock survival expected | `supervisor-crash.log` |
| passed | Preserved `orphan-recovery-check.ts`; mock survival during replacement expected | `supervisor-recovery.log` |

No new reproduction or production test was necessary.
If behavior changes, require old-child absence before replacement, including a child that ignores `SIGTERM`.
Retain the main-parent crash check and add an independent-service isolation check.
Actual cloudflared persistence and public behavior remain `not_run`; this conditional verdict requires no live check.

## Sources, costs, and remaining limits

Preserved [Node.js 26.10.0 documentation](https://nodejs.org/api/child_process.html#optionsdetached) supports possible child survival; local checks establish Bun applicability.
Its saved evidence is `research/03-runtime-daybreak/parallel-cli-node-child-lifecycle.json`, originally accessed 2026-09-26.
Preserved cloudflared `2026.9.3` source appears in `research/03-runtime-astra/cloudflared-2026.9.3-cmd.go:384-388`.
The new primary-source response appears in `research/concerns/c04-astra/parallel-fetch.json`, accessed 2026-09-27 UTC.
One Parallel MCP fetch returned two sources and one HTTP 404; usage was two `sku_extract_excerpts` units.
The provider supplied no dollar charge. The invoiced total remains unknown; no further paid calls ran.
New Jev cost: `$0.00`. Allocation: `$1` total, including at most `$0.25` for Jev.
Raven, Jev, parallel-cli, and Perplexity had no new calls; preserved evidence covered the remaining questions.
No public tunnel, signing, transaction submission, production edit, dependency change, or Git mutation occurred.
No blocker prevents this bounded report. No additional research allocation is requested.
