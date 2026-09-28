# Sequential audit remediation report

Status: complete for the selected remediation scope. All ten selected corrections are accepted.

Nine confirmed concerns and one conditional validation gap received narrow corrections.
The remaining confirmed concern, C13, needs a separate recovery design.

This report records corrections to the [original audit](../2026-09-26/REPORT.md).
The original reports describe their frozen source. This report records the later changes and acceptance evidence.
The source remains based on `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Selected corrections

| Concern | Result | Practical change |
| --- | --- | --- |
| C01: signer deadline | Accepted | The interface states output limits and caller timeout responsibilities. |
| C15: SDK distribution | Accepted | The guide preserves the complete build tree and separate stylesheet. |
| C02: malformed demo request | Accepted | URL parsing failures return HTTP 400. The same server continues normal requests. |
| C05: stale signing response | Independently accepted | The SDK rejects delayed success after an observed wallet revision change. |
| C06: component destruction | Independently accepted | Destruction stops owned work and prevents late publication. Established host clients remain available. |
| C10: signed transaction details | Accepted | The demo retains decoded transaction details before submission and after reload. |
| C12: dirty fixture source | Accepted | The fixture build rejects staged and unstaged tracked source changes before compilation. |
| C17: reused CAP-71 evidence | Accepted | Resumed rows identify reused checks, original protocols, and the current environment protocol. |
| C08: confirmation validation | Independently accepted | Invalid provider responses cannot create terminal journal state. Original-hash recovery remains available. |
| C14: CLI submission guard | Independently accepted | The existing guard saves the signed envelope before CLI sending and blocks unresolved repeat attempts. |

The [decision record](DECISIONS.md) explains each correction, regression check, and remaining limit.
The [queue](queue.json) records file ownership and acceptance.
The [patch directory](steps/) preserves each correction and its worker evidence.

## Review method

Sol workers handled one concern at a time through Herdr.
Each worker assessed the current source before changing its assigned files.
The coordinator checked scope and evidence before advancing the queue.
Separate Sol xhigh sessions reviewed signing, destruction, confirmation, and submission changes.
Reviewers formed conclusions before reading implementation transcripts.
These reviews used separate contexts within the same model family.

The C06 review found one remaining native dialog focus path.
An offline browser reproduction confirmed it. A focused correction and fresh review resolved it.
The reviewer rejected another proposed focus issue after checking native disabled-button behavior.
This process preserved demonstrated concerns and rejected unsupported ones.

The original audit retains its paired Astra xhigh and Daybreak xhigh reports.
This pass does not claim a new paired audit of every changed file.

## Deferred decisions

C11 needs complete authorization-tree expectations for the relevant contract fixtures.
C13 needs a recovery design for old checkpoints without original phase observations.
Both need more design work before implementation.

C07 remains optional compatibility work without a demonstrated shipped-path trigger.
C09 remains conditional hardening without an ordinary writer of the inconsistent saved record.
C03, C04, C18, and C20 remain accepted limits.
C16 and C19 remain unsupported claims under the audited requirements.
See [deferred work](DEFERRED.md) for mitigation options and acceptance conditions.

The original audit found no significant missing core capability within the accepted companion scope.
This pass adds no product features or speculative configuration.
The [original feature assessment](../2026-09-26/FEATURES.md) retains optional opportunities and their tradeoffs.

## Verification

| Check | Result |
| --- | --- |
| Go race suite and Go vet | Passed |
| Complete Bun command | 341 tests passed across 21 files; zero failures; three harness self-tests passed |
| Formatting and diff checks | Passed |
| Isolated current-source TypeScript | Passed in an exact copy of the current source and audit directory |
| Checkout TypeScript | Failed on 174 existing diagnostics in seven ignored Pagebook capture files |
| Final test-mock correction | 38 connection tests passed; strict focused TypeScript passed |
| Executable test comparison | The final type annotation produces identical JavaScript |

The combined TypeScript check found one new dialog-mock type error after the behavioral suite passed.
A bounded Sol worker added one explicit `this` type. Runtime code and test assertions did not change.
The worker reran the connection tests. The coordinator reran formatting and full TypeScript checks.
The [verification record](checks/README.md) preserves both the initial failure and the corrected result.
The unchanged Go and full Bun results remain applicable because the final edit erases during TypeScript compilation.
The checkout limitation remains visible. The ignored captures and compiler configuration remain unchanged.

All new behavioral checks use isolated mock keys, provider responses, and local test state.
No live 1Password signing or testnet acceptance ran in this pass.
Physical camera behavior and installed-release acceptance remain untested here.
These corrections cannot revoke existing signatures or turn unknown submission outcomes into proven cancellations.

## Research and source control

Workers reused the original primary-source evidence when it answered the relevant question.
Unresolved external facts required parallel-cli and Stellar Raven research under the worker instructions.
No worker reported new paid research in this pass.
The [original research record](../2026-09-26/RESEARCH.md) preserves provider usage and limitations.
The original visible Jev charges and reservations total `$0.430850701`.
Other original providers did not expose a complete invoice.

The [session registry](sessions.json) records the Sol models, efforts, sessions, and outcomes.
The [resume check](checks/resume.json) found no drift across all 199 saved tracked source files.
The separate existing interception documentation change remains protected.
The [integrity record](checks/integrity.json) checks scope, source hashes, original audit preservation, and document links.
All worker sessions ended. The owned Herdr pane closed, and the coordinator focus remained unchanged.
At remediation acceptance, all corrections were uncommitted.
No deployment, real-prefix installation, or live transaction occurred during remediation.
The [publication record](../PUBLICATION.md) describes the later commits and pull requests.
