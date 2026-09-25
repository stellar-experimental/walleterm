# Acceptance evidence

The acceptance runs used Stellar testnet on 2026-09-25.

| Suite | Result |
| --- | --- |
| 1Password signing | Raw Ed25519 signatures passed independent verification |
| Classic | G01-G10 and the Stellar CLI pipeline passed |
| Contract accounts | C01-C08 and C10-C13 passed; C09 references sponsor coverage |
| Extended authorization | E01-E03 passed |
| Native CAP-71 delegation | CAP71-01 through CAP71-12 passed |
| CAP-85 external executables | X01-X06 passed; X07 recorded observations |
| Approval failures | Observed denial, cancellation, and locked-app connection closure returned no signature |
| Passkeys | Not implemented |

[The acceptance summary](acceptance-summary.json) records all suites and their limits.
[The protocol summary](protocol-acceptance.json) records the 38 CAP-71/CAP-85 transaction hashes and ledgers.
[Protocol notes](../docs/PROTOCOL-UPDATES.md) explain the diagnostic limits and older account behavior.

## Tracked summaries and local records

Git includes this index and the two reviewed summaries.
The summaries contain public testnet addresses, transaction hashes, contract identifiers, and source hashes.
They contain no signing keys or vault identifiers.

Raw evidence stays local and ignored: signer metadata, signed envelopes, signatures, RPC responses, checkpoints, and review scratch files.
Paths in the summaries identify those local records. A fresh clone does not contain them.
Source hashes identify the tested revision; later comment edits can change file hashes without changing behavior.

A `prepared` event records intent. It does not establish a passed test.
A `passed_previous_run` event reuses earlier evidence. It is not a new live run.
An `observed` event records an outcome without an acceptance assertion.

Preserve unresolved submission journals and checkpoints. Ignored files are not disposable while a transaction outcome remains unknown.
See [live test setup](../docs/LIVE-TESTS.md) before starting a new run.
