# Remediation decisions

The coordinator accepts each correction before the next worker starts.
The original audit describes the earlier source. This record describes the remediation pass.

## C01: signer deadline documentation

Accepted. The old wording promised a deadline for the full operation.
`main.go` applies a shared deadline to pollable input, connection setup, and SSH-agent traffic.
Output writes can still block. `bridge/signer.ts` supplies an outer timeout and drains both output streams.
The new documentation states these limits and preserves the prohibition on automatic signing retries.
Only `docs/INTERFACE.md` changed. The source comparison and `git diff --check` passed.
No runtime test was necessary for this documentation change.

## C15: SDK distribution documentation

Accepted. Generated SDK modules import shared files outside `dist/sdk/`.
The guide now preserves the complete `dist/` layout and copies `sdk/connect.css` separately.
The obsolete separate `jsqr.js` instruction was removed.
The worker built a temporary source copy and checked 65 relative JavaScript references.
All three SDK modules loaded with the full layout. The SDK-only negative control failed as expected.
The bundled-asset HTTP regression and `git diff --check` passed.
The optional Markdown formatting check failed on both the current document and unchanged HEAD.
The worker removed temporary files. Browser camera and live signing checks did not run.

## C02: malformed demo request target

Accepted. The worker reproduced `ERR_INVALID_URL` with the raw request target `//%25`.
The handler now catches URL parsing failures and returns HTTP 400.
The regression then checks the Host restriction and `/api/session` on the same server.
All seven `bridge/code-view.test.ts` tests passed with permitted loopback access.
The sandbox blocked the initial loopback attempt. That environment failure was not a product failure.
Formatting and `git diff --check` passed. No public tunnel or live signing was used.

## C05: delayed SDK success after an observed revision change

Accepted after independent Sol xhigh review.
The final success guard now compares the captured and current selection revisions.
The guard remains inside the existing cancellation path.
Three regressions cover A→B, A→B→A, and an unchanged revision.
They verify the original hash, valid mock signature, request identity, and one signing call.
Changed revisions reject the delayed response and preserve `requestState: 'unknown'`.
The implementation worker passed all 54 SDK and bridge tests.
The reviewer passed 13 targeted tests, formatting, and SDK type checking.
The reviewer restored the old guard in memory. Both race cases failed; the unchanged control passed.
The reviewer did not read the implementation transcript before concluding.
This correction cannot revoke a signature that already exists. Live signing and testnet acceptance did not run.

## C06: component destruction and late publication

Accepted after independent Sol xhigh review and a focused correction recheck.
Destruction aborts owned camera and pairing controllers. Guards prevent late callbacks, credential writes, and view updates.
An established client remains available to its host. Destruction cannot undo a revocation request that already started.
The implementation passed 45 connection and scanner tests, SDK type checking, formatting, and `git diff --check`.
Sixteen new regressions cover destruction and ownership boundaries.

The first reviewer found a remaining native dialog focus path.
An offline Chrome 150.0.7871.24 probe confirmed publication after a host focus handler destroyed the component.
The reviewer rejected a separate disabled-button scenario because native disabled buttons did not emit focus events.
The worker added two guards around dialog closure and one focused regression.
The fresh reviewer passed five targeted tests and successful focus-restoration controls.
The regression failed against the prior patch and when either guard was removed.
Both reviewers preserved source files and did not read implementation transcripts before concluding.
The browser session and temporary probes were closed and removed.

The historical pause checkpoint remains in PAUSE.md. Physical camera and live signing checks did not run.

## C10: decoded details after signing

Accepted. The signed state now displays the existing description of the reviewed original transaction body.
The runtime correction changes one display condition.
Four regressions use real Stellar transaction encoding for note, payment, offer, and offer cancellation actions.
They check material terms after signing, reopening, and reload, plus the exact submitted envelope.
They also verify action visibility, unchanged journal bytes, one signing call, and no automatic submission.
All 28 site tests passed. Focused TypeScript, formatting, and `git diff --check` passed.
The restored-record controls use valid records. C09 journal integrity remains deferred.

## C12: tracked changes in cached fixture source

Accepted. The build script rejects staged or unstaged tracked changes before checkout or compilation.
Three tests use temporary Git repositories with signing and hooks disabled.
Both dirty cases stop before compiler and manifest execution.
They preserve source bytes, index bytes, HEAD, existing artifacts, and the manifest.
The clean control reaches all five compiler calls and the manifest step.
Both dirty regressions failed before the correction and passed afterward.
The three tests, shell syntax, focused TypeScript, formatting, and diff checks passed.
Actual fixtures were not rebuilt. The pinned revision and manifests remain unchanged.
The guard does not establish historical artifact provenance or protect against concurrent source edits.

## C17: explicit reuse in incomplete CAP-71 rows

Accepted. A completed row now identifies reused checks and their original protocols.
It labels the current environment protocol separately. Missing original protocol metadata remains `null`.
The correction preserves saved check objects, deployment evidence, salts, and completed-row history.
The regression covers synthetic current protocols 28 and 29 with checks saved under protocols 27 and 28.
Protocol discovery is mocked. Reused checks make no simulation, signing, or submission calls.
A fresh-execution control retains its existing metadata behavior.
All 18 CAP-71 tests passed. Focused TypeScript, formatting, and diff checks passed.
No live acceptance ran. CAP-85 and general assertion identity remain outside this correction.

## C08: confirmation response binding

Accepted after independent Sol xhigh review. This remains conditional reliability hardening.
The guard checks the exact pending hash, boolean success, and positive safe-integer ledger before journal changes.
Both submission and status lookup use the same guard.
Invalid responses preserve the unresolved state and original hash. Optional offer decoding cannot undo a validated terminal result.
The implementation passed all 112 site tests.
The reviewer passed 84 C08 tests and five recovery controls, plus focused TypeScript, formatting, and diff checks.
The regressions cover malformed responses, valid success and failure, reload protection, blocked replacement, and original-hash recovery.
The correction adds no dependencies, retries, cancellation changes, or storage policy.
No evidence establishes a real provider fault. All provider responses in these checks were mocked.

## C14: durable guard for CLI01 submission

Accepted after independent Sol xhigh review.
A small transport adapter reuses `createSubmissionGuard` and the existing shared evidence directory.
The guard saves the attempt, original hash, network, and signed envelope before the CLI send starts.
Unknown outcomes retain the shared gate and block another signing attempt after restart.
Reconciliation queries only the original hash. It never signs or sends again.

The pipeline preserves actual Stellar CLI construction, hashing, decoding, encoding, and sending.
The callable pipeline imports no live initialization. Only the guarded entry point loads `live-utils.ts`.
The existing guard, `live-utils.ts`, and `types.ts` remain unchanged.
Five new regressions cover CLI timeout, lost lookup, `NOT_FOUND`, successful submission, and failed-transaction reconciliation.
The failure cases also verify blocked reruns, a fresh process, saved envelopes, and original-hash recovery.
The implementation and independent review each passed all 41 CLI and submission tests.
Focused TypeScript, formatting, and diff checks passed.
The reviewer preserved source files and did not read the implementation transcript before concluding.
CLI, signer, and RPC operations were mocked. No live 1Password or testnet acceptance ran.

## V01: final test-mock type correction

Accepted as a verification correction for C06. This is not another audit concern.
Combined TypeScript checking found `TS2339` in the new native-focus regression mock.
Its `close()` method needed an explicit `this: ConnectUI['dialog']` parameter.
A bounded Sol worker changed that single type annotation.
All 38 connection tests and focused strict TypeScript checking passed.
The coordinator confirmed identical transpiled JavaScript before and after the annotation.
Full isolated TypeScript checking, formatting, and diff checks then passed.
The checkout retains only its 174 existing ignored Pagebook diagnostics.
The initial failed checks remain recorded. No runtime behavior or assertions changed.
