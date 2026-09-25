# Verification evidence

Date: 2026-09-25. Network: Stellar testnet.

| Check | Result | Evidence |
| --- | --- | --- |
| Raw 1Password Ed25519 signing | Passed | `1password-feasibility.json` |
| Go protocol tests and static checks | Passed | `make test` |
| Installation and executable alias | Passed | `installation.json`; fresh shells from `/tmp` |
| Classic G01-G10 | Passed | `live/results-classic.json` |
| Official Stellar CLI pipeline | Passed | `CLI01` in `live/results-classic.json` |
| Contract fixture deployment | Passed | `live/contracts-state.json` |
| Contract C01-C13 | Passed; C09 is a coverage reference | `live/results-contracts.json` |
| Live approval denial | Passed | `1password-lifecycle.json`; observed Deny returned no signature |
| Cached approval | Observed | Later signature requests succeeded without new prompts |
| Locked desktop app and connection loss | Passed | `1password-lifecycle.json`; agent closed the connection after about 60 seconds |
| Pending request cancellation | Passed | `1password-lifecycle.json`; SIGINT returned no signature |
| Portable skill installation | Passed | `skill-installation.json`, `skill-portability.json` |
| Submission recovery guard | Passed offline | 35 cases in `tests/submission.test.mjs` |
| Independent installed CLI use | Passed | `usability/FINAL.md`; payment and legacy OpenZeppelin multisig authorization |
| Extended authorization E01-E03 | Passed | `live/results-extended.json`; native multisig, delegated signatures, and rule changes |
| Passkeys | Not implemented | The runtime supports Ed25519 |

`tool-versions.json` records the local tool versions.
`../fixtures/wasm/manifest.json` records the contract source commit and WASM hashes.
`REVIEW.md` records review findings and their corrections.
`review-followup-resolutions.md` records the final review corrections.
`review-guard-integration.md` records the independent guard integration review.
`acceptance-summary.json` combines the recorded results and remaining limits.

## Read the records

The result files contain events and outcomes. A `prepared` event is not a passed acceptance test.
The transaction files contain signed public envelopes, transaction hashes, RPC responses, and ledger results.
`live/signatures.jsonl` contains public signing requests and independently verified signatures.
Local unit tests use isolated mock keys. Live tests use only the dedicated 1Password keys.

G02 configured thresholds before adding signers in one transaction. The actual transaction passed.
Its hash is `0b94d56d41dbc6d0b9f3ac52ee8b603e570fc39bc4447b45d612bd12db8626e6`.
Its ledger is `4865508`. The classic suite restored the original signer settings.

## Local application changes

The three dedicated keys are in the Private vault. `public-test-keys.json` records their public metadata.
The existing 1Password SSH agent configuration gained three explicit item entries.
The previous configuration is saved at `/tmp/walleterm-v2-agent-before.toml`.
Existing vault items remain unchanged.

Earlier denial attempts returned signatures. The later observed Deny established refusal behavior.
The tests kept the existing approval settings. The user unlocked 1Password after the failure tests.
