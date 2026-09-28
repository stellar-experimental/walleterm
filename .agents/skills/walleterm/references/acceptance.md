# Acceptance snapshot

This snapshot records project evidence dated 2026-09-25. It does not replace checks against current network state.
The source project recorded full transaction hashes and results in `evidence/live/`; this portable package keeps only the coverage summary.
The signer was written in Go at that date. The Rust binary replaced it later and passes the same frozen transcripts.
The commands of that date are historical. They signed digests and used `walleterm sign-auth`.
The current `walleterm sign` takes an artifact instead, and a new live run needs the current harnesses.

| Layer | Observed result |
| --- | --- |
| Offline Go core | `go test ./...` and `go vet ./...` passed with local Unix mock sockets. |
| 1Password agent | A dedicated key signed a 32-byte payload. Independent Ed25519 verification passed. |
| Classic testnet | G01-G10 and CLI01 passed, including multisig, source rules, fee bumps, bad digests, and rotation. |
| Extended testnet | E01-E03 passed: native G multisig, OZ delegated G signers, nested calls, context rules, threshold update, and removal. |
| Contract testnet | C01-C08 and C10-C13 passed. C09 sponsor coverage came from C01-C04; C09 was not run separately. |
| Native delegation testnet | CAP71-01 through CAP71-12 passed, including C-to-G, C-to-C-to-G, thresholds, expiry, replay, and address substitution. |
| External executable testnet | X01-X06 passed: manager changes, reference creation, version changes, account creation authorization, and context decoder compatibility. |

The installed tools were `stellar 27.1.0` (`8e402ea28202950b272fbabc34caad4d2f64fe87`), `stellar-xdr 27.0.0`, and SDK `17.1.0`.
The testnet used protocol 28. Earlier acceptance cases used `address_v2`.
A fresh-context run used the installed skill and `walleterm` for two successful testnet tasks.
T1 paid 100 stroops: `86d57ecd0f8d70ef533606f6c5e159eb01ab56d3409f86a291831a9ca45ab731`, ledger `4866622`.
T2 called an OpenZeppelin 2-of-3 account with legacy `address` credentials.
Its transaction hash is `05c4fe40ae4e0f651d0840914b9a74dc4d4b9f2366cf498446e700fc63d1f245`, ledger `4866629`.
The T2 account counter changed from 2 to 3. T2 used two ordered External signatures and enforce simulation.
These two results do not establish general legacy credential support. E01-E03 separately passed the extended authorization tests.
The tested OpenZeppelin account source was commit `a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640`.

An observed Deny returned `signing_refused`, exit 1, and no signature. That code alone does not prove Deny.
SIGINT cancelled a pending request without a signature. The parent then dismissed the remaining 1Password prompt.
While 1Password stayed locked, the agent closed a pending request after about 60 seconds.
The CLI returned `agent_protocol`, exit 1, and no signature. This was not the CLI 120-second deadline.
Cached 1Password approval allowed later signatures.
CAP-71 used native `address_with_delegates`; its separate same-key substitution case used explicit `address_v2`.
Duplicate and unordered delegate tests used successful paired controls and returned `Error(Auth, InvalidInput)`.
The RPC omitted their diagnostic reasons. The duplicate case cannot distinguish duplicate rejection from ordering rejection.
X07 separately observed SDK 27 simple-account acceptance and pinned OpenZeppelin rejection of `ExternalRef` creation.
The OpenZeppelin diagnostic reported `Error(Value, MissingValue)` while decoding `ExternalRef`.
X07 is an observation, not an asserted pass. These results apply to the tested code and adapters.
Other legacy `address` cases and OpenZeppelin `Delegated` C-address adapters lack live coverage.
Passkeys are not planned and are out of scope.
