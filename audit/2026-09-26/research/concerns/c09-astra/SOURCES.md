# C09 preserved primary evidence

This review reused existing evidence. It made no new provider requests.
The preserved sources record access on 2026-09-26.
The check driver verified SDK 17.1.0 and both preserved SDK source hashes.

| Primary source | Preserved evidence | C09 applicability |
| --- | --- | --- |
| [Stellar SDK transaction reference](https://stellar.github.io/js-stellar-sdk/reference/core-transactions/) | [SDK source excerpts](../../05-demo-astra/sdk-source.json) | `hash()` covers the signature payload. Envelope serialization includes signatures separately. |
| [Stellar transaction result codes](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions) | [Jev source text](../../05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0128.txt) | Insufficient valid signatures or the wrong network produce `tx_bad_auth`. |
| [Web Locks API](https://w3c.github.io/web-locks/) | [Preserved Parallel result](../../05-demo-daybreak/parallel-cli-browser-recovery.json) | Exclusive locks coordinate participating contexts within one origin. |

The SDK documentation can change. Installed SDK source and executable checks establish applicability to this frozen revision.
The preserved transaction result page records 2026-09-22. That date does not identify a deployed Horizon version.
The Web Locks source identifies the Editor's Draft dated 2025-09-24.
The mocks do not test native browser locks, browser disk corruption, or live Horizon rejection.
The review makes no general claim about browser crash durability or storage fault frequency.

## Costs and discovery

New research cost: **$0**. New Jev cost: **$0**.
The budget limits remain $1 total and $0.25 for Jev.
The session exposes Stellar Raven, Parallel Search, and Perplexity tool metadata.
This review invoked none of those providers. It did not invoke Jev or parallel-cli.
No unresolved external fact required another search.

The original Astra report records $0.030209479 for Jev. Its earlier failed transport attempt remains included.
The original Daybreak report records $0.008729397 for its failed Jev attempt.
Those earlier charges do not represent new C09 spending. Other earlier provider charges remain unknown.
See the [original Astra source ledger](../../05-demo-astra/SOURCES.md) and [original Daybreak ledger](../../05-demo-daybreak/research-summary.md).
