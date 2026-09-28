# Research method and source status

The user authorized up to $250 of paid research.
Reviewers receive bounded allocations. Unused funds remain unused.

## Requested tools

| Requested surface | Available surface | Use |
|---|---|---|
| Herdr | Herdr 0.9.1, protocol 22 | Isolated reviewer sessions with explicit models and effort. |
| Stellar Raven | `stellar-raven` MCP search and execute | Official protocol evidence and ecosystem discovery. |
| stellar-raven-jev | Installed CLI and supplied skill | Ranked source retrieval with saved source text. |
| parallel-search | Parallel Search MCP and parallel-web-search skill | Independent primary-source discovery. |
| parallel-cli | Installed CLI | Saved search artifacts. |
| Perplexity MCP | Search tools | Independent source discovery and challenge. |

The installed skill catalog has no separate `stellar-raven` SKILL.md entry.
The audit uses the requested Stellar Raven MCP and its discovered operational guidance.
The `parallel-web-search` skill supplies the requested Parallel search workflow.

## Source policy

Prefer primary specifications, maintained documentation, pinned implementation source, and reproducible local checks.
Record versions and access dates. Separate repository behavior from current external documentation.
Search relevance scores do not prove truth or coverage.
Search summaries do not override direct source evidence.
Different tools can return the same underlying source. This does not provide independent corroboration.

## Central research results

The first Jev attempt failed during transport and reserved $0.008729397.
The permitted retry returned partial evidence and reported $0.050518827.
It reported six scoring failures and 62 currentness failures.
Its source text remains useful, but it does not establish complete coverage or currentness.
The coordinator inspected its full report and read the cited source texts.
Parallel CLI initially failed under restricted network access. Its permitted retry succeeded.
Raven, Parallel Search MCP, and Perplexity returned primary-source material.

## Primary sources read centrally

- [Stellar transaction preconditions](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions#time-bounds).
- [Soroban authorization structure](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction#authorization-data).
- [Signing Soroban invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations).
- [1Password SSH security](https://www.1password.dev/ssh/agent/security).
- [1Password authorization](https://www.1password.dev/ssh/agent/authorization).
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare).
- [Freighter signing API](https://docs.freighter.app/extension-freighter-api/signing).

Access date: 2026-09-26.
Saved central evidence lives in `research/central-*`.
Each reviewer records its own source evidence and limitations.
The final usage record consolidates visible usage and unresolved billing visibility.

## Final research and storage record

All 16 area reviewers used the requested research surfaces.
Both overall reviewers also used Raven, Jev, Parallel Search MCP, parallel-cli, and Perplexity.
Focused reviewers reused preserved primary evidence and queried unresolved facts when useful.
The [reviewer registry](checks/reviewer-sessions.json) records all 58 individual sessions.

Jev records 31 runs: 19 failed and 12 partial.
Reported or reserved Jev usage totals `$0.430850701`.
This figure is not a verified invoice for every research provider.
Other provider charges remain unknown where tools expose no dollar amount.
The audit used bounded allocations within the authorized `$250` research budget.
It did not buy credits, start new subscriptions, or run paid deep-research processors.

No Jev run establishes complete retrieval coverage.
The audit cross-checked consequential claims against primary text, pinned source, and local reproductions.
Different providers returning the same source do not create independent corroboration.

The [research archive](research/evidence.tar.gz) contains 1416 raw evidence files.
It occupies 7,768,115 bytes after compression.
Human source notes, usage records, and provider limitations remain readable in `research/`.
The [archive manifest](research/archive-manifest.json) records every logical path and SHA-256 value.
Extract the archive into `research/` to restore those logical paths.
Some report references use these archived paths.

Two copies of an irrelevant public documentation key example were removed.
The [redaction record](research/redactions.json) preserves source URLs and before-and-after hashes without the example bytes.
No project credential was identified or printed.
The remaining raw evidence retains its recorded bytes.
