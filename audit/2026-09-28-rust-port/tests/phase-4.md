# Phase 4 test report

- Commit: `df834c02c0cc5a50b2d008596d17543542de5c16` (`Run walleterm tunnel natively with a supervised Quick Tunnel`), parent `e01e827`.
- Diff from `e01e827`: 11 files (`Cargo.toml`, `Cargo.lock`, `src/{cli,lib,platform,process,qr,service,tunnel,vault}.rs`, `tests/tunnel.rs`), 1867 insertions, 19 deletions. New dependency: `qrcode =0.14.1`.
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`. `git checkout --detach df834c0`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target` (removed an ignored `dist/`).
- Start state: HEAD matched the request. `git status --short` was empty. It was still empty after all runs.
- Baseline: `pgrep -fl 'mock-tunnel|tunnel-child|wt-sup-'` printed nothing (exit 1) before any test.
- Date: 2026-09-28. Logs: `rust-everywhere-notes/tests/logs/phase-4/`

## Safety review before the runs

- `tests/tunnel.rs` writes a mock `cloudflared` shell script into `/private/tmp/wt-sup-<id>/`. Each process test clears the environment and puts that directory first on `PATH` (`<dir>:/bin:/usr/bin`). The mock prints `https://mock-tunnel.trycloudflare.com` and does not use the network.
- Launcher tests use mock tunnels, mock probes, and mock services.
- `the_tunnel_command_reports_a_busy_port_without_starting_cloudflared` runs `walleterm tunnel` with the real `HOME` and `OP_VAULT=Private`.
  The test agent confirmed that it stops safely. `tunnel::launch` calls `service.listen()` (`src/tunnel.rs:362`) before `spawn_tunnel` (`:411`).
  `bridge::production` and `Bridge::new` only store closures. They do not open the agent socket or run `op`. `op` is not on the test `PATH`.
- The manual release-binary runs below stop in `--help` or `parse_port` (`src/service.rs:262`), before any agent, `cloudflared`, or network step.

No test reached 1Password, the real `cloudflared`, Cloudflare, or testnet.

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
| `go test -count=1 ./...` | 0 | `ok walleterm 0.325s` (uncached; `make test` used the Go cache) |
| `cargo fmt --all --check` | 0 | No diffs |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | No warnings |
| `cargo clippy --locked --features test-host --bin walleterm-test-host -- -D warnings` | 0 | No warnings |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |

- Rust in `make test`: lib 27, main 0, `bridge` 41, `cli` 16, `ledger` 5, `tunnel` 21, `vault` 7, `vectors` 4, doc-tests 0. Total 121 passed, 0 failed, 0 ignored.
- Bun in `make test`: 585 pass, 0 fail, 726 `expect()` calls, 39 files.
- `Cargo.lock`: 134 `[[package]]` entries (133 at `e01e827`, plus `qrcode`). Budget of 160: within budget.
- `pgrep -fl 'mock-tunnel|tunnel-child|wt-sup-'` after `make test`: no output (exit 1).

## Phase-specific checks

### 1. Tunnel tests, three runs

`cargo test --locked --test tunnel -- --nocapture`, three runs in a row:

| Run | Exit | Passed | Failed | Ignored | Time |
| --- | --- | --- | --- | --- | --- |
| 1 | 0 | 21 | 0 | 0 | 1.67 s |
| 2 | 0 | 21 | 0 | 0 | 1.80 s |
| 3 | 0 | 21 | 0 | 0 | 1.69 s |

`make test` also ran the file once: 21 passed (1.42 s). So 4 of 4 runs passed, with no flaky result.

Tests (21): `a_closed_parent_pipe_stops_the_supervisor_and_its_stubborn_child`, `a_narrow_terminal_prints_fields_without_a_broken_qr_code`, `a_paused_replacement_prints_its_url_once_when_a_later_probe_succeeds`, `a_readiness_failure_closes_the_listener_and_tunnel`, `a_split_cloudflared_url_selects_only_the_tunnel_origin`, `a_stopped_tunnel_gets_a_new_url_without_restarting_the_service`, `a_supervisor_sigkill_stops_its_tunnel_group_and_spares_bystanders`, `an_exit_right_after_the_url_closes_the_listener`, `an_html_error_page_fails_the_probe`, `cancellation_during_listener_startup_starts_no_tunnel`, `cancellation_during_readiness_reports_no_readiness`, `healthy_checks_stay_silent_and_keep_monitoring`, `paused_recovery_resumes_after_the_oldest_restart_leaves_the_window`, `public_failures_recover_without_replacing_a_healthy_tunnel`, `readiness_requires_the_exact_service_name`, `recovery_pauses_after_three_replacements_and_preserves_the_service`, `shutdown_during_recovery_cannot_create_another_tunnel`, `six_failed_health_checks_replace_an_unreachable_tunnel`, `stopping_a_supervisor_stops_its_stubborn_child_within_the_grace_periods`, `the_service_owns_its_listener_and_an_isolated_tunnel_and_prints_the_code`, `the_tunnel_command_reports_a_busy_port_without_starting_cloudflared`.

Result: PASS.

### 2. Stray processes

`pgrep -fl 'mock-tunnel|tunnel-child|wt-sup-'` printed nothing (exit 1) after each of the three runs, after `make test`, and after the release-binary checks.
Extra checks after the runs:

- No `/private/tmp/wt-sup-*` directory remained.
- No `/bin/sleep 60` bystander and no `cloudflared` process remained.

Result: PASS.

### 3. Release binary

`cargo build --release --locked --bin walleterm`: exit 0, 9.48 s.
`target/release/walleterm`: Mach-O 64-bit executable arm64, **2425824 bytes** (Phase 3: 697760 bytes), SHA-256 `e108a1f7945196d189f81587b6184a5796fbeb9566fa2f6db6095931ddd97144`.
`grep -a -c WALLETERM_TEST_HOST_ONLY_V1`: 0.

All runs used `< /dev/null`.

| Command | Exit | stdout | stderr |
| --- | --- | --- | --- |
| `walleterm tunnel --help` | 0 | `walleterm tunnel [--port 8787]`, then 5 lines: cloudflared, macOS and 1Password agent, `OP_VAULT` from shell or `.env`, CLI filtering, Ctrl+C | empty |
| `walleterm tunnel --port 0` | **2** | `invalid_input: Use walleterm tunnel [--port 8787].` | empty |
| `walleterm tunnel --port 65537 --` | **2** | `invalid_input: Use walleterm tunnel [--port 8787].` | empty |

The service commands print plain text, not JSON. `AGENTS.md` asks for readable output for service commands.
The test agent did not run `walleterm tunnel` with a valid port.

Result: PASS.

### 4. Top-level help

`walleterm --help`: exit 0. It has 1 `walleterm tunnel [--port 8787]` line and 1 `walleterm demo [--port 8788]` line. It has 0 `tunnel-child` lines.

Result: PASS.

## Observations for review

These are not failures of the requested checks.

1. The release binary now contains the Rust bridge. For example, `The trusted testnet ledger is unavailable.` occurs once. This closes the Phase 3 observation for `tunnel`.
   `demo` still uses the `walleterm-bridge` sidecar, as the request states.
2. `tunnel-child` is hidden from help, but the release CLI accepts it (`src/cli.rs:470`). The string occurs in the binary.
   The test agent did not run it, because it starts a supervisor that runs `cloudflared` from `PATH`.
   The Phase 3 plan does not list it as a migration switch. It is the "private internal mode" in Phase 4 item 1. A reviewer may want to confirm its behavior when a user runs it directly.

## Not run

- No live 1Password signing, real `cloudflared`, Cloudflare tunnel, or testnet transaction. The brief and the request exclude them.
- `walleterm tunnel` with a valid port and `walleterm tunnel-child` were not run by hand.

## Verdict

PASS. All standard and Phase 4 checks pass at `df834c0`. Four tunnel runs gave 21/21 each, and no stray processes remained.
