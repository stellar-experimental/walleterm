# Overall review commands and evidence

Working repository: `/Users/kalepail/Desktop/walleterm-v2`.
Reviewed source: `/private/tmp/walleterm-audit-40d6cca9db73`.
Review configuration: `gpt-6-astra`, `model_reasoning_effort="xhigh"`.
The coordinator recorded this launch in `checks/overall-launches.json`.
No agent was delegated. The paired overall report was not read.

## Local checks

```sh
python3 audit/2026-09-26/checks/09-overall-astra/verify.py
```

Outcome: exit `0`; all seven identity, coverage, and version checks passed.
Evidence: `integrity.json`.
The script independently checks all 199 snapshot files against the manifest and baseline Git blobs.
It checks the archive contents, 14 fixture hashes, all 56 prior reports, and the concurrent patch.
It also checks all four actual Cargo locks against the coordinator's version record.
It writes only `integrity.json` beside itself.
It never opens the paired overall report.

The script executes these read-only Git forms:

```text
git -C /Users/kalepail/Desktop/walleterm-v2 ls-tree -r --name-only -z 40d6cca9db732a0db16d154c80d4a153bf33c6b7
git -C /Users/kalepail/Desktop/walleterm-v2 show 40d6cca9db732a0db16d154c80d4a153bf33c6b7:<manifest path>
git -C /Users/kalepail/Desktop/walleterm-v2 diff --no-ext-diff --no-textconv 40d6cca9db732a0db16d154c80d4a153bf33c6b7 -- .agents/skills/walleterm-site-bridge/references/interception.md
```

Source inspection used `rg`, `sed`, `cat`, and `nl` against named source and evidence files.
Several guessed inspection paths did not exist. Correct paths were then read from the manifest.
Those path errors were inspection errors, not repository defects.
No broad behavioral suite was repeated. Existing central and focused evidence resolved the material questions.
The final coordinator packaging and normal repository checks remain pending.

## Jev

The CLI help and `stellar-raven-jev doctor` were inspected before research.
Local readiness did not establish remote authentication.
Both attempts used this command, with stdout and stderr captured separately:

```sh
stellar-raven-jev --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/jev --budget-usd 0.90 --retain-days 0 search --bundle 'For Soroban authorization, what must a wallet inspect in every nested invocation before signing a simulation result, and can the RPC supplied expiration ledger be trusted as an independent short lifetime guarantee?'
```

Initial outcome: exit `1`, transport failure; `jev.stdout.json` and `jev.stderr.txt`.
Permitted retry: exit `2`, partial usable evidence; `jev.retry.stdout.json` and `jev.retry.stderr.txt`.
Files above reside under `research/09-overall-astra/`.
Both costs appear in `research/09-overall-astra/usage.json`.

## Parallel CLI

The CLI help was inspected before research.
Both attempts used this search:

```sh
parallel-cli search 'Find primary WHATWG or W3C requirements for stopping camera tracks when a web component is removed, and whether aborting a pending operation cancels camera permission or requires cleanup after a late grant.' -q 'site:w3.org mediacapture streams stop getUserMedia abort permission' --include-domains w3.org,whatwg.org --json --max-results 4 --excerpt-max-chars-total 9000 --client-model gpt-6-astra -o /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/09-overall-astra/parallel-cli.json
```

Initial outcome: exit `4`, API transport failure; `parallel-cli.stdout.txt` and `parallel-cli.stderr.txt`.
Permitted retry: exit `0`; `parallel-cli.retry.stdout.txt`, `parallel-cli.retry.stderr.txt`, and `parallel-cli.json`.

## MCP research calls

Raven discovered operations before execution.
Its two operations searched `authorization tree` and `signatureExpirationLedger` with `includeContent: true`.
The calls requested three and two hits, respectively.
Saved responses: `raven-discovery.json` and `raven.json`.

Parallel Search MCP searched official Git documentation about pinned `HEAD` and modified build inputs.
Queries: `site:git-scm.com diff --quiet HEAD` and `site:git-scm.com diff untracked files`.
Saved response: `parallel-mcp.json`; one search unit.

Perplexity MCP used a fast search with four results and `max_tokens: 800`.
Query: `site:developers.cloudflare.com Quick Tunnel trycloudflare HTTP 401 authentication error response`.
Saved response: `perplexity.json`.
The response did not establish a shipped-deployment producer for C07.

All research artifacts reside under `research/09-overall-astra/`.
`SOURCES.md` records applicability, discarded results, limits, and primary URLs.
