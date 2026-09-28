# Bridge service and authorization

Read `COMMON.md` in this directory first.

Primary files: `bridge/server.ts, bridge/signer.ts, bridge/transaction.ts, bridge/PROTOCOL.md, bridge/server.test.ts, bridge/signer.test.ts, bridge/vault.test.ts`.

Focus: Origin and capability binding, pairing, wallet grants/revisions, OP_VAULT, XDR constraints, cancellation races, concurrency, resource limits. Website approval on testnet is an accepted design.

Follow direct dependencies when necessary. Cite exact source lines in the frozen snapshot.
