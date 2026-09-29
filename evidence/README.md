# Acceptance evidence

These records hold live Stellar testnet results. Each record names the tested revision, the transaction hashes, and its limits.

| Record | Date | Binary or host | Coverage |
| --- | --- | --- | --- |
| [`signing-live-2026-09-28.json`](signing-live-2026-09-28.json) | 2026-09-28 | The Rust `walleterm` binary at `b50236d` and `1ec919e` | One `walleterm sign` for transactions, authorization entries, and SEP-53 messages. Classic rows G01-G10, contract rows C01-C13, and the OpenZeppelin adapter through the CLI and the SDK. Bridge protocol version 3 through the Stellar Wallets Kit: transactions, messages, refused requests, two tabs, a wallet switch, and disconnection. |
| [`sep43-live-2026-09-28.json`](sep43-live-2026-09-28.json) | 2026-09-28 | Bridge protocol version 3 on the earlier Go and TypeScript host at `a945067` | The SEP-43 wallet API through the demo and the Stellar Wallets Kit: `getAddress`, `signTransaction`, `signAuthEntry`, refused requests, and Kit disconnection. |
| [`protocol-acceptance.json`](protocol-acceptance.json) | 2026-09-25 | The CAP-71 and CAP-85 fixtures with the earlier signer | CAP71-01 through CAP71-12 passed. X01-X06 passed. X07 is an observation, not an asserted pass. |

Each record uses dedicated testnet keys. It contains public addresses, transaction hashes, contract IDs, and source hashes.
It contains no private keys, signatures, connection codes, or vault identifiers.

The runners use these event statuses:

- `prepared` records intent. It does not show a passed test.
- `passed_previous_run` reuses earlier evidence. It is not a new live run.
- `observed` records an outcome without an acceptance assertion.
- `covered_by` points to another row that covers the case.
- `blocked` records an unknown submission result. Resolve its original hash before a new submission.

Raw local records stay on the machine that ran the test, and Git ignores them.
These include signer metadata, signed envelopes, RPC responses, submission journals, and checkpoints.
Keep an unresolved submission journal until its original transaction hash has a final result.
See [the live test guide](../docs/LIVE-TESTS.md) before you start a new run.
