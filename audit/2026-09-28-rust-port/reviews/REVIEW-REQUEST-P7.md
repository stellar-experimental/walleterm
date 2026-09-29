# Review request: Phase 4 fixes (02b4fcb) and Phase 7 (8841ddd, bcbd050, 6c33155, d5c4725)

Your sandbox cannot write to this notes folder. Write the review to `/private/tmp/walleterm-reviews/REVIEW-P7.md`;
Opus copies it here. Review detached checkouts, never the shared rust-everywhere tree. Review head: 02b4fcb.
Order: 353a8b2, 8841ddd, bcbd050, 6c33155, d5c4725, 02b4fcb.

## 02b4fcb: your Phase 4 findings

Every new regression below fails on d5c4725 (Opus ran them there). The closed-output test hung on d5c4725,
so it now has an outer timeout.

- P4-S1: both `codesign -dvv` and the entitlement read must exit 0 (`tools/src/release.rs`). A failure returns
  "The signature inspection failed. Nothing was archived or published." `tools/tests/release.rs` ports your fault
  matrix to one POSIX shell dispatcher (no Python): a clean publish, `details-error`, `entitlements-error`, and
  `unexpected-entitlement`. It asserts no ditto, xcrun, tag, push, release, or PR call after a failure.
  To run it, the tools binary reads `WALLETERM_TOOLS_ROOT` (tests only) for a scratch root.
- P4-S2: the launcher creates `run-N` (0700, `create`, not `create_all`) per supervisor generation. Your probe
  reused one directory through `spawn_supervisor_from` directly; production no longer does that. The regression
  `a_replacement_supervisor_records_its_own_processes_and_stays_alive` goes through `launch` with the real
  supervisor twice and checks both records, the replacement's liveness, and final cleanup.
- P4-S3: a `starting` async mutex. `connect` holds it for its whole run and stores the tunnel in `shared` before
  the URL wait. `stop_all` cancels first, then takes the mutex, then takes and stops the tunnel. Tests: shutdown
  before the first URL and before a replacement URL, both with a mock that ignores SIGTERM. The EOF branch of
  `wait_for_tunnel` now selects on the deadline and the stop request.
- P4-S4: on success, `wait_for_tunnel` swaps in a closed receiver and moves the real one to a discard task.
  Your probe shape is the regression (4 MiB after the URL; zero bytes queued; the tunnel stays up; stop succeeds).
- P4-S5: `keys()` notifies `idle` after it clears the listing slot. `close()` waits for no pending jobs and no
  listing. Test: `shutdown_waits_for_a_website_lookup_to_finish_its_cleanup`. `service.close()` is still bounded
  by the launcher's 3.5 s timeout.
- P4-S6: `build/manifest.rs` (shared by `build.rs` and a `src/demo.rs` unit test) checks each line, the lowercase
  hex digest, and the file's SHA-256. `build.rs` writes each verified file to `OUT_DIR/asset-N` and embeds that
  copy. A real `cargo build` with a changed asset failed with the new message.

## Phase 7

- 8841ddd: Go, `bridge/*.ts`, `demo/server.ts`, and the TS package, install, and release scripts are gone.
  Twelve Soroban envelope cases were frozen into `vectors.json` from `bridge/transaction.ts` before
  `soroban-transaction.test.ts` was removed (first 87 cases unchanged; `rust-everywhere-notes/gen-vectors.ts` is
  the producer). The `auth-cli` case in `authorization.test.ts` was dropped because `sign-auth.json` covers it.
  Pure SDK tests moved to `tests/browser`. The scanner test decodes the tunnel's own terminal QR (`src/qr.rs`
  writes `tests/browser/pairing-qr.txt` and a Rust test keeps it in sync), so npm `qrcode` is gone.
  The live harnesses use the test host's new `WALLETERM_TEST_HOST_PRODUCTION` mode: `bridge::production` on
  loopback with the full shell environment; they count signature requests from the Signed and withheld log lines.
- bcbd050: `NOTICES.txt` groups identical license texts (whitespace-insensitive). Every package heading stays.
- 6c33155: docs and skills describe one binary. Dated records stay as history.
- d5c4725: the demo imports the Stellar SDK from its bundle and drops the 810 KB global script and route.
  A real browser loaded the demo without console or page errors.
- Measurements: `rust-everywhere-notes/MEASUREMENTS.md`.

Plan acceptance points to check: no active build or runtime path calls Go or `walleterm-bridge`; no Rust
application path loads Bun, Node, `.env` values other than `OP_VAULT`, or runtime JavaScript; each retained TS
file has a browser, compiler, interoperability, independent-verification, or art purpose; the only active Python
is `design/tools/artcheck.py` (the `audit/` scripts are dated evidence); no claimed native coverage depends only
on the removed TS server.

Security focus: the production test-host mode (it must stay behind the `test-host` feature and never enter a
package), the P4 fixes for new races or leaks, and anything the deletions left uncovered.

Reply with only the review path and ACCEPT or CHANGES.

## Addendum: 05911ef ports main #27 before the rebase

main moved to 6bad9df (#25, #27, #29). #27 changed `bridge/server.ts`: an `unknown` record prints the withheld
line only when `!r.delivered`. 05911ef makes the same change in `log_result` and replaces the three older Rust
tests with main's new matrix (switch, disconnect, expiry, each delivered and undelivered; a repeated create; and
cancel delivered and undelivered). The rebase onto main comes after this review. Include 05911ef.
