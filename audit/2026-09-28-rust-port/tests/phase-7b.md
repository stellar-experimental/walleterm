# Phase 7b test report

- Commit: `7f14df3429dca7df1e0c25d5278d3d3f87c89e59` (`Correct the cli.json case count in the parity README (58, unchanged since it was frozen)`).
- Commits since `8841ddd`: `bcbd050` (NOTICES grouping), `6c33155` (docs), `d5c4725` (demo SDK loaded once), `02b4fcb` (Phase 4 review fixes), `7f14df3` (README count).
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`. `git checkout --detach 7f14df3`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target` (removed an ignored `dist/`).
- Start state: HEAD matched the request. `git status --short` was empty. It was still empty at the end.
  For the bisect in the failure section, the test agent checked out `6c33155`, `d5c4725`, and `02b4fcb` briefly, then returned to `7f14df3`.
- Date: 2026-09-28, about 15:25 to 16:00 local time. Logs: `rust-everywhere-notes/tests/logs/phase-7b/`
- The test agent's own scripts are outside the worktree: `tests/phase-7b-timing.pl`.
  Scratch copies (`old-d5c4725`, `old-8841ddd`) and packages (`pkg-7a`, `pkg-7b`, `pkg-d5`) are in the session scratchpad.

## Safety review before the runs

- `tools/tests/release.rs` runs `walleterm-tools release 0.0.999 --publish` with a cleared environment.
  `PATH` puts one fake dispatcher first for `git`, `gh`, `bun`, `cargo`, `rustc`, `security`, `codesign`, `ditto`, and `xcrun`.
  `HOME`, `TMPDIR`, and `WALLETERM_TOOLS_ROOT` point into `/private/tmp/wtr-<mode>-<pid>/`.
  The tool calls only these programs, in both HEAD and `d5c4725` (checked with a grep of `run(` and `Command::new`). Nothing reached the real repository, GitHub, the keychain, or Apple.
- New tunnel tests use scripted mock `cloudflared` programs on a private `PATH`.
- The timing runs used only `--version` and invalid `{}` input. Each command printed its version or `invalid_input` (exit 2) before any agent step.

No test used 1Password, the real `cloudflared`, Cloudflare, testnet, or a real release.
`~/.local/bin/walleterm` was the same before and after: same target, mtime `1790620203`, inode `289060419`.

## Tool versions

rustc 1.93.0 (254b59607 2026-01-19), cargo 1.93.0, bun 1.4.2, tsc 7.0.2, cargo-deny 0.20.2 (pinned binary), perl 5 (`Time::HiRes`), macOS `/usr/bin/time -l`. `hyperfine` is not installed.

## Standard checks

| Command | Exit | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | OK |
| CAP-71 fixture build | 0 | OK |
| `bun run format:check` | 0 | All matched files use Prettier code style |
| **`make test`** | **2** | **FAIL**: `bun test` has 417 pass and **55 fail** (472 tests, 26 files) |
| `make test-package` | 0 | `The package check passed.` |
| `make test-kit` | 0 | `"kit":"2.7.0","ok":true`, all 10 results as in 7a |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |
| `Cargo.lock` | | 135 `[[package]]` entries, unchanged (budget 160) |

Inside `make test`, every step before `bun test` passed:

- `bun run build`, `cargo fmt --all --check`, both clippy runs, test-host build, and `bun run typecheck` (`tsc --noEmit`).
- `cargo test --workspace --locked`: **154 passed**, 0 failed. lib 28, `bridge` 46, `cli` 16, `config` 1, `demo` 3, `ledger` 5, `tunnel` 26, `vault` 10, `vectors` 4, tools unit 6, `fixtures` 3, `install` 3, `release` 3.

`bun run test` stopped at `bun test`, so the three self-tests did not run inside make. Run separately, `bun tests/contracts.ts`, `bun tests/extended-contracts.ts`, and `bun tests/cap85.ts` all exited 0 with `"ok":true`.
`bun test --path-ignore-patterns tests/browser/site.test.ts`: 353 pass, 0 fail (25 files).

### Failure: `tests/browser/site.test.ts`, 55 of 119 tests

All failures come from `site.test.ts`. Every other test file passes.

- First error: `ReferenceError: TransactionBuilder is not defined`, for example `site.test.ts:295`, `requestSignature()` rejects with it instead of `/Unverified/`.
  Other tests then fail at `site.test.ts:470` with `SyntaxError: JSON Parse error: Unexpected EOF`, because the details panel stays empty.
- Cause: `d5c4725` changed `demo/site/app.ts` from `const { Account, …, TransactionBuilder, xdr } = globalThis.StellarSdk` to `import { Account, …, TransactionBuilder, xdr } from '@stellar/stellar-sdk'`.
  The test loads `app.ts` through `browserScript()` (`tests/browser/support.ts:59-66`). That function **removes every `import` line** and expects the test to inject `StellarSdk` as a global (`site.test.ts:165`, `:441`, `:516`, …).
  After the import is removed, the names are undefined in the test context.
- Bisect of `bun test tests/browser/site.test.ts`:

  | Commit | Result |
  | --- | --- |
  | `6c33155` | 119 pass, 0 fail |
  | `d5c4725` | 64 pass, **55 fail** |
  | `02b4fcb` | 64 pass, 55 fail |
  | `7f14df3` | 64 pass, 55 fail |

- The shipped demo is not shown broken. Bun bundles `app.js`, so the import resolves. `tests/browser/demo.test.ts` (the real Rust host serving the embedded demo, following every imported module) passes, and so does `make test-kit`.
  The failure is in the `site.test.ts` harness, which `d5c4725` did not update. Its 55 behavior tests do not run until it is fixed.

## Specific checks

### 1. `02b4fcb` regressions

At HEAD:

| Command | Exit | Result |
| --- | --- | --- |
| `cargo test --locked --test tunnel --test bridge` | 0 | `tunnel` 26, `bridge` 46 passed |
| `cargo test --locked -p walleterm-tools --test release` | 0 | 3 passed |
| `cargo test --locked --lib demo` | 0 | 1 passed: `demo::tests::the_build_manifest_rejects_changed_missing_and_malformed_assets` |

**Mutation on `d5c4725`.** `git archive d5c4725 | tar -x` into the scratchpad. The test agent copied `tests/tunnel.rs`, `tests/bridge.rs`, `tests/support/mod.rs`, and `tools/tests/release.rs` from `02b4fcb`.
`tools/src/main.rs:93` changed from `let root = repository();` to `let root = std::env::var_os("WALLETERM_TOOLS_ROOT").map_or_else(repository, PathBuf::from);`. This was the only diff.
The old copy ran `bun install` and `bun run build` (both exit 0), and it compiled.
Each test binary ran directly under `perl -e 'alarm 180; exec …'`, so a hang would kill the test binary itself. No alarm fired.

| Binary | Exit | Passed | Failed | Failing tests and first error |
| --- | --- | --- | --- | --- |
| `tunnel` | 101 | 21 | **5** | `a_replacement_supervisor_records_its_own_processes_and_stays_alive` (`tests/tunnel.rs:741`, `left == right`) |
| | | | | `shutdown_before_the_first_url_stops_the_starting_tunnel_first` (`:238`, `the service did not reach the expected state`) |
| | | | | `shutdown_before_a_replacement_url_stops_the_replacement_first` (`:238`, same) |
| | | | | `tunnel_output_after_the_url_is_discarded_and_shutdown_stays_normal` (`:810`, `4 MiB after the URL must not wait in memory`) |
| | | | | `closed_output_keeps_the_url_deadline_and_the_stop_request` (`:825`, `the URL deadline holds: Elapsed(())`) |
| `bridge` | 101 | 45 | **1** | `shutdown_waits_for_a_website_lookup_to_finish_its_cleanup` (`tests/bridge.rs:1235`, `close returned before cleanup ended`) |
| `release` | 101 | 2 | **1** | `a_failed_signature_inspection_stops_before_any_archive_or_publication` (`tools/tests/release.rs:168`, `details-error: Built walleterm-0.0.999-darwin-arm64.zip (…) from 1234567.`). The old code archived after a failed inspection. |

The failures match the expected 7 tests exactly: the five tests in the P4 block, the website-lookup test, and the inspection test. No other test failed.
After the old runs, there was no stray `cloudflared`, `wt-sup-*`, or `wtr-*` process or directory.

Result: PASS.

### 2. Stale asset gate

1. The test agent copied `dist/.` to a scratch directory. It rewrote the path column of `routes.tsv` from `…/rust-everywhere-test/dist/` to the copy.
   15 of 23 routes point into `dist/`. The other 8 point at source files (`demo/site/index.html`, CSS, `fixtures/wasm/*.wasm`, `syntax.LICENSE`, `sdk/connect.css`), and those paths stayed the same.
2. Control: `WALLETERM_ASSETS=<copy> cargo build --locked --bin walleterm` with the unchanged copy: **exit 0**.
3. The test agent appended one line to the copied `demo/site/app.js`.
4. `WALLETERM_ASSETS=<copy> cargo build --locked --bin walleterm`: **exit 101**. `panicked at build.rs:27:90: The demo asset …/stale-assets/demo/site/app.js changed after its manifest was written. Build the assets again.`
5. Normal rebuild `cargo build --locked --bin walleterm`: exit 0.

Result: PASS.

### 3. Package

`cargo run --locked -q -p walleterm-tools -- package <scratch>/pkg-7b 0.0.0-t7b`: exit 0.

| Item | 7a (`8841ddd`, built for this comparison) | 7b (`7f14df3`) |
| --- | --- | --- |
| `walleterm` bytes | 4,819,760 | **4,011,520** |
| gzip -9 bytes | 1,673,399 | **1,499,621** |
| `NOTICES.txt` bytes | 953,110 (identical to Phase 6) | **274,617** |
| `NOTICES.txt` lines | 18,343 | 5,480 |
| `== ` heading lines / unique | 153 / 153 | 222 / 153 |

- **Every 7a heading appears in 7b**: 153 unique headings, 0 missing, 0 new.
  7b repeats a heading when a package has several license files, one under each distinct text. For example, `unicode-ident`, `typenum`, `rustix`, and `atomic-waker` appear 3 times each.
- License content: the test agent split both files into whitespace-normalized paragraphs, excluding headings. There are 182 distinct paragraphs in each, and **0 7a paragraphs are missing** from 7b.
- `stellar-sdk.js`: 0 matches in the 7b binary (`grep -a -c` and `strings`), against 2 in the 7a binary. The positive control `/app.js` has 2 matches.
  The route list (`dist/routes.tsv`, 23 routes) has no `/stellar-sdk.js`. `scripts/build.ts` no longer adds it (the 7a version had 1 reference).
- `demo/site/index.html`: 0 `stellar-sdk` references. Its only script is `<script defer type="module" src="/app.js"></script>`.

Result: PASS.

### 4. Release tests do not touch the repository

After `cargo test -p walleterm-tools` (in `make test` and in check 1): `release/` does not exist in the worktree, `git status --short` is empty, and no `/private/tmp/wtr-*` remains.

Result: PASS.

### 5. Active docs grep

Files: `README.md`, `docs/INTERFACE.md`, `AGENTS.md`, and all 18 tracked files under `.agents/`. Command: `git grep` on explicit paths.

| Pattern | Hits |
| --- | --- |
| `walleterm-bridge` | none |
| `sidecar` (case-insensitive) | none |
| `bun scripts/release.ts` | none |
| `bun scripts/install.ts` | none |
| `Go` (whole word) | `README.md:8` "It embeds the demo website and needs no Bun, Node, or Go at runtime." A correct negative statement. |
| | `.agents/skills/walleterm/references/acceptance.md:5` "The signer was written in Go at that date. The Rust binary replaced it later …" |
| `go test` (not `cargo test`) | `.agents/skills/walleterm/references/acceptance.md:9` "Offline Go core: `go test ./...` and `go vet ./...` passed …" |

`acceptance.md` is an "Acceptance snapshot" that "records project evidence dated 2026-09-25", and line 5 says Go was replaced. The test agent treats it as a dated record, not a stale instruction.
Controls: the same `git grep -w Go` finds 7 lines in `fixtures/parity/README.md`, and `sidecar` finds hits in `docs/BUN-MIGRATION.md`. So the patterns work.
Note: the test agent's first grep attempt passed an unquoted zsh variable as the file list. That attempt searched nothing and is discarded. The table above comes from the corrected `git grep` run.

Result: PASS. No stale active references.

### 6. `MEASUREMENTS.md` against independent measurements

**Sizes**

| Item | Document | Measured | Match |
| --- | --- | --- | --- |
| Base `walleterm` | 3,397,074 | 3,397,074 (`baseline/pkg`, same size as the Phase 1 `pkg-p1` build) | yes |
| Base `walleterm-bridge` | 66,338,418 | 66,338,418 (byte-identical to `pkg-p1`) | yes |
| Base gzip -9 | 1,407,131 + 26,521,270 | 1,407,131 + 26,521,270 | yes |
| Base `NOTICES.txt` | 111,760 | 111,760 | yes |
| Rust `walleterm` at `d5c4725` | 3,994,160 | 3,994,160 (`package … 0.0.0-test` from the scratch copy) | yes |
| Rust gzip -9 at `d5c4725` | 1,494,861 | 1,494,849 | 12 bytes smaller; likely the version string |
| Rust `NOTICES.txt` | 274,617 | 274,617 (`d5c4725` and `7f14df3` identical) | yes |
| Rust at HEAD `7f14df3` | n/a | 4,011,520; gzip 1,499,621 | `02b4fcb` added 17,360 bytes |

**Start time and memory.** Harness: `tests/phase-7b-timing.pl`. Perl `fork` and `exec` of `/usr/bin/env PATH=/usr/bin:/bin <binary> …`, from `/private/tmp`, base and Rust interleaved, one warm-up each.
Base: `baseline/pkg/walleterm`. Rust: the HEAD package (the document used `bcbd050`; the startup path is the same). Every run gave the expected exit code (0 or 2).
**Load average was 5.9 to 7.9**, because other agent sessions ran at the same time. The absolute times are therefore higher than the document's.

| Command | Doc base / Rust median | Round 1 base / Rust median | Round 2 base / Rust median | Min base / Rust |
| --- | --- | --- | --- | --- |
| `--version` (60 interleaved) | 7.7 / 8.7 ms | 8.67 / 10.47 ms | 12.10 / 14.09 ms | 7.39 / 8.89 ms |
| `--version` (25) | | 11.62 / 13.81 ms | | 8.17 / 9.05 ms |
| `sign` with `{}` (25) | 9.7 / 9.6 ms | 9.55 / 10.56 ms | 12.91 / 15.79 ms | 7.63 / 8.55 ms |
| `sign-auth` with `{}` (25) | 39.7 / 14.7 ms | 43.19 / 16.84 ms | 42.26 / 16.53 ms | 35.16 / 9.21 ms |

Max RSS, `/usr/bin/time -l`, 25 runs each (median / max):

| Command | Doc base / Rust | Measured base | Measured Rust |
| --- | --- | --- | --- |
| `--version` | 4.9 / 6.1 MB | 4.9 / 5.0 MB | 6.1 / 6.1 MB |
| `sign` `{}` | 5.7 / 6.3 MB | 5.6 / 5.8 MB | 6.3 / 6.3 MB |
| `sign-auth` `{}` | 32.3 / 6.3 MB | 32.0 / 32.0 MB | 6.3 / 6.3 MB |

Differences:

- `--version`: consistent with the document. Rust is about 1.5 to 2 ms slower in medians and about 0.9 ms slower in minimums. The document says 1 ms.
- **`sign` `{}`**: the document shows the two as equal (9.7 / 9.6 ms). Here Rust was slower in both rounds: by 1.0 ms and 2.9 ms in medians, and 0.9 ms in minimums. It matches `--version`. The document's "equal" is not reproduced under this load. The gap is about 1 ms, not zero.
- `sign-auth`: reproduced. Rust is about 2.5 times faster, and its RSS is about 5 times smaller.
- RSS matches the document within 0.3 MB.

**Other numbers**

| Item | Document | Measured | Note |
| --- | --- | --- | --- |
| `Cargo.lock` packages | 135 | 135 | yes |
| Crates linked into the arm64 binary | 107 | 107 with `cargo metadata --filter-platform aarch64-apple-darwin`, normal edges reachable from `walleterm` | yes, with that method |
| | | **100** with `cargo tree -p walleterm -e normal --no-default-features --target aarch64-apple-darwin` | `cargo tree` resolves the features for this build, while metadata unifies them across the workspace. So 107 is an upper bound; 100 are compiled for the release binary. Both are within the budget of 130. |
| `bun.lock` packages | 101 → 71 | 101 (`52a7fc3`) → 71 (HEAD) | yes |
| Go lines | 1,326 | 1,326 | yes, but this includes the 688 lines of 3 Go test files. Non-test Go: 638. The TS host figure excludes tests, so the two rows use different rules. |
| TS host lines | 2,467 | 2,467 (non-test `bridge/*.ts`, `demo/server.ts`, and the package, install, and release scripts) | yes |
| Rust application lines | 7,483 | 7,483 at `d5c4725` and `bcbd050`; **7,634 at HEAD** | the document does not state its commit |
| Rust test lines | 4,347 | 4,347 at `d5c4725` and `bcbd050`; **4,696 at HEAD** | same |
| SDK lines | 2,554 / 2,554 | 2,554 / 2,554 | yes |
| TS test and harness lines | 20,192 → 17,920 | 20,192 → 17,920 (`*.test.ts` plus `tests/`) | yes |
| Rust tests at `8841ddd` | **146** | **144** executed (phase 7a log), and 111 integration + 33 unit test attributes in source | **2 too high** |
| Bun tests at `8841ddd` | 472 | 472 | yes |

Result: most numbers match. Corrections for the document:
1. The Rust test count at `8841ddd` is 144, not 146.
2. The `sign` timing does not show parity. Rust is about 1 ms slower, as for `--version`.
3. Say which commit the Rust line counts use (`d5c4725`/`bcbd050`). HEAD has 7,634 and 4,696 lines.
4. Say that the Go line count includes its tests, or give 638 non-test lines to match the TS host rule.
5. Say how the 107 crates were counted (`cargo metadata`). `cargo tree` for the release build gives 100.

## Not run

- No live 1Password signing, real `cloudflared`, testnet, or real release, tag, sign, or notarization.
- The self-tests did not run inside `make test` because `bun test` failed first. They were run separately and passed.

## Verdict

FAIL. `make test` fails: 55 `tests/browser/site.test.ts` tests fail with `TransactionBuilder is not defined`.
The harness removes `import` lines and injects a global SDK, but `d5c4725` changed `demo/site/app.ts` to import the SDK, and the harness was not updated.
All other checks pass, and the old code fails exactly the 7 expected tests. `MEASUREMENTS.md` needs small corrections (see check 6).

## Correction (added during phase 7c, 2026-09-28)

Check 1 says: "After the old runs, there was no stray `cloudflared`, `wt-sup-*`, or `wtr-*` process or directory." The directory part is wrong.
The zsh `ls -d` check aborted on the first unmatched glob. The old `d5c4725` tunnel run (15:53:13–26) left 4 directories: `/private/tmp/wt-sup-{e2746982,43637abd,647b15af,6fc752da}`.
The failing tests panicked before their final `remove_dir_all`. No process leaked. The test agent removed these 4 directories in phase 7c.
Check 4 ("no `/private/tmp/wtr-*` remains") was rechecked with `find`: 0 `wtr-*` directories. The verdict does not change.
