# Phase 6 test report

- Commit: `08768c07666cdd02702c094ab8c6b03b674fe80b` (`Phase 6: Rust maintainer tools and one Bun attach helper`), parent `0efec43`.
- Diff from `0efec43`: 22 files, 1129 insertions, 163 deletions. New: the `tools/` package (`walleterm-tools`), `classic-attach.ts`. Removed: `classic-attach.py`, `verify-signature.ts`, `design/tools/__pycache__/artcheck.cpython-313.pyc`.
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`. `git checkout --detach 08768c0`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target` (removed ignored `bin/` and `dist/`).
- Start state: HEAD matched the request. `git status --short` was empty. It was still empty after all runs.
- Date: 2026-09-28, about 14:38 to 14:50 local time. Logs: `rust-everywhere-notes/tests/logs/phase-6/`

## Safety review and baselines

The test agent read `tools/src/{main,install,package,release}.rs` and `tools/tests/install.rs` before any run.

- `install <prefix>` writes only under the prefix it receives. Every `make install` run passed an explicit `PREFIX` under `$TMPDIR`.
- `release` validates `major.minor.patch` and its flags before any `git`, `gh`, `security`, `codesign`, or `notarytool` call (`tools/src/release.rs:54-59`).
- `tools/tests/install.rs` runs the real `walleterm-tools install` against fake `bun` and `cargo` scripts on `PATH`, with prefixes under `/private/tmp/wtt-<name>-<pid>/`.
- `tests/site-bridge.test.ts` uses `Keypair.random()` mock keys. It runs `classic-attach.ts` and `legacy-freighter.ts` with Bun. The attach script calls only offline Stellar CLI commands: `tx decode`, `tx hash`, `tx encode`, `strkey decode`. (The test agent read this part after the run. It confirmed that no signer or network call occurs.)

Baselines before the runs (`baseline.txt`): no `/private/tmp/wtt-*`, no `walleterm-package-*` in `/tmp` or `$TMPDIR`.
`~/.local/bin/walleterm` was a symlink to `…/.local/share/walleterm/releases/2872b1b6f7fc6c81bda11061/bin/walleterm`, with lstat mtime `1790620203`, inode `289060419`. It was dated 14:30, before this test session. The test agent only ran `ls` and `stat` on it.

No test used 1Password, `cloudflared`, Cloudflare, testnet, `codesign`, `notarytool`, `gh release`, or `git tag`.

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
| `make test` | 0 | All 10 steps ran. See below. |
| `go test -count=1 ./...` | 0 | `ok walleterm 0.314s` (uncached; `make test` used the Go cache) |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |

- Rust in `make test`: lib 26, main 0, `bridge` 41, `cli` 16, `demo` 3, `ledger` 5, `tunnel` 21, `vault` 7, `vectors` 4, `walleterm_tools` unit 3, `tools/tests/install.rs` 3, doc-tests 0. Total 129 passed, 0 failed, 0 ignored.
  `make test` also covers the fmt and both clippy steps, and all passed.
- Bun in `make test`: 586 pass, 0 fail, 726 `expect()` calls, 40 files.
- `Cargo.lock`: **135** `[[package]]` entries (134 plus `walleterm-tools`). Budget of 160: within budget.

## Phase 6 checks

### 1. `cargo test -p walleterm-tools --locked`

Exit 0.

- Unit tests (`src/main.rs`): **3 passed**: `release::tests::release_versions_are_plain_semver`, `release::tests::the_cask_changes_only_its_version_and_checksum`, `release::tests::ci_pins_are_read_from_the_workflow`.
- `tests/install.rs`: **3 passed**: `bad_arguments_print_the_usage`, `install_refuses_to_replace_a_regular_alias_file`, `install_switches_links_and_keeps_the_old_version_after_a_failed_build`.

After this run and after `make test`, no `/private/tmp/wtt-*` existed.
These tests clear the environment, so `std::env::temp_dir()` is `/tmp` for their package scratch. No `/private/tmp/walleterm-package-*` remained either.

Result: PASS.

### 2. `make test-package` and NOTICES

`make test-package`: exit 0. Last line: `The package check passed.` (release build 17.17 s, `Built walleterm 0.0.0-test in …/T/tmp.Hv9sKB2AXl.`).

Separate run: `cargo run --locked -q -p walleterm-tools -- package <mktemp -d> 0.0.0-t6`: exit 0.

| Item | Value |
| --- | --- |
| `walleterm` | Mach-O 64-bit executable arm64, **4801808 bytes**; `gzip -9`: 1670558 bytes |
| `walleterm --version` | `walleterm 0.0.0-t6` |
| `NOTICES.txt` | **953110 bytes**, 18343 lines |
| Sections (`^== `) | **153**: 1 vendored demo syntax highlighter + 152 packages |

A copy is in `logs/phase-6/NOTICES-t6.txt`.

| Name | Required | Found |
| --- | --- | --- |
| `ed25519-dalek` | present | `== ed25519-dalek 2.2.0 (BSD-3-Clause) ==` |
| `stellar-xdr` | present | `== stellar-xdr 28.0.0 (Apache-2.0) ==` |
| `hyper` | present | `== hyper 1.11.1 (MIT) ==` |
| `@stellar/stellar-sdk` | present | `== @stellar/stellar-sdk 17.1.0 (Apache-2.0) ==` |
| `jsqr` | present | `== jsqr 1.4.0 (Apache-2.0) ==` |
| `@twinkleplop/core` | present | `== @twinkleplop/core 0.2.2 (MIT) ==` |
| `tokio-test` | absent | absent (0 matches) |
| `walleterm-tools` | absent | absent (0 matches) |
| `qrcode` | absent | **present: `== qrcode 0.14.1 (MIT OR Apache-2.0) ==`**. See below. |

**The `qrcode` expectation is not met as written. The test agent judges the expectation wrong, not the code.**

- `qrcode 0.14.1` is the **Rust crate**. `Cargo.toml:28` lists it in `[dependencies]`. `src/qr.rs:3` uses it (`use qrcode::{Color, QrCode};`). `cargo tree -e normal --no-default-features -i qrcode` shows `qrcode v0.14.1 └── walleterm`.
  So the release binary contains it, and its license notice is required.
- The **npm** package `qrcode 1.5.4` moved from `dependencies` to `devDependencies` in this commit. It is absent from NOTICES. `qrcode` occurs only once in the file, in the crate section header.
- A precise check is "no npm `qrcode 1.5.4` section". That check passes.

After both runs, no `walleterm-package-*` remained in `$TMPDIR` or `/tmp`. The test agent removed its own `mktemp` output directory.

Note: JS notices cover the full transitive `dependencies` tree of `package.json` `dependencies`, plus `devDependencies` named `@twinkleplop/*` (`tools/src/notices.rs:95-139`). Some listed packages, such as `axios`, `follow-redirects`, and `@types/json-schema`, may not be in the minified bundle. This superset is safe for license compliance.

Result: PASS for the intent. The literal `qrcode` check fails because the Rust crate is present, and that crate is required.

### 3. `make build`

Exit 0. `Built walleterm 08768c0 in bin.`, then `ln -sf walleterm bin/stellar-walleterm`.

| Entry in `bin/` | Type | Size |
| --- | --- | --- |
| `NOTICES.txt` | file | 953110 bytes (byte-identical to the `0.0.0-t6` run) |
| `stellar-walleterm` | symlink, `readlink` = `walleterm` | |
| `walleterm` | Mach-O arm64 | 4801808 bytes, SHA-256 `0ed4fbf225367cd5f08f6335dfaeff024d9b685afe3b299d7bd1771e2571565f` |

`ls -A bin`: exactly these 3 entries.

| Command | Exit | Output |
| --- | --- | --- |
| `bin/walleterm --version` | 0 | `walleterm 08768c0` |
| `bin/stellar-walleterm --version` | 0 | `walleterm 08768c0` |

The version comes from `git describe --tags --always --dirty` (`08768c0`). `bin/walleterm` has 0 matches for `walleterm-bridge` and 0 for `WALLETERM_TEST_HOST_ONLY_V1`.

Result: PASS.

### 4. `make install` into a temp prefix

`PREFIX=/var/folders/j9/…/T/tmp.EX15GJnF7R/prefix`, which `mktemp -d` created fresh. The default `PREFIX` was never used.

| Run | Exit | Output | Release directories |
| --- | --- | --- | --- |
| `make install PREFIX=<tmp>` (1) | 0 | `Installed walleterm in <tmp>/bin.` | `1048de441e9996f217fd8051` |
| `make install PREFIX=<tmp>` (2) | 0 | `Installed walleterm in <tmp>/bin.` | `1048de441e9996f217fd8051` (same) |

- Release directory count: **1**. `ls -A` shows no hidden `.install-*` stage directory. The release has `bin/walleterm` and `bin/NOTICES.txt`.
- `<tmp>/bin/walleterm` → `<tmp>/share/walleterm/releases/1048de441e9996f217fd8051/bin/walleterm` (absolute).
- `<tmp>/bin/stellar-walleterm` → `walleterm` (relative).
- `--version` on both links: `walleterm 08768c0`, exit 0.
- The installed binary is byte-identical to `bin/walleterm` from `make build`. The build is reproducible across separate target directories.

Broken build:

1. The mode of `scripts/build.ts` in the test worktree was 644. The test agent set it to 000.
2. `make install PREFIX=<tmp>`: **exit 2** (make), tool exit 1. Output: `error: EACCES reading "…/rust-everywhere-test/scripts/build.ts"`, then **`The build failed. The installed version did not change.`**
3. The test agent restored mode 644. The file SHA-256 was unchanged, and `git status --short` was empty.
4. After the failure: the `walleterm` and `stellar-walleterm` link targets were unchanged, the releases were still only `1048de441e9996f217fd8051` (no stage directory), and `--version` still printed `walleterm 08768c0`.

The test agent then removed the temp prefix.
`~/.local/bin/walleterm` after all runs had the same target, mtime `1790620203`, and inode `289060419`. It was untouched.

Result: PASS.

### 5. `make release` without a valid version

| Command | Exit | stderr |
| --- | --- | --- |
| `make release` | 2 | `Use make release VERSION=<major.minor.patch> [PUBLISH=1 \| NOTARIZE=0].` |
| `make release VERSION=1.2` | 2 | `Use walleterm-tools release <major.minor.patch> [--publish \| --no-notarize].` |

The first fails in the Makefile guard. The second runs `cargo run … release "1.2"`, and `valid_release_version` rejects it before any external call.
The git tag count was 0 before and after. The test agent ran no real release.

Result: PASS.

### 6. `site-bridge` test and Python removal

`bun test tests/site-bridge.test.ts`: exit 0. **1 pass**, 0 fail. Test: `a reviewed V1 XDR crosses the legacy page bridge once`.
It runs `.agents/skills/walleterm-site-bridge/scripts/classic-attach.ts` for the good path and the refusals: wrong key, forged signature, a second attach, an unknown flag, and a different signer. It uses mock keys only.
No `walleterm-site-bridge-*` temp directory remained.

- `git grep -nIiE "python|\.py\b" -- .agents`: no matches (exit 1). No `.py` file or `__pycache__` is under `.agents/`.
- `git ls-files | grep -E '__pycache__|\.pyc$'`: 0 tracked files. `.gitignore:27` has `__pycache__/`.
- Outside scope: `design/tools/artcheck.py` is still tracked, and `audit/2026-09-26/` has archived Python references. Neither is in `.agents/`.

Result: PASS.

### 7. Old TS scripts no longer referenced

`git grep -nE "package\.ts|install\.ts|release\.ts" -- Makefile .github package.json`: no matches (exit 1).
The files still exist for Phase 7 to delete: `scripts/package.ts`, `scripts/install.ts`, `scripts/release.ts`, and the tests `scripts/package.test.ts` and `scripts/install.test.ts`. `bun run test` still runs those tests.

Result: PASS.

## Not run

- No live 1Password signing, `cloudflared`, testnet, `codesign`, `notarytool`, `gh release`, `git tag`, or real release.
- No `make install` with the default `PREFIX`.

## Verdict

PASS, with one disputed expectation. All checks pass except the literal "NOTICES does not name `qrcode`". The test agent judges that expectation wrong. The name is the Rust crate `qrcode 0.14.1`, which ships in the binary and needs its notice. The npm `qrcode` is correctly absent.
