# C17 primary evidence

The frozen source and acceptance documents decide the checkpoint question.
No unresolved external fact required new research.

## Preserved protocol sources

The earlier contract review retrieved these primary documents on `2026-09-27` UTC (`2026-09-26` EDT).
This review read their transition and compatibility sections and verified their preserved hashes.
The recorded access times come from `research/06-contracts-astra/primary-source-index.json`.

| Source | Preserved evidence | SHA-256 |
| --- | --- | --- |
| [CAP-71-01](https://raw.githubusercontent.com/stellar/stellar-protocol/master/core/cap-0071-01.md) | `research/06-contracts-astra/cap-0071-01.md`; `2026-09-27T01:42:38.104133+00:00` | `3c44b25c3a8bc7040e1f92a7e905647cb95847cd7b15e8738751b488970611ea` |
| [CAP-85](https://raw.githubusercontent.com/stellar/stellar-protocol/master/core/cap-0085.md) | `research/06-contracts-astra/cap-0085.md`; `2026-09-27T01:42:38.863907+00:00` | `6514cbd4b0b95fd080954e9413b5f75617ba80364188ef18f1a422b9209fbbb7` |

CAP-71 describes protocol gating and states that this proposal introduces no backward incompatibilities.
CAP-85 describes compatibility limits for older custom accounts that decode the new executable type.
Its transition paragraph still says `TBD`; its host-function definitions specify minimum protocol `28`.
These mutable-master snapshots establish proposal context, not current network deployment or any later protocol regression.
Neither source defines Walleterm checkpoint acceptance or requires automatic assertion replay.

## Installed applicability

The frozen package pins JavaScript Stellar SDK `17.1.0` and uses Bun `1.4.2` for this check.
CAP-71 requires protocol `>=27`; CAP-85 requires protocol `>=28` in the frozen runners.
The historical protocol summary records protocol `28` and dated source hashes.
The probe's protocol `29` is synthetic. No claim concerns its deployment or compatibility.

## Tool discovery and usage

Tool metadata exposed Stellar Raven, Parallel Search MCP, and Perplexity MCP.
`COMMON.md` supplied the Jev and parallel-cli skill paths.
The review did not invoke these providers or CLIs.
Therefore, CLI authentication, doctor, help, and paid source retrieval were unnecessary.
The review used the smart-contracts skill and its testing reference for offline/live evidence boundaries.

| Cost category | New usage |
| --- | --- |
| Jev | `$0`; zero calls; limit `$0.25` |
| Raven, Parallel MCP, parallel-cli, Perplexity | Zero calls |
| Total new research | `$0`; limit `$1` |
| Unknown new provider charges | None |

Prior retrieval costs remain attributed to their original area reviews.
No additional allocation is necessary.
