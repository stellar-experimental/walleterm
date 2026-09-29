# Phase 5 test report

- Commit: `0efec43e7efad750ceddf673afb13a6a1f3c12bf` (`Embed the demo and ship one Rust binary for every command`), parent `df834c0`.
- Diff from `df834c0`: 15 files, 495 insertions, 68 deletions. New: `build.rs`, `src/demo.rs`, `tests/demo.rs`, `tests/browser/demo.test.ts`, `tests/browser/fixture.ts`.
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`. `git checkout --detach 0efec43`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target` (removed an ignored `dist/`).
- Start state: HEAD matched the request. `git status --short` was empty. It was still empty after all runs, including `make build` (`bin/` is ignored).
- Baseline: `pgrep -fl 'mock-tunnel|tunnel-child|wt-sup-|walleterm-test-host'` printed nothing before the runs.
- Date: 2026-09-28. Logs: `rust-everywhere-notes/tests/logs/phase-5/`

## Safety review before the runs

- `tests/demo.rs` serves the embedded demo on a `127.0.0.1:0` listener. It starts no `cloudflared`.
- `tests/browser/demo.test.ts` starts the Rust test host with `demo: true` and fetches only from its loopback origin.
- `fixtures/kit/check.mts` uses `createHost` from `tests/browser/host.ts` (marker check) with mock keys, a mock `latestLedger` of 100, and a mock `sign`. It reaches no RPC or testnet.
- `make test-kit` used the network only for `bun install --cwd fixtures/kit` (npm).
- `build.rs` reads only `WALLETERM_ASSETS` or `dist/`. It runs no Bun and uses no network.

No test reached 1Password, `cloudflared`, Cloudflare, or testnet. The test agent did not run `demo` or `tunnel` with a valid port.

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
| `make test` | 0 | All 10 steps ran, starting with `bun run build`. See below. |
| `go test -count=1 ./...` | 0 | `ok walleterm 0.329s` (uncached; `make test` used the Go cache) |
| `cargo fmt --all --check` | 0 | No diffs |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | No warnings |
| `cargo clippy --locked --features test-host --bin walleterm-test-host -- -D warnings` | 0 | No warnings |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |

- Rust in `make test`: lib 26, main 0, `bridge` 41, `cli` 16, `demo` 3, `ledger` 5, `tunnel` 21, `vault` 7, `vectors` 4, doc-tests 0. Total 123 passed, 0 failed, 0 ignored.
  Lib went from 27 to 26. The commit removes `service::tests::the_sidecar_never_inherits_code_loading_variables` together with the sidecar code.
- Bun in `make test`: 586 pass, 0 fail, 726 `expect()` calls, 40 files.
- `Cargo.lock`: 134 `[[package]]` entries, unchanged. Budget of 160: within budget.

## Phase-specific checks

### 1. Demo tests and browser tests

`cargo test --locked --test demo`: exit 0. **3 passed**, 0 failed.
Tests: `the_demo_serves_each_file_with_its_exact_bytes_and_strict_headers`, `the_demo_rejects_other_hosts_methods_and_malformed_targets`, `every_embedded_route_matches_its_manifest_hash_and_source`.

`bun test tests/browser/`: exit 0. **40 pass**, 0 fail, 84 `expect()` calls, 5 files. This matches the expected 40.

| File | Pass | Fail |
| --- | --- | --- |
| `auth-lifecycle.test.ts` | 8 | 0 |
| `demo.test.ts` | 1 | 0 |
| `host-lifecycle.test.ts` | 18 | 0 |
| `sdk-discovery.test.ts` | 1 | 0 |
| `sep43.test.ts` | 12 | 0 |

No `walleterm-test-host` process remained after the run.

Result: PASS.

### 2. `make test-kit`

Exit 0. Steps: `cargo build --locked --features test-host --bin walleterm-test-host`, `bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts` (`@creit.tech/stellar-wallets-kit@2.7.0`, 396 packages), `bun fixtures/kit/check.mts`.

JSON result:

```json
{
  "kit": "2.7.0",
  "ok": true,
  "results": {
    "public_default": "rejected with -3 before pairing",
    "fetch_address": "paired through getAddress",
    "sign_transaction": "verified",
    "sign_auth_entry": "verified",
    "sign_message": "rejected with -3",
    "switch": "Kit address followed onChange",
    "wallet_disconnect": "Kit address cleared, no dialog",
    "expiry_401": "signing returned -3, Kit address cleared, no dialog",
    "other_wallet": "guard ignored Walleterm events while another Kit wallet was selected",
    "disconnect": "bridge session revoked"
  }
}
```

No `walleterm-test-host` process remained after the run.

Result: PASS.

### 3. `make build`

Exit 0. Steps: `bun scripts/build.ts target/assets --minify`, `WALLETERM_ASSETS=…/target/assets cargo build --release --locked --bin walleterm` (9.62 s), `cp` to `bin/walleterm`, `ln -sf walleterm bin/stellar-walleterm`.
`target/assets/routes.tsv` has 24 routes (1.5 MB directory).

| Item | Value |
| --- | --- |
| `bin/walleterm` | Mach-O 64-bit executable arm64, **4804096 bytes** |
| `gzip -9 -c bin/walleterm \| wc -c` | **1671093 bytes** |
| SHA-256 | `6f21e000b2437e102beafd1626a771cb2fc03d60d2888520bf3633c81d056d68` (same as `target/release/walleterm`) |
| `bin/stellar-walleterm` | symlink, `readlink` = `walleterm`; it resolves to the same inode as `bin/walleterm` |

| Command | Exit | Output |
| --- | --- | --- |
| `bin/walleterm --help` | 0 | Lists `list`, `sign`, `sign-auth`, `tunnel`, `demo`, `--help`, `--version`. Same text as Phase 4. |
| `bin/walleterm demo --help` | 0 | `walleterm demo [--port 8788]`, `Requires cloudflared. Shows public links and QR codes.`, `The signing bridge requires macOS and the 1Password SSH agent.`, `Press Ctrl+C to stop this service.` |
| `bin/walleterm --version` | 0 | `walleterm dev` |
| `bin/stellar-walleterm --version` | 0 | `walleterm dev` |

All stderr empty. All runs used `< /dev/null`.

Result: PASS.

### 4. Build with empty assets

The test agent hashed `target/release/walleterm` and `bin/walleterm` first.

| Build | Exit | Message |
| --- | --- | --- |
| `WALLETERM_ASSETS=<empty directory> cargo build --release --locked --bin walleterm` | **101** | `panicked at build.rs:15:9: The demo assets are missing at …/empty-dir/routes.tsv. Run \`bun run build\` first.` |
| Extra: `WALLETERM_ASSETS=<directory with an empty routes.tsv>` (same command) | **101** | `panicked at build.rs:38:5: routes.tsv lists no demo files` |

Both builds failed in the build script. Afterward both binary hashes were unchanged, so no empty-site binary replaced them.
The test directories are in `rust-everywhere-notes/tests/phase-5-assets/`.

Result: PASS.

### 5. Forbidden strings in the release binary

| String | `grep -a -c` on `bin/walleterm` | `strings -a \| grep -c` | `grep -a -c` on `target/release/walleterm` |
| --- | --- | --- | --- |
| `walleterm-bridge` | **0** | 0 | 0 |
| `WALLETERM_TEST_HOST_ONLY_V1` | **0** | 0 | 0 |
| Positive control: `walleterm demo` | 2 | | |

Result: PASS.

## Observations for review

These are not failures of the requested checks.

1. `walleterm demo --help` says `The signing bridge requires macOS and the 1Password SSH agent.` The top-level help calls demo "an independent example website". A reviewer may want to confirm this line applies to `demo`.
2. `make test` builds the unminified `dist/` for `cargo test`. `make build` embeds the minified `target/assets/`. The tests therefore do not run against the exact assets in the shipped binary. `every_embedded_route_matches_its_manifest_hash_and_source` checks whichever manifest the build used.

## Not run

- No live 1Password signing, real `cloudflared`, Cloudflare tunnel, or testnet transaction.
- `walleterm demo` and `walleterm tunnel` with a valid port were not run.

## Verdict

PASS. All standard and Phase 5 checks pass at `0efec43`.
