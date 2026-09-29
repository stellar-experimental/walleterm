# Phase 3 test report

- Commits under test: `885bf27` (Phase 3, Rust bridge for protocol version 3 with vault discovery) and `e01e827` (Phase 2 review fixes).
- Tested at: `e01e8279ac6e56e0c4d515a9473aab349b047b96` (`Address the Phase 2 security review: deadline, port range, format characters`). Parent chain: `885bf27`, `1680f33`.
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`. `git checkout --detach e01e827`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target` (removed an ignored `dist/`).
- Start state: HEAD matched the request. `git status --short` was empty. It was still empty after all runs.
- Date: 2026-09-28, about 14:15 to 14:25 local time.
- Logs: `rust-everywhere-notes/tests/logs/phase-3/`

## Safety review before the runs

The test agent read the new tests before it ran them:

- `tests/vault.rs` writes a fake `op` script into a private test directory and passes its path to `allowed_keys_with` and `discover`. No test calls the real `op`.
- `tests/vault.rs`, `tests/cli.rs`, and `tests/bridge.rs` use mock agent sockets and mock seeds.
- `tests/ledger.rs` uses loopback mock RPC servers. `https://…example` origins in `tests/bridge.rs` are only header values.
- `src/bin/walleterm-test-host.rs` forwards every dependency (signers, sign, ledger, review) to the JS harness. `tests/browser/host.ts` answers with JS mocks.

No test reached 1Password, the real tunnel, or testnet.

## Tool versions

| Tool | Version |
| --- | --- |
| rustc | 1.93.0 (254b59607 2026-01-19) |
| cargo | 1.93.0 (083ac5135 2025-12-15) |
| rustfmt | 1.8.0-stable (254b59607d 2026-01-19) |
| bun | 1.4.2 |
| go | go1.27.1 darwin/arm64 |
| cargo-deny | 0.20.2 (pinned binary) |

## Standard checks

| Command | Exit | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | OK |
| `cargo +1.93.0 build --locked -q --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none` | 0 | OK |
| `bun run format:check` | 0 | All matched files use Prettier code style |
| `make test` | 0 | All 9 steps ran. See below. |
| `go test -count=1 ./...` | 0 | `ok walleterm 0.315s` (uncached; `make test` used the Go cache) |
| `cargo fmt --all --check` | 0 | No diffs |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | No warnings |
| `cargo clippy --locked --features test-host --bin walleterm-test-host -- -D warnings` | 0 | No warnings |
| `cargo test --workspace --locked` | 0 | 99 passed, 0 failed, 0 ignored |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |

`make test` steps: `go test ./...`, `go vet ./...`, `cargo fmt --all --check`, workspace clippy, `cargo test --workspace --locked`, test-host clippy, `cargo build --locked --features test-host --bin walleterm-test-host`, `bun run typecheck`, `bun run test`.

- Rust in `make test`: lib 26, main 0, `bridge` 41, `cli` 16, `ledger` 5, `vault` 7, `vectors` 4, doc-tests 0. Total 99 passed, 0 failed.
- Bun in `make test`: 585 pass, 0 fail, 726 `expect()` calls, 39 files.

## Phase-specific checks

### 1. Rust integration tests

| Command | Exit | Passed | Expected |
| --- | --- | --- | --- |
| `cargo test --locked --test bridge` | 0 | 41 | 41 |
| `cargo test --locked --test cli` | 0 | 16 | 16 |
| `cargo test --locked --test ledger` | 0 | 5 | 5 |
| `cargo test --locked --test vault` | 0 | 7 | 7 |
| `cargo test --locked --test vectors` | 0 | 4 | 4 |

All with 0 failed and 0 ignored. Result: PASS.

### 2. Browser tests and the Rust host

`bun test tests/browser/`: exit 0. **39 pass**, 0 fail, 84 `expect()` calls, 4 files.

**Count differs from the request (38).** Per file:

| File | Pass | Imports `host.ts` |
| --- | --- | --- |
| `auth-lifecycle.test.ts` | 8 | yes |
| `host-lifecycle.test.ts` | 18 | yes |
| `sep43.test.ts` | 12 | yes |
| `sdk-discovery.test.ts` | 1 | no |

The three host files have 38 tests. `sdk-discovery.test.ts` adds 1 SDK-only test (`caller cancellation still stops SDK vault discovery immediately`). No test failed or was skipped.

Rust host evidence:

- `tests/browser/host.ts:9` defines `MARKER = 'WALLETERM_TEST_HOST_ONLY_V1'`. Line 111 throws unless the `ready` message has that marker.
- `host.ts:10-12` spawns `$WALLETERM_TEST_HOST` or `target/debug/walleterm-test-host`. `WALLETERM_TEST_HOST` was unset in all runs.
- `src/bin/walleterm-test-host.rs:151` sends `{"ready":{"marker":MARKER,"port":…,"pairing":…}}`.
- `target/debug/walleterm-test-host` (9880360 bytes, SHA-256 `5c49735384c03fb5df12e0c86821c73d11b30062ac9c19e7e56cdc284ba0832e`) contains the marker: `grep -a -c` = 1, `strings | grep -c` = 1.
- Negative control: the test agent moved the host binary aside and reran `bun test tests/browser/`. Exit 1: **2 pass, 37 fail**, with `ENOENT … posix_spawn '…/target/debug/walleterm-test-host'`.
  The 2 passes are SDK-only: `SDK freezes adapter options and rejects a substituted signed artifact` (`auth-lifecycle.test.ts:172`) and the `sdk-discovery.test.ts` test.
  The binary was restored. Its SHA-256 matched again.
- After the runs, `pgrep -fl walleterm-test-host` found no processes.

Result: PASS. 37 of 39 browser tests require the Rust host.

### 3. Release binary

`cargo build --release --locked --bin walleterm`: exit 0, 38.27 s.
`target/release/walleterm`: Mach-O 64-bit executable arm64, **697760 bytes**, SHA-256 `20cd01374fe47060e389ae0631755c0732218acff86803f2fce5cf031be0061e`.
No `walleterm-test-host` exists in `target/release/`.

| Check on `target/release/walleterm` | Result |
| --- | --- |
| `grep -a -c WALLETERM_TEST_HOST_ONLY_V1` | **0** |
| `strings -a … \| grep -c WALLETERM_TEST_HOST_ONLY_V1` | **0** |
| `grep -a -c TEST_HOST` | 0 |
| Positive control: `grep -a -c 'walleterm sign-auth'` | 3 |

**Tool note:** plain `grep -c` (without `-a`) is not reliable on these Mach-O files with macOS grep.
On the debug host binary, which contains the marker, plain `grep -c` printed nothing and exited 1. `LC_ALL=C grep -c` did the same.
A plain `grep -c` result is therefore not evidence of absence. This report uses `grep -a -c` and `strings`.

Result: PASS. The marker is absent from the release binary.

### 4. Dependency counts

| Measure | Count |
| --- | --- |
| `Cargo.lock` `[[package]]` entries | **133** (includes the root `walleterm`) |
| Budget | at most 160: **within budget** (27 to spare) |
| `cargo tree --locked -e normal --prefix none --no-dedupe`, unique lines | 100 (99 excluding the root) |
| Same with `--features test-host` | 100 |
| `cargo tree --locked -e normal,build,dev --target all --prefix none`, unique | 126 (125 excluding the root) |
| Direct normal dependencies (`--depth 1`) | 18 |

Result: PASS.

## Observations for review

These are not failures of the requested checks.

1. The release `walleterm` does not link the Rust bridge yet. The size changed little from Phase 2 (697552 to 697760 bytes).
   Bridge strings such as `The trusted testnet ledger is unavailable.` and `walleterm:ledger_unavailable` do not occur in it.
   `src/service.rs:89` still starts the `walleterm-bridge` sidecar for `tunnel`. This may be planned for a later phase.
2. `ASTRA-PLAN-v2.md` Phase 3 says: "The browser harness must observe that marker and the requested executable path."
   `host.ts` checks the marker. The `ready` message has no executable path, and `host.ts` does not compare one.

## Not run

- No live 1Password signing, tunnel, or testnet transaction. The brief excludes them.

## Verdict

PASS. All standard and Phase 3 checks pass at `e01e827`. The browser count is 39, not 38; the extra test is SDK-only (see check 2).
