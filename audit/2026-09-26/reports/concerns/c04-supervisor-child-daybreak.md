# C04: tunnel child survival after supervisor `SIGKILL`

## Scope and assignment

| Field | Value |
| --- | --- |
| Reviewer | `daybreak`; model `gpt-daybreak-blue-latest`; effort `xhigh` |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Assigned source | `bridge/launch.ts`; `bridge/tunnel-child.ts` |
| Coverage | Launch, monitoring, replacement, signals, parent pipe, and child cleanup |
| Baseline | Central Go race and Bun checks passed. I did not repeat them. |

I read both named reports and existing reproductions without reading the paired C04 concern report.

## Verdict

**Verdict:** Conditional, with no confirmed breach of the accepted main-parent crash promise.
**Priority:** No release blocker. Treat broader descendant cleanup as optional low-priority reliability hardening.
**Confidence:** High for the ownership gap and promise; low for persistent real `cloudflared` behavior.

Affected users are macOS testnet users whose tunnel supervisor suffers an independent hard failure.

## Reachable scenario

1. `bridge/launch.ts:185-189` starts the Bun tunnel supervisor.
2. `bridge/tunnel-child.ts:5-18` starts and owns `cloudflared`.
3. A supervisor `SIGKILL` prevents its cleanup code from running.
4. `bridge/launch.ts:300-305` marks the direct supervisor as lost.
5. `bridge/launch.ts:383-404` stops that exited process and starts a replacement.
6. A surviving grandchild remains outside the launcher's direct child handle.

The main runtime does not read the grandchild PID from `child.json`.

## Evidence

The direct check found the mock child alive 100 milliseconds after supervisor `SIGKILL`.
The integrated check started a replacement while the old mock child remained alive.
See `checks/concerns/c04-daybreak/results.md` for commands and exact output.

Official Node documentation says child processes may continue after their parent exits.
The local Bun checks establish this behavior for the tested mock process.

## Counterevidence

The reproductions replace `cloudflared` with small Bun scripts.
They do not exercise `cloudflared` logging, pipe errors, signal handling, or tunnel connections.
No evidence shows that a real Quick Tunnel remains reachable after supervisor `SIGKILL`.

The documented promise concerns a crash of the main parent process.
`docs/INTERFACE.md:47` says the parent pipe stops the tunnel after that crash.
`bridge/tunnel-child.test.ts:27-67` kills the main parent and uses a stubborn mock child.
That targeted test passed and stopped both descendants within its deadline.

Normal supervisor `SIGTERM` also runs `bridge/tunnel-child.ts:53-58` cleanup.
`bridge/runtime.ts:3-25` gives direct-child cleanup a bounded `SIGKILL` escalation.

## Minimum mitigation

No code mitigation is required for the current main-parent crash promise.
Document that the parent pipe does not cover an independent supervisor `SIGKILL`.

If descendant cleanup becomes a requirement, use a dedicated process group.
The launcher can terminate that group before it starts a replacement.
Test process-group behavior on the supported macOS and Bun versions first.
Do not add PID-file cleanup without PID-reuse and ownership protections.

## Verification steps

1. Keep the current hard main-parent crash test.
2. Add a process-group test only if the requirement expands.
3. Require the old stubborn grandchild to exit before replacement.
4. Test real `cloudflared` only with separate public-tunnel authorization.

## Checks and limits

| Status | Check | Result |
| --- | --- | --- |
| passed | Frozen-source hashes | Both assigned files matched `manifest.json`. |
| passed | Direct mock reproduction | The mock grandchild survived supervisor `SIGKILL`. |
| passed | Integrated mock reproduction | A replacement started while the old mock lived. |
| passed | Main-parent crash test | One test passed; both descendants stopped. |
| supplied | Central baseline | Go race and Bun suites passed earlier. |
| `not_run` | Real `cloudflared` reproduction | A public tunnel was not permitted. |
| blocked | Final process listing | The sandbox denied `ps`; reproduction cleanup code completed. |

No new test was added because the preserved reproductions answered the disputed code-path question.
No public service, signature request, key access, or transaction ran.

## Sources and research usage

- Frozen source and contract, accessed 2026-09-26.
- [Node.js child processes](https://nodejs.org/api/child_process.html), page version 26.10.0, retrieved 2026-09-26.
- Preserved evidence: `research/03-runtime-daybreak/parallel-cli-node-child-lifecycle.json`.

I made no new provider calls because preserved primary evidence was sufficient. New research cost was `$0.00` of `$1.00`.
New Jev cost was `$0.00` of `$0.25`.
Preserved Parallel usage reports one `sku_search`; its dollar charge remains unknown.

The real `cloudflared` survival duration remains unresolved.
