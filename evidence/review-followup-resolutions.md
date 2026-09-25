# Follow-up review resolutions

Date: 2026-09-25. The parent integrated the accepted corrections.

## Signing output

Astra found that failed output writes could return success.
The CLI now checks errors and short writes for all successful output.
A failed signing notice prevents the signing request and returns `output_error`.
A failed signature output returns exit 1 without a signing retry.
Offline Go tests cover JSON output, human output, help, version, and failed diagnostic writes.
The tests also prove that a failed diagnostic write causes zero signing requests.
Astra ran Go tests, static checks, and race checks with dependency networking disabled.
The installed binary now returns exit 1 for a read-only stdout descriptor.

## Unknown submissions

The shared helper now creates a persistent gate before the RPC submission.
It archives each attempt separately and saves the send response before polling.
Thrown transport errors, deadlines, and unknown statuses retain the original hash and gate.
Signing, funding, submission, and classic restoration check this gate.
`node tests/live.mjs reconcile` queries only the saved hash. It never resubmits.
Only a confirmed ledger result clears a gate during reconciliation.
The guard has 35 passing offline tests, including a separate process and hanging RPC calls.
A classic G02 mock also confirmed zero restoration signatures after an unknown submission.

## Checkpoints and results

Baseline checkpoints now validate source revision, WASM hashes, network, and signer public keys.
Malformed JSON stops execution. Two offline tests cover stale and mismatched checkpoints.
The parent verified and bound the existing deployment checkpoint before reuse.
`checkpoint-migration.json` records this migration. The original checkpoint remains available.
Selected baseline rows now execute again. `C-run-scope` records their scope.
The runner rejects unknown row names and records final classic state failures.

## Review points that need context

An old blocked P03 row concerned approval behavior. It was not an unknown transaction submission.
The new submission gate therefore uses pending transaction records, not every historical blocked test.
Selected partial runs can succeed. Their scope does not establish full-suite success.
Historical failures remain in the result files. Later corrections do not delete them.
An ordinary test failure can allow independent cases to continue. The suite then exits with failure.
An unknown submission stops the suite immediately.

Contract errors can appear inside a host authorization error.
The negative checks now require both the expected cause and an allowed top-level host error.
Checking only the top-level error would lose the contract-specific assertion.

## Live application failures and installed use

Observed Deny, SIGINT cancellation, and locked-app connection closure returned no signature.
`1password-lifecycle.json` records these results and preserves the earlier approved attempt.
A fresh Opus context used the installed skill outside the checkout.
Its payment and OpenZeppelin multisig call both passed on testnet.
The multisig call also established live legacy `address` credential coverage.
See `usability/FINAL.md` for transaction hashes and independent signature checks.

## Extended tests

Astra found unsafe checkpoint loading, interrupted E03 recovery, and ambiguous native account error checks.
Fable made checkpoint writes atomic and made read errors stop execution.
The extended checkpoint binds its network, keys, source revision, and baseline artifacts.
E03 checks current rule state and requires preserved evidence for completed phases.
Missing evidence stops recovery instead of creating a new pass.
E01 checks the specific diagnostic reason for insufficient weight, reversed order, and duplicate signatures.
The parent also checks cached diagnostic evidence before accepting a reused E01 step.
E01-E03 passed on testnet. Account B returned to its original signer configuration.
There is no pending submission gate.

The parent corrected the classic unknown-restoration status and recovery text after the final guard review.
Reconciliation exit 0 means that the lookup completed. Read its returned transaction status and recorded expectation result.
A persistent NOT_FOUND result stays blocked and needs manual evidence review.
