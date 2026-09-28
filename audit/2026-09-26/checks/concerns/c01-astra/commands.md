# C01 astra check record

Caller directory: `/Users/kalepail/Desktop/walleterm-v2`.
Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Inputs and read-only inspection

I read the assigned COMMON, CONCERN, and C01 briefs.
I read snapshot AGENTS.md, README.md, docs/PLAN.md, and docs/INTERFACE.md before tracing source.
I read the two assigned original signer reports.
I inspected `checks/01-signer-astra/audit_test.go.txt` before selecting existing tests.
I reused `audit-output-deadline.log`, `audit-output-deadline.exit`, and the original `commands.md`.
I did not read any paired concern report.

Source inspection used `cat`, `nl -ba`, `sed -n`, and these bounded searches:

```sh
rg -n 'Deadline|BlockedDiagnostic|fill|Pipe|func Test' audit/2026-09-26/checks/01-signer-astra/audit_test.go
rg -n '^func Test|Output|Deadline|Pipe|writeFail' main_test.go
rg -n 'spawn|stdout|stderr|Promise.all|timeout|stopChild|135|120|150' bridge/signer.ts
rg -n 'function stopChild|SIGTERM|SIGKILL|1500' bridge/runtime.ts
go version
go env GOROOT
command -v stellar-raven-jev
command -v parallel-cli
```

The frozen source commands ran from the snapshot directory.
The evidence command ran from the caller directory.
The Go version was `go1.27.1 darwin/arm64`.
No source inspection executed the real signer or contacted 1Password.

## Verification and targeted checks

I inspected the five selected test groups and their mock helpers before execution.
The tests use isolated mock keys, local pipes, and temporary Unix sockets.
They call the internal `run` function with an injected mock socket.
They never call production `main` or start public services.

```sh
python3 audit/2026-09-26/checks/concerns/c01-astra/check.py verify
python3 audit/2026-09-26/checks/concerns/c01-astra/check.py tests targeted-sandbox
python3 audit/2026-09-26/checks/concerns/c01-astra/check.py tests targeted-permitted
```

The first command compares manifest ownership with the baseline Git tree.
It verifies all 199 snapshot SHA-256 hashes and ten relevant Git blobs.
It also records hashes for the preserved reproduction and reads local Go primary documentation.
`verification.json` records the exact Git commands and source hashes.

The test commands expand to this selection:

```sh
go test -count=1 -race -run '^(TestListAndSignWithOfflineMock|TestListAndSignOutputFailure|TestDiagnosticFailurePreventsSigning|TestAgentReadDeadlineReturnsTimeout|TestInputReadDeadlineReturnsTimeout)$' -timeout=20s -v main.go service.go main_test.go
```

`targeted-sandbox.json` and `targeted-permitted.json` record exact commands, working directories, environment overrides, and exits.
Each run uses a separate `/private/tmp/wt-c01-astra-*` directory for caches and temporary build files.
`GOPROXY=off`, `GOSUMDB=off`, and `GOTOOLCHAIN=local` prevent dependency retrieval.
The sandbox run could not bind mock Unix sockets. Both pipe deadline tests passed.
The permitted retry used only the already authorized offline socket access.
All five selected test groups passed with race detection: 16 leaf cases, exit 0, package time 1.426 seconds.
The logs preserve both outcomes; the sandbox restriction is not a product defect.

## Evidence reuse and stop rule

The preserved 122-second test fills an actual pipe before calling the unmodified internal signer.
It clears the pipe's temporary fill deadline before observing the product's deadline.
Its mock agent outlasts the product deadline and detects any signing request.
Its log reports 122.001 seconds, then `output_error` and zero signing requests after pipe closure.
I did not repeat this wait or add another reproduction.
The final-output blocking path received source review only.
The bridge consumer received source review only; no Bun or browser test ran.

## Primary sources and research

`go-primary-excerpts.txt` retains relevant installed Go source comments with exact line numbers.
`go-primary-manifest.json` records local paths, full source hashes, version, and primary project URLs.
These files support connection-specific deadlines and the limits of file write deadlines.
The saved reproduction supplies the relevant macOS pipe evidence.

Tool metadata discovery found Raven MCP, Parallel Search MCP, and Perplexity MCP.
Executable discovery found `/Users/kalepail/.cargo/bin/stellar-raven-jev` and `/Users/kalepail/.local/bin/parallel-cli`.
No research provider ran. No provider failed, returned partial results, or incurred new charges.
New research spend: $0 total, including $0 Jev. Unknown new provider charges: none.
The allocation remains $1 total, including at most $0.25 Jev.
No unresolved factual question required another source search.
