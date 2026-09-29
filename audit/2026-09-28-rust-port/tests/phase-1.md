# Phase 1 test report

- Commit: `1660f97484f8558879c1613f6eb73867627363f6` (`Add the Rust signing core with frozen parity vectors`), branch `feat/rust-everywhere`
- Start state: `git rev-parse HEAD` matched the request. `git status --short` was empty.
- Date: 2026-09-28, runs from 13:25 to 13:27 local time.
- Logs: `_migration/tests/logs/`

## Tool versions

| Tool | Version |
| --- | --- |
| rustc | 1.93.0 (254b59607 2026-01-19), from `rust-toolchain.toml` channel 1.93.0 |
| cargo | 1.93.0 (083ac5135 2025-12-15) |
| bun | 1.4.2 |
| go | go1.27.1 darwin/arm64 |
| cargo-deny | 0.20.2 (pinned binary from the request) |

## Standard checks

| Command | Exit | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | OK |
| `cargo +1.93.0 build --locked -q --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none` | 0 | OK, no output |
| `bun run format:check` | 0 | All matched files use Prettier code style |
| `make test` | 0 | See below |
| `cargo fmt --all --check` | 0 | No diffs |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | No warnings |
| `cargo test --workspace --locked` | 0 | lib 8 passed; `tests/vectors.rs` 3 passed; doc-tests 0; 0 failed, 0 ignored |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |

`make test` runs `go test ./...`, `go vet ./...`, `cargo fmt --all --check`, the clippy command, `cargo test --workspace --locked`, `bun run typecheck`, and `bun run test`.
In `make test`: Go `ok walleterm (cached)`; Rust 8 + 3 + 0 passed, 0 failed; Bun 540 pass, 0 fail, 636 `expect()` calls, 35 files.
The Go result in `make test` came from the cache. Check 4 below reran Go with `-count=1`.

## Phase-specific checks

### 1. Rust vectors

`cargo test --locked --test vectors -- --nocapture`: exit 0. 3 passed, 0 failed, 0 ignored.

- `a_changed_signature_fails_independent_verification ... ok`
- `the_vector_file_matches_its_recorded_hash ... ok`
- `every_frozen_vector_matches ... ok`

Result: PASS (3 tests, as expected).

### 2. TS vectors

`bun test tests/vectors.test.ts`: exit 0. 82 pass, 0 fail, 1 file.

Result: PASS (82 tests, as expected).

### 3. Mutation check

`tests/vectors.rs` reads the fixed path `fixtures/parity/vectors.json`. The mutation therefore changed the tracked file for one run.

1. `cp -p fixtures/parity/vectors.json _migration/tests/vectors.json.orig`. Both SHA-256: `4e04a8e8b12b5b7332fb1ef12d8eb9a401c79753262b82124c63459672145e7e`.
2. Changed line 35, the first vector `expect.digest`, from `5454…aa70` to `6454…aa70` (first hex digit only).
   `git diff --stat`: 1 file, 1 insertion, 1 deletion.
3. `cargo test --locked --test vectors`: exit 101. 1 passed, 2 failed.
   - `the_vector_file_matches_its_recorded_hash ... FAILED` at `tests/vectors.rs:138:5`.
     left `b483712b1fb3065cecc101740723f676f8fd26a154e8133e237182a6a5ff6f1d`, right `4e04a8e8b12b5b7332fb1ef12d8eb9a401c79753262b82124c63459672145e7e`.
   - `every_frozen_vector_matches ... FAILED` at `tests/vectors.rs:106:5`.
   - `a_changed_signature_fails_independent_verification ... ok`.
4. `cp -p _migration/tests/vectors.json.orig fixtures/parity/vectors.json`. SHA-256 again `4e04a8e8…5e7e`. `cmp` reports byte-identical.
5. `git status --short` after restore: no tracked changes. `fixtures/parity/vectors.json` has no diff.

Result: PASS. Both the hash guard and the per-vector comparison detect the change.

### 4. Go suite and packaging

- `go test -count=1 ./...`: exit 0. `ok walleterm 0.333s`.
- `bun scripts/package.ts _migration/tests/pkg-p1`: exit 0. `Built walleterm 1660f97 in …/_migration/tests/pkg-p1.`
  - `walleterm`: Mach-O 64-bit executable arm64, 3397074 bytes, SHA-256 `4278b0d26e9881442ddd2d217d45e1ac55ea4e88f3cb8cb81e9c3a501b864344`
  - `walleterm-bridge`: Mach-O 64-bit executable arm64, 66338418 bytes, SHA-256 `b0f1bf2c7797a39888fa510d8b62b872c89231ab3be899b3377dd191b9dd93b8`
  - `NOTICES.txt`: 111760 bytes

Result: PASS. Both binaries built.

## Worktree note

An untracked file `fixtures/parity/cli.json` (37854 bytes, mtime 2026-09-28 13:26:11) appeared during the mutation run.
The tree was clean at the start. No script, test, or Makefile target in the repository references `cli.json`.
The test agent did not create it. Another agent in this shared worktree probably wrote it. The test agent did not delete it.
Final `git status --short`: `?? fixtures/parity/cli.json` only. HEAD is still `1660f97`.
The results above do not depend on this file.

## Not run

- No live 1Password signing, tunnel, or testnet transaction. The brief excludes them.

## Verdict

PASS. All standard and phase 1 checks pass at `1660f97`. One untracked file from another writer remains; see the worktree note.
