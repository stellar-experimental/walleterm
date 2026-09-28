# C03: Shared pairing limit and repeated invalid codes

## Decision

| Field | Result |
|---|---|
| Verdict | **Accepted limit** |
| Priority | No production change |
| Confidence | High |
| Concern count | 0 confirmed; 0 unresolved |
| Actual affected users | Users who start a new pairing while an actor knows the active tunnel URL |

The global lock behavior is reachable. It creates a low-impact availability tradeoff, not a material security defect.
The protocol documents this tradeoff at `bridge/PROTOCOL.md:17-20`.
An Origin-scoped limit does not improve the adversarial threat model.

## Scope

| Item | Value |
|---|---|
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Snapshot | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Requested model | `gpt-daybreak-blue-latest` |
| Requested effort | `xhigh` |
| Model attestation | `inconclusive`; the runtime exposes no active-model metadata |
| Assigned source | `bridge/server.ts`; `bridge/PROTOCOL.md` |

I read both named original reports and the existing Daybreak reproduction result.
I did not read the paired C03 report or other concern reports.
I made no production change, used no delegation, and requested no signature.

The central baseline passed Go race tests, Go vet, TypeScript, 224 Bun tests, and three contract self-tests. I did not repeat it.

## Code coverage

I reviewed Origin validation at `bridge/server.ts:65-76` and pairing state at `bridge/server.ts:126-160`.
I traced connections at `bridge/server.ts:287-364` and protocol promises at `bridge/PROTOCOL.md:15-25,37-40,78-85`.

## Reachable scenario

An actor first learns the active Quick Tunnel URL. The actor sends five wrong codes to `POST /v1/connect`.
A non-browser client can send a different valid-looking Origin on each request.
`validOrigin` does not authenticate an Origin or resolve its hostname.
The fifth failure rotates the code and sets the shared one-minute lock.
New pairing attempts then receive `429`, including attempts with the new correct code.
The actor can repeat this action after each lock ends.

This action cannot create a session or request a signature. It does not revoke existing sessions.
Its demonstrated impact is one-minute disruption and code invalidation for new pairings.

## Mitigation assessment

A per-Origin counter can isolate accidental browser failures. A malicious non-browser client can rotate arbitrary Origin values.
Therefore, Origin cannot identify the attacker for this limit.

A larger global ceiling would delay the same disruption. It would also permit more guesses against each eight-digit code.
Per-Origin state also adds bounded-map and expiry requirements.

The minimum mitigation is no runtime change.
Keep the global five-attempt ceiling, code rotation, and one-minute pause.
Clarify that `bridge/PROTOCOL.md:20` describes a process-wide pause.
Keep the distinct-Origin audit test as regression evidence.

Browser fairness needs a trusted rate-limit key outside this design.

## Evidence and counterevidence

| Evidence | Result |
|---|---|
| New distinct-Origin test | **passed**: five `.invalid` Origins caused rotation and the shared `429`. |
| Existing frozen pairing test | **passed**: five failures rotated the code and locked the correct code. |
| Source trace | `attempts` and `lockedUntil` are process-wide at `server.ts:126-132`. |
| Lock trace | The fifth failure sets the lock and rotates at `server.ts:333-338`. |
| Counterevidence | The actor must first learn the active tunnel URL. |
| Counterevidence | The limit caps guesses, and every lock replaces the current code. |
| Counterevidence | Existing authenticated sessions do not use `/v1/connect`. |

The browser Origin header supports browser security policy. It does not prove source identity to an HTTP server.
The local Bun test directly proves arbitrary header acceptance in this implementation.

## Exact checks

| Command | Outcome | Evidence |
|---|---|---|
| `bun test audit/2026-09-26/checks/concerns/c03-daybreak/origin-forgery.test.ts` | **failed** in the sandbox with `EADDRINUSE` | `checks/concerns/c03-daybreak/results.json` |
| Same command with permitted loopback access | **passed**: 1 test and 13 expectations | `origin-forgery.test.ts`; `results.json` |
| `bun test bridge/server.test.ts --test-name-pattern 'short codes expire, rotate once, and pause for one minute after five incorrect attempts'` | **passed**: 1 test; 43 filtered | `results.json` |
| `shasum -a 256` on both assigned source files | **passed**: both hashes match `manifest.json` | `results.json` |

## Sources, costs, and limits

I reused the preserved [MDN CORS source](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS), accessed 2026-09-26.
That source describes CORS as a browser mechanism.
The retained evidence is `research/02-bridge-astra/perplexity.json`.

I used no new research provider because the frozen code and direct test were decisive.
New research and Jev costs were `$0.00`.

Public-tunnel reachability remains `not_run` because this review started no public service.
The test proves server behavior after a request reaches the loopback bridge.
