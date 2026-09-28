# Audit 03: service runtime and tunnel lifecycle

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.
> Both C04 reviewers found no breach of the documented main-parent crash promise. Real cloudflared persistence remains unverified.

## Conclusion

The runtime has one confirmed low-severity process cleanup defect.
No critical, high, or medium concern remains in this bounded review.
The listener, environment, timeout, recovery, and ordinary shutdown controls are effective.
Quick Tunnel instability and Stellar Testnet resets are accepted limits.

## Review identity

| Item | Value |
|---|---|
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Snapshot | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Snapshot files | 199 tracked files |
| Model | `gpt-daybreak-blue-latest` |
| Effort | `xhigh` |
| Mode | Independent, frozen source, no delegation |
| Concerns | 1 low |

The snapshot has no `.git` directory.
Central evidence ties the caller head to the audit revision without a diff.

## Scope and code coverage

I read the required project instructions and interface documents first.

| Area | Files and lines |
|---|---|
| CLI dispatch | `service.go:18-125`, `service_test.go:9-50` |
| Runtime helpers | `bridge/runtime.ts:3-38`, `bridge/runtime.test.ts:7-26` |
| Tunnel launch | `bridge/launch.ts:19-463`, `bridge/launch.test.ts:12-438` |
| Supervisor | `bridge/tunnel-child.ts:5-58`, `bridge/tunnel-child.test.ts:12-67` |
| Entrypoints | `bridge/entry.ts:1-4`, `demo/entry.ts:1-4` |
| Listeners | `bridge/server.ts:571-623`, `demo/server.ts:35-93` |
| Contract | `docs/INTERFACE.md`, `docs/CONNECTION-LIFECYCLE.md` |

I traced binding, startup, readiness, monitoring, replacement, shutdown, signals, and environment filtering.

## R03-01: supervisor `SIGKILL` can orphan `cloudflared`

- Severity: Low
- Confidence: High for the process path
- Actual cloudflared persistence confidence: Medium
- Status: Confirmed with an integrated mock process

### Evidence

- `bridge/launch.ts:185-189` starts the Bun supervisor.
- `bridge/tunnel-child.ts:6` starts `cloudflared` as the supervisor's child.
- `bridge/launch.ts:300-305` only marks the tunnel lost after supervisor exit.
- `bridge/launch.ts:397-404` starts a replacement without terminating the old grandchild.
- `bridge/tunnel-child.ts:22-31` records the grandchild PID, but the main runtime never reads it.

The integrated check killed the supervisor after successful startup.
Recovery started a second supervisor while the first mock child remained alive.
See `checks/03-runtime-daybreak/orphan-recovery-check.ts:66-85`.
The direct check found the same result without the launch monitor.
See `checks/03-runtime-daybreak/orphan-supervisor-check.ts:33-57`.

[Node.js documentation](https://nodejs.org/api/child_process.html) permits a child process to survive a parent exit.
The Bun checks prove that behavior for the installed runtime.

### Reachable scenario

1. The main runtime and tunnel supervisor start normally.
2. The supervisor receives `SIGKILL` or suffers an equivalent abrupt failure.
3. The supervisor cannot run its cleanup handler.
4. The main runtime observes the supervisor exit.
5. Recovery starts a replacement while the old child can remain alive.

### Impact and counterevidence

The orphan can retain an outbound tunnel connection and consume local resources.
Repeated supervisor failures can create multiple unmanaged children.
The bridge changes its accepted public host after replacement.
`bridge/server.ts:290-299` rejects requests with the old tunnel host.
`demo/server.ts:35-45` applies the same host check.

Full shutdown closes the loopback listener.
The closure check confirmed connection refusal after both service closures.
These controls limit the finding to low operational severity.

### Minimum mitigation

Start the supervisor and grandchild in a dedicated process group on macOS.
Terminate that group after any supervisor exit and during normal shutdown.
Keep the existing parent pipe for main-process crash cleanup.
Alternatively, send the grandchild PID to the main runtime.
The main runtime must terminate and await that PID before replacement.

### Verification plan

1. Require the old grandchild's absence in the integrated check.
2. Keep the existing hard-parent-crash test.
3. Test a child that ignores `SIGTERM`.
4. Confirm that recovery waits for group cleanup.

## Confirmed non-issues

| Area | Evidence-backed result |
|---|---|
| Loopback | Both services and tunnel metrics bind `127.0.0.1` |
| Public identity | Readiness requires the exact service identifier |
| Configuration | A private temporary directory holds a `0600` empty configuration |
| Environment | Only `PATH`, `HOME`, `TMPDIR`, and `LANG` reach the supervisor |
| Health limits | DNS and HTTP probes each allow 2.5 seconds |
| Startup limits | URL discovery allows 30 seconds; readiness allows 45 seconds |
| Recovery | Six failures trigger replacement; three attempts fit each ten-minute window |
| Shutdown | `SIGTERM` escalates to `SIGKILL` under fixed deadlines |
| Parent crash | The existing parent-crash test stops a stubborn child |
| Listener close | Both local listeners refused new connections after closure |

The focused suite passed all 19 runtime tests.
The targeted Go service tests also passed.

## Accepted limits and feature opportunities

[Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) defines Quick Tunnels for testing without an uptime guarantee.
Random URL changes match the current documented testnet workflow.
[Stellar documentation](https://developers.stellar.org/docs/networks) says Testnet resets clear ledger entries and history.
These network limits are not local runtime defects.

In-memory sessions end after a service restart.
The bridge never retries a signer or submits a transaction.
No missing runtime capability blocks the documented purpose.
A named tunnel could support a future stable production transport.
That option needs separate credentials, ownership, and acceptance.

## Checks

| Status | Check | Result |
|---|---|---|
| passed | Runtime Bun tests | 19 passed, 0 failed |
| passed | Targeted Go tests | Package passed |
| passed | Central Go race rerun | Package passed |
| passed | Central Bun rerun | 224 tests and three contract self-tests passed |
| passed | Loopback closure | Both listeners refused connections after closure |
| confirmed | Orphan reproduction | Replacement started while the old child remained alive |
| failed, then passed | Initial loopback check | Sandbox blocked sockets; permitted rerun passed |

Exact commands appear in `checks/03-runtime-daybreak/targeted-results.md`.
All new build caches remained under `/private/tmp`.

## Research and usage

| Tool | Outcome |
|---|---|
| Stellar Raven MCP | First Stellar source discovery pass |
| Jev | One failed call and one partial retry; `$0.03303557` known cost |
| Parallel CLI | One search; one `sku_search`; price unknown |
| Parallel Search MCP | One official Cloudflare query; price unknown |
| Perplexity MCP | One source-discovery challenge; price unknown |

No paid deep-research processor ran.
Jev returned sufficient official text despite its degraded partial status.
See `research/03-runtime-daybreak/usage.json` and `provider-evidence.md`.

## Limits and not_run items

- `not_run`: A public Quick Tunnel did not start.
- `not_run`: An actual cloudflared crash reproduction did not run.
- `not_run`: A live 1Password or signature request did not run.
- `not_run`: A Stellar transaction or mainnet check did not run.
- `not_run`: A lid-close, wake, or network-roaming check did not run.

The actual cloudflared persistence duration remains unverified.
The mock proves the ownership gap without claiming live tunnel behavior.

## Sources

- [Stellar networks](https://developers.stellar.org/docs/networks), retrieved 2026-09-26.
- [Stellar reset automation](https://developers.stellar.org/docs/build/guides/basics/automate-reset-data), retrieved 2026-09-26.
- [Node.js child processes](https://nodejs.org/api/child_process.html), version 26.10.0, retrieved 2026-09-26.
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), updated 2026-04-20.
