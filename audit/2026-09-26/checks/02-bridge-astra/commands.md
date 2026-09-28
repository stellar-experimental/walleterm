# Commands and tool calls

The caller directory was `/Users/kalepail/Desktop/walleterm-v2` unless specified.
Only the assigned report and evidence directories received retained writes.

## Preparation and reads

```sh
mkdir -p audit/2026-09-26/research/02-bridge-astra audit/2026-09-26/checks/02-bridge-astra
cat audit/2026-09-26/briefs/COMMON.md audit/2026-09-26/briefs/02-bridge.md
cat /private/tmp/walleterm-audit-40d6cca9db73/AGENTS.md /private/tmp/walleterm-audit-40d6cca9db73/README.md /private/tmp/walleterm-audit-40d6cca9db73/docs/PLAN.md /private/tmp/walleterm-audit-40d6cca9db73/docs/INTERFACE.md
cat /Users/kalepail/Desktop/stellar-raven-jev/skills/stellar-raven-jev/SKILL.md /Users/kalepail/.agents/skills/parallel-web-search/SKILL.md
git rev-parse HEAD
bun --version
node --version
op --version
op item list --help
op read --help
```

I read the report's coverage files with `cat`, `nl -ba`, and bounded `sed -n` ranges.
I searched those files with `rg` and listed relevant paths with `rg --files`.
I inspected `manifest.json`, dependency metadata, local result logs, and the coordinator's permitted baseline logs.
A memory registry search returned prior bridge notes. I opened no saved review report or rollout transcript.
An SDK declaration glob failed because that path did not exist. The transaction-builder declaration lookup succeeded.

The initial snapshot verification used Python to hash every path in `manifest.json`.
The final retained validation script repeats that check.

## Targeted tests

Working directory: `/private/tmp/walleterm-audit-40d6cca9db73`.

```sh
bun test bridge/server.test.ts bridge/signer.test.ts bridge/vault.test.ts > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/02-bridge-astra/targeted-tests.log 2>&1
```

Automatic approval review timed out before the first attempt executed.
The permitted retry exited 0: 62 passed, 0 failed.

Working directory: `/Users/kalepail/Desktop/walleterm-v2`.

```sh
bun test audit/2026-09-26/checks/02-bridge-astra/adversarial.test.ts > audit/2026-09-26/checks/02-bridge-astra/adversarial-tests.log 2>&1
```

This command exited 0: 12 passed, 0 failed.

The coordinator supplied separate evidence for these commands:

```sh
go test -race ./...
bun run test
```

Both commands exited 0. I did not rerun the complete baseline.

## Jev

```sh
stellar-raven-jev --help > audit/2026-09-26/research/02-bridge-astra/jev-help.txt
stellar-raven-jev search --help > audit/2026-09-26/research/02-bridge-astra/jev-search-help.txt
stellar-raven-jev doctor > audit/2026-09-26/research/02-bridge-astra/jev-doctor.txt
stellar-raven-jev search 'How do Stellar classic transaction time bounds and sequence numbers limit replay after a signed transaction leaves a wallet?' --budget-usd 1 --retain-days 0 --bundle --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev > audit/2026-09-26/research/02-bridge-astra/jev-compact.json 2> audit/2026-09-26/research/02-bridge-astra/jev-stderr.txt
```

The search exited 1 after three transport failures. The recorded reservations total `$0.008729397`.
I inspected its compact report, full report, usage, and failures before retrying.

The permitted retry used the same question and a smaller allocation:

```sh
stellar-raven-jev search 'How do Stellar classic transaction time bounds and sequence numbers limit replay after a signed transaction leaves a wallet?' --budget-usd 0.90 --retain-days 0 --bundle --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/02-bridge-astra/jev > audit/2026-09-26/research/02-bridge-astra/jev-retry-compact.json 2> audit/2026-09-26/research/02-bridge-astra/jev-retry-stderr.txt
```

The retry exited 2 with partial evidence. Its recorded cost is `$0.019627227`.
I inspected the compact report, full result inventory, degradation messages, and cited source files `0050.txt` and `0020.txt`.

## parallel-cli

```sh
parallel-cli --help > audit/2026-09-26/research/02-bridge-astra/parallel-help.txt
parallel-cli search --help > audit/2026-09-26/research/02-bridge-astra/parallel-search-help.txt
parallel-cli search 'Find official 1Password CLI documentation for listing SSH Key items by vault and reading only the public key field through secret references. Clarify vault names, IDs, and field references.' -q 'site:developer.1password.com CLI item list vault SSH public key read' --max-results 4 --excerpt-max-chars-total 16000 --json -o audit/2026-09-26/research/02-bridge-astra/parallel-cli.json > audit/2026-09-26/research/02-bridge-astra/parallel-cli.stdout.txt 2> audit/2026-09-26/research/02-bridge-astra/parallel-cli.stderr.txt
```

The first attempt exited 4 with `APIConnectionError`. Its client retried the transport twice.
The permitted retry repeated the same query and arguments.
Its stdout and stderr used `parallel-cli-retry.stdout.txt` and `parallel-cli-retry.stderr.txt`.
The retry exited 0 and retained four source results in `parallel-cli.json`.

## MCP research calls

Tool discovery inspected session metadata through `ALL_TOOLS`.
All five requested research systems had available capabilities.

### Stellar Raven

Tool: `mcp__stellar_raven__search`.

```json
{"query":"transaction signatures network passphrase time bounds","service":"stellarDocs","kind":"operation","limit":3}
```

Tool: `mcp__stellar_raven__execute`.

```js
async () => {
  const results = await Promise.all([
    stellarDocs.search_protocol_concepts_docs({query:'transaction signatures network passphrase',includeContent:true,hitsPerPage:4}),
    stellarDocs.search_protocol_concepts_docs({query:'transaction time bounds sequence number',includeContent:true,hitsPerPage:4})
  ]);
  return results;
}
```

Evidence: `research/02-bridge-astra/raven.json`.

### Parallel Search MCP

Tool: `mcp__parallel_search__web_search_preview`.

```json
{"objective":"Find primary Node.js and Bun documentation describing HTTP server requestTimeout, headersTimeout, socket timeout, and connection limits. Identify whether requestTimeout bounds asynchronous handler work or only receipt of a request.","search_queries":["site:nodejs.org http server requestTimeout headersTimeout","site:bun.sh node http server maxConnections"]}
```

Evidence: `research/02-bridge-astra/parallel-mcp.json`.

Tool: `mcp__parallel_search__web_fetch`.

```json
{"urls":["https://www.1password.dev/cli/secret-reference-syntax/"],"objective":"Read the primary secret-reference syntax for vault IDs, item IDs, and a named public key field. Do not retrieve account data."}
```

Evidence: `research/02-bridge-astra/secret-reference.json`.

### Perplexity MCP

Tool: `mcp__perplexity__perplexity_search`.

```json
{"query":"site:developer.mozilla.org Origin header forbidden request header CORS opaque origin null authorization bearer token","max_results":3,"max_tokens_per_page":700,"search_domain_filter":["developer.mozilla.org"],"search_type":"fast"}
```

Evidence: `research/02-bridge-astra/perplexity.json`.

## Report verification

```sh
python3 audit/2026-09-26/checks/02-bridge-astra/validate-report.py
```

The validator checks source hashes, report sections, evidence links, test totals, and Jev usage.
It writes `checks/02-bridge-astra/report-validation.json`.
