# Review request: Phase 2 fixes (e01e827) and Phase 3 (885bf27)

Your sandbox cannot write to this notes folder. Write the review to `/private/tmp/walleterm-reviews/REVIEW-P3.md`;
Opus copies it here. Review detached checkouts, never the shared rust-everywhere tree.

## e01e827: your Phase 2 findings

- S1: `Agent::check()` before every read and write (`src/agent.rs`). Regressions `a_late_notice_never_sends_a_signing_request_after_the_deadline` and `a_buffered_response_after_the_deadline_is_not_read` fail when the checks are removed (Opus verified).
- S2: one range check after the option loop in `parse_port`; the `--` branch only breaks. Test cases `--port 65537 --`, `--port 65537`, `--port=0 --`.
- N1: complete Cf table in `printable`; test `format_characters_are_escaped_like_go`; README statement narrowed to unassigned code points.
- Not changed: the blocking `UnixStream::connect`. You could not reproduce a stall; Unix-domain connect on macOS refuses immediately when the backlog is full. Say if you want it bounded anyway.

## 885bf27: the native bridge (protocol v3)

Deviation from the plan: no frozen HTTP lifecycle traces. Instead, the complete bridge-only coverage of `bridge/server.test.ts`, `auth-lifecycle.test.ts`, `auth-ledger.test.ts`, `signer.test.ts`, and `vault.test.ts` is ported to Cargo (`tests/bridge.rs` 41 tests, `tests/ledger.rs`, `tests/vault.rs`), and the SDK tests run unchanged against the Rust bridge through `walleterm-test-host` (`tests/browser/`, 38 tests). The old TS tests still run against the TS bridge until cutover, so both implementations pass the same SDK suite today. Challenge this if you think frozen traces would catch something these do not.

Files: `src/bridge.rs`, `src/http.rs`, `src/ledger.rs`, `src/vault.rs`, `src/config.rs`, `src/cancel.rs`, `src/json.rs`, the async client in `src/agent.rs`, `src/bin/walleterm-test-host.rs`, `tests/support/mod.rs`, `tests/browser/host.ts`.

Deliberate behavior points:
- Handlers run in a spawned task, so a client disconnect cannot cancel a half-applied selection (Node semantics; the SDK relies on it). Test `a_selection_completes_after_its_client_disconnects`.
- Cancellation drops the dependency future. For the native signer this closes the agent socket; the "1Password returned a signature after cancellation" line now appears only in a narrow race.
- Request bodies with duplicate JSON keys now fail (the TS server accepted the last value).
- Authorization log lines use "(signer G…, authorization C…)"; the TS server printed "sequence undefined" for them because `details.sequence` existed as undefined.
- The listing coalescer (`keys()`) shares one discovery among concurrent website calls.
- `production()` wires the real agent socket, `op`, and the fixed ledger; nothing in the library reads a test override.
- The test host is a separate `required-features = ["test-host"]` binary with marker `WALLETERM_TEST_HOST_ONLY_V1`.

Security focus: session and grant isolation, Host and Origin checks, the revision compare-and-set after every await, withholding after any end, no `denied` after signing starts, the single signing worker, cancellation reaching the signer, body limits and deadlines, the ledger client (https only, no redirects, caps), vault CLI cleanup, and the test-host boundary.

Reply with only the review path and ACCEPT or CHANGES.
