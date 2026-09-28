# Research summary

Access date: 2026-09-26.

## Stellar Raven MCP

Question: Stellar transaction hashing, Horizon submission errors, time bounds, sequence rules, and testnet USDC identity.

Tools: `mcp__stellar_raven__search` and `mcp__stellar_raven__execute`.

Outcome: passed.

Relevant primary sources:

- [Transaction Failed](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/transaction-failed)
  states that HTTP 400 excludes the transaction from the ledger.
- The same page identifies `tx_bad_seq` as the exceptional result that can become valid later.
- [Operations and Transactions](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions#time-bounds)
  states that ledger time controls transaction validity.
- [Transaction Lifecycle](https://developers.stellar.org/docs/learn/fundamentals/transactions/transaction-lifecycle#10-application-validator)
  states that inclusion consumes the source sequence.
- [x402 Quickstart Guide](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide#step-3-expanded-establish-usdc-trustline)
  identifies `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` as testnet USDC.

Applicability: the frozen demo uses `@stellar/stellar-sdk` 17.1.0 and `Networks.TESTNET`.

Usage: the MCP returned no dollar charge.

## stellar-raven-jev

Question: safe uncertain-submission recovery by hash, time bounds, and source sequence.

Environment commands:

```text
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
```

Search command:

```text
stellar-raven-jev --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-daybreak --budget-usd 1 search --json --bundle "What do current official Stellar sources require for safely reconciling an uncertain classic transaction submission by transaction hash, time bounds, and source sequence?"
```

Outcome: failed during Jev transport.

The run saved three transport reports and no source documents.
The failed routing reservation cost `$0.008729397`.
No retry ran because the first run produced no usable source evidence.

Evidence:

- `1790472929-f8a823a2-0a5d-4a1a-b615-b09fccf9a730/search.json`
- `1790472929-f8a823a2-0a5d-4a1a-b615-b09fccf9a730/usage.json`
- `1790472929-f8a823a2-0a5d-4a1a-b615-b09fccf9a730/failures.json`

## Parallel Search MCP

Question: official Horizon submission and uncertain-response recovery.

Tool: `mcp__parallel_search__web_search_preview`.

Outcome: passed with one `sku_search`.

Relevant primary sources:

- [Error Handling](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling)
  recommends hash polling after a timeout.
- [Submit a Transaction](https://developers.stellar.org/docs/data/apis/horizon/api-reference/submit-a-transaction)
  says an already-included transaction returns its original response.
- [Transaction Result Codes](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions)
  defines `tx_bad_seq`, `tx_too_early`, and `tx_too_late`.

The submit endpoint reported an update date of 2026-06-17.

Usage: one `sku_search`; the provider returned no dollar charge.

## parallel-cli

Question: Web Locks, local storage, and page-exit behavior.

Command:

```text
parallel-cli search "Find primary documentation for durable browser transaction journals, Web Locks cross-tab coordination, localStorage persistence, and page-exit request behavior" -q "Web Locks API exclusive lock" -q "localStorage persistence atomic write" -q "pagehide fetch keepalive" --json --max-results 10 --excerpt-max-chars-total 27000 --include-domains developers.google.com,developer.mozilla.org,w3c.github.io,html.spec.whatwg.org -o "/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/05-demo-daybreak/parallel-cli-browser-recovery.json"
```

Outcome: passed after the restricted network blocked the first attempt.

Relevant primary sources:

- [Web Locks API](https://w3c.github.io/web-locks/) defines origin-scoped exclusive locking.
- The source was the 2025-09-24 Editor's Draft.
- [Window.localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)
  states that storage persists across sessions and remains origin-specific.
- The MDN page reported a modification date of 2025-11-30.
- [Using Deferred Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Deferred_Fetch)
  states that `pagehide` and `keepalive` remain best-effort mechanisms.

Applicability: the demo uses Web Locks, `localStorage`, `pagehide`, and `fetch` keepalive.

Evidence: `parallel-cli-browser-recovery.json`.

Usage: one `sku_search`; the provider returned no dollar charge.

## Perplexity MCP

Question: challenge the demo's expiry rule with primary Stellar sources.

Tool: `mcp__perplexity__perplexity_search`.

Outcome: passed.

The results supported the conservative rule.
No result showed later inclusion after ledger time exceeded `maxTime`.

Relevant primary sources:

- [Error Handling](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling)
- [Transaction Lifecycle](https://developers.stellar.org/docs/learn/fundamentals/transactions/transaction-lifecycle)
- [CAP-21](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0021.md)

Usage: the MCP returned no usage metrics or dollar charge.

## Budget

Visible spend: `$0.008729397`.

Unknown charges: Stellar Raven MCP, Parallel Search MCP, parallel-cli, and Perplexity MCP.

The visible spend stayed below the `$10` lane allocation.
