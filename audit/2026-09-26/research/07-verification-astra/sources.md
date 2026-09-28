# Verification audit research record

Access date for all sources: 2026-09-26.
Installed code: Bun `1.4.2`, `@stellar/stellar-sdk` `17.1.0`, and Jev CLI `0.1.0`.
The package declares TypeScript `7.0.2`.
Research used public technical questions only.

## Primary sources

| Source | Version or source date | Supported conclusion and applicability | Retained evidence |
| --- | --- | --- | --- |
| [Stellar getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) | Retrieved page dated 2026-07-21; RPC server version unverified | Hash lookup returns terminal results or `NOT_FOUND`; retained history is bounded | `perplexity.json`; Jev `search-documents/0038.txt` contains examples only |
| [Stellar sendTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction) | Retrieved page dated 2025-12-12; RPC server version unverified | Submission queues the transaction; the client must query its final outcome | `parallel-cli.json`, `perplexity.json` |
| [Stellar RPC configuration](https://developers.stellar.org/docs/data/apis/rpc/admin-guide/configuring) | Unversioned configuration documentation | Retention is configurable; the documented default does not establish a particular node's actual retention | `raven.json` |
| [Horizon error handling](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling) | Retrieved page dated 2025-12-19 | Timeouts require transaction-status investigation; this supports the unknown-outcome model | Jev `search-documents/0014.txt`, `perplexity.json` |
| [Node.js filesystem](https://nodejs.org/api/fs.html) | Retrieved page title: Node.js `26.8.1` | `wx` excludes an existing path; `fsyncSync` concerns the open descriptor and depends on the platform | `parallel-mcp.json` |

Stellar RPC documentation applies directly to the shared submission guard's RPC calls.
The Horizon source supplies supporting context; this audit did not assume a particular Stellar CLI transport.
The CLI timeout reproduction does not depend on its transport implementation.
Node documentation describes the compatibility API, not a measured Bun/macOS power-loss guarantee.
This audit therefore reports power-loss behavior as unverified.
Multiple tools returning the same page count as one source.

The returned `getTransaction` text describes a default history window of 120960 ledgers, approximately seven days.
The actual node window remains unverified because live RPC calls were outside scope.
The report uses only the bounded-retention conclusion.
The retained Jev example chunk does not independently establish retention behavior.

## Tool coverage and usage

| Tool | Result | Visible usage |
| --- | --- | --- |
| Stellar Raven MCP | First Stellar discovery; primary configuration content read | Dollar charge unavailable |
| stellar-raven-jev | One scoped question; failed transport attempt, then usable partial retry | $0.026720113 combined reported cost |
| Parallel Search MCP | Complementary filesystem search | One `sku_search`; dollar charge unavailable |
| parallel-cli | Complementary submission-status search; transport failure, then successful retry | One `sku_search`; dollar charge unavailable |
| Perplexity MCP | Challenge pass returned three primary Stellar pages | Dollar charge unavailable |

The first Jev attempt reported $0.008729397, three requests, and zero scored documents.
The retry reported $0.017990716, 283 requests, 259 scored documents, and 13 selected documents.
It also reported 15 uncertain documents, two selected results beyond the compact display, and one duplicate URL.
The retry reported degraded operation, one lost evidence report, and one fallback response.
It reported zero rate-limited requests.
These limits prevent a claim of exhaustive retrieval.
They do not prevent the bounded finding, which relies on frozen source and offline reproduction.

The combined visible Jev cost remains below its $1 allocation.
Separate source-provider charges and the other providers' dollar charges were unavailable.
The audit therefore cannot certify the aggregate invoice amount against the $10 allocation.
It used no deep-research processors and requests no further allocation.

## Retained Jev sessions

- Failed attempt: `jev/1790473710-1ea9991d-e893-4c35-9112-1503ffb75009/`.
- Partial retry: `jev/1790473788-1dc393c6-c348-42dc-9752-4ca20924cfcd/`.
- Compact outputs: `jev-compact.json`, `jev-retry-compact.json`.
- Diagnostic outputs: `jev-stderr.txt`, `jev-retry-stderr.txt`.

The retry directory retains `search.json`, `bundle.md`, and source text files.
This audit read the relevant primary-source text and selection metadata.
It did not use unrelated retrieved skills or instructions as authority.
