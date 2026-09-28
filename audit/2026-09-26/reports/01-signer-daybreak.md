# Independent Go signer audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Conclusion

I found one low-severity defect.

Output writes can exceed the documented 120-second absolute deadline.

Raw digest handling, SSH framing, validation, signature verification, and metadata output matched the interface.

All permitted offline Go checks passed.

Live 1Password and testnet checks were not authorized.

Evidence status: `complete_with_tool_failures`.

## Scope

| Item | Value |
|---|---|
| Audit date | 2026-09-26 |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen snapshot | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Model | `gpt-daybreak-blue-latest` |
| Reasoning effort | `xhigh` |
| Concern count | 1 low |
| Live checks | `not_run` |

I reviewed `main.go`, `main_test.go`, `docs/INTERFACE.md`, and `docs/STELLAR-CLI.md`.

I also read `AGENTS.md`, `README.md`, `docs/PLAN.md`, and `go.mod`.

I traced the direct `runServiceCommand` dependency in `service.go`.

The service implementation was outside this signer review.

I did not read another audit report.

I did not inspect concurrent runtime source.

## Source identity

| File | SHA-256 |
|---|---|
| `main.go` | `43f4fe2e97c5e5837e34b7d8f4b38792fc277851fbec15da5cf1d5006c15c1da` |
| `main_test.go` | `02847410813957a5714606f9b5a1e18cd7496969b8828d9271f985485d6db500` |
| `docs/INTERFACE.md` | `05df4a7a812778a343fb006a62831d6c070cd6de1682bf594ce15a7a7d28ccb4` |
| `docs/STELLAR-CLI.md` | `7fe136c648cb5195edd2af4d96b7637fb7862e5d8275a05ac6c31df8578777fa` |
| `go.mod` | `4556f821907e1963288caca334fc2f73011709312e28f35b8be8cef8be741511` |

## Code coverage

I traced each reachable `list` and `sign` path.

| Area | Source lines | Result |
|---|---|---|
| Command and format selection | `main.go:62-109` | matched |
| Absolute input and agent deadline | `main.go:111-143` | matched, except output writes |
| Signer selection and notice | `main.go:159-175` | matched |
| Independent Ed25519 verification | `main.go:176-188` | matched |
| Strict JSON input | `main.go:225-281` | matched |
| Canonical G-address handling | `main.go:284-323` | matched |
| Socket type, owner, and mode | `main.go:325-335` | matched |
| SSH frame bounds | `main.go:345-384` | matched |
| Identity parsing and metadata | `main.go:416-472` | matched |
| Raw digest sign request | `main.go:475-504` | matched |
| Failure and output behavior | `main.go:192-223` | one defect |

The Go coverage run reported 76.4% statement coverage.

Focused signer functions received 80.0% to 100.0% coverage, except `transportError`.

`transportError` received 0.0% direct coverage.

## Confirmed defects

### F-01: Output writes bypass the absolute deadline

| Field | Value |
|---|---|
| Severity | Low |
| Confidence | High |
| Classification | Confirmed defect |
| Promise | `docs/INTERFACE.md:138-139` |
| Source | `main.go:113-139`, `main.go:147-188`, `main.go:193-198` |

The interface promises a 120-second absolute deadline for each complete signer operation.

The code applies that deadline to pollable input and the agent connection.

The code does not apply the deadline to standard output or standard error.

`writeOutput` calls synchronous `io.WriteString` without a deadline.

Reachable scenario:

1. A wrapper starts `walleterm list` with a pipe for standard output.
2. The wrapper stops reading, or the pipe is already full.
3. The agent returns a valid identity list.
4. `writeOutput` blocks after the agent work completes.
5. The command exceeds the documented absolute deadline.

The same condition can block the signing notice or the final signing result.

Impact: an agent cannot rely on the documented timeout for process completion.

A post-sign block also hides whether the agent produced a signature.

Evidence: the only deadline calls target input and `net.Conn`.

No deadline wraps the writes at `main.go:147-188`.

Counterevidence: a normal sign result is small, and normal callers continuously drain both streams.

The command never retries a signature after an output failure.

Minimum mitigation: apply the same deadline to pollable output files before any command output.

Restore prior deadlines after `run` returns.

Keep the documented caller timeout for non-pollable writers.

Verification plan:

1. Fill an output pipe before invoking `run`.
2. Use an isolated mock agent response.
3. Confirm that `run` returns by the shared deadline.
4. Repeat for the diagnostic notice and the final result.
5. Confirm that a blocked notice sends no signing request.

## Unresolved concerns

No unresolved code concern remains in the reviewed signer paths.

The failed Parallel tools reduced source diversity, but they did not leave a standards gap.

Jev, Stellar Raven, Perplexity, and direct primary pages covered the required claims.

## Accepted limits and non-issues

| Topic | Assessment |
|---|---|
| Digest context | Accepted limit. The signer cannot inspect a 32-byte digest. |
| Network binding | Accepted limit. The caller builds the network-bound hash. |
| 1Password prompt | Accepted limit. It does not display Stellar transaction details. |
| Socket provenance | Accepted limit. Filesystem checks do not defeat a compromised local user. |
| Raw bytes | Correct. `sign` sends the decoded 32 bytes without another hash. |
| SSH flags | Correct. Ed25519 requests use flags zero. |
| Signature wrapper | Correct. The parser requires `ssh-ed25519` and exactly 64 bytes. |
| Verification | Correct. Go verifies the raw signature before success output. |
| Agent refusal | Correct. Type 5 maps to a generic refusal, not a claimed human denial. |
| Public comments | Correct. JSON encoding and quoted human output prevent terminal control injection. |
| Unknown fields | Correct. The parser rejects unknown, duplicate, and trailing JSON data. |
| Automatic retries | Correct. No signing request is retried. |

## Feature opportunities

No missing runtime capability blocks the documented `list` and `sign` purpose.

Add direct tests for `transportError` before changing transport error mappings.

This test work should stay separate from F-01.

## Checks

### Command log

```sh
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
parallel-cli --help
parallel-cli search --help
go test -count=1 -coverprofile=/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/01-signer-daybreak/go-cover.out ./...
go test -race -count=10 ./...
go vet ./...
go test -run 'TestInputStrictness|TestBoundsAndSocketChecks|TestProtocolFailures' -count=100 ./...
go tool cover -func=/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/01-signer-daybreak/go-cover.out
```

The Go commands ran from `/private/tmp/walleterm-audit-40d6cca9db73`.

The permitted commands used no live key or network.

| Command | Status | Outcome |
|---|---|---|
| `go test -count=1 -coverprofile=.../go-cover.out ./...` | passed | 76.4% statements |
| `go test -race -count=10 ./...` | passed | No race detected |
| `go vet ./...` | passed | No finding |
| Strict input, bounds, and protocol tests, 100 repetitions | passed | No failure |
| Initial sandbox socket tests | blocked | `bind: operation not permitted` |
| Live `walleterm list` | `not_run` | Prohibited by the brief |
| Live `walleterm sign` | `not_run` | Prohibited by the brief |
| Testnet submission | `not_run` | Prohibited by the brief |
| Bun baseline | `not_run` | The coordinator owns the permitted baseline |

The sandbox bind result was an environment restriction.

The permitted mock-socket runs superseded it.

Check evidence: `checks/01-signer-daybreak/checks-summary.md` and `go-cover.out`.

## Research usage

| Tool | Status | Usage |
|---|---|---|
| Stellar Raven MCP | passed | Official Stellar documentation found |
| Jev | partial, usable | `$0.014611102`; 253 requests; 244 documents scored |
| Parallel CLI | failed | One call timed out; charge unknown |
| Parallel Search MCP | failed | One transport failure; no usage returned |
| Perplexity MCP | passed | Ten results; charge unknown |
| Direct primary-page read | passed | RFC and Stellar pages read |

The total research ceiling was `$10` for this review.

The Jev allocation was `$1`.

The visible Jev spend was `$0.014611102`.

No paid deep-research processor ran.

No credits were added.

Other provider charges were not visible.

Research evidence: `research/01-signer-daybreak/research-summary.md`.

The Jev session also retains the source text and compact JSON.

### Research command log

Jev command:

```sh
stellar-raven-jev --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-daybreak --budget-usd 1 search --bundle "For a minimal Stellar Ed25519 signer, what exact 32-byte value must be signed for transaction envelopes, and what primary sources define network binding and signature bytes?"
```

Parallel CLI command:

```sh
parallel-cli search "Find primary specifications for OpenSSH agent Ed25519 signing. Verify message numbers 11 through 14, SSH string framing, raw input signing, and the Ed25519 signature wrapper." -q "RFC 8709 ssh-ed25519 signature format" -q "SSH agent protocol 11 12 13 14" --include-domains rfc-editor.org,openssh.com,github.com/openssh --json --max-results 10 --excerpt-max-chars-total 27000 --client-model gpt-daybreak-blue-latest -o /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-daybreak/parallel-ssh-agent.json
```

Stellar Raven query: `transaction signature hash network passphrase Ed25519 envelope`.

Parallel Search objective: find primary SSH agent and Ed25519 specifications.

Perplexity query: primary SSH agent types, Ed25519 encoding, and direct data signing.

### Research evidence files

| File | Contents |
|---|---|
| `research-summary.md` | Tool outcomes, usage, and primary sources |
| `parallel-cli-failure.json` | Parallel CLI timeout record |
| `parallel-mcp-failure.md` | Parallel Search transport failure |
| `perplexity-summary.md` | Challenge results and primary URLs |
| `1790470379-6fbfa220-bbf3-4de5-b384-b28cd822e6cf/search.json` | Jev compact JSON |
| `1790470379-6fbfa220-bbf3-4de5-b384-b28cd822e6cf/bundle.md` | Jev source text |

## Primary sources

| Source | Version and access | Relevance |
|---|---|---|
| [RFC 9987](https://www.rfc-editor.org/rfc/rfc9987.html) | May 2026; accessed 2026-09-26 | Agent frames, requests, responses, and flags |
| [RFC 8709](https://www.rfc-editor.org/rfc/rfc8709.html) | February 2020; accessed 2026-09-26 | Ed25519 key and 64-byte signature encoding |
| [Stellar networks](https://developers.stellar.org/docs/networks) | Accessed 2026-09-26 | Network-bound transaction hashes |
| [CAP-15](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md) | Retrieved 2026-09-26 | `TransactionSignaturePayload` hashing |
| [Frozen XDR](https://github.com/stellar/stellar-xdr/blob/68fa1ac55692f68ad2a2ca549d0a283273554439/Stellar-transaction.x) | Commit `68fa1ac` | Snapshot's pinned transaction XDR |

RFC 9987 applies directly to `main.go:345-504`.

RFC 8709 applies directly to `main.go:459-472` and `main.go:498-503`.

The Stellar sources apply to the caller-generated digest boundary.

The Go binary does not construct transaction hashes.

## Limits

This review used only the frozen snapshot.

It used only the assigned research and check directories for retained evidence.

No live key, socket, signature, network transaction, or testnet state was inspected.

The Parallel CLI and Parallel Search MCP failures remain recorded tool limits.

These failures do not block the signer conclusion.

## Final status

Concern count: one low-severity confirmed defect.

Check summary: four offline Go checks passed with permitted mock socket access.

Research usage: `$0.014611102` visible Jev spend, with other provider charges unknown.

Blockers: live acceptance remains `not_run`; no blocker affects the source audit conclusion.
