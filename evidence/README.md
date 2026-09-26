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

[The StellarTerm testnet record](stellarterm-testnet-2026-09-25.json) covers a live Freighter message bridge.
It records a payment, trustline, offer, cancellation, and trustline removal.
The test left no open offers or USDC trustline.

[The SDF demo bridge record](sdf-demo-bridge-2026-09-25.json) covers the Asset Sandbox trustline and the confidential-token connection gate.
It records the live hash, ledger, final trustline, page refresh error, and unsigned message request.
The published Stellar Token Launchpad addresses redirected to a generic site.

[The confidential-token recheck](confidential-token-2026-09-26.json) records the first capture and the later authorized signing test.
The user permitted the demo's separate confidential key in browser storage.
Walleterm signed the message and four accepted transactions: registration, a 0.01 XLM deposit, merge, and withdrawal.
The Stellar signing key stayed inside 1Password. The final confidential balances were zero.

[The mobile web proof](mobile-poc/README.md) covers the earlier combined `web` command on an iPhone and desktop Chrome.
[The tunnel record](tunnel-testnet-2026-09-25.json) covers live signing through `walleterm tunnel` and `walleterm demo` over public Quick Tunnels.
It records desktop and real iPhone runs: payments, data notes, offers, offer cancellations, terminal denials, and one 1Password agent error.
A later desktop run covers website approval: the page review, Sign, and Discard, with no tunnel terminal input.
[The browser QA report](browser-qa-2026-09-25/report.md) covers the public demo in a browser, with recovery, denial, and cancellation checks.

[Vault filter validation](../docs/VAULT-FILTER-VALIDATION.md) records the 2026-09-26 review, local tests, and installed browser checks.
Its final live vault recheck passed after user approval, including vault name, ID, HTTP selection, and browser filtering.

## Tracked summaries and local records

Git includes this index, two acceptance summaries, three site records, the browser QA report, and the mobile proof index and JSON summaries.
These files contain public testnet addresses, transaction hashes, contract identifiers, and source hashes.
They contain no signing keys or vault identifiers.

Raw evidence stays local and ignored: signer metadata, signed envelopes, signatures, RPC responses, checkpoints, and review scratch files.
Paths in the summaries identify those local records. A fresh clone does not contain them.
Source hashes identify the tested revision; later comment edits can change file hashes without changing behavior.

A `prepared` event records intent. It does not establish a passed test.
A `passed_previous_run` event reuses earlier evidence. It is not a new live run.
An `observed` event records an outcome without an acceptance assertion.

Preserve unresolved submission journals and checkpoints. Ignored files are not disposable while a transaction outcome remains unknown.
See [live test setup](../docs/LIVE-TESTS.md) before starting a new run.

See [wallet switching validation](../docs/WALLET-SWITCH-VALIDATION.md) for review and release checks.
