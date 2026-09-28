# Commands and evidence

All paths below use the frozen revision `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
The caller directory stayed `/Users/kalepail/Desktop/walleterm-v2`.
Only named `workdir` values changed individual command directories.

## Offline checks

Working directory: `/private/tmp/walleterm-audit-40d6cca9db73`.

```sh
XDG_CACHE_HOME=/private/tmp/04-sdk-astra-cache BUN_INSTALL_CACHE_DIR=/private/tmp/04-sdk-astra-cache/bun bun test bridge/sdk.test.ts bridge/connect.test.ts bridge/scan.test.ts
XDG_CACHE_HOME=/private/tmp/04-sdk-astra-cache BUN_INSTALL_CACHE_DIR=/private/tmp/04-sdk-astra-cache/bun bun test bridge/server.test.ts
```

The first command passed 36 tests; `bun-targeted.log` records its output.
The second command initially failed because the sandbox blocked loopback listening; `bun-server.log` preserves that attempt.
The same command passed 44 tests with permitted loopback access; `bun-server-permitted.log` records that result.
The tests inject isolated mock keys. They do not access 1Password or submit transactions.

Working directory: `/Users/kalepail/Desktop/walleterm-v2`.

```sh
XDG_CACHE_HOME=/private/tmp/04-sdk-astra-cache BUN_INSTALL_CACHE_DIR=/private/tmp/04-sdk-astra-cache/bun bun test audit/2026-09-26/checks/04-sdk-astra/remote-switch.test.ts
XDG_CACHE_HOME=/private/tmp/04-sdk-astra-cache BUN_INSTALL_CACHE_DIR=/private/tmp/04-sdk-astra-cache/bun bun test audit/2026-09-26/checks/04-sdk-astra/destroy-scan.test.ts
python3 audit/2026-09-26/checks/04-sdk-astra/verify-source.py
```

`remote-switch.test.ts` requires permitted loopback access. Its two cases pass and confirm the reported defect.
The initial harness encoded a Uint8Array incorrectly. The bridge rejected that mock signature through independent verification.
`remote-switch-harness-error.log` preserves the failure. The corrected harness uses `Buffer.from(signature).toString('hex')`.
`remote-switch.log` records the corrected result; no runtime file changed.
`destroy-scan.log` records one passing reproduction and successful explicit cleanup afterward.
The source check writes `source-identity.json` and requires all 23 inspected files to match Git objects.
It also records installed dependency versions and `bun --version`.

## Source tracing

The review used `cat`, `nl -ba`, `sed -n`, `rg -n`, `rg --files`, and `wc -l`.
Source reads used the frozen directory. The source-identity file lists inspected files and their hashes.
The review read both assigned briefs and all six `sdk/*` files.
It traced the four test files and `bridge/test/support.ts`.
It followed bridge session, selection, cancellation, and transaction-validation paths.
It followed demo account callbacks and transaction locks only to assess counterevidence.
It read package exports and the build script without executing a build.
It read `checks/BROWSER.md` as coordinator evidence; it opened no other area report.
A narrow memory registry lookup supplied prior terminology. Frozen source and current checks controlled every finding.
Two exploratory searches named nonexistent files; neither failure affected a conclusion.

## Research commands

Working directory: `/Users/kalepail/Desktop/walleterm-v2`.
Help and doctor outputs reside in `research/04-sdk-astra/`.

```sh
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
parallel-cli --help
parallel-cli search --help
```

Doctor passed local configuration checks. It did not validate remote authentication.
The first Jev attempt used the following command:

```sh
XDG_CACHE_HOME=/private/tmp/04-sdk-astra-cache stellar-raven-jev search 'What does SEP-43 require for Stellar browser wallet signTransaction inputs, outputs, and wallet discovery? Use the primary specification.' --budget-usd 1 --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/04-sdk-astra/jev --host-dir /private/tmp/04-sdk-astra-cache/jev-host --retain-days 0 --limit 3 --bundle
```

Exit 1: transport failed; usage reported $0.008729397. See `jev-compact.json` and `jev-stderr.txt`.
The permitted retry used the identical command with `--budget-usd 0.99`.
Exit 2: partial evidence; usage reported $0.021021724. See `jev-compact-permitted.json` and `jev-stderr-permitted.txt`.
The two attempts asked one scoped question. No rate limit occurred.

```sh
XDG_CACHE_HOME=/private/tmp/04-sdk-astra-cache parallel-cli search 'Find primary browser documentation for camera secure context restrictions and late getUserMedia permission resolution after cancellation.' -q 'site:developer.mozilla.org getUserMedia secure context promise ignore' --include-domains developer.mozilla.org,w3.org --json --max-results 3 --excerpt-max-chars-total 9000 -o audit/2026-09-26/research/04-sdk-astra/parallel-cli.json
curl -fsSL --max-time 30 https://raw.githubusercontent.com/stellar/stellar-protocol/master/ecosystem/sep-0043.md -o audit/2026-09-26/research/04-sdk-astra/sep-0043.md
shasum -a 256 audit/2026-09-26/research/04-sdk-astra/sep-0043.md
```

Parallel CLI exited 4 with a sandbox connection error, then exited 0 with permitted network access.
The `parallel-cli-stdout*` and `parallel-cli-stderr*` files preserve both attempts.
The direct SEP-43 read passed and closed the Jev source gap.

## Discovered research tools and arguments

1. `mcp__codex_apps__stellar_raven_search`: query `wallet standard signTransaction network passphrase`, service `stellarDocs`, kind `operation`, limit 3.
2. `mcp__codex_apps__stellar_raven_execute`: the script below returned indexed primary source text into `raven.json`.

```js
async () => {
  const a = await stellarDocs.search_wallet_dapp_docs({query:"signTransaction",includeContent:true,hitsPerPage:3});
  return a;
}
```

3. `mcp__parallel_search__web_search_preview`: one query, saved in `parallel-mcp.json`.
   Objective: `Find authoritative browser documentation about sessionStorage copying to opened tabs and pagehide limits for fetch keepalive cancellation.`
   Search queries: `site:developer.mozilla.org sessionStorage opener copy`; `site:developer.mozilla.org pagehide reliably fired keepalive`.
4. `mcp__perplexity__perplexity_search`: one challenge, saved in `perplexity-mcp.json`.
   Query: `W3C WCAG keyboard focus hidden dynamically removed controls dialog status messages focus order`.
   Parameters: `search_domain_filter: ["w3.org"]`, `max_results: 3`, `max_tokens_per_page: 650`, `search_type: "fast"`.
5. `web__run`: opened the primary SEP-43 and WCAG 2.2 URLs listed in `SOURCES.md`.
   Follow-up `find` calls checked `2.1.1 Keyboard`, `2.4.3 Focus Order`, and `4.1.3 Status Messages`.
   `wcag-source-check.txt` retains those browser-source checks.

The research summary records visible usage and unknown charges separately.
No source code or credentials entered research queries.
