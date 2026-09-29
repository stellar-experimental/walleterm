# Phase 2 test report

- Commits under test: `caf7256` (Phase 2, native CLI signer) and `1fc9888` (Phase 1 review fixes).
- Tested at: `1fc9888bef07edd6d9927294a02ccabfef3fbfb3` (`Address the Phase 1 security review: exact decimals and alias diagnostics`). Its history contains `caf7256` and `1660f97`.
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`, created with `git worktree add --detach … 1fc9888`, then `git checkout --detach 1fc9888` and `git clean -fdx -e node_modules -e target -e fixtures/cap71/target`.
- Start state: `git rev-parse HEAD` matched the request. `git status --short` was empty. It was still empty after all runs.
- Date: 2026-09-28, runs from about 13:47 to 13:50 local time.
- Logs: `rust-everywhere-notes/tests/logs/phase-2/`

## Tool versions

| Tool | Version |
| --- | --- |
| rustc | 1.93.0 (254b59607 2026-01-19) |
| cargo | 1.93.0 (083ac5135 2025-12-15) |
| rustfmt | 1.8.0-stable (254b59607d 2026-01-19) |
| bun | 1.4.2 |
| go | go1.27.1 darwin/arm64 |
| cargo-deny | 0.20.2 (pinned binary from the Phase 1 request) |

## Standard checks

| Command | Exit | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | OK |
| `cargo +1.93.0 build --locked -q --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none` | 0 | OK |
| `bun run format:check` | 0 | All matched files use Prettier code style |
| `make test` | **2** | **FAIL**: stopped at `cargo fmt --all --check` (step 3 of 7) |
| `cargo fmt --all --check` | **1** | **FAIL**: 3 diffs, see below |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | No warnings |
| `cargo test --workspace --locked` | 0 | lib 16, main 0, `tests/cli.rs` 13, `tests/vectors.rs` 4, doc-tests 0; 0 failed, 0 ignored |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |

`make test` runs `go test ./...`, `go vet ./...`, `cargo fmt --all --check`, clippy, `cargo test --workspace --locked`, `bun run typecheck`, and `bun run test`.
In `make test`, `go test ./...` passed (`ok walleterm 0.572s`). Then `cargo fmt --all --check` failed and make stopped.
Because make stopped, the test agent ran the remaining steps one by one:

| Command | Exit | Result |
| --- | --- | --- |
| `go vet ./...` | 0 | OK |
| `bun run typecheck` (`tsc --noEmit`) | 0 | OK |
| `bun run test` | 0 | 546 pass, 0 fail, 642 `expect()` calls, 35 files |

### Format failure

`rustfmt.toml` is tracked (from `1660f97`): `max_width = 110`, `use_small_heuristics = "Max"`.
`cargo fmt --all --check` reports these diffs:

1. `src/authorization.rs:316`: the `const L: [u8; 32]` array literal wraps differently. rustfmt wants 16 bytes on the first line.
2. `tests/vectors.rs:122`: `let accepted: Vec<&Value> = vectors["cases"]…collect();` must split into a method chain.
3. `tests/vectors.rs:130`: the `inspect_transaction(…)` call must put one argument on each line.

Both files last changed in `1fc9888`. `cargo fmt --all` would fix all three. The test agent did not change them.

## Phase-specific checks

### 1. CLI tests

`cargo test --locked --test cli -- --nocapture`: exit 0. **13 passed**, 0 failed, 0 ignored.
Tests: `human_comments_cannot_reach_the_terminal_raw`, `help_version_and_sign_auth_arguments`, `socket_type_owner_and_mode_are_checked`, `every_signing_request_has_the_exact_wire_form`, `a_failed_notice_prevents_signing`, `output_failure_never_repeats_signing`, `go_signer_transcripts`, `sign_auth_transcripts`, `a_slow_but_complete_agent_succeeds`, `input_reads_share_the_deadline`, `a_dribbling_agent_cannot_extend_the_deadline`, `a_silent_agent_times_out_at_the_absolute_deadline`, `the_binary_rejects_bad_input_without_touching_the_agent`.
Before the run, the test agent confirmed that `tests/cli.rs` injects a mock socket under `/private/tmp/wt-rs-*` through `Io.socket` and uses a mock seed.

Result: PASS (13, as expected).

### 2. Rust vectors

`cargo test --locked --test vectors`: exit 0. **4 passed**, 0 failed.
Tests: `a_changed_signature_fails_independent_verification`, `structural_admission_accepts_what_the_sdk_cannot_model`, `every_parity_file_matches_its_recorded_hash`, `every_frozen_vector_matches`.

Result: PASS (4, as expected).

### 3. TS vectors

`bun test tests/vectors.test.ts`: exit 0. **88 pass**, 0 fail, 1 file.

Result: PASS (88, as expected).

### 4. Release binary

`cargo build --release --locked`: exit 0, 8.86 s.
`target/release/walleterm`: Mach-O 64-bit executable arm64, **697552 bytes**, SHA-256 `a6d304dd1128b92d13f0603733263eda0d1e3104d76d8a42abcad5cb9661c5b9`.

Before the runs, the test agent read `src/cli.rs`. `sign` calls `parse_sign_input` and `sign-auth` calls `parse_auth_input` before any socket connect.

| Command | Exit | stdout | stderr |
| --- | --- | --- | --- |
| `walleterm --help` | 0 | Usage text (list, sign, sign-auth, tunnel, demo, --help, --version) | empty |
| `walleterm --version` | 0 | `walleterm dev` | empty |
| `echo '{}' \| walleterm sign` | **2** | `{"ok":false,"error":{"code":"invalid_input","message":"The public key must be a canonical Ed25519 G-address."}}` | empty |
| `echo '[]' \| walleterm sign-auth` | **2** | `{"ok":false,"error":{"code":"invalid_input","message":"Send one JSON object."}}` | empty |

`--version` prints `dev` because `WALLETERM_VERSION` was not set at build time.
The test agent did not run `list`, or `sign` or `sign-auth` with valid input.

Result: PASS.

### 5. Go suite

`go test -count=1 ./...`: exit 0. `ok walleterm 0.301s`.

Result: PASS.

## Not run

- No live 1Password signing, tunnel, or testnet transaction. The brief excludes them.
- `make test` steps after `cargo fmt --all --check` did not run inside make. The test agent ran each of them separately (results above).

## Verdict

FAIL. `make test` and `cargo fmt --all --check` fail on 3 format diffs in `src/authorization.rs` and `tests/vectors.rs`. All other standard and phase 2 checks pass.

## Rerun at 1680f33

- Commit: `1680f334603d4feb5d66b912a0974b742c51ddda` (`Apply rustfmt to the Phase 1 review fixes`), parent `1fc9888`.
- `git diff --stat 1fc9888 1680f33`: `src/authorization.rs` (4 lines) and `tests/vectors.rs` (19 lines) only.
- Worktree: `rust-everywhere-test`, `git checkout --detach 1680f33`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target`.
  The clean removed an ignored `dist/` directory from the earlier run.
- Start state: HEAD matched the request. `git status --short` was empty before and after the runs.
- Tools: same versions as above.
- Logs: `rust-everywhere-notes/tests/logs/phase-2-rerun/`
- Scope, as requested: `make test`, `cargo fmt --all --check`, clippy, and cargo-deny only. `bun install` and the CAP-71 build were not rerun; the worktree kept `node_modules` and `fixtures/cap71/target` from the first run.

| Command | Exit | Result |
| --- | --- | --- |
| `make test` | 0 | All 7 steps ran. See below. |
| `cargo fmt --all --check` | 0 | No diffs |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | No warnings |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |

Inside `make test`:

- `go test ./...`: `ok walleterm (cached)`. No Go file changed since the `go test -count=1` pass at `1fc9888`.
- `go vet ./...`, `cargo fmt --all --check`, clippy: OK.
- `cargo test --workspace --locked`: lib 16, main 0, `tests/cli.rs` 13, `tests/vectors.rs` 4, doc-tests 0; 0 failed.
- `bun run typecheck`: OK.
- `bun run test`: 546 pass, 0 fail, 642 `expect()` calls, 35 files.

The phase-specific checks were not rerun. They passed at `1fc9888`, and this commit changes only formatting.

### Verdict at 1680f33

PASS. `make test`, `cargo fmt --all --check`, clippy, and cargo-deny all pass.
