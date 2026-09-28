# C07: Credential cleanup after an unreadable 401

## Verdict and scope

| Field | Assessment |
| --- | --- |
| Verdict | **Conditional resilience work.** The mocked cleanup failure is confirmed. |
| Priority / severity | P3 / Low; no demonstrated security boundary failure |
| Confidence | High for code behavior; no demonstrated intermediary trigger in the standard deployment |
| Reviewer | `gpt-6-astra`, `xhigh` |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Assigned scope | `sdk/walleterm.ts:85-101`; `sdk/connect.ts:267-313,345-355` |
| Affected users | SDK users whose fetch returns HTTP 401, followed by body decoding failure |
| Storage impact | Connection UI users with `sessionStorageKey` enabled |

Coverage includes directly related account, storage, disconnect, server error, CORS, and tunnel launch paths.
I read the required source documents and `reports/04-sdk-daybreak.md`.
I inspected its reproduction before adding C07 checks.
I did not read the paired concern report, delegate, or change production files.

## Reachable condition and impact

1. The active client sends `/v1/account` with its captured token at `sdk/walleterm.ts:69-83,237-238`.
2. Fetch resolves with HTTP 401, but `response.json()` rejects at `sdk/walleterm.ts:85-91`.
3. Execution skips matching-token cleanup at `sdk/walleterm.ts:93-98`.
4. `checkHealth()` receives status 401 and sets `expired` at `sdk/connect.ts:305-308`.
5. `sync()` retains the client because its token remains set at `sdk/connect.ts:345-355`.

The mock confirms retained credentials, saved storage, and the prior account during an existing connection.
It also confirms that `onChange` does not publish disconnection.
The component state becomes `expired`; it does not remain `connected`.
Reload retains saved credentials but publishes no recovered account.
The original report therefore overstates the connected-state effect.
This behavior conditionally contradicts the cleanup promise at `docs/CONNECTION-UI.md:56-61`.

No check demonstrated credential disclosure, session extension, unauthorized signing, or submission.
The server still rejects absent, revoked, expired, or mismatched sessions at `bridge/server.ts:169-173`.

## Intermediary evidence and counterevidence

The server serializes errors as JSON at `bridge/server.ts:77-89,571-580`.
It supplies CORS headers for website requests at `bridge/server.ts:301-313`.
The SDK uses `mode: 'cors'` at `sdk/walleterm.ts:72-80`.
A network response without valid CORS headers produces a fetch failure, rather than an accessible HTTP 401. [S1](https://fetch.spec.whatwg.org/#cors-check)
The original injected fetch bypasses this browser requirement.

The launcher writes an empty configuration and starts a Quick Tunnel at `bridge/launch.ts:274-298`.
Cloudflare documents this localhost forwarding mode and a 429 concurrency limit. [S2](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
Cloudflare Access separately documents optional AJAX 401 responses. [S3](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#ajax)
The reviewed launcher does not configure that Access application or its authentication policy.
Inference: Access documentation does not establish the proposed HTML 401 path for this deployment.
No preserved evidence or new source establishes that applicable intermediary path.
A response body failure after accessible 401 headers remains possible; its occurrence was not demonstrated here.

Normal JSON 401 cleanup, late-response isolation, and explicit disconnection passed.
Generic fetch failure preserves credentials and sets `unreachable`, as the recovery design requires.

## Minimum mitigation and verification

Move the existing matching-token 401 cleanup before `response.json()`.
Preserve `this.token === token`, the response status, and the unreadable-response diagnostic.
The existing UI `sync()` then removes storage and publishes disconnection.
This change needs no new configuration, storage format, server policy, or broader cancellation behavior.
An acceptable alternative adds the same guarded cleanup inside the JSON catch block, but duplicates the condition.
Users can disconnect explicitly while this low-priority change waits.

Verify JSON, HTML, empty-body, and body-read failures with status 401.
Confirm current credentials clear and delayed old responses preserve newer credentials.
Confirm active and restored UI storage clears and `onChange` publishes disconnection.
Keep network failures and non-401 responses outside this cleanup rule.
No mitigation was implemented or tested in this review.

## Exact checks

Commands, environment, exit codes, and logs appear in `checks/concerns/c07-astra/results.json` and `checks/concerns/c07-astra/CHECKS.md`.

| Check | Outcome | Evidence under `checks/concerns/c07-astra/` |
| --- | --- | --- |
| Original reproduction, C07 test filter only | **failed**: expected null; retained `session` | `original-c07.log` |
| Added C07 observation tests, Bun 1.4.2 | **passed**: 7 tests | `c07.test.ts`, `c07-observations.log` |
| Existing cleanup and stale-response controls | **passed**: 4 tests | `existing-controls.log` |
| Manifest versus baseline tree | **passed**: 199 paths match | `results.json` |
| Frozen SHA-256 verification before and after tests | **passed**: all 199 files match | `results.json` |

The observation tests assert existing behavior; their success does not establish a fix.
They use mock fetch and storage, with real SDK state methods and stubbed rendering.
Browser network enforcement, a public intermediary, live 1Password, and testnet acceptance remain `not_run`.

## Sources, costs, and limits

Sources were accessed on 2026-09-26, America/New_York; checks finished on 2026-09-27 UTC.

- S1: [WHATWG Fetch](https://fetch.spec.whatwg.org/#cors-check), updated 2026-09-21; sections 4.4 and 4.10 govern browser CORS exposure.
- S2: [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), updated 2026-04-20; applies to the launcher's tunnel mode.
- S3: [Cloudflare Access sessions](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#ajax), current page; deployment applicability remains unproven.
- S4: [Parallel pricing](https://parallel.ai/pricing), current page; one ten-result search lists $0.001–$0.005.

Research files reside in `research/concerns/c07-astra/`; `usage.json` records discovery, calls, applicability, and accounting limits.
I reused the original reproduction and results; preserved external sources did not establish the disputed intermediary path.
New research used one Parallel MCP search, reporting one `sku_search`; published pricing estimates at most $0.005. [S4](https://parallel.ai/pricing)
The provider did not expose the actual dollar charge; its invoice remains unverified.
New Jev usage was $0; Raven, Jev, parallel-cli, and Perplexity needed no new requests.
No failed research call, paid deep research, credit purchase, or budget increase occurred.
Blockers: none for this conditional verdict. A normal-deployment trigger remains unproven.
