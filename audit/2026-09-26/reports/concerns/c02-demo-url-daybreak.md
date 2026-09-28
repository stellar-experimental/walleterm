# C02 daybreak concern review

## Assignment

| Field | Value |
| --- | --- |
| Concern | C02, malformed request parsing in the demo HTTP service |
| Model label | `daybreak` |
| Effort | `xhigh` |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Assigned source | `demo/server.ts:35-47` |
| Baseline | Go race, Go vet, TypeScript, 224 Bun, and three contract self-tests passed |

I reviewed only C02 and its named original report and evidence.
I did not read the paired concern report.
I did not edit production source or delegate work.

## Verdict

**Verdict:** Confirmed loopback reliability defect; remote Quick Tunnel reachability remains unverified.

**Severity and priority:** Low.

**Confidence:** High for loopback process exit and low for public reachability.

The affected user is the demo operator on the same Mac.
A local process can stop the demo service and require a restart.
Remote users are affected only if Cloudflare forwards the malformed target unchanged.
This review found no evidence for signing, key access, bridge compromise, or transaction submission.

## Reachable scenario

`demo/server.ts:35-46` permits a request with a matching `Host` header.
`demo/server.ts:47` passes the raw request target to `new URL()`.
The handler does not catch a URL parsing error.

The preserved test sets the configured origin to `https://audit-only.trycloudflare.com`.
It connects directly to the loopback listener.
It sends `GET //%25` with the matching public-looking `Host` header.

Bun 1.4.2 throws `ERR_INVALID_URL` at `demo/server.ts:47:18`.
The uncaught error exits the child process with code 1.
The demo then stops serving its website.

The test imports only the demo server and calls no signer, bridge, 1Password, Stellar, or cloudflared code.

## Evidence and counterevidence

| Evidence | Result |
| --- | --- |
| Frozen `demo/server.ts` hash | passed; matched the audit manifest |
| Preserved reproduction inspection | passed; the test reaches the assigned handler |
| Sandboxed rerun | blocked; loopback setup timed out after 6000 ms |
| Approved loopback rerun | failed as expected; child exit code 1 |
| Public Quick Tunnel reproduction | `not_run`; prohibited by the assignment |

Exact commands and outcomes are in `checks/concerns/c02-daybreak/checks.md`.

The listener binds to loopback under the documented design.
Therefore, the check proves local reachability only.

Cloudflare documents configurable URL normalization that can merge successive forward slashes.
The location depends on settings, so this does not prove the Quick Tunnel's forwarded target.

## Minimum mitigation

Catch URL parsing errors around `demo/server.ts:47`, return HTTP 400, and end the response.
Keep the process running for later requests.

A broad server restart is unnecessary.
A new parsing framework is unnecessary.
Moving the method check before parsing does not protect malformed `GET` requests.

## Exact verification steps

1. Run the preserved malformed-target test against the changed frozen candidate.
2. Require HTTP 400 for `GET //%25`.
3. Require the child process to remain alive.
4. Request `/api/session` and require HTTP 200.
5. Run the existing demo and lifecycle tests.
6. Keep public reachability `not_run` unless the user separately authorizes a tunnel check.

## Source and research usage

The code and local runtime evidence decide the bounded concern.
No new Raven, Jev, Parallel, or Perplexity query was necessary.
New Jev usage was `$0` against the `$0.25` cap.
Total new visible research cost was `$0` against the `$1` cap.

Preserved primary evidence came from Cloudflare's URL normalization documentation.
The page was updated on 2026-04-16 and accessed on 2026-09-27 UTC.
Source: <https://developers.cloudflare.com/rules/normalization/how-it-works/>.

## Limits

The central baseline evidence was reused and was not repeated.
No public tunnel, live signature, key access, or Stellar submission ran.
Public exploitability remains `inconclusive`.
No blocker prevents this bounded verdict.
