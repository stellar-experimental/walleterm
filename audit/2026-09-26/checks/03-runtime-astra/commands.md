# Commands and results

The source working directory was `/private/tmp/walleterm-audit-40d6cca9db73`.
The caller repository was `/Users/kalepail/Desktop/walleterm-v2`.
The shell used zsh.
These variables abbreviate absolute paths in the commands below.

```sh
AUDIT_ROOT=/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26
RUNTIME_CHECKS=$AUDIT_ROOT/checks/03-runtime-astra
RUNTIME_RESEARCH=$AUDIT_ROOT/research/03-runtime-astra
FROZEN_SOURCE=/private/tmp/walleterm-audit-40d6cca9db73
```

## Local setup and inspection

```sh
cat "$AUDIT_ROOT/briefs/COMMON.md" "$AUDIT_ROOT/briefs/03-runtime.md"
cat "$FROZEN_SOURCE/AGENTS.md" "$FROZEN_SOURCE/README.md"
cat "$FROZEN_SOURCE/docs/PLAN.md" "$FROZEN_SOURCE/docs/INTERFACE.md"
cat "$FROZEN_SOURCE/docs/CONNECTION-LIFECYCLE.md"
cat /Users/kalepail/Desktop/stellar-raven-jev/skills/stellar-raven-jev/SKILL.md
cat /Users/kalepail/.agents/skills/parallel-web-search/SKILL.md
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
parallel-cli search --help
bun --version
go version
cloudflared --version
stellar-raven-jev --version
parallel-cli --version
```

These commands passed.
The report lists versions and covered source files.
Source inspection used `rg`, `cat`, `nl -ba`, `sed`, and `wc -l`.
No command read another audit report.
The initial memory registry search used `runtime|audit|frozen`.
No rollout report was opened.
The source manifest read tracked file bytes for hash comparison only.

## Tests

Run these commands from the frozen source directory.

```sh
env GOCACHE=/private/tmp/walleterm-audit-runtime-go-cache \
  GOMODCACHE=/private/tmp/walleterm-audit-runtime-go-modcache \
  GOTMPDIR=/private/tmp TMPDIR=/private/tmp \
  go test -race -count=1 -run 'Test(ServiceOptions|SeparatedHelp|BunVersion)$' -v . \
  > "$RUNTIME_CHECKS/go-service.log" 2>&1

env TMPDIR=/private/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-runtime-bun-cache \
  bun test bridge/launch.test.ts bridge/runtime.test.ts bridge/tunnel-child.test.ts \
  > "$RUNTIME_CHECKS/bun-lifecycle.log" 2>&1

env TMPDIR=/private/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-runtime-bun-cache \
  bun test "$RUNTIME_CHECKS/targeted.test.ts" > "$RUNTIME_CHECKS/targeted.log" 2>&1

env TMPDIR=/private/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-runtime-bun-cache \
  bun test "$RUNTIME_CHECKS/targeted.test.ts" > "$RUNTIME_CHECKS/targeted-permitted.log" 2>&1

env TMPDIR=/private/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-runtime-bun-cache \
  bun test -t 'malformed demo' "$RUNTIME_CHECKS/targeted.test.ts" \
  > "$RUNTIME_CHECKS/malformed-encoded.log" 2>&1

env TMPDIR=/private/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-runtime-bun-cache \
  bun test bridge/signer.test.ts bridge/server.test.ts \
  -t 'stopping the signer|failed public key read|caller cancellation stops|closing the bridge' \
  > "$RUNTIME_CHECKS/signer-shutdown.log" 2>&1
```

| Log | Exit | Outcome |
| --- | --- | --- |
| `go-service.log` | 0 | 3 passed |
| `bun-lifecycle.log` | 0 | 19 passed |
| `targeted.log` | 1 | 1 passed; two listener-dependent checks blocked by sandbox |
| `targeted-permitted.log` | 1 | 2 passed; raw `//%` request confirmed demo crash |
| `malformed-encoded.log` | 1 | Encoded `//%25` request confirmed demo crash |
| `signer-shutdown.log` | 0 | 4 passed; 51 filtered out |

The permitted checks used approved local socket access.
All cloudflared executables in the custom checks were mocks.
The first two custom runs used `GET //%` with the local host header.
The last custom run used `GET //%25` with an accepted public-origin host header.
The final `targeted.test.ts` retains the encoded reproduction.
No public service or live signing call ran.

## Jev

One public question ran twice because the initial transport failed.
The repeat retained the exact question and reduced the allocation.

```sh
stellar-raven-jev --output-dir "$RUNTIME_RESEARCH/jev" --budget-usd 1 --retain-days 0 \
  search 'What official Stellar guidance requires clients to check a transaction hash after a timeout instead of assuming failure or submitting a new transaction?' \
  --bundle > "$RUNTIME_RESEARCH/jev-compact.json" 2> "$RUNTIME_RESEARCH/jev-stderr.txt"

stellar-raven-jev --output-dir "$RUNTIME_RESEARCH/jev" --budget-usd 0.99 --retain-days 0 \
  search 'What official Stellar guidance requires clients to check a transaction hash after a timeout instead of assuming failure or submitting a new transaction?' \
  --bundle > "$RUNTIME_RESEARCH/jev-permitted-compact.json" 2> "$RUNTIME_RESEARCH/jev-permitted-stderr.txt"

stellar-raven-jev --output-dir "$RUNTIME_RESEARCH/jev" usage > "$RUNTIME_RESEARCH/jev-usage.json"
stellar-raven-jev doctor > "$RUNTIME_RESEARCH/jev-doctor.json"
```

The initial search exited 1 with transport failures.
The permitted search exited 2 with usable partial results.
The usage and doctor commands exited 0.
No source or Jev rate limit required a retry.
The report records both reservations.

## Parallel CLI

The sandbox attempt exited 4 with `APIConnectionError`.
The permitted repeat of this command exited 0.

```sh
parallel-cli search \
  'Find official Cloudflare Quick Tunnel documentation for config files, ephemeral URLs, availability limits, HTTP2 and grace-period shutdown options.' \
  -q 'site.developers.cloudflare.com quick tunnels config.yaml limitations' \
  -q 'site.developers.cloudflare.com tunnel grace-period no-autoupdate metrics' \
  --max-results 4 --excerpt-max-chars-total 16000 --json \
  -o "$RUNTIME_RESEARCH/parallel-cli.json" \
  > "$RUNTIME_RESEARCH/parallel-cli-permitted-stdout.json" \
  2> "$RUNTIME_RESEARCH/parallel-cli-permitted-stderr.txt"
```

The initial stdout and stderr use `parallel-cli-stdout.json` and `parallel-cli-stderr.txt`.
The CLI performed internal connection retries before its initial failure.

## Direct primary-source reads

Each command exited 0 with network permission.
These reads did not start cloudflared.

```sh
curl -fsSL --max-time 25 \
  https://raw.githubusercontent.com/cloudflare/cloudflared/2026.9.3/cmd/cloudflared/tunnel/cmd.go \
  -o "$RUNTIME_RESEARCH/cloudflared-2026.9.3-cmd.go"

curl -fsSL --max-time 25 \
  https://raw.githubusercontent.com/cloudflare/cloudflared/2026.9.3/config/configuration.go \
  -o "$RUNTIME_RESEARCH/cloudflared-2026.9.3-configuration.go"

curl -fsSL --max-time 25 \
  https://developers.cloudflare.com/rules/normalization/how-it-works/index.md \
  -o "$RUNTIME_RESEARCH/cloudflare-normalization.md"
```

## MCP calls

Tool discovery inspected the available tool metadata.
The following calls completed successfully.
No private source code or credentials entered their requests.

1. `mcp__stellar_raven__search`
   Input: `{"query":"testnet network reset transaction status","service":"stellarDocs","kind":"operation","limit":2}`.
2. `mcp__codex_apps__stellar_raven_execute`
   Code: `async () => { return await stellarDocs.search_docs({query: 'testnet reset', includeContent:true, hitsPerPage:3}); }`.
   Output: `raven-testnet.json`.
3. `mcp__codex_apps__parallel_search_web_search`
   Objective: Find official Bun documentation about automatic .env loading by spawned Bun processes and disabling it.
   Additional objective: Find how child_process spawn env interacts with Bun dotenv loading.
   Queries: `site.bun.sh docs environment variables env-file no-env-file`; `site.bun.com docs runtime environment variables dotenv`.
   Session: `85a58b7a96c142f895c8b57f0f170c3a`. Model: `gpt-6-astra`.
   Output: `parallel-mcp.json`.
4. `mcp__perplexity__perplexity_search`
   Query: `site.nodejs.org child_process exit close pipe stdio child kill subprocess descendants`.
   Domain: `nodejs.org`. Search type: `fast`. Results: 3. Tokens per page: 1500.
   Output: `perplexity.json`.

## Final verification

```sh
python3 "$RUNTIME_CHECKS/verify_snapshot.py"
```

The verifier reads Git tree entries and snapshot bytes.
It never writes Git objects or changes the snapshot.
The initial equivalent inline command produced `source-manifest.json`.
The saved verifier produces `source-manifest-final.json`.

