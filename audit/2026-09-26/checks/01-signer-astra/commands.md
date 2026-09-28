# Audit commands

The frozen source directory was `/private/tmp/walleterm-audit-40d6cca9db73`.
The working repository was `/Users/kalepail/Desktop/walleterm-v2`.
The check directory was `audit/2026-09-26/checks/01-signer-astra`.
The research directory was `audit/2026-09-26/research/01-signer-astra`.

## Source preparation and versions

Read `AGENTS.md`, `README.md`, `docs/PLAN.md`, and `docs/INTERFACE.md` before the source review.
Read all of `main.go`, `main_test.go`, `service.go`, `go.mod`, and `docs/STELLAR-CLI.md`.
Use `cat`, `nl -ba`, `sed -n`, and `rg -n` for source inspection.
Copy `main.go`, `main_test.go`, `service.go`, and `go.mod` into the check directory without changes.
The audit tests remain separate in `audit_test.go`.

```sh
python3 audit/2026-09-26/checks/01-signer-astra/verify_snapshot.py
go version
stellar --version
stellar-raven-jev --version
parallel-cli --version
```

Results: `snapshot-verification.json`, `snapshot-verification.log`, and `tool-versions.json`.
All 199 snapshot files matched their Git blobs. All four check copies matched the snapshot.

## Go checks

The initial commands used these environment settings:

```sh
GOCACHE=/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/01-signer-astra/cache
GOTMPDIR=/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/01-signer-astra/tmp
TMPDIR=/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/01-signer-astra/tmp
GOPROXY=off
GOSUMDB=off
```

After testing, the coordinator requested a cache move.
The cache now resides under `/private/tmp/walleterm-signer-astra-ywjb7l5_`.
Use these settings for any reproduction:

```sh
export GOCACHE=/private/tmp/walleterm-signer-astra-ywjb7l5_/go-cache
export GOTMPDIR=/private/tmp/walleterm-signer-astra-ywjb7l5_/tmp
export TMPDIR=/private/tmp/walleterm-signer-astra-ywjb7l5_/tmp
export GOPROXY=off GOSUMDB=off
cd /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/01-signer-astra
```

| Command | Outcome | Evidence |
|---|---|---|
| `go test -count=1 -race -coverprofile=coverage.out -timeout=60s -v main.go service.go main_test.go` | Exit 1; sandbox blocked Unix socket binding | `go-test.log`, `go-test.exit`, `coverage.out` |
| `go vet main.go service.go main_test.go` | Exit 0 | `go-vet.log`, `go-vet.exit` |
| `go test -count=1 -race -run '^TestAudit' -timeout=30s -v main.go service.go main_test.go audit_test.go` | Exit 0; five test groups passed | `audit-tests.log`, `audit-tests.exit` |
| `go test -run '^$' -fuzz '^FuzzAuditInput$' -fuzztime=15s -parallel=2 main.go service.go main_test.go audit_test.go` | Exit 0; 21,072 executions | `audit-fuzz.log`, `audit-fuzz.exit`, `fuzz-corpus/` |
| `go test -count=1 -race -run '^TestAuditBlockedDiagnosticExceedsOperationDeadline$' -timeout=140s -v main.go service.go main_test.go audit_test.go` | Exit 0; reproduced deadline exception | `audit-output-deadline.log`, `audit-output-deadline.exit` |

The five-group run preceded the addition of the deadline observation test.
To reproduce that original selection, exclude `TestAuditBlockedDiagnosticExceedsOperationDeadline` or increase the test timeout.
The socket checks used permitted execution. The initial suite did not.
The original suite used temporary mock sockets under `/private/tmp`. Its cleanup removed those sockets.
The added checks used relative mock sockets inside the check directory. Their cleanup removed those sockets.
No command contacted the real 1Password socket.

## Research CLI commands

Read the specified Jev and Parallel skill files before running these commands.

```sh
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
parallel-cli --help
parallel-cli search --help
```

Outputs: `jev-help.txt`, `jev-search-help.txt`, `jev-doctor.json`, `parallel-help.txt`, and `parallel-search-help.txt`.

```sh
stellar-raven-jev \
  --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/jev \
  --host-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/jev-host \
  --retain-days 0 --budget-usd 1 \
  search 'What exact bytes does an Ed25519 signer sign for a Stellar transaction envelope, and how does the network passphrase enter that digest? Use primary Stellar sources.' --bundle
```

The first attempt failed during transport. Outputs: `jev-compact.json` and `jev-stderr.log`.
The retained report charged $0.008729397 in reservations. It reported no rate limit.
After inspecting that usage, repeat the same question with network access and `--budget-usd 0.98`.
Outputs: `jev-permitted-compact.json`, `jev-permitted-stderr.log`, and `jev-permitted.exit`.
That attempt exited 2 with partial results. Its reported usage was $0.017824644.
The `jev/` directory retains both reports, the compact evidence bundle, and source text.

```sh
parallel-cli search \
  'Find official 1Password SSH agent documentation for the macOS socket path, application authorization, and cached approval duration.' \
  -q 'site:developer.1password.com SSH agent authorization' \
  -q 'site:developer.1password.com agent.sock macOS' \
  --json --max-results 5 --excerpt-max-chars-total 16000 \
  -o /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/01-signer-astra/parallel-cli.json
```

The first attempt returned `APIConnectionError`. Its client made two automatic transport retries.
Outputs: `parallel-cli-stdout.log` and `parallel-cli-stderr.log`.
The permitted retry succeeded. Outputs: `parallel-cli.json`, `parallel-cli-permitted-stdout.log`, and `parallel-cli-permitted.exit`.
The query did not change.

## MCP research calls

| Tool | Input | Evidence |
|---|---|---|
| `mcp__stellar_raven__search` | `query="transaction signatures Ed25519 hash"`, `service="stellarDocs"`, `kind="operation"`, `limit=3` | `raven-discovery.json` |
| `mcp__stellar_raven__execute` | SDK query `transaction signature hash Ed25519`; contract query `signature_payload`; full returned page sections | `raven-sources.json` |
| `mcp__stellar_raven__execute` | Describe `stellarDocs.search_docs` | Tool schema discovery; no source claim |
| `mcp__stellar_raven__execute` | Queries `transaction hash signature` and `network passphrase`; page sections | `raven-digest-attempt.json`; automatic approval review timed out |
| `mcp__parallel_search__web_search_preview` | RFC SSH agent framing, Ed25519 flags, identities, and signature wrappers | `parallel-mcp.json` |
| `mcp__perplexity__perplexity_search` | `site:developer.1password.com SSH agent security approval duration application signatures cached authorization` | `perplexity.json` |

The Parallel MCP queries were `RFC 9987 SSH agent sign request` and `RFC 8709 Ed25519 signature encoding`.
Perplexity used `max_results=4`, `max_tokens_per_page=1200`, `search_type="fast"`, and the `developer.1password.com` domain filter.
The failed Raven follow-up needed no retry. Direct primary sources resolved the remaining question.

## Direct primary reads

```sh
python3 audit/2026-09-26/research/01-signer-astra/fetch_primary.py
curl -fLsS --max-time 30 -H 'Accept: text/markdown' https://developer.1password.com/docs/ssh/agent/security -o audit/2026-09-26/research/01-signer-astra/1password-security.html
curl -fLsS --max-time 30 -H 'Accept: text/markdown' https://developer.1password.com/docs/ssh/get-started -o audit/2026-09-26/research/01-signer-astra/1password-get-started.html
curl -fLsS --max-time 30 https://raw.githubusercontent.com/stellar/stellar-cli/8e402ea28202950b272fbabc34caad4d2f64fe87/cmd/soroban-cli/src/utils.rs -o audit/2026-09-26/research/01-signer-astra/stellar-cli-utils.rs
```

The script records each URL, exact command, result, access time, and content hash in `primary-source-manifest.json`.
The old `llms-ssh.txt` URL returned 404. Direct documentation pages succeeded.
Those responses contained Markdown, despite the `.html` filenames. The `.txt` files retain that source text.
Additional manifests: `1password-primary-manifest.json` and `stellar-cli-utils-manifest.json`.
Research usage appears in `usage-summary.json`.

## Limits

Live 1Password signing, key creation, public services, and testnet submission were `not_run` under the brief.
The coordinator supplied the central baseline status. This lane did not rerun the full repository suites.
