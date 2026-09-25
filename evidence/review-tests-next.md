# Live test orchestration review

Reviewed `tests/live-utils.mjs`, `tests/live.mjs`, `tests/classic.mjs`, and `tests/contracts.mjs`.
Compared `evidence/acceptance-summary.json` and `evidence/REVIEW.md` with `evidence/live/results-classic.json`, `evidence/live/results-contracts.json`, and `evidence/live/contracts-state.json`.
No network call. No vault access. No signature. Parent owns every fix.

`evidence/REVIEW.md` lines 54–55 say a failed row exits nonzero and an unknown submission blocks restoration signing.
The classic runner and the contract checkpoint path do not keep both promises.

## Unknown submission and restoration

`tests/live-utils.mjs` lines 61–78 write the hash, then poll.
Lines 76–78 record `blocked` and throw when the status stays `NOT_FOUND`, `PENDING`, or `TRY_AGAIN_LATER`.
Lines 62–71 do not catch a thrown `sendTransaction` or `getTransaction`.
A dropped response therefore has an artifact hash and no `blocked` row.

`tests/classic.mjs` lines 205, 277, and 286 always call `restoreB` from `finally`.
`restoreB` at lines 148–168 signs and submits a new `setOptions` transaction.
The classic path never reads the unknown hash and never uses `UnknownSubmission` (`tests/contracts.mjs` lines 92–100).
Consequence: an uncertain G02, G04, G09, or G10 submission is followed by a new signed restore.
Both transactions can use one account sequence. The later signer state can drift.

`tests/contracts.mjs` lines 417–421 do stop C13 restoration when `failure` is an `UnknownSubmission`.
That guard does not cover classic restores.
Line 421 replaces the original C13 failure when the restore itself is unknown.
Consequence: the results row names only the restore hash.

A later process does not reconcile that hash.
`tests/live.mjs` lines 5–8 fund accounts and start the suite.
Neither runner reads existing `blocked` rows or artifact hashes before `ctx.send`.
Consequence: the next run submits a new transaction while the old hash is still unresolved.

`evidence/live/results-classic.json` lines 2–13 show the gap.
Row `P03` is `blocked` with `exit_code` 0 and `response.ok` true.
The same file then records a full G01–G10 run. The blocked row did not stop submission.

## Checkpoint reuse

`tests/contracts.mjs` lines 239–247 and 246–247 return a saved wasm hash or contract id with no new hash of the file.
`loadState` at lines 233–235 ignores a mismatched `oz_commit`.
`setup` at lines 256–276 deploys nothing when `state.contracts[name]` exists.
Consequence: a changed fixture still drives live rows through the old contract ids.

Lines 453–458 record `passed_previous_run` and skip the row when `state.done[row.id]` exists.
Line 470 then returns success when `failures` is empty.
Consequence: a rerun exits 0 and submits nothing for those rows.
`evidence/live/contracts-state.json` line 76 already holds `done.C01` and later rows.
`C09` at lines 349–351 accepts that saved hash as coverage.
Consequence: `covered_by` can pass from checkpoint data alone.

`tests/live-utils.mjs` lines 16–22 append every run to one results file.
The file is not reduced to the latest row per id.
`evidence/live/results-contracts.json` records `C10` failed at `2026-09-25T16:03:29.330Z`, then `C11` submitted `5e192427f35e6e68988b9384ae42bad2335e947ca73afe7c0eadff0b5b610724`.
A later `C10` row passed. `evidence/acceptance-summary.json` lines 116–120 keep only that later pass.
Consequence: exit status and the summary hide the failed attempt and the submissions that followed it.

## Process exit status

`tests/live.mjs` lines 3–8 have no `process.exit` and no full-suite check.
`tests/contracts.mjs` line 442 limits work to `WALLETERM_ROWS`.
Unselected rows are `not_run` at line 452. The process still ends at 0 when selected rows pass.
Consequence: exit 0 does not mean C01–C13 ran in that process.
The third results block records `C01`–`C09`, `C11`, and `C13` as `not_run` with reason `not selected`, beside a later passed `C10`.

`ctx.stopOnFailure` is read at line 466 and never set.
A normal contract failure is pushed at line 465, and later rows still call `ctx.send`.
The observed `C10` simulation failure did not stop `C11`.
Consequence: one failed row still creates later transactions. Nonzero exit waits until line 470.

`tests/classic.mjs` lines 287–291 assert final signer state outside `scenario`.
A restoration miss throws, and `record` is not called.
Consequence: `results-classic.json` can show every scenario `passed` while the process exits nonzero.

Only `tests/contracts.mjs` line 535 calls `process.exit`, and only for the offline self-test.

## False-positive assertions

`tests/contracts.mjs` lines 162–166 and 212–217 pass when the diagnostic text contains the expected substring.
Lines 367, 391, and 393 set `exact_assertion: true`. No branch reads that field.
Consequence: a nested copy of the expected code passes the row.

The live `C12` duplicate-signature text starts with `HostError: Error(Auth, InvalidAction)`.
The pass depends on a nested `Error(Contract, #5)` and the text `public keys are not ordered`.
The live duplicate-signer deploy starts with `HostError: Error(Context, InvalidAction)`.
The pass depends on a nested `Error(Contract, #3007)`.
The top-level host error is not the asserted string.

Classic G01–G10 in this file do compare exact result codes after `ctx.send`.
Preserve the observed split: duplicate-insufficient is `txBadAuth`; unrelated extra is `txBadAuthExtra`.
That split is not the defect. The contract substring check is the defect.

## Required corrections

1. Before any new `ctx.send`, load the original hash from the artifact or the `blocked` row and query it.
2. Call `restoreB` only after that query shows a known result.
3. Treat a thrown send or poll like an unknown outcome. Do not sign a restore for it.
4. Make `passed_previous_run` and a partial `WALLETERM_ROWS` run exit nonzero.
5. Reuse a contract id only when the file hash and `oz_commit` match the checkpoint.
6. Assert the top-level diagnostic error. Remove the unused `exact_assertion` flag or enforce it.
7. Record the classic final-state failure in `results-classic.json` before the process exits.
