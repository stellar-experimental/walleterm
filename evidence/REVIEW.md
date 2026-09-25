# Independent review decisions

## Opus review, 2026-09-25

- Raw digest forwarding, full key matching, strict parsing, and independent signature verification passed source review.
- Negative live tests must check exact protocol or contract errors. Classic callers already perform this check.
- The stdin read needs a deadline or an explicit EOF requirement. Sol owns this correction.
- Submission deadlines must preserve an unknown outcome. The helper must retain the original hash for reconciliation.
- `signing_refused` means an SSH agent failure. It cannot identify the user's action without observing the prompt.
- Same-user socket substitution remains outside the local filesystem checks.
- Add missing mock tests for absent keys, unsupported identities, unsafe socket permissions, and stalled responses.
- Require exactly three public live-test keys before assigning A, B, and C.

The parent accepts supported findings and verifies fixes before recording completion.

Resolution: Sol added the stdin deadline, missing mock cases, and neutral refusal text.
The parent added unknown-submission records and the exact public-key count check.
`make test` and `go vet ./...` passed after these corrections.
Regular files need no read deadline. Nonpollable standard input requires a caller timeout and EOF.

## Grok review decisions

The full report is `grok-design-review.md`.

- Accepted: document SSH framing, exact key matching, fingerprint format, and one connection per command.
- Accepted: distinguish runtime secret handling from claims about key origin or export history.
- Accepted: preserve exact classic rejection codes and replay the same authorization bytes in replay tests.
- Accepted: bind each contract digest to its credential variant and contract-specific schema.
- Rejected: require a new 1Password prompt for every test signature. The user permits normal 1Password approval behavior.
  Record cached approval honestly. Do not change the user's security settings.
- The report's generic OpenZeppelin duplicate error needs qualification. Duplicate map encoding and duplicate registered signers differ.
  Contract tests must record the actual failure and its layer.
- G01-G10 already passed live with exact result assertions. The test evidence controls broader reviewer assumptions.

## Contract runner review

Opus reviewed the runner against SDK 17.1.0 and local host source before live scenario execution.

- Replay must fail with `Error(Auth, ExistingValue)`. Expiry and tree errors do not prove nonce consumption.
- Duplicate native G-account signatures must fail with the observed host contract error.
- Changing authorization arguments alone tests tree matching. Changing both signed arguments and call arguments tests signature binding.
- Negative evidence needs the transaction, credential variant, digest, expiration, simulation ledger, and unchanged state.
- Multiple-account tests must check both accounts. Rotation tests must restore the original owner.
- Reused evidence must remain distinct from a fresh execution.

Fable owns these runner corrections. The parent owns live execution and verifies their actual outcomes.

Resolution: the corrected runner passed live acceptance on 2026-09-25.
The live nonce replay returned `Error(Auth, ExistingValue)` before expiration.
The parent tightened expiry and map serialization checks to their observed exact errors.
The no-policy account rejected the missing required signer with OZ `3002`, as the pinned source specifies.
C10 passed after correcting its expected error. The original failed assertion remains in the evidence.
C06 and C07 checked both counters. C13 restored owner B, followed by an independent owner read.
The runner returns a nonzero exit status when any row fails.
The runner stops before restoration signing when a submission outcome is unknown.
