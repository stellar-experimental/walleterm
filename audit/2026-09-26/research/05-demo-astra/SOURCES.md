# Source evidence

Access date: 2026-09-26, America/New_York.
Installed versions: Bun 1.4.2 and `@stellar/stellar-sdk` 17.1.0.
The frozen package manifest pins SDK 17.1.0. The installed package reports that same version.
Online SDK documentation is mutable. Installed source and executable tests control version applicability.

| Source | Evidence file | Applicability |
|---|---|---|
| [Horizon error handling](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling) | `raven-source.json`; Jev `0019.txt`; `perplexity.json` | Classic synchronous submission, timeout, original-hash checks, duplicate-payment risk |
| [Horizon timeout](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout) | `raven-source.json`; `perplexity.json` | A 504 does not establish transaction failure |
| [Operations and transactions](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions) | `raven-source.json`; Jev `0154.txt` | Ledger time controls time bounds; applied transactions consume their sequence |
| [Horizon transaction object](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/transactions/object) | Jev `0102.txt`; `perplexity.json` | `successful` is boolean; `hash` identifies the transaction; `ledger` identifies inclusion |
| [Transaction result codes](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions) | Jev `0128.txt` | `tx_bad_seq`, `tx_bad_auth`, time-bound failures |
| [SDK transaction reference](https://stellar.github.io/js-stellar-sdk/reference/core-transactions/) | `parallel-mcp.json`; `sdk-source.json` | Transaction hash and envelope signatures have separate representations |
| [SDK key reference](https://stellar.github.io/js-stellar-sdk/reference/core-keys) | `parallel-mcp.json`; executable mock tests | `verify` checks signature bytes against transaction hash bytes |
| [MDN storage event](https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event) | `parallel-cli-storage.json` | Other same-origin tabs receive storage changes |
| [MDN quota error](https://developer.mozilla.org/en-US/docs/Web/API/QuotaExceededError) | `parallel-cli-storage.json` | Storage can reject writes when its quota is exhausted |

Jev text paths start at `jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/`.
The four cited Jev files contain source text. Their full-report entries list no fuller companions.
The error-handling and transaction-object pages report 2025-12-19 dates.
The operations page reports 2026-06-17. The result-code page reports 2026-09-22.
These dates describe retrieved pages. They do not identify a deployed Horizon version.

Raven, Jev, and Perplexity found overlapping Stellar pages. Those results count as the same sources.
Perplexity did not establish a conflicting recovery rule.
Stellar documentation permits unchanged retries. This project deliberately uses the stricter no-automatic-resubmission rule.
The audit did not recommend relaxing that rule.

## Research status and cost

| Tool | Status | Visible usage |
|---|---|---|
| Stellar Raven MCP | Passed | One discovery call; one execution with two documentation searches; charge unknown |
| Jev, sandbox attempt | Failed transport | $0.008729397; three reservations remained charged |
| Jev, authorized network retry | Partial, usable | $0.021480082; 357 requests; 96 source requests |
| parallel-cli | Initial connection failure; network retry passed | One reported `sku_search`; charge unknown |
| Parallel Search MCP | Passed | One reported `sku_search`; charge unknown |
| Perplexity MCP | Passed | One fast search; charge unknown |

Combined visible Jev cost: **$0.030209479**, within the $1 allocation.
The second Jev call used a $0.99 ceiling after inspection of the first charge.
No tool reported a rate limit. The audit ran no additional question or scoring continuation.
Jev returned 29 selected documents and 21 uncertain documents. Seventeen selected documents remained outside compact output.
I inspected the full result inventory and read the four relevant primary text files.
The partial result included one lost original page unrelated to this question.
Other limits included capped original reads and source coverage limits.
These limits do not weaken the executable reproductions. They prevent a claim of exhaustive research coverage.
Raven source text was truncated after relevant sections and unrelated configuration content.
No additional allocation is needed for these findings.
The total provider bill remains unknown because other providers did not expose prices.

Saved Parallel output: `parallel-cli-storage.json`.
