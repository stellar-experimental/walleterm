# Commands and outcomes

All source reads used `/private/tmp/walleterm-audit-40d6cca9db73`.
Artifacts used the assigned `08-product-astra` directories.
No source edit, real installation, skill installation, key access, signature, submission, or service startup ran.

## Offline checks

1. From the frozen root: `bun test scripts/install.test.ts`.
   Result: exit 0; two tests passed. Log: `install-baseline.log`.
2. From the caller root: `python3 audit/2026-09-26/checks/08-product-astra/install-probe.py`.
   Result: exit 0. Four injected failures preserved both commands.
   A successful installation and repeat installation passed. Output: `install-probe.json`.
3. From the caller root: `python3 audit/2026-09-26/checks/08-product-astra/distribution-probe.py`.
   Result: exit 0. SDK-only import failed; full distribution import passed.
   Output: `distribution-probe.json`.
4. From the caller root: `python3 audit/2026-09-26/checks/08-product-astra/static-audit.py`.
   Result: exit 0. Output: `static-audit.log` and the document/package/link inventories.
5. An inline Python script created temporary output and cache directories.
   It ran `go build -trimpath -o TEMP/ARCH/walleterm .` from the frozen root.
   Environment: `GOOS=darwin`, `GOARCH=arm64`, then `GOARCH=amd64`; `GOCACHE=TEMP/go-cache`.
   Both builds passed. `file TEMP/ARCH/walleterm` confirmed each Mach-O architecture.
   The arm64 build ran `TEMP/arm64/walleterm --help`.
   A temporary `stellar-walleterm -> walleterm` link enabled `stellar walleterm --version`.
   The temporary caller directory and PATH contained only the test installation.
   Both commands passed. The script removed its temporary directory.
   Output: `platform-builds.json`.
6. An inline Python script read `git ls-tree -rz 40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
   It computed each frozen file's Git blob hash without writing Git objects.
   All 199 hashes matched. Output: `frozen-source.json`.

The distribution check used browser assets from the supplied central baseline build.
The file layout follows `scripts/build.ts` with `splitting: true`.
No full test suite or format check was repeated.

## Installed tools

Commands: `bun --version`, `go version`, `stellar --version`, `rustc --version`,
`cloudflared --version`, `op --version`, `stellar-raven-jev --version`, and `parallel-cli --version`.
All returned exit 0. Exact output: `versions.json`.
The `op` command queried its version only.

Commands: `stellar tx sign --help`, `stellar tx hash --help`,
`stellar tx encode --help`, and `stellar tx decode --help`.
All returned exit 0. Files: `stellar-tx-*-help.txt`.

## Research commands

Preparation: `stellar-raven-jev --help`, `stellar-raven-jev search --help`,
`stellar-raven-jev doctor`, `parallel-cli --help`, and `parallel-cli search --help`.
Doctor reported local readiness and did not validate remote authentication.
No credential values were printed.

Jev question:
`What do official Stellar CLI sources specify for transaction hash, external decorated signature insertion, and transaction submission? Verify a digest-only external signer workflow.`

Jev command:
`stellar-raven-jev --budget-usd 1 --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/08-product-astra/jev --retain-days 0 search QUESTION --bundle`.
It returned exit 1 after sandbox transport failures.
Visible charged reservation: $0.008729397.
The same question ran with `--budget-usd 0.90` after permitted network escalation.
It returned exit 2 with partial usable evidence and visible spend $0.018602107.
The lane total is $0.027331504.
Files: `jev-compact.json`, `jev-retry-compact.json`, their stderr files, and both retained session directories.

Parallel CLI command:
`parallel-cli search OBJECTIVE -q 'site.github.com/axios/axios/security/advisories 1.20.0' -q 'site.github.com/stellar/js-stellar-sdk security advisories' --max-results 6 --excerpt-max-chars-total 14000 --json -o audit/2026-09-26/research/08-product-astra/parallel-cli.json`.
Objective:
`Find primary security advisories affecting axios 1.20.0, @stellar/stellar-sdk 17.1.0, jsqr 1.4.0, qrcode 1.5.4. Give affected and fixed versions.`
It passed after permitted network escalation.
The first sandbox attempt used Axios 1.16.0 and failed with `APIConnectionError`, exit 4.
That failed objective did not determine installed-version applicability.
Both attempts retained stdout and stderr files.

From the frozen root: `bun audit --help`, then `bun audit --json`.
The read-only network query returned exit 0 and `{}`.
Files: `bun-audit.json`, `bun-audit-stderr.txt`.

OSV command:
`curl -fsS --max-time 60 -H 'Content-Type: application/json' --data-binary @audit/2026-09-26/research/08-product-astra/osv-request.json https://api.osv.dev/v1/querybatch -o audit/2026-09-26/research/08-product-astra/osv-response.json`.
It returned exit 0.
The request contains only public package names and versions.
Files: `osv-request.json`, `osv-response.json`, and `osv-matches.json`.

## MCP calls

The research directory retains full provider outputs.
- Stellar Raven: `search` discovered `stellarDocs.search_sdk_cli_tools_docs`.
  `execute` ran it with `query: "transaction sign"`, `includeContent: true`, and `hitsPerPage: 3`.
  Output: `raven.json`. Results were adjacent; they did not establish external signature injection.
- Parallel Search: one `web_search_preview` queried 1Password platforms, Ed25519, and approval caching.
  Output: `parallel-mcp.json`; one `sku_search`.
- Perplexity: one `perplexity_search` challenged dependency security, using fast search and six results.
  Output: `perplexity.json`. Its initial Axios version was corrected during source assessment.
- Parallel extraction: one `web_fetch` retrieved five primary advisory pages.
  Output: `primary-advisories.json`; five `sku_extract_excerpts`.

Other provider monetary charges were not returned.
No paid deep-research call or credit purchase ran.

