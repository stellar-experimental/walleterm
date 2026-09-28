# Area 02: Bridge service and authorization

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Result

**No material defect found.** Concern count: **0 confirmed defects; 0 unresolved code concerns**.

All 62 existing targeted tests passed. All 12 additional audit tests passed.
These results support the documented testnet boundary. They do not establish live 1Password or public-tunnel acceptance.

## Scope and independence

| Item | Value |
| --- | --- |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Requested model and effort | `gpt-6-astra`, `xhigh` |
| Model evidence | The coordinator manifest records this model and effort. The runtime exposes no separate identity attestation. |
| Review date | 2026-09-26, America/New_York; evidence timestamps also use 2026-09-27 UTC. |
| Source verification | All 199 tracked files matched the coordinator's SHA-256 manifest. |
| Write ownership | This report, `research/02-bridge-astra`, and `checks/02-bridge-astra` only. |
| Delegation | None. |

I read both assigned briefs and the required source documents.
I did not read paired reports or other audit reports.
A required memory search exposed older bridge notes. Every conclusion below uses current source and fresh checks.
I read the coordinator's permitted baseline results after the coordinator supplied their path.

The tests used isolated mock keys, mock CLI programs, and loopback HTTP servers.
I did not access vault contents, request live signatures, start public services, or submit transactions.
I did not change runtime source, dependencies, configuration, or Git state.

## Code coverage

All source references below refer to the frozen snapshot.
Coverage describes manual review and targeted checks. It does not claim measured branch coverage.

| Files and lines | Reviewed behavior |
| --- | --- |
| `bridge/server.ts:55-108,169-213,287-375` | Tokens, exact origins, Host checks, bodies, pairing, sessions, discovery, and revocation. |
| `bridge/server.ts:214-285,376-563` | Signing queue, grants, revisions, retries, cancellation, withholding, and request limits. |
| `bridge/server.ts:571-624` | HTTP settings, tracked work, startup, and shutdown. |
| `bridge/signer.ts:32-108` | Child input, output limits, deadlines, cancellation, and response validation. |
| `bridge/signer.ts:111-202` | Vault metadata, public-field reads, full-key matching, batch limits, and error handling. |
| `bridge/transaction.ts:1-132` | Envelope restrictions, canonical XDR, transaction details, digest construction, and signature verification. |
| `bridge/PROTOCOL.md:1-106` | Promised authority, timing, limits, wallet changes, and cancellation behavior. |
| `bridge/server.test.ts:1-1156` | Existing bridge tests, including their SDK interactions. |
| `bridge/signer.test.ts:1-301`; `bridge/vault.test.ts:1-336` | Mock signer tests and real subprocess tests with mock CLI programs. |
| `bridge/runtime.ts:1-38`; `bridge/test/support.ts:1-65` | Child termination and offline test support. |
| `sdk/errors.ts:1-14`; `sdk/types.ts:1-65` | Error normalization and protocol types. |
| `bridge/entry.ts:1-4`; `bridge/launch.ts:274-320` | Default bridge construction and tunnel-origin assignment. |
| `AGENTS.md`, `README.md`, `docs/PLAN.md`, `docs/INTERFACE.md` | Required promises, accepted boundaries, and acceptance rules. |
| `package.json`, `bun.lock`, installed SDK declarations | Dependency versions and test construction. |

## Findings

There are no confirmed findings to assign a severity or mitigation.

| Question | Evidence and counterevidence | Assessment |
| --- | --- | --- |
| Can another website use a session? | `server.ts:169-173` requires the token and exact connected Origin. Added origin and Host checks passed. | No bypass found. Confidence: high. |
| Can concurrent pairing reuse one code? | `server.ts:333-356` checks and rotates without an intervening await. The concurrent-use test produced one session. | No reuse found. Confidence: high. |
| Can a grant admit later keys? | `server.ts:400-427` preserves the displayed grant and intersects current keys. Existing stale-grant tests passed. | No grant expansion found. Confidence: high. |
| Can delayed requests use an old wallet revision? | `server.ts:398-407,459-481` rechecks state after asynchronous work. Existing concurrent-switch and A-B-A tests passed. | No stale selection found. Confidence: high. |
| Can vault failures expose an unfiltered list? | `signer.ts:121-190` rejects failures and matches full public keys. Empty, invalid, removed, and failed-vault tests passed. | No bypass found. Confidence: high. |
| Can cancellation deliver a late signature? | `server.ts:247-261,415-423,535-558` suppresses results after cancellation or wallet changes. Existing race tests passed. | No late delivery found within the server. Confidence: high. |
| Can malformed XDR widen signing authority? | `transaction.ts:12-93` rejects unsupported envelopes, sources, networks, preconditions, and operations. Added rejection checks passed. | No bypass found. Confidence: high. |
| Can a child return an unchecked signature? | `transaction.ts:122-131` verifies the exact transaction hash and selected key. Invalid-signature tests passed. | No unchecked delivery found. Confidence: high. |
| Do application limits apply? | Added tests exercised 64 sessions, 32 active requests, 1000 records, 1000 early cancellations, and body limits. | All tested limits held. Confidence: high. |

The default runtime uses website approval through `approveAll` at `server.ts:109-118`.
The optional review hook receives copied details and signer metadata at `server.ts:233-235`.
An added mutation test confirmed that hook changes cannot alter the recorded transaction or account.

## Non-issues and accepted limits

- Website approval is deliberate. A connected website can request supported testnet signatures without another terminal approval.
- The public URL alone provides no session token. Pairing still requires the current eight-digit code.
- CORS reflection alone provides no signing authority. Session checks enforce the token and connected Origin.
- A non-browser client can supply an Origin header. The bearer token remains the authority in that case.
- An unset or empty `OP_VAULT` exposes all available Ed25519 identities, as documented.
- The signer reads item metadata and `/public key`. It does not request a private-key field.
- Vault membership can change after a check. The implementation performs its promised check immediately before signing.
- Cancellation cannot undo a signature already delivered. It can suppress a result that remains inside the bridge.
- The bridge never builds or submits transactions. It cannot establish ledger acceptance or reconcile a website's submission.
- Sequence numbers prevent repeated application of the same classic transaction. Changed transactions require separate recovery reasoning. [Stellar transaction validity](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions), [Stellar submission errors](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling).
- Testnet signatures include the network binding. They do not become mainnet transaction signatures. [Stellar network passphrases](https://developers.stellar.org/docs/networks#network-passphrases).
- Five incorrect pairing codes trigger a global pause. Someone who knows the public URL can disrupt new pairing.
- That pause is the documented brute-force tradeoff at `server.ts:317-338`. It does not authorize signing or revoke existing sessions.
- Application limits do not promise a total TCP connection limit. I did not establish public-tunnel resistance to traffic exhaustion.

## Feature opportunity

**Optional: expose supported operations and limits through the existing readiness response.**
`server.ts:566-567` currently returns the service name and protocol version.
Machine-readable limits would help agents reject unsupported requests before constructing them.
The smallest change adds static capabilities to that response and corresponding SDK types.
This is a feature opportunity, not a missing security requirement.

## Checks and commands

Commands ran after source inspection. Evidence paths below are relative to `audit/2026-09-26`.
The command record contains exact research queries and output paths: [commands.md](../checks/02-bridge-astra/commands.md).

| Check | Command or method | Outcome | Evidence |
| --- | --- | --- | --- |
| Snapshot | SHA-256 comparison against every `manifest.json` entry | **passed**: 199 matches | `checks/02-bridge-astra/snapshot-verification.json` |
| Targeted tests | `bun test bridge/server.test.ts bridge/signer.test.ts bridge/vault.test.ts` | **passed**: 62; failed: 0 | `checks/02-bridge-astra/targeted-tests.log` |
| Added audit tests | `bun test audit/2026-09-26/checks/02-bridge-astra/adversarial.test.ts` | **passed**: 12; failed: 0 | `checks/02-bridge-astra/adversarial.test.ts.txt`, `adversarial-tests.log` |
| Coordinator Go baseline | `go test -race ./...` | **passed**, coordinator evidence | `checks/baseline-permitted-results.json`, `baseline-permitted-1.txt` |
| Coordinator Bun baseline | `bun run test` | **passed**: 224 Bun tests, build, and contract self-tests | `checks/baseline-permitted-results.json`, `baseline-permitted-2.txt` |
| Installed versions | `bun --version`; `node --version`; `op --version`; SDK package metadata | **passed**: Bun 1.4.2; Node v24.13.0; op 2.39.0; SDK 17.1.0 | `checks/02-bridge-astra/results.json` |
| Report checks | Validate evidence links, outcomes, scope, and unchanged source hashes | See `report-validation.json` | `checks/02-bridge-astra/report-validation.json` |
| Live acceptance | 1Password, real vault membership, public tunnel, and testnet submission | **not_run** | Separate authorization required. |

The first test escalation timed out before execution. Automatic approval review permitted its single retry.
The tests used Bun's installed runtime and the supplied dependency directory.
That directory links to the caller's `node_modules`; dependency bytes were not independently frozen.

## Research usage

I used public technical questions. I sent no private repository code or credentials to research providers.
I used Stellar Raven first for Stellar source discovery and read its returned official source text.

| Provider | Use and outcome | Visible usage |
| --- | --- | --- |
| Stellar Raven MCP | One discovery call; one execution with two official-document calls. **passed**. | No monetary usage exposed. |
| Jev, first attempt | One scoped question. Transport failed before retrieval. **failed**. | Three charged reservations: `$0.008729397`. |
| Jev, permitted retry | Same question; allocation `$0.90`. Read the report and relevant retained source text. **partial**. | 350 requests; 461235 input tokens; 28485 output tokens; `$0.019627227`. |
| parallel-cli | One source question; sandbox transport failed. Its permitted retry returned official 1Password sources. **passed** after retry. | One successful `sku_search`; failed-attempt charges unknown. |
| Parallel Search MCP | One HTTP timeout search and one secret-reference extraction. **passed**. | One `sku_search`; one `sku_extract_excerpts`. |
| Perplexity MCP | One browser-Origin and CORS challenge search. **passed**. | Three results; no monetary usage exposed. |

**Total recorded Jev cost: `$0.028356624`, within the `$1` allocation.**
The first failed attempt's reservations remain included.
The retry retained 33 selected documents and 19 uncertain documents across 351 scored documents.
Its compact output omitted 20 selected results and three duplicate URLs. I inspected the full result inventory.
The run reported bounded source coverage, stale indexes, and one source fallback.
It reported no rate limits, scoring failures, or lost evidence.
I used the relevant official transaction-validity and error-handling text. Unread results do not support this report.

Raven, Jev source services, Parallel, and Perplexity monetary charges remain unknown.
I cannot state an exact combined provider total against the `$10` lane budget.
I ran no deep-research processor, added no credits, and made no rate-limit retry.
No follow-up allocation is required for this report.

The usage record is [usage-summary.json](../research/02-bridge-astra/usage-summary.json).

## Sources and applicability

Access date: 2026-09-26 America/New_York, also 2026-09-27 UTC.
The documentation pages are unversioned unless stated below. Retrieved publication dates are provider metadata.
Different tools citing one page count as one source.

| Primary source | Applicable claim and version limit | Retained evidence |
| --- | --- | --- |
| [Stellar network passphrases](https://developers.stellar.org/docs/networks#network-passphrases) | Network binding supports `Networks.TESTNET` and hash verification in SDK 17.1.0. | `research/02-bridge-astra/raven.json` |
| [Stellar transaction validity](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions) | Classic time bounds and sequence rules support the bridge's replay boundary. | Jev retry `search-documents/0050.txt` |
| [Stellar submission errors](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling) | Identical retries differ from changed transactions. This supports the stated submission boundary. | Jev retry `search-documents/0020.txt` |
| [1Password item commands](https://developer.1password.com/docs/cli/reference/management-commands/item) | Vault and category filters support `signer.ts:133-155`. Installed op 2.39.0 help confirms `SSH Key`. | `parallel-cli.json`, `op-item-list-help.txt` |
| [1Password secret references](https://www.1password.dev/cli/secret-reference-syntax/) | ID-based vault/item paths and named fields support the public-field reference. | `secret-reference.json`, `op-read-help.txt` |
| [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) | Browser origin behavior informs the challenge check. Tests separately establish server authorization. | `perplexity.json` |
| [Node HTTP](https://nodejs.org/api/http.html) | `requestTimeout` bounds receipt of a request. It does not establish a handler deadline. | `parallel-mcp.json` |
| [Bun HTTP Server](https://bun.sh/reference/node/http/Server) | The Bun compatibility reference describes the configured HTTP settings. Runtime tests used Bun 1.4.2. | `parallel-mcp.json` |

The Node search result identifies documentation version v26.10.0. The bridge runs Bun, so Node documentation alone proves no runtime behavior.
The 1Password website's category list omitted `SSH Key`. Installed op 2.39.0 help includes it.
The subprocess tests confirm the command construction against mocks. Live CLI acceptance remains `not_run`.

Jev retry directory:
`research/02-bridge-astra/jev/1790470813-fa45d9fb-bb7c-4ad1-863d-cdfa7ebeeab3/`.

## Limits and blockers

No blocker prevents completion of this offline review.
Jev's first attempt failed, and its retry remained partial. The retained primary sources cover the cited protocol claims.
The review does not establish real 1Password permissions, prompt behavior, Cloudflare behavior, or ledger acceptance.
The review does not replace separate SDK, demo, tunnel-supervision, Go-signer, or contract-adapter audits.
Future changes should repeat the 74 targeted checks and the coordinator baseline.
Any future live acceptance needs separate authorization and dedicated testnet keys.
