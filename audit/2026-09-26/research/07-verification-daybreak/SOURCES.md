# Sources

Access date: 2026-09-26.

| Source | Version or date | Audit use |
| --- | --- | --- |
| [Stellar RPC `sendTransaction`](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction) | Page dated 2025-12-12 by Perplexity | A send only enqueues. The client must query the hash. |
| [Stellar RPC JavaScript submission guide](https://developers.stellar.org/docs/build/guides/transactions/submit-transaction-wait-js) | Page dated 2025-08-08 by Perplexity | The official example polls after `PENDING`. |
| [Stellar CLI manual](https://developers.stellar.org/docs/tools/cli/stellar-cli) | Page dated 2026-08-13 by Perplexity | Version 28 has `tx send` and `tx fetch result`. |
| [Stellar JSON-RPC structure](https://developers.stellar.org/docs/data/apis/rpc/api-reference/structure/json-rpc#example-request) | Current docs index | `getTransaction` takes the original hash. |
| [Open Group `fsync`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/fsync.html) | POSIX.1-2024 | A directory sync persists directory entries and attributes. |
| [Linux `fsync(2)`](https://man7.org/linux/man-pages/man2/fsync.2.html) | Current manual page | A file sync does not necessarily persist its directory entry. |

Stellar Raven and Perplexity found the Stellar sources.

Parallel Search MCP found the storage sources.

Jev returned no source documents because its transport failed.
