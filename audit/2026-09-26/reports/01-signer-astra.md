# Independent Go signer audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Result

I found one low-severity timeout contract gap.
I found no material defect in digest selection, signature verification, or private-key isolation within this scope.
The blocked output check exceeded 122 seconds without requesting a signature.
The relevant offline checks and primary sources support these conclusions.

| Item | Value |
|---|---|
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Model / effort | `gpt-6-astra` / `xhigh`; no model change or delegation |
| Audit date | 2026-09-26, America/New_York |
| Confirmed defects | 1 Low; 0 Medium; 0 High; 0 Critical |
| Unresolved security concerns | 0 within the reviewed boundary |
| Live evidence | `not_run`; the brief prohibits live signing and submission |
| Research | Complete for this scope; Jev retrieval remained partial |
| Audit blockers | None; live acceptance remains outside this audit |

I read no other audit report.
All findings use the frozen source and this lane's evidence.
The coordinator supplied baseline status separately. I did not inspect the central baseline evidence.
I changed no runtime source, dependency, configuration, or Git state.

## Scope and code coverage

The snapshot verification matched all 199 files against their Git blob hashes.
The four Go check copies also matched the snapshot byte for byte.
See [snapshot verification](../checks/01-signer-astra/snapshot-verification.json).

| Area | Frozen source coverage | Review result |
|---|---|---|
| Runtime signer | All 505 lines of `main.go` | Traced `main`, `run`, parsing, selection, framing, verification, errors, and output |
| Signer tests | All 614 lines of `main_test.go` | Reviewed every test before execution |
| Direct dependency | All of `service.go` and `go.mod` | Checked command separation and dependencies; no service execution |
| Contracts | All of `docs/INTERFACE.md` and `docs/STELLAR-CLI.md` | Compared the implementation against the documented signer boundary |
| Project context | `AGENTS.md`, `README.md`, `docs/PLAN.md` | Read before the source review |

The audit excludes bridge authorization, contract adapters, installation, and submission recovery implementation.
The blocked initial test run reported 43.9% statement coverage across the selected Go files.
That figure includes service code and incomplete socket tests. It does not represent completed signer coverage.

## Confirmed finding

### S1 — A blocked diagnostic pipe exceeds the operation deadline

**Severity:** Low. **Confidence:** High. **Class:** Availability and interface contract.

**Locations:**

- [`main.go:113`](/private/tmp/walleterm-audit-40d6cca9db73/main.go:113) creates the absolute deadline.
- [`main.go:137`](/private/tmp/walleterm-audit-40d6cca9db73/main.go:137) applies that deadline to the agent connection.
- [`main.go:169`](/private/tmp/walleterm-audit-40d6cca9db73/main.go:169) writes the diagnostic notice synchronously before signing.
- [`main.go:193`](/private/tmp/walleterm-audit-40d6cca9db73/main.go:193) writes output without a deadline.
- [`docs/INTERFACE.md:138`](/private/tmp/walleterm-audit-40d6cca9db73/docs/INTERFACE.md:138) promises a 120-second deadline for the full operation.

**Reachable scenario:** An agent runner shares a stderr pipe with other processes. Its log reader stops consuming data.
The pipe fills before `walleterm sign` writes its notice.
Valid input and successful key discovery lead directly to the blocked write.
The socket deadline expires, but that deadline cannot interrupt the diagnostic write.

**Impact:** The signing command can remain blocked beyond its documented deadline.
A caller that relies on that deadline can retain a stuck task and an open connection.
The demonstrated case produces no signature. It does not bypass approval or expose a private key.

**Evidence:** [audit_test.go](../checks/01-signer-astra/audit_test.go.txt) contains `TestAuditBlockedDiagnosticExceedsOperationDeadline`.
The test fills an actual `os.Pipe`, supplies valid input, and uses an isolated mock Unix socket.
The command remained blocked after 122.001 seconds.
Closing the pipe returned `output_error`; the mock received zero signing requests.
See [the observation log](../checks/01-signer-astra/audit-output-deadline.log).

**Counterevidence:** Socket operations have one absolute deadline, and supported stdin reads receive that same deadline.
Ordinary output succeeds promptly. An explicit diagnostic write failure prevents signing.
The interface already acknowledges non-pollable input limits, but it does not acknowledge blocked output.
This issue requires output backpressure. It is a local availability gap, not a signature integrity defect.

**Minimum mitigation:** Narrow the documented deadline to supported input and agent I/O.
Document a caller timeout for blocked output, alongside the existing non-pollable input exception.
If the full-operation guarantee remains required, enforce termination while output remains blocked.
Apply supported output deadlines without adding a signing retry.

**Verification plan:** Keep the pipe full beyond 120 seconds and assert bounded command termination.
Assert zero signing requests when the diagnostic write cannot complete.
Also test a blocked result pipe after signing. Preserve the existing prohibition on automatic retries.
If the contract changes instead, retain this observation test and document the exception accurately.

## Non-issues and accepted limits

| Boundary | Evidence and conclusion |
|---|---|
| Raw digest bytes | `main.go:272`, `main.go:280`, and `main.go:475` decode 64 lowercase hexadecimal characters into 32 bytes. The request uses flags zero. |
| No extra hash or SSHSIG | The wire contains the decoded digest directly. The added binding tests reject signatures over hexadecimal text, Base64 text, and another hash. |
| Full signer identity | `main.go:159` selects the full canonical G-address. Comments and fingerprints do not select the key. |
| Independent verification | `main.go:176` verifies the signature using the selected public key and original digest. Wrong-key and wrong-digest signatures fail. |
| JSON strictness | `main.go:225` rejects unknown fields, duplicate fields, wrong types, trailing content, and oversized input. Boundary and fuzz checks passed. |
| StrKey canonical form | `main.go:310` checks type, length, checksum, and exact re-encoding. The published SEP-23 vector passed. |
| SSH framing | `main.go:350` bounds frames to 1 MiB. `main.go:426` bounds identity counts to 1024. Malformed wrappers and trailing data fail. |
| Public metadata | `main.go:435` requires valid UTF-8 comments. JSON encoding escapes controls; human output quotes comments at `main.go:147`. |
| Socket origin | `main.go:54` derives the fixed path from the operating-system account. `main.go:325` checks type, owner, and permissions. |
| Socket symlinks | `os.Lstat` prevents a final-component symlink from passing the socket check. The added symlink test passed. |
| Local compromise | Filesystem checks cannot authenticate 1Password cryptographically. The README and interface explicitly accept this limit. |
| Private-key isolation | Production Go code requests identities and signatures only. It contains no key export, key creation, or private-field access. |
| Refusal semantics | `main.go:488` reports generic `SSH_AGENT_FAILURE`. It does not claim that the human selected Deny. |
| Write failures | The code exits nonzero after short or failed result writes. It does not retry signing. The blocked-write exception is S1. |
| Digest-only approval | The caller must review the source artifact. A digest cannot reveal the network, destination, or amount. |
| Cached approval | 1Password can reuse approval within a configured session. The documented boundary states this behavior. |

The wire contract matches [RFC 9987](https://www.rfc-editor.org/rfc/rfc9987) and [RFC 8709](https://www.rfc-editor.org/rfc/rfc8709).
The StrKey checks match [SEP-23 version 1.3.0](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0023.md).
The current [1Password security documentation](https://developer.1password.com/docs/ssh/agent/security) confirms approval reuse and process/key authorization.
These facts do not establish a fresh human prompt for every invocation.

## Useful feature opportunities

No additional runtime feature is necessary for the documented digest signer.

The installed Stellar CLI reports `28.0.0`, while `docs/STELLAR-CLI.md:16` explicitly pins `27.1.0`.
Refresh the documented CLI examples with offline XDR checks before claiming current CLI compatibility.
Keep historical acceptance evidence tied to its original version.
This version difference does not change the Go signer's digest contract.
See [tool versions](../checks/01-signer-astra/tool-versions.json).

## Checks and evidence status

All exact check commands and research queries appear in [commands.md](../checks/01-signer-astra/commands.md).

| Check | Status | Evidence |
|---|---|---|
| Frozen snapshot and copied files | passed | `checks/01-signer-astra/snapshot-verification.json` |
| Original signer suite with race detection | blocked by sandbox socket access | `checks/01-signer-astra/go-test.log` |
| Go vet | passed | `checks/01-signer-astra/go-vet.exit` |
| Five added signer test groups with race detection | passed | `checks/01-signer-astra/audit-tests.log` |
| JSON input fuzzing | passed; 21,072 executions | `checks/01-signer-astra/audit-fuzz.log` |
| Blocked diagnostic observation | passed reproducer; deadline guarantee failed | `checks/01-signer-astra/audit-output-deadline.log` |
| Central repository baseline | passed, coordinator-reported | `checks/01-signer-astra/coordinator-notes.md` |
| Live 1Password signing and approval behavior | not_run | Prohibited by the audit brief |
| Live testnet submission and ledger acceptance | not_run | Prohibited by the audit brief |

The original test failure was environmental. It is not a product finding.
The added permitted checks used isolated mock keys and temporary local sockets.
The coordinator reported passing Go race, Go vet, TypeScript, 224 Bun tests, and three contract self-tests.
I did not repeat those full suites.
Generated build caches now reside under `/private/tmp`, outside the audit directory.

## Primary sources and applicability

Access date: 2026-09-26 in America/New_York; direct fetch manifests record 2026-09-27 UTC timestamps.
All source files below reside under `research/01-signer-astra/`.
Different providers returning the same page count as one source.

| Primary source | Version and relevant claim | Retained evidence |
|---|---|---|
| [RFC 9987](https://www.rfc-editor.org/rfc/rfc9987) | May 2026; sections 5.5–5.6 define identity and signature messages | `rfc9987.txt`, `parallel-mcp.json` |
| [RFC 8709](https://www.rfc-editor.org/rfc/rfc8709) | February 2020; sections 4–7 define Ed25519 key and signature encodings | `rfc8709.txt`, `parallel-mcp.json` |
| [SEP-23](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0023.md) | Version 1.3.0; canonical encoding and published public-key vector | `sep23.md` |
| [Stellar XDR](https://github.com/stellar/stellar-xdr/blob/68fa1ac55692f68ad2a2ca549d0a283273554439/Stellar-transaction.x) | Commit `68fa1ac55692f68ad2a2ca549d0a283273554439`; envelope signatures cover the SHA-256 payload digest | `stellar-transaction.x` |
| [Stellar CLI signer](https://github.com/stellar/stellar-cli/blob/8e402ea28202950b272fbabc34caad4d2f64fe87/cmd/soroban-cli/src/signer/mod.rs) | CLI 27.1.0, lines 422–429; Ed25519 signs the 32-byte hash directly | `stellar-cli-signer.rs` |
| [Stellar CLI digest construction](https://github.com/stellar/stellar-cli/blob/8e402ea28202950b272fbabc34caad4d2f64fe87/cmd/soroban-cli/src/utils.rs) | Same commit, lines 47–71; hashes the passphrase into the payload, then hashes its XDR | `stellar-cli-utils.rs` |
| [1Password SSH setup](https://developer.1password.com/docs/ssh/get-started) | Undated current documentation; confirms the fixed macOS socket path | `1password-get-started.txt` |
| [1Password SSH security](https://developer.1password.com/docs/ssh/agent/security) | Undated current documentation; describes process/key approval and approval reuse | `1password-security.txt` |
| [Stellar complex account](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/complex-account) | Page references examples `v23.0.0`; verifies the supplied authorization payload | `raven-sources.json` |

The pinned CLI sources match the repository's documented reference version.
They do not establish installed CLI 28.0.0 acceptance.
The contract example supports only the digest boundary here. It does not establish compatibility with every account contract.
The 1Password documentation supports the intended integration. It does not establish the installed app's live behavior.

## Research execution and usage

Stellar Raven ran first for Stellar source discovery. I read its returned full page sections.
One category query returned no matching page. A later broader call timed out during automatic approval review.
Direct pinned source reads resolved the digest question without another broad search.

Jev handled one scoped question, with one permitted retry after the initial transport failure.
The successful retry returned six selected documents, 30 uncertain documents, and `load.degraded=true`.
I read the relevant CAP-15 and network source text and checked the full report's limitations.
Those selected results had no companion entries.
The report relies on direct pinned primary code for the exact digest formula.

Parallel CLI and Parallel MCP each completed one search query group.
Perplexity completed one challenge search about cached approval.
Its old `llms-ssh.txt` result returned 404 on direct access.
The current primary pages supplied the final 1Password evidence.

| Provider | Visible usage | Charge status |
|---|---|---|
| Jev initial transport failure | $0.008729397 | Retained reservation charges |
| Jev permitted partial run | $0.017824644; 297 requests | Reported cost |
| Jev total | **$0.026554041** | Below the $1 allocation |
| Parallel CLI | 1 `sku_search` | Dollar charge not exposed |
| Parallel MCP | 1 `sku_search` | Dollar charge not exposed |
| Perplexity MCP | 1 search | Dollar charge not exposed |
| Stellar Raven MCP | Discovery and page reads | Dollar charge not exposed |

See [usage-summary.json](../research/01-signer-astra/usage-summary.json) and the source manifests for exact records.
I did not add credits or run a paid deep-research processor.
No follow-up research allocation is required for this scope.
The full provider total remains unknown because some tools expose no dollar charge.

## Limits and handoff

This audit supports the reviewed signer boundary and the recorded offline checks.
It does not renew live 1Password or testnet acceptance.
The full 120-second elapsed-time check covered blocked diagnostics, not every possible input or output device.
The socket owner check received source review; this lane did not create a socket owned by another user.
No fix was applied. S1 remains open for the coordinator's disposition.
