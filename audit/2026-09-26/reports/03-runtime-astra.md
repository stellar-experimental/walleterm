# 03-runtime independent audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Conclusion

One low-severity reliability defect remains in the demo HTTP handler.
A crafted request stops the demo process on Bun 1.4.2.
Local access is confirmed. Public Quick Tunnel access is unverified.
No material signer, tunnel ownership, or recovery defect was confirmed within this review.

| Item | Value |
| --- | --- |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Reviewer configuration | `gpt-6-astra`, `xhigh`, as requested |
| Audit date | 2026-09-26, America/New_York |
| Source access date | 2026-09-27 UTC |
| Confirmed concerns | 1 low; 0 medium; 0 high; 0 critical |
| Separate unresolved concerns | 0 |
| Runtime versions | Bun 1.4.2 (`744846f84`); Go 1.27.1 darwin/arm64; cloudflared 2026.9.3 |
| Research versions | stellar-raven-jev 0.1.0; parallel-cli 0.9.3 |

I used no other audit reports and delegated no work.
A memory registry lookup supplied process guidance only.
I derived the finding from frozen source and independent checks.
All 199 tracked snapshot files matched the specified commit.
The initial and final manifests record Git blob hashes and SHA-256 values.

## Scope and source coverage

All source references below name files within the frozen source directory.

| Files | Review coverage |
| --- | --- |
| `service.go:18-126`, `service_test.go:1-50` | Arguments, platform checks, executable resolution, version checks, environment, and process replacement |
| `bridge/runtime.ts:1-39`, `bridge/runtime.test.ts:1-27` | Abort handling, deadlines, child exit, and SIGKILL escalation |
| `bridge/launch.ts:1-463`, `bridge/launch.test.ts:1-438` | URL parsing, DNS/HTTP probes, private config, recovery, output, shutdown, and cleanup |
| `bridge/tunnel-child.ts:1-58`, `bridge/tunnel-child.test.ts:1-67` | Parent pipe, child ownership, crash handling, and signal handling |
| `bridge/entry.ts:1-4`, `demo/entry.ts:1-4` | Independent entry points |
| `demo/server.ts:1-94` | Listener, host check, request parsing, static assets, and close |
| `bridge/server.ts:113-168,214-286,287-314,571-624` | Lifecycle dependencies, cancellation, job ownership, loopback binding, and close |
| `bridge/signer.ts:1-202` | Direct process dependency, output limits, cancellation, and vault batch cleanup |
| `bridge/server.test.ts`, `bridge/signer.test.ts`, `bridge/test/support.ts` | Relevant fixtures and shutdown tests; no claim of full protocol review |
| `main.go:94-95` | Service command dispatch |

I read `AGENTS.md`, `README.md`, `docs/PLAN.md`, and `docs/INTERFACE.md`.
I also read `docs/CONNECTION-LIFECYCLE.md`.
I did not review browser transaction behavior or contract authorization as separate audit areas.

## Finding R03-01: A malformed request stops the demo

**Severity:** Low reliability defect.  
**Confidence:** High for local access; public access remains unverified.  
**Location:** `demo/server.ts:35-47`, especially line 47.

The demo passes an untrusted request target directly into `new URL()`.
The request handler does not catch parsing errors.
The following request passes the host check and throws `ERR_INVALID_URL`:

```http
GET //%25 HTTP/1.1
Host: audit-only.trycloudflare.com
Connection: close
```

The check sets this public origin on an isolated demo listener.
It sends the request directly to that listener through `127.0.0.1`.
Bun 1.4.2 exits with code 1.
The check expects the process to survive, so its assertion fails.
The earlier `//%` request also caused this exit.

**Impact:** The demo stops serving its website.
The user must restart the demo.
The bridge runs separately, so this failure does not authorize a signature.
The normal tunnel supervisor observes parent pipe closure after the demo exits.
The existing parent-crash test verifies that cleanup mechanism.

**Evidence:**

- `checks/03-runtime-astra/targeted.test.ts:80-99`
- `checks/03-runtime-astra/targeted-permitted.log`
- `checks/03-runtime-astra/malformed-encoded.log`

**Counterevidence and boundary:**

The listener binds loopback.
Cloudflare normalization can merge repeated slashes before later request processing.
Its configuration determines where normalization occurs. [Cloudflare normalization](https://developers.cloudflare.com/rules/normalization/how-it-works/)
I did not start a public tunnel or test Cloudflare forwarding.
This finding does not establish remote denial of service through Quick Tunnels.
It also does not establish a signing or key boundary failure.

**Minimum mitigation:** Catch URL parsing errors and return HTTP 400 before asset handling.
Do not restart the entire service for malformed input.
A broader request exception handler is optional if it also preserves safe response handling.

**Verification plan:** Repeat the encoded request and require HTTP 400 with a surviving process.
Then require `GET /api/session` to return HTTP 200.
Run the existing lifecycle tests.
Public forwarding verification requires separate authorization only if a remote security classification matters.

## Confirmed protections and non-issues

| Area | Evidence and conclusion |
| --- | --- |
| Service ownership | `service.go:84-99` selects one entry point and replaces the Go process with Bun. |
| Loopback binding | `bridge/server.ts:607` and `demo/server.ts:84` bind `127.0.0.1`. The independent listener check passed. |
| Private config | `bridge/launch.ts:274-298` creates a private directory and explicit empty configuration. Measured modes were 0700 and 0600. |
| Environment | `bridge/launch.ts:277-278` permits PATH, HOME, TMPDIR, and LANG. Real supervisor checks withheld both sentinel secrets. |
| Cloudflare isolation | Versioned cloudflared source reads the explicit configuration path. The existing default configuration remains outside that path. [Configuration source](https://github.com/cloudflare/cloudflared/blob/2026.9.3/config/configuration.go#L385-L428) |
| Tunnel selection | The explicit URL selects Quick Tunnel behavior in cloudflared 2026.9.3. [Tunnel source](https://github.com/cloudflare/cloudflared/blob/2026.9.3/cmd/cloudflared/tunnel/cmd.go#L255-L264) |
| Port conflicts | `bridge/launch.ts:264-273` waits for the listener before starting cloudflared. |
| Bounded recovery | `bridge/launch.ts:362-415` enforces six failed probes and three replacements within ten minutes. Existing tests passed. |
| Cancellation | Shutdown aborts recovery before another child starts. The matching test passed. |
| Parent crash | The supervisor receives pipe EOF and stops its child. The hard-parent-crash test passed with a stubborn mock child. |
| Independent shutdown | Two real supervisors used separate directories. Stopping one preserved the other service and child. |
| Signing cleanup | Four targeted tests passed for signer cancellation, batch cleanup, and bridge shutdown. |
| Retry scope | Tunnel recovery does not call the signer or transaction submission APIs. |
| Healthy output | Existing tests confirmed silent healthy probes. |

## Accepted limits

- Connected websites approve supported testnet requests. This behavior follows the stated interface.
- The digest signer cannot inspect a transaction from its digest. This audit does not classify that boundary as defective.
- Quick Tunnels provide temporary URLs and no uptime guarantee. These limits fit the selected testnet workflow.
  [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- A supervisor must remain alive to process parent pipe EOF.
  A separate supervisor SIGKILL or operating-system failure falls outside the tested parent-crash guarantee.
- `stopChild()` controls its direct child. It does not provide arbitrary descendant cleanup.
  This matches the relevant process API distinction. [Node.js child processes](https://nodejs.org/api/child_process.html)
- A hard parent crash can leave its private temporary directory.
  The supervisor stops processes but does not remove that directory.
  It contains configuration and PID metadata, rather than wallet keys or session credentials.
- The local process trusts PATH and HOME. Compromise of those inputs remains a local account boundary.
- Bun loads environment files automatically. The service intentionally uses this behavior for OP_VAULT.
  The supervisor starts in a separate private directory with a restricted environment.
  [Bun environment variables](https://bun.sh/docs/runtime/environment-variables)

## Feature opportunities

| Opportunity | Value | Smallest useful option |
| --- | --- | --- |
| More specific recovery diagnostics | Operators cannot distinguish DNS failure, invalid response, or child exit from every recovery message. | Print a bounded failure category and exit code when failure first occurs. Keep healthy checks silent. |
| Stable public address | Replacements require a new connection URL. | Consider a named tunnel only after an accepted stable-address use case. The current Quick Tunnel choice needs no expansion. |

Neither opportunity blocks the documented testnet workflow.
The malformed-request mitigation belongs to the finding, rather than future feature work.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Snapshot verification | passed; 199/199 files matched | `source-manifest.json`, `source-manifest-final.json` |
| Go service tests with race detection | passed; 3 tests | `go-service.log` |
| Existing Bun lifecycle tests | passed; 19 tests | `bun-lifecycle.log` |
| Additional checks inside sandbox | blocked for listeners; 1 passed, 2 reported failures | `targeted.log` |
| Additional checks with socket permission | 2 passed; 1 failed from R03-01 | `targeted-permitted.log` |
| Encoded-path reproduction | failed survival assertion; confirmed R03-01 | `malformed-encoded.log` |
| Signer and bridge shutdown checks | passed; 4 tests | `signer-shutdown.log` |
| Central baseline | supplied evidence only; not independently repeated here | `../baseline-permitted-results.json` |

There were 28 distinct passing targeted tests and one distinct failing regression check.
The encoded-path run repeats the same defect with stronger input evidence.
The sandbox listener failures are not product defects.
All check evidence names above are relative to `checks/03-runtime-astra/`.
Exact substantive commands appear in `checks/03-runtime-astra/commands.md`.

## Research and sources

All requested research tools were available and used.
Stellar Raven ran first for Stellar source discovery.
Saved provider results remain under `research/03-runtime-astra/`.

| Source | Version or date | Applicability and evidence |
| --- | --- | --- |
| [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) | Updated 2026-04-20 | Temporary URLs, no uptime guarantee, 200 concurrent requests, and no SSE; `parallel-cli.json` |
| [Cloudflare configuration](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/) | Updated 2026-09-01 | Configuration background; `parallel-cli.json` |
| [cloudflared tunnel source](https://github.com/cloudflare/cloudflared/blob/2026.9.3/cmd/cloudflared/tunnel/cmd.go) | 2026.9.3, matching the installed binary | Quick Tunnel branch and flags; `cloudflared-2026.9.3-cmd.go` |
| [cloudflared configuration source](https://github.com/cloudflare/cloudflared/blob/2026.9.3/config/configuration.go) | 2026.9.3 | Explicit config selection; `cloudflared-2026.9.3-configuration.go` |
| [Bun environment variables](https://bun.sh/docs/runtime/environment-variables) | Current documentation; no pinned release | Dotenv behavior; validated separately on Bun 1.4.2; `parallel-mcp.json` |
| [Node.js child processes](https://nodejs.org/api/child_process.html) | Retrieved page identifies Node.js 26.10.0 | API reference only; Bun behavior rests on local checks; `perplexity.json` |
| [Cloudflare normalization](https://developers.cloudflare.com/rules/normalization/how-it-works/) | Updated 2026-04-16 | Counterevidence for public crash access; `cloudflare-normalization.md` |
| [Stellar timeout guidance](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout) | Retrieved chunk identifies 2025-12-19 | A timeout does not confirm transaction failure; Jev documents `0082.txt` and companion `0209.txt` |
| [Stellar error handling](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling) | Retrieved metadata identifies 2025-12-19 | Changed retries can duplicate payment effects; Jev document `0021.txt` |
| [Stellar testnet reset guidance](https://developers.stellar.org/docs/platforms/stellar-disbursement-platform/admin-guide/troubleshooting#recreating-channel-accounts) | Unversioned retrieved section | Reset context only; not runtime authority; `raven-testnet.json` |

The Stellar sources permit unchanged transaction retries under specified conditions.
They do not mandate this project's stronger prohibition on automatic resubmission.
The runtime's refusal to repeat signing or submission therefore remains a valid design choice.

Jev's useful session is `1790471498-a6665079-1cab-44dd-b9b6-bf236f1196e0`.
Its source files remain under that session's `search-documents/` directory.
I read the cited source chunks and the available full companion.
I inspected the full report, omitted-result counts, and degraded-retrieval information.
I did not treat relevance scores as proof.

## Research usage and limits

| Tool | Result | Visible usage |
| --- | --- | --- |
| Stellar Raven MCP | passed; primary source text returned | Provider charge unavailable |
| Jev, initial sandbox attempt | failed transport; reservations remained charged | $0.008729397 |
| Jev, permitted repeat of the same question | partial; useful primary source text returned | $0.020225809 |
| Jev combined | Within the $1 allocation | $0.028955206; 364 requests |
| parallel-cli | Initial connection failure; one permitted search succeeded | 1 `sku_search`; dollar charge unavailable |
| Parallel Search MCP | passed; one query | Dollar charge unavailable |
| Perplexity MCP | passed; one search challenge | Dollar charge unavailable |

The permitted Jev repeat used `--budget-usd 0.99`.
Its maximum allocation plus the earlier reservation remained below $1.
Neither attempt reported a Jev rate limit.
The useful session reports degraded retrieval and one source fallback.
No further research calls, credits, or deep-research processors were requested.
Visible usage does not establish the total provider invoice.

The audit does not need another allocation for its bounded conclusion.

## not_run and blockers

- `not_run`: Public Quick Tunnel reproduction of R03-01.
- `not_run`: Real 1Password signing, key creation, or key-field access.
- `not_run`: Stellar transaction submission or live testnet acceptance.
- `not_run`: Real cloudflared outage, sleep/wake, and supervisor SIGKILL testing.
- `not_run`: Independent full baseline repetition or browser acceptance testing.

No blocker prevents this bounded report.
A parent may authorize public forwarding verification if a remote severity decision becomes necessary.
Runtime source, dependencies, configuration, and Git state remain unchanged.
Build caches and temporary test processes used `/private/tmp`.
