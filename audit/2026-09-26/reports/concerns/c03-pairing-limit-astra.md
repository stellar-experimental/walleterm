# C03: Shared pairing limit

## Verdict and scope

**Accepted limit.** The availability effect is confirmed. The proposed per-Origin change does not resolve the actual threat.

| Field | Assessment |
|---|---|
| Concern | C03 only |
| Assigned reviewer | `gpt-6-astra`, `xhigh`; no separate runtime identity attestation |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Severity / priority | Low availability impact; informational, no required runtime fix |
| Confidence | High for code behavior and mitigation assessment |
| Affected users | Testnet bridge users who need new pairing while an attacker knows their bridge URL |
| Concern count | One accepted availability limit; zero additional defects or unresolved concerns |
| Ownership | This report, `checks/concerns/c03-astra/`, and `research/concerns/c03-astra/` |

I read the required source documents and both named original bridge reports.
I did not read the paired C03 report or other concern reports. I did not delegate.

An initial memory check supplied context only. The frozen source and fresh checks determine this verdict.
All 199 manifest hashes matched. The baseline Git tree matched the manifest file list.

## Reachable behavior

| Frozen source | Relevant behavior |
|---|---|
| `bridge/server.ts:65-76,287-316` | Origin syntax, Host checks, and reflected CORS permit unauthenticated connection requests. |
| `bridge/server.ts:126-160` | One bridge instance owns the code, failure count, lock deadline, and rotation callback. |
| `bridge/server.ts:317-339` | Five incorrect codes rotate the code and block all new pairing for 60000 milliseconds. |
| `bridge/server.ts:343-363` | A successful connection creates a session and rotates the code. |
| `bridge/server.ts:169-173,365,443-451` | Existing session authorization does not check the pairing lock. |
| `bridge/PROTOCOL.md:17-25,37-38,80-85` | The contract documents the code limit, session authority, and testnet boundary. |

An attacker who knows the bridge URL sends five JSON requests with incorrect codes.
The attacker needs no session, wallet, signature, or control of the named Origin domain.
The bridge rejects the next correct code with `429`, including requests from another website.
The attacker can repeat the five failures after each lock ends and repeatedly interrupt new pairing.

Requests during the lock do not extend its deadline. An attacker must compete for requests after each deadline.
The rotation callback refreshes the displayed code; the earlier code becomes obsolete.

## Evidence and counterevidence

I inspected `checks/02-bridge-daybreak/targeted-results.json` and `bridge/server.test.ts:177-194` before adding a check.
The existing test covers expiry, code rotation, the one-minute lock, and recovery.
The added check closes three gaps: distinct Origins, repeated locks, and existing-session access.

| Fresh check | Outcome |
|---|---|
| Existing pairing test | **passed** |
| Added C03 check | **passed**: two lock cycles, chosen Origin headers, existing-session access, and recovery |
| Browser preflight response | **passed**: `204` with the requesting Origin; this was a local HTTP check |
| Correct code during both locks | **passed**: `429`, including at 59999 milliseconds |
| Existing session during both locks | **passed**: `/v1/account` returned `200` |
| Recovery after the second minute | **passed**: correct code returned `201` |
| Signer and discovery calls | **passed**: zero calls |
| Initial sandbox run | **failed**: both listeners returned `EADDRINUSE`; the permitted retry passed |

The test executes the frozen HTTP handler on macOS with Bun 1.4.2 and real loopback requests.
It injects the clock and inert signer functions. It does not mock the HTTP authorization or pairing logic.
The attack cannot learn the code or create a session through this failure path.
The shared limit protects a single eight-digit secret against guesses from all callers, including forged Origins.
The behavior matches `bridge/PROTOCOL.md:20` and `docs/INTERFACE.md:71`.
These facts support an accepted availability tradeoff.

## Minimum mitigation and alternatives

Keep the global five-failure limit for the current contract. No runtime mitigation is required for this accepted limit.
The smallest improvement clarifies the existing documentation: the pause affects every website, and URL holders can repeat it.
No production or documentation change forms part of this review.

Per-Origin limits can reduce accidental interference or contain a browser script restricted to one Origin.
A client outside the browser can choose fresh Origins or copy the victim's Origin and consume that victim's allowance.
The added check sends both invented Origins and the victim's exact Origin through the real handler.
A larger global ceiling still permits shared lockout and increases the guess allowance before that lockout.

A two-Origin success test alone would therefore overstate the mitigation. Origin values do not identify independent attackers.
If stronger availability becomes a requirement, assess secret invitation credentials before changing the shared limit.
That alternative changes the pairing contract and needs a separate design decision.

Verification for any future change must include forged victim Origins, rotating Origins, the global guess budget, and session continuity.

## Sources, costs, and limits

The preserved [MDN CORS documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) describes browser enforcement and preflight behavior.
I reused its excerpt in `research/02-bridge-astra/perplexity.json`; the original review records access on 2026-09-26.
The page is unversioned. The local Bun check separately establishes that a client can supply the Origin header.
The frozen protocol v2 and source establish the application contract and its implementation.

New research cost: **$0 total; $0 Jev**. New unknown provider charges: **none**.
I discovered Raven, Parallel, Perplexity, Jev, and parallel-cli without new provider calls.
Preserved evidence and direct checks answered C03. No additional research or budget allocation is required.
Exact commands, outcomes, evidence files, and source provenance appear in `checks/concerns/c03-astra/commands.md`.
The usage record is `research/concerns/c03-astra/usage.json`.

Live browser, Cloudflare, 1Password, and testnet checks remain **not_run**. This review establishes local handler reachability.
The dependency directory links to the caller's installation; those dependency bytes are not independently frozen.
I did not change production source, dependencies, configuration, Git state, or other reports.
No blocker remains for this bounded review.
