# Review request: Phase 1 fixes (1fc9888) and Phase 2 (caf7256)

Review in a clean checkout of each commit (for example a detached worktree under the notes folder or /private/tmp).
Opus is coding Phase 3 in rust-everywhere, so its working tree is not a stable snapshot.

## 1fc9888: your Phase 1 findings

- S1: serde_json `float_roundtrip`; vectors `auth-openzeppelin-near-integer`, `auth-ledger-near-integer`; raw-text `json_u32` unit test.
  Opus confirmed that removing the feature makes exactly those two vectors fail.
- N1: the lenient classification path maps `-`/`_` to `+`/`/`; vectors `auth-base64url`, `preimage-base64url`, `tx-base64url`.
- N2: `tx-invalid-asset-code` with `rust_accepts`; README wording corrected; `structural_admission_accepts_what_the_sdk_cannot_model`.
- Weak-key and group-order-scalar tests in `src/authorization.rs`.
Confirm each finding is closed, or say what remains.

## caf7256: the native CLI signer

Files: `src/agent.rs`, `src/cli.rs`, `src/platform.rs`, `src/service.rs`, `src/main.rs`, `tests/cli.rs`, `fixtures/parity/cli.json`, `fixtures/parity/sign-auth.json`.

- Frozen transcripts: `cli.json` (57 cases, main.go `run()` against scripted mock agents, exact stdout/stderr bytes and every raw request frame) and `sign-auth.json` (26 cases, `bridge/main.ts sign-auth` with a fake `walleterm sign`). Their capture tools ran once from the scratchpad and are not committed; `fixtures/parity/README.md` records the producers.
- Agent IO: non-blocking socket, every read and write gated by `poll()` against one absolute deadline (`SO_RCVTIMEO` returns EINVAL on macOS after peer close, which first masked a truncated frame as `agent_unavailable`).
- Socket checks: `symlink_metadata` (a symlink fails), type socket, mode `& 0o077 == 0`, owner equals `getuid()`. Path from `getpwuid_r` for the real UID.
- `sign` JSON input: Go token-decoder semantics through a serde visitor with phase tracking; invalid UTF-8 becomes U+FFFD before parsing, as Go does.
- Output: Go's HTML-safe JSON escaping (`<`, `>`, `&`, U+2028/2029) and a `strconv.Quote` port for `--human` comments.
- `sign-auth`: native signing; agent failure codes collapse to `signing_failed` with the agent's message (the sidecar's behavior); `timeout` stays. Notice failure prevents opening the agent.
- `tunnel`/`demo` still exec the Bun sidecar (Phase 4 replaces this) with the BUN_*/NODE_OPTIONS/WALLETERM_BINARY filter.
- Recorded differences in `fixtures/parity/README.md`.

Security focus: the deadline and cancellation paths, zero signing requests on every rejection path, exactly one signing request on output failure, no retry, socket identity checks, and anything that could let a caller redirect signing.
Write `REVIEW-P2.md` in the notes folder with ranked findings (blocker / should-fix / note), file:line, and a concrete failing input where possible.
Reply with only the review path and ACCEPT or CHANGES.
