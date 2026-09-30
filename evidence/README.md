# Acceptance evidence

These records hold live Stellar testnet results. Each record names the tested revision, the transaction hashes, and its limits.

| Record | Date | Binary or host | Coverage |
| --- | --- | --- | --- |
| [`ux-review-live-2026-09-29.json`](ux-review-live-2026-09-29.json) | 2026-09-29 | Release `walleterm` builds at `977fd19` and `84b9c67` (branch `ux-review-fixes`) | Tunnel terminal lines, the connect dialog text, Add USDC trustline, an offer and its cancellation, two declined 1Password prompts, a locked-1Password connect and sign, and the new terminal lines. Four accepted transactions. |
| [`demo-walkthrough-live-2026-09-29.json`](demo-walkthrough-live-2026-09-29.json) | 2026-09-29 | The demo website in a `walleterm` debug build at `81a8fa1` | The smart account walkthrough: the live state of an existing set, a repeated counter increase, a new contract set with both deployments, and its first increase. Eight signatures in four transactions. |
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
