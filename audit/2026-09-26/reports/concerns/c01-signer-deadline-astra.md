# C01: Signer deadline and blocked output

## Decision and scope

| Field | Result |
|---|---|
| Reviewer | `gpt-6-astra`, `xhigh`; fresh concern review; no delegation |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Verdict | Confirmed documentation gap; conditional local availability effect |
| Priority / confidence | P3 / Low severity / High confidence |
| Concern count | 1; no additional candidate reviewed |
| Minimum mitigation | Clarify the deadline and caller responsibilities; no runtime change required |

Documentation clarification is sufficient for the current companion design. Blocked output is acceptable once the interface states this limitation explicitly.
The affected users run direct CLI wrappers with blocked output and no external process timeout.
Ordinary pipe consumers that read both streams do not satisfy this failure condition.

I read both assigned original signer reports and the preserved reproduction before running checks. I did not read other concern reports.
Source coverage includes `main.go:113–223`, its transport deadline path, and `docs/INTERFACE.md:114–154`.
I checked existing output tests and the direct bridge caller solely for C01 reachability and counterevidence.
I verified all 199 snapshot files against the manifest and ten relevant files against the baseline Git objects.

## Reachability and impact

| Location | Relevant behavior |
|---|---|
| `main.go:113`, `main.go:116`, `main.go:132`, `main.go:137` | One deadline covers supported stdin reads, connection establishment, and agent I/O. |
| `main.go:169`, `main.go:193–198` | The synchronous diagnostic write has no output deadline. |
| `main.go:147–155`, `main.go:179–188`, `main.go:206–217` | List results, signing results, and errors can also wait for output. |
| `main.go:136` | Deferred connection cleanup waits for `run` to return. |
| `docs/INTERFACE.md:138–141` | The contract describes a full-operation deadline and connection closure on timeout. |

A caller supplies valid input and an already full stderr pipe with an open reader that stops consuming data.
An inherited logging pipe shared with other processes can create this condition.
Identity discovery completes, but the signing notice waits for pipe space before `sign` runs.
The connection deadline cannot interrupt this separate output write. The command can retain its task and connection beyond 120 seconds.
A large list can also fill an initially empty stdout pipe when its caller waits for exit before reading.
A small signing result alone does not establish that failure on an empty pipe.

The preserved test uses a real macOS pipe and a mock Unix agent socket.
It remained blocked after 122.001 seconds; closing the pipe returned `output_error` with zero signing requests.
This proves the local blocking mechanism, not a live 1Password incident or a website-triggered failure.
Blocking final output could hide a completed signature; that path received source review, not another long reproduction.
There is no evidence of key exposure, approval bypass, unauthorized signing, or transaction submission.

## Counterevidence and caller responsibility

Normal callers consume stdout and stderr while the command runs. Existing tests verify output success, failures, and no signing retry.
A failed diagnostic write prevents signing; a failed result write can follow one completed signature.
These tests use buffers or failing writers; they do not independently reproduce a blocked result pipe.
`bridge/signer.ts:65–71` consumes stdout and drains stderr before sending input at line 88.
`bridge/signer.ts:63`, `:96`, and `:113` enforce separate child timeouts: 125000 ms for signing and 10000 ms for discovery.
`bridge/runtime.ts:3–18` sends SIGTERM, then SIGKILL after 1500 ms when necessary.
These are source-level safeguards; this review did not run the browser or Bun integration.
No reviewed path lets the connected website replace these child streams with an unread pipe.

## Minimum mitigation and alternatives

Clarify `docs/INTERFACE.md:138–141` with the following requirements. Keep the existing EOF and non-pollable input caveats.

- The 120-second deadline covers supported stdin reads and agent I/O.
- Standard output and standard error writes have no internal deadline.
- Callers must read both output streams while the command runs.
- Callers that require bounded completion must enforce a process timeout, terminate the child, and wait for its exit.
- Blocked output can delay connection cleanup.
- Missing output does not prove that signing failed. Do not retry signing automatically.

Output deadlines are an optional stronger contract. They must cover diagnostics, success output, and error output without retrying signing.
`os.File.SetWriteDeadline` supports only some files and can return an error after a partial write.
It cannot establish universal process termination for every output device or arbitrary writer.
Retaining a strict process deadline requires separate termination behavior and tests; this review does not require that expansion.
No additional signing feature is necessary for C01.

## Checks and verification

Exact commands, environment settings, outcomes, and evidence paths appear in [commands.md](../../checks/concerns/c01-astra/commands.md).

| Check | Outcome | Evidence |
|---|---|---|
| Frozen source identity | passed; 199 manifest matches, ten baseline Git matches | `checks/concerns/c01-astra/verification.json` |
| Preserved 122-second reproduction | passed observation; advertised completion bound failed; not rerun | `checks/01-signer-astra/audit-output-deadline.log`, `audit_test.go:248–307` |
| Initial targeted checks | blocked for mock socket creation; two deadline tests passed | `checks/concerns/c01-astra/targeted-sandbox.log` |
| Permitted targeted checks | passed; five groups, 16 leaf cases; race detection enabled; exit 0 | `checks/concerns/c01-astra/targeted-permitted.log` |
| Live signing, public services, testnet writes | `not_run`; prohibited by the brief | No live activity |

For documentation acceptance, verify all six requirements above and preserve the existing signing behavior.
If runtime deadlines change, test blocked diagnostics, blocked results, partial writes, ordinary consumers, and zero automatic signing retries.
No new reproduction or full baseline run was necessary.

## Primary evidence, cost, and limits

Primary evidence comprises the frozen source, preserved pipe reproduction, and installed Go source documentation.
[Go connection deadlines](https://go.dev/src/net/net.go) apply to connection I/O. [Go file deadlines](https://go.dev/src/os/file.go) describe supported files, blocked writes, and partial writes.
I read the installed Go `go1.27.1 darwin/arm64` sources; `go.mod` declares the minimum language version `1.22`.
Local access occurred on 2026-09-26 America/New_York; retained manifests contain UTC timestamps.
The local source hashes and excerpts reside in `checks/concerns/c01-astra/go-primary-manifest.json` and `go-primary-excerpts.txt`.
These URLs identify the primary project sources; this review did not fetch their current web contents.

New research cost: **$0 total; $0 Jev**. No new provider calls or unknown provider charges occurred.
Raven, Parallel, and Perplexity tools were discoverable; Jev and parallel-cli executables were present. Existing evidence resolved C01.
No production file, dependency, configuration, or Git state changed. No audit blocker remains.
