# Phase 7a test report

- Commit: `8841dddae5539bcdeb4f5dc01192f22320222774` (`Phase 7: remove Go and the TypeScript hosts`).
- Commits since `08768c0`: `2804700` (Phase 3 review fixes), `353a8b2` (Phase 6 completion), `8841ddd` (Phase 7 code removal).
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`. `git checkout --detach 8841ddd`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target` (removed ignored `bin/` and `dist/`).
- Start state: HEAD matched the request. `git status --short` was empty. It was still empty after all runs.
- Date: 2026-09-28, about 14:55 to 15:25 local time. Logs: `rust-everywhere-notes/tests/logs/phase-7a/`
- The test agent's own scripts are outside the worktree: `tests/phase-7a-fuzz.mts` and `tests/phase-7a-production-smoke.mts`.

## Safety review before the runs

- `tests/browser/host.ts` `production: true` sets `WALLETERM_TEST_HOST_PRODUCTION=1`. In that mode, `walleterm-test-host` computes the agent socket path, reads `.env` from its working directory, builds an HTTPS client, and wires `bridge::production`. All of these are lazy closures.
  `GET /api/session` returns a static reply (`src/bridge.rs:991`). The worker task acts only on queued `/v1/requests` jobs.
  The smoke test ran from an empty directory with `OP_VAULT` unset. It called no `/v1` route.
- `tools/tests/fixtures.rs` copies `fixtures/build.sh` with `OZ_COMMIT` set to a local synthetic Git commit, so no fetch occurs. It runs the script with fake `stellar` and `cargo` under `/private/tmp/wtf-*`.
  The test agent did not run the real `fixtures/build.sh` or `fixtures/cap85/build.sh`.
- `bun run test` runs `tests/contracts.ts`, `tests/extended-contracts.ts`, and `tests/cap85.ts`. These are the offline self-tests from earlier phases. The `*-live.ts` files are not in the default suite.

No test used 1Password signing or listing, `cloudflared`, Cloudflare, or testnet.

## Tool versions

| Tool | Version |
| --- | --- |
| rustc / cargo | 1.93.0 (254b59607 2026-01-19) / 1.93.0 (083ac5135 2025-12-15) |
| rustfmt | 1.8.0-stable |
| bun | 1.4.2 |
| tsc (`bunx tsc`) | 7.0.2 |
| stellar | 28.0.0 (300aaf69ab100536678bdb641428b06f06b318ea) |
| cargo-deny | 0.20.2 (pinned binary) |

## Standard checks

| Command | Exit | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | `Checked 52 installs across 72 packages (no changes)` |
| `cargo +1.93.0 build … fixtures/cap71 … --target wasm32v1-none` | 0 | OK |
| `bun run format:check` | 0 | All matched files use Prettier code style |
| `make test` | 0 | 8 steps, no Go step. See below. |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |

- `make test` steps: `bun run build`, `cargo fmt --all --check`, workspace clippy, `cargo test --workspace --locked`, test-host clippy, test-host build, `bun run typecheck`, `bun run test`.
- Rust: lib 27, main 0, `bridge` 45, `cli` 16, `config` 1, `demo` 3, `ledger` 5, `tunnel` 21, `vault` 10, `vectors` 4, `walleterm_tools` unit 6, `tools/tests/fixtures.rs` 3, `tools/tests/install.rs` 3, doc-tests 0. **Total 144 passed**, 0 failed, 0 ignored.
- Bun: **472 pass**, 0 fail, 456 `expect()` calls, 26 files. The three offline self-tests printed `"ok":true` (`contracts.ts` C01–C13, `extended-contracts.ts` E01–E03, `cap85.ts` X01–X07).
- `Cargo.lock`: **135** `[[package]]` entries, unchanged. Budget of 160: within budget.
- `bun.lock`: 0 matches each for `qrcode`, `pngjs`, and `dijkstrajs`. `package.json` has no `qrcode` or `@types/qrcode`.

## Specific checks

### 1. `2804700`: new tests catch the old bugs

At HEAD: `cargo test --locked --test config --test vault --test bridge`: exit 0. `bridge` 45, `config` 1, `vault` 10 passed.

**Mutation setup.** `git archive 08768c0 | tar -x` into the session scratchpad (`…/scratchpad/old-08768c0`), with its own `CARGO_TARGET_DIR`. No worktree was added to the repository.
The test agent copied these files from **`2804700`**, the commit under test: `tests/bridge.rs`, `tests/vault.rs`, `tests/config.rs`, `tests/vectors.rs`, `tests/support/mod.rs` (the only file in `tests/support/`), `fixtures/parity/dotenv.json`, `fixtures/parity/README.md`.
At `2804700`, the README's `vectors.json` hash (`2affc3c9…b28c`) matches `08768c0`'s `vectors.json`. So the vectors hash check stays valid there.
The shim was appended to the old `src/config.rs`:

```rust
pub fn parse_env(text: &str) -> Vec<(String, String)> {
    ["OP_VAULT", "K", "A", "B"].iter().filter_map(|k| env_value(text, k).map(|v| (k.to_string(), v))).collect()
}
```

The old copy ran `bun install --frozen-lockfile --ignore-scripts` (exit 0) and `bun run build` (exit 0) for `dist/routes.tsv`. All four test targets compiled.

**Results on old code** (each with a 240 s alarm; none hit it):

| Test file | Exit | Passed | Failed | Failing tests, first error |
| --- | --- | --- | --- | --- |
| `bridge` | 101 | 41 | **4** | `a_selection_body_that_outlasts_its_session_fails_without_stopping_the_bridge`: panic at `src/bridge.rs:1210:36` `no entry found for key` |
| | | | | `shutdown_before_the_approved_listing_resumes_starts_no_signing`: `tests/bridge.rs:1187` log had `Signed 9af34c02… for https://site-one.example.` |
| | | | | `shutdown_before_the_signature_resumes_withholds_it`: `tests/bridge.rs:1202`, same `Signed …` log |
| | | | | `shutdown_waits_for_signer_discovery_to_finish_its_cleanup`: `tests/bridge.rs:1217` `close returned before cleanup ended` |
| `vault` | 101 | 8 | **2** | `every_bun_dotenv_form_keeps_the_vault_filter`: `tests/vault.rs:336` on `"\u{feff}OP_VAULT=Private\n"` |
| | | | | `a_failure_in_any_batch_position_stops_the_stalled_reads`: `tests/vault.rs:364` `position 1: 121.505358917s` |
| `config` | 101 | 0 | **1** | `dotenv_parsing_matches_bun_for_every_frozen_case`: 210 differences |
| `vectors` | 0 | 4 | 0 | |

The failures match the expected 7 tests exactly. No other test failed.

`outer_cancellation_returns_after_the_children_stop` passed on both: old (1.74 s) and HEAD (1.69 s).

Shim note: the 210 `config` differences include keys that the 4-key shim does not return. The corpus also has keys such as `NOTE`, `export`, `J`, `.`, and `-`.
To isolate real parser differences, the test agent filtered the corpus to the keys `OP_VAULT`, `K`, `A`, and `B` (`logs/phase-7a/dotenv-4keys.json`). The old parser then shows **36 differences**.
The first 15 printed include three `OP_VAULT` cases:

- A BOM before `OP_VAULT=Private`: the vault is lost.
- `export\tOP_VAULT=Private`: the vault is lost.
- `OP_VAULT=` inside a multi-line quoted `NOTE`: the vault becomes empty, which lists every key.

Other printed cases: `K: v`, escaped quotes, `\r` escapes, NBSP trimming, and a bare `\r` line break.

Result: PASS.

### 2. Dotenv parity

- `bun fixtures/parity/dotenv.ts > logs/phase-7a/dotenv-regen.json`: exit 0. SHA-256 `42ab2525d78d06f31cb4b10b048b1abcb29cff78b2848c1e9ace590c33addee8`. This equals the README value and the committed file, byte for byte.
- Differential fuzz. The generator is `tests/phase-7a-fuzz.mts`. It uses splitmix64, a different PRNG from `dotenv.ts`, with new seeds. Each corpus went through Bun 1.4.2 `node:util.parseEnv`, then `WALLETERM_DOTENV_CORPUS=<corpus> cargo test --locked --test config`.

| Corpus | Seed | Inputs | Unique | Non-empty env | With `OP_VAULT` | Exit | Differences |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `chars`: `dotenv.ts` alphabet, length 0–120 | `5eed7a01` | 60,000 | 58,955 | 8,661 | 431 | 0 | **0** |
| `wide`: plus 50 more tokens (NUL, U+0085, U+2028/9, soft hyphen, ZWSP, U+3000, U+1680, U+180E, C0 and DEL controls, emoji, brackets, `${`, `\r\n`, …), length 0–120 | `5eed7a02` | 60,000 | 59,039 | 4,496 | 2,694 | 0 | **0** |
| `lines`: 1–5 structured lines with random prefixes, keys, separators, quotes (some unclosed), trailing text, embedded line breaks, and line ends | `5eed7a03` | 40,000 | 39,989 | 32,847 | 4,338 | 0 | **0** |

Total: **160,000 inputs, 0 differences.**
Control: the test agent changed one expected `OP_VAULT` value in a copy of the `lines` corpus. The test then failed with `1 differences` (exit 101). So the variable is honored and a difference is detected. The copy was deleted afterward.
The corpora are kept in `logs/phase-7a/fuzz-{chars,wide,lines}.json`.

Result: PASS.

### 3. `353a8b2`: tools and fixtures

- `cargo test -p walleterm-tools --locked`: exit 0.
  - Unit tests, 6: `fixtures::tests::times_match_date_to_iso_string`, `fixtures::tests::the_fixture_manifest_reproduces_the_committed_file`, `fixtures::tests::the_cap85_manifest_reproduces_the_committed_file`, and 3 `release::tests`.
  - `tests/fixtures.rs`, 3: `the_fixture_build_accepts_clean_source`, `the_fixture_build_rejects_unstaged_tracked_changes`, `the_fixture_build_rejects_staged_tracked_changes`.
  - `tests/install.rs`, 3.
  - 12 passed, 0 failed. No `/private/tmp/wtf-*` or `/private/tmp/wtt-*` remained.
- `make test-package`: exit 0. `The package check passed.` The new target builds two packages at the same time and requires byte-identical binaries and NOTICES. It runs the binary with `env -i` for `--version`, `sign-auth` `{}` (exit 2), and `demo --port 0` (exit 2). No `walleterm-package-*` remained in `$TMPDIR` or `/tmp`.
- `fixtures/build.sh:35`: `cargo run … -p walleterm-tools -- fixture-manifest "$OUT" "$OZ_COMMIT"`.
  `fixtures/cap85/build.sh:16`: `cargo run … -p walleterm-tools -- cap85-manifest "$HERE"`.
  The old `bun … manifest.ts` lines are gone. `fixtures/manifest.ts`, `fixtures/cap85/manifest.ts`, and `fixtures/build.test.ts` are no longer tracked.

Result: PASS.

### 4. `8841ddd`: removal, vectors, browser, QR, tsc

| Item | Result |
| --- | --- |
| Go files | 0 tracked (`*.go`, `go.mod`, `go.sum`), 0 on disk outside `node_modules` and `target` |
| `bridge/` | absent |
| `demo/server.ts` | absent |
| `scripts/package.ts`, `scripts/install.ts`, `scripts/release.ts` | absent |
| entitlements plist | no tracked `*.plist`, none on disk (`scripts/bridge.entitlements.plist` removed) |

`fixtures/parity/vectors.json`:

- **99 cases**, 99 unique IDs. `08768c0` has 87.
- The **first 87 cases are identical** to `08768c0` (87/87 deep-equal). The top-level fields are also identical.
- 12 cases were added: `tx-soroban-upload`, `-create`, `-invoke`, `-restore`, `-extend`, `-high-fee`, `-source-account-auth`, `-unsigned-account-auth`, `-signed-account-auth`, `-unsigned-contract-auth`, `-signed-contract-auth`, `-delegated-auth`.

README hashes:

| File | SHA-256 matches README | README cases | Actual cases |
| --- | --- | --- | --- |
| `vectors.json` | yes | 99 | 99 |
| `cli.json` | yes | **57** | **58** |
| `sign-auth.json` | yes | 26 | 26 |
| `dotenv.json` | yes | 2106 | 2106 |

The `cli.json` count is a documentation error that is older than this phase. The file has had 58 cases, and the README has said 57, since `caf7256`.

`bun test tests/browser`: exit 0. **250 pass**, 0 fail, 348 `expect()` calls, **14 test files**. The folder has 18 files: the 14 tests plus `fixture.ts`, `host.ts`, `support.ts`, and `pairing-qr.txt`.
Per file: `activity` 9, `auth-lifecycle` 8, `authorization` 7, `code-view` 5, `connect` 44, `demo` 1, `host-lifecycle` 18, `kit` 4, `scan` 7, `sdk-artifact` 8, `sdk-discovery` 1, `sdk` 7, `sep43` 12, `site` 119.
No `walleterm-test-host` process remained.

`cargo test --locked --lib qr`: exit 0, 2 passed. `qr::tests::the_browser_scanner_fixture_is_the_terminal_code` compares `tests/browser/pairing-qr.txt` byte for byte with the terminal renderer output for a fixed pairing.
`WALLETERM_WRITE_QR_FIXTURE` was unset, and `git status` stayed clean. `tests/browser/scan.test.ts` decodes the same file.

`bunx tsc --noEmit`: exit 0, no output.

Result: PASS.

### 5. Production test host smoke test

`cargo build --locked --features test-host --bin walleterm-test-host`: exit 0.
The script `tests/phase-7a-production-smoke.mts` ran from an empty directory with `OP_VAULT` unset. Exit 0. Output is in `logs/phase-7a/production-smoke.json`:

- `createHost({ production: true })` became ready on `http://127.0.0.1:53124`, pid 83306.
- Pairing: `walleterm` 3, `url` equal to the origin, an 8-digit code equal to `host.code()`. The report masks the code.
- `GET /api/session`: **200**, body `{"protocol":3,"service":"walleterm"}`.
- `lsof -U` on the host: only stdio pipes and runtime-internal socket pairs. No path to `agent.sock` or 1Password (`agent_socket_open: false`).
  `lsof -i`: only the loopback listener and the test connection.
- Host log lines: none.
- After `host.close()`, `pgrep` found no host process.

The script did not call any `/v1` route. Nothing listed signers, signed, or reached the ledger.

Result: PASS.

### 6. `make test-kit`

Exit 0. `bun install --cwd fixtures/kit`: `Checked 446 installs across 397 packages (no changes)`.

```json
{"kit":"2.7.0","ok":true,"results":{"public_default":"rejected with -3 before pairing","fetch_address":"paired through getAddress","sign_transaction":"verified","sign_auth_entry":"verified","sign_message":"rejected with -3","switch":"Kit address followed onChange","wallet_disconnect":"Kit address cleared, no dialog","expiry_401":"signing returned -3, Kit address cleared, no dialog","other_wallet":"guard ignored Walleterm events while another Kit wallet was selected","disconnect":"bridge session revoked"}}
```

No `walleterm-test-host` process remained.

Result: PASS.

## Observations for review

These are not failures of the requested checks.

1. User docs still describe the removed sidecar:
   - `README.md:24`: `walleterm-bridge` runs `sign-auth`, `tunnel`, and `demo`.
   - `docs/INTERFACE.md:37` and `:184`: the installed `walleterm-bridge` binary or sidecar.
   - `.agents/skills/walleterm-site-bridge/references/service.md:11`: the installed `walleterm-bridge` binary.
   - `README.md:209`: "entitlements of each binary". The release now has one binary.
   - `docs/SKILLS-AUDIT.md:102` lists `bridge/transaction.ts` and `bridge/server.ts`.
2. `fixtures/parity/README.md` gives 57 `cli.json` cases. The file has 58.
3. Cleanup is complete. No `/private/tmp/wtf-*`, `wtt-*`, `wt-sup-*`, `wt-rs-*`, or `walleterm-package-*` directory and no test-host process remained.

## Not run

- The real `fixtures/build.sh` and `fixtures/cap85/build.sh` (they fetch and compile contracts).
- `/v1/signers` or any listing or signing route on the production host. No live 1Password, `cloudflared`, or testnet.

## Verdict

PASS. All standard and Phase 7a checks pass at `8841ddd`. The old code fails exactly the 7 expected tests. 160,000 fuzz inputs match Bun with 0 differences. Some docs still name the removed `walleterm-bridge` sidecar.

## Correction (added during phase 7c, 2026-09-28)

The leftover checks in this report used `ls -d <glob1> <glob2> …` in zsh. When the first glob had no match, zsh aborted the whole command, so the later globs were not checked.
In phase 7c, `find` showed `/private/tmp/wt-rs-67239-2` (created 14:04, outside this test agent's runs). It existed during this report.
Observation 3 ("No … `wt-rs-*` … directory … remained") is therefore wrong for `wt-rs-*`. The other results and the verdict do not change.
