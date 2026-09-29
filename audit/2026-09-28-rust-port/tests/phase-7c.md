# Phase 7c test report

- Commit: `381bf9fb2638fdd8ad721285d7c8bb3df2644cc9` (`Merge main (#25, #27, #29, #31) into the Rust branch`).
  Parents: `3ea4cd2` (Rust branch) and `ad684c8` (= local `origin/main`, `Share the Walleterm session across the website's tabs (#31)`).
- Rust-side commits since `7f14df3`: `05911ef` (port main #27), `aa5ca73` (Phase 7 review fixes, including the 7b site-test fix), `3ea4cd2` (close the service while shutdown waits for tunnel ownership).
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`. `git checkout --detach 381bf9f`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target -e fixtures/kit/node_modules` (removed an ignored `dist/`).
- Start state: HEAD matched the request. `git status --short` was empty before and after all runs.
- Date: 2026-09-28, about 16:15 to 16:45 local time. Logs: `rust-everywhere-notes/tests/logs/phase-7c/`

## Safety review before the runs

- `fixtures/kit/live/check.mts` starts `createHost` with mock dependencies and one `Keypair.random()` key. Its `sign` mock counts calls.
  It imports only `buildPage` from `live/serve.mts`. That module starts `Bun.serve` only under `import.meta.main`.
  Requests go to the loopback test host. It uses no RPC, testnet, or 1Password.
- `fixtures/kit/tabs.mts` uses `createHost` with two random mock keys.
- The tunnel tests use scripted mock `cloudflared` programs on a private `PATH`.

No test used 1Password, the real `cloudflared`, Cloudflare, or testnet.
`~/.local/bin/walleterm` was unchanged: mtime `1790620203`, inode `289060419`.

## Tool versions

rustc 1.93.0, cargo 1.93.0, bun 1.4.2, tsc 7.0.2, cargo-deny 0.20.2 (pinned binary). All the same as 7b.

## Standard checks

| Command | Exit | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | `Checked 52 installs across 72 packages (no changes)` |
| `bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts` | 0 | `Checked 446 installs across 397 packages (no changes)` |
| CAP-71 fixture build | 0 | OK |
| `bun run format:check` | 0 | All matched files use Prettier code style |
| `make test` | 0 | All steps passed. See below. |
| `make test-package` | 0 | `The package check passed.` |
| `make test-kit` | 0 | `check.mts`: `"kit":"2.7.0","ok":true`, all 10 results as before. `tabs.mts`: 10 steps, all with `"agree": true`; final line `{"ok":true}` |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |
| `Cargo.lock` | | 135 `[[package]]` entries, unchanged (budget 160) |

`make test`:

- Rust: **156 passed**, 0 failed, 0 ignored. lib 28, main 0, `bridge` 46, `cli` 16, `config` 1, `demo` 3, `ledger` 5, `tunnel` 28, `vault` 10, `vectors` 4, tools unit 6, `fixtures` 3, `install` 3, `release` 3, doc-tests 0.
- Bun: **509 pass**, 0 fail, 542 `expect()` calls, 28 files.
- Self-tests: `contracts.ts`, `extended-contracts.ts`, and `cap85.ts` all `"ok":true`.

`tabs.mts` addresses were `GAZZ…FNTZ` and then `GCBP…FMPJ`. These are random mock keys from that run.

## Specific checks

### 1. Merge integrity

- `bridge/`: absent. 0 tracked files under `bridge/`.
- `createBridge`: 0 matches outside `audit/` and `evidence/`.
- Imports of `bridge/server` (`from`, `import(`, `require(`): 0 matches.
- Any `bridge/server` text outside `audit/` and `evidence/`:
  - Provenance comments: `tests/bridge.rs:2` "Ported from bridge/server.test.ts …" and `tests/browser/host-lifecycle.test.ts:1` "Ported from … the legacy bridge/server.test.ts".
  - Dated records: `docs/SKILLS-AUDIT.md:83,102` and `docs/SKILLS-INDEPENDENT-REVIEW.md:38`.
  - None is code.
- `git diff origin/main HEAD -- sdk/`: **no difference** (0 lines). `origin/main` = `ad684c8`, the merge's second parent. The test agent did not fetch.
  - `sdk/walleterm.ts:582,613,628,635` `storageKey` (default `'walleterm:session'`). `:640` `page?.addEventListener?.('storage', …)`.
  - `sdk/connect.ts:60` `listed: WalletermClient | null = null`, used at `:487` and `:523`.

Result: PASS.

### 2. Ported main tests and the live-page check

| Command | Exit | Result |
| --- | --- | --- |
| `bun test tests/browser/tabs.test.ts` | 0 | 16 pass, 0 fail |
| `bun test tests/browser/sep43.test.ts` | 0 | 12 pass, 0 fail |
| `bun test tests/browser/connect.test.ts` | 0 | 47 pass, 0 fail |
| `bun test tests/browser/kit.test.ts` | 0 | 6 pass, 0 fail |
| `bun fixtures/kit/live/check.mts` | 0 | **`ok: true`, `signatures: 0`**. Every negative case was rejected with `bridgeRequests: 0`, for example `public` → `-3 walleterm:network_unsupported` and `v1_preimage` / `sign_message` → `-3 walleterm:unsupported`. The page build lists `/page.js` and 6 chunks. |

Result: PASS.

### 3. main #27 in Rust

The command as written, `cargo test --test bridge endings_of_a_signed_request canceling_a_signed_request a_repeated_create`, **exits 1 with a usage error**. `cargo test` accepts only one filter before `--`.
Run instead: `cargo test --locked --test bridge -- endings_of_a_signed_request canceling_a_signed_request a_repeated_create`. Exit 0, **3 passed**, 43 filtered out:

- `endings_of_a_signed_request_log_a_withheld_line_only_when_undelivered`
- `canceling_a_signed_request_logs_a_withheld_line_only_when_undelivered`
- `a_repeated_create_delivers_a_signature_and_a_later_switch_prints_no_withheld_line`

Result: PASS (with the corrected command).

### 4. Review fixes

| Command | Exit | Result |
| --- | --- | --- |
| `cargo test --locked --test tunnel` | 0 | **28 passed**, including `shutdown_while_recovery_stops_the_old_tunnel_waits_for_that_stop` and `shutdown_during_retirement_cancels_bridge_signing_first` |
| `bun test tests/browser/sign-events.test.ts` | 0 | 4 pass, 0 fail |
| `bun test tests/browser/site.test.ts` | 0 | **119 pass**, 0 fail. The 7b failure is fixed. |

Result: PASS.

### 5. The two new tunnel tests on older `src/tunnel.rs`

Setup: `git archive 05911ef` and `git archive aa5ca73` into two scratch trees. Each got HEAD's `tests/tunnel.rs` and `tests/support/mod.rs` (the only file in `tests/support/`).
`src/tunnel.rs` in each tree is byte-identical to its commit. It differs from HEAD by 39 lines (`05911ef`) and 7 lines (`aa5ca73`), which matches `git diff --stat`.
Each tree was built in **its own** `CARGO_TARGET_DIR`, with `WALLETERM_ASSETS=<test worktree>/dist`. Each test binary ran directly under a Perl `alarm`.

| Source | Exit | Result | Failing test and first error |
| --- | --- | --- | --- |
| `05911ef` | 101 | 27 passed, **1 failed** | `shutdown_while_recovery_stops_the_old_tunnel_waits_for_that_stop`: `tests/tunnel.rs:862` `shutdown returned before the old tunnel stopped` |
| `aa5ca73` | 101 | 27 passed, **1 failed** | `shutdown_during_retirement_cancels_bridge_signing_first`: `tests/tunnel.rs:922` `closing false, canceled false, delivered true` |

No alarm fired. Repeatability: each new test ran 10 times alone (`--exact`, 60 s alarm) on each version:

| Test | `05911ef` | `aa5ca73` | HEAD |
| --- | --- | --- | --- |
| `shutdown_while_recovery_stops_the_old_tunnel_waits_for_that_stop` | fail 10/10 | pass 10/10 | pass 10/10 |
| `shutdown_during_retirement_cancels_bridge_signing_first` | **pass 10/10** | fail 10/10 | pass 10/10 |

- **Part 1, not met as expected.** Only one of the two new tests fails on `05911ef`. `shutdown_during_retirement_cancels_bridge_signing_first` passes on `05911ef` every time.
  So `05911ef` does not have the defect that this test detects. `aa5ca73` introduced it, and `3ea4cd2` fixed it. The test guards against the `aa5ca73` regression, not against a defect in `05911ef`.
- **Part 2, met.** `shutdown_during_retirement_cancels_bridge_signing_first` fails on `aa5ca73` every time.

Result: the two new tests detect the defects they target: the recovery test on `05911ef`, and the retirement test on `aa5ca73`. The expectation "both fail on `05911ef`" does not hold for the retirement test.

### 6. Totals and package at `381bf9f`

| Item | Value |
| --- | --- |
| Rust tests (`make test`) | 156 passed, 0 failed |
| Bun tests (`make test`) | 509 pass, 0 fail, 28 files |
| `walleterm` (`package … 0.0.0-t7c`) | **4,011,600 bytes** |
| gzip -9 | **1,501,037 bytes** |
| `NOTICES.txt` | 274,617 bytes, byte-identical to 7b |
| Forbidden strings | `walleterm-bridge` 0, `WALLETERM_TEST_HOST_ONLY_V1` 0, `stellar-sdk.js` 0 |

## Observations

1. **Failed tunnel tests leave scratch directories.** `tests/tunnel.rs` `scratch()` (`:582`) returns a plain `PathBuf`. Each test removes its directory with `remove_dir_all` as its last line.
   A failing test panics before that line, so `/private/tmp/wt-sup-*` stays behind. (The `cli.rs` tests use a `Drop` guard.) Passing runs leave nothing.
   The 4 directories from the test agent's 7b old-code run (15:53) were found here and removed. 8 other `wt-sup-*` directories (15:30 and 15:40) and `/private/tmp/wt-rs-67239-2` (14:04) come from outside the test agent's run windows. They were left in place.
   No mock `cloudflared` process from any of them is alive.
2. The check 3 command needs `--` before multiple test-name filters.

## Correction to earlier reports

Earlier leftover checks used `ls -d <glob1> <glob2> …` in zsh. When the first glob has no match, zsh aborts the whole command ("no matches found"), so the later globs were never checked.
The corrected checks in this report use `find`. Corrections were appended to `phase-7a.md` and `phase-7b.md`.

## Not run

- No live 1Password signing, real `cloudflared`, Cloudflare, or testnet.

## Verdict

PASS, with one expectation not met as stated. All standard checks and checks 1–4 and 6 pass. In check 5, the retirement test passes on `05911ef` and fails only on `aa5ca73`; it guards the `aa5ca73` regression. The check 3 command needs `--` before the filters.
