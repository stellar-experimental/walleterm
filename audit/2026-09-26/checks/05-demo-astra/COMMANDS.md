# Commands and outcomes

Caller directory: `/Users/kalepail/Desktop/walleterm-v2`.
Source directory: `/private/tmp/walleterm-audit-40d6cca9db73`.
All paths below start in the caller directory unless stated otherwise.
Read commands used `cat`, `sed`, `nl`, `rg`, and bounded Python JSON projections.
Those commands read the assigned briefs, frozen source, dependencies, and permitted coordinator evidence.
The memory lookup supplied historical state names. Frozen source and tests established all report conclusions.

## Local preparation

```sh
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
parallel-cli search --help
bun --version
python3 audit/2026-09-26/checks/05-demo-astra/verify-snapshot.py
```

All commands passed. Evidence: `preflight.log` and `snapshot-integrity.json`.
Jev doctor checked local configuration only. It did not authenticate remotely.
An initial SDK source lookup used absent `src/base/*.ts` paths and returned exit 2.
The follow-up found installed `lib/esm/base/*.js` files. Evidence: `../../research/05-demo-astra/sdk-source.json`.

## Offline tests

Run these commands from the source directory:

```sh
bun test bridge/site.test.ts bridge/activity.test.ts
bun test bridge/code-view.test.ts -t 'JSON tokens|terminal command|large, dense|older asynchronous|disclosures'
```

Results: 33 passed and 5 passed. Logs: `existing-offline.log` and `code-view-offline.log`.
The second command excludes the local HTTP server test. Coordinator evidence covers asset serving.

Run this command from the caller directory:

```sh
bun test audit/2026-09-26/checks/05-demo-astra/adversarial.test.ts
```

Result: 13 passed. Log: `adversarial.log`.
The earlier version contained 11 tests. Two added tests checked normal submission and quota failure before signing.
Tests with `finding:` names assert existing defects. Passing those tests does not establish corrected behavior.
The fixture uses real SDK 17.1.0 transaction bytes and isolated deterministic mock keys.
It replaces every network request with an in-memory function. It opens no listening sockets.

## Research commands

```sh
stellar-raven-jev --budget-usd 1 --retain-days 0 \
  --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-astra/jev \
  search 'For Stellar Horizon classic transactions, what evidence resolves an unknown submission after a timeout: original transaction hash, ledger close time, time bounds, and source sequence?' --bundle
```

Initial result: exit 1, transport failure, $0.008729397 retained charge.
Evidence: `jev-compact.json`, `jev-stderr.txt`, and its saved `search.json`.
The same question ran once with authorized network access and `--budget-usd 0.99`.
Result: exit 2, partial usable evidence, $0.021480082.
Evidence: `jev-network-compact.json`, `jev-network-stderr.txt`, and the named Jev session directory.
Both calls used the default source scope. No follow-up scoring or research call ran.

```sh
parallel-cli search \
  'Find primary browser documentation for localStorage write failures, quota errors, storage event delivery, and Web Locks across same-origin tabs.' \
  -q 'site:developer.mozilla.org localStorage QuotaExceededError storage event Web Locks' \
  --include-domains developer.mozilla.org --max-results 4 \
  --excerpt-max-chars-total 12000 --json \
  -o audit/2026-09-26/research/05-demo-astra/parallel-cli-storage.json
```

Initial result: exit 4, connection failure. Its query contained `site.developer.mozilla.org` instead of `site:developer.mozilla.org`.
The authorized network retry corrected that search operator and passed. It returned one `sku_search` usage unit.
Evidence: `parallel-cli-stdout.json`, `parallel-cli-stderr.txt`, `parallel-cli-network-stdout.json`, `parallel-cli-network-stderr.txt`, and `parallel-cli-storage.json`.

## MCP calls

1. `stellar_raven.search`: official Horizon timeout and time-bound source discovery.
2. `stellar_raven.execute`: `stellarDocs.search_rpc_horizon_data_docs` and `stellarDocs.search_docs`.
3. `parallel_search.web_search_preview`: official SDK hash, envelope, and signature documentation.
4. `perplexity.perplexity_search`: a primary-source challenge concerning timeout, 404, expiry, and duplicate payments.

All calls returned source evidence. Exact inputs appear in `../../research/05-demo-astra/requests.json`.
Raven returned relevant source sections before truncating unrelated configuration material.
The relevant timeout and time-bound sections remain readable in `raven-source.json`.
No deep-research processor ran. No credits were added.
