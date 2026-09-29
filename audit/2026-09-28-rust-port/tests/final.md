# Final test matrix

- Commit: `1bda24ab8f6468d999db00be271f2e249133b434` (`Name the Rust ink_stroke function in the illustration standard`).
- Commits since `381bf9f` (phase 7c): `6cd9f6a` (Phase 8: art generator in `tools/src/art.rs`, `make art`), `96fb0b7` (tunnel test scratch cleanup on failure), `1bda24a` (doc identifier).
- Worktree: `~/Desktop/walleterm-v2-worktrees/rust-everywhere-test`. `git checkout --detach 1bda24a`, then `git clean -fdx -e node_modules -e target -e fixtures/cap71/target -e fixtures/kit/node_modules` (removed an ignored `dist/`).
- Start state: HEAD matched the request. `git status --short` was empty before and after all runs.
- Date: 2026-09-28, about 16:25 to 16:45 local time. Logs: `rust-everywhere-notes/tests/logs/final/`
- Tools: rustc 1.93.0, cargo 1.93.0, bun 1.4.2, tsc 7.0.2, cargo-deny 0.20.2 (pinned binary).

## Safety

- `tools/src/art.rs` only computes SVG text and writes `design/art/out/` and `site/art/` under the tools root. It starts no process and uses no network.
  The test agent ran `make art` only in a scratch clone, never in the test worktree.
- The kit checks, the live-page check, and the tunnel tests use mock keys, mock dependencies, and mock `cloudflared` (reviewed in 7c).
- No test used 1Password, the real `cloudflared`, Cloudflare, testnet, or a real release.
- `~/.local/bin/walleterm` **changed before this run**: mtime `1790627138`, inode `290060150`. In 7c it was `1790620203`, inode `289060419`. The test agent did not change it. It was the same before and after this run.

## 1. Full matrix

| Command | Exit | Result |
| --- | --- | --- |
| `bun install --frozen-lockfile --ignore-scripts` | 0 | `Checked 52 installs across 72 packages (no changes)` |
| `bun install --cwd fixtures/kit --frozen-lockfile --ignore-scripts` | 0 | `Checked 446 installs across 397 packages (no changes)` |
| CAP-71 fixture build | 0 | OK |
| `bun run format:check` | 0 | All matched files use Prettier code style |
| `make test` | 0 | **Rust 158 passed**, 0 failed, 0 ignored. **Bun 509 pass**, 0 fail, 542 `expect()` calls, 28 files. Self-tests `"ok":true`. |
| `make test-package` | 0 | `The package check passed.` |
| `make test-kit` | 0 | `check.mts` `"ok": true` (Kit 2.7.0, 10 results). `tabs.mts`: 7 of 7 `"agree": true`, 0 false, final `{"ok":true}` |
| `bun tests/contracts.ts` | 0 | `ok: true`, rows C01–C13 |
| `bun tests/extended-contracts.ts` | 0 | `ok: true`, rows E01–E03 |
| `bun tests/cap85.ts` | 0 | `ok: true`, rows X01–X07 |
| `bun fixtures/kit/live/check.mts` | 0 | **`ok: true`, `signatures: 0`** |
| `cargo-deny --workspace --locked check advisories licenses sources` | 0 | `advisories ok, licenses ok, sources ok` |
| `Cargo.lock` | | 135 `[[package]]` entries (budget 160) |

Rust per binary: lib 28, main 0, `bridge` 46, `cli` 16, `config` 1, `demo` 3, `ledger` 5, `tunnel` 28, `vault` 10, `vectors` 4, tools unit 8 (7c: 6, plus the art tests), `fixtures` 3, `install` 3, `release` 3, doc-tests 0. Total 158.

Result: PASS.

## 2. Phase 8 byte equality

- Old: `git archive 381bf9f` into the scratchpad.
- New: `git clone --shared --no-checkout <common .git>` into the scratchpad, then `git checkout --detach 1bda24a`. The clone reads the main repository's objects and writes nothing to it.
- `design/art/out/` is ignored (`.gitignore:57`) and does not exist in a fresh checkout. `site/art/` has 8 tracked SVGs.
- In both trees, the test agent deleted every `site/art/*.svg` and `design/art/out/` first. So each generator had to create all 18 files.

| Step | Exit | Files |
| --- | --- | --- |
| `bun design/art/build.ts` (381bf9f) | 0 | 10 in `design/art/out/`, 8 in `site/art/` |
| `make art` (1bda24a, `cargo run … walleterm-tools -- art`) | 0 | 10 in `design/art/out/`, 8 in `site/art/` |

`cmp` of all 18 files: **18 identical, 0 different**. No file exists on only one side. The list with sizes and hashes is in `logs/final/art-cmp.txt`:

- `design/art/out/`: `01-moon-green-field`, `04-request-line`, `08-bridge-walk`, `10-keyhole`, `11-horizon-moon`, `15-moss-circle`, `16-hourglass`, `favicon`, `night-horizon`, `night-wallet`.
- `site/art/`: `bridge-narrow`, `bridge`, `favicon`, `hero`, `horizon`, `keyhole`, `night-wallet`, `request`.

`git status --short` in the 1bda24a clone after `make art`: **empty**. All 8 regenerated `site/art` files equal the committed blobs.

Result: PASS.

## 3. Art generator location and docs

- `design/art/` has no tracked files. The directory is absent from the checkout, so there are 0 `.ts` or `.mts` files there.
- `design/ILLUSTRATION.md`: `:19`, `:34` link `tools/src/art.rs`. `:87` "Change the scenes in `tools/src/art.rs`, then run `make art`." `:103` "`make art` writes each scene to `design/art/out/` and each site crop to `site/art/`."
- `.agents/skills/walleterm-illustration/SKILL.md`: `:9` scenes live in `tools/src/art.rs`. `:15` edit `SCENES` in `tools/src/art.rs`. `:17` "Run `make art`."
- `README.md:193`: "Its illustrations come from `tools/src/art.rs` (`make art`)."
- No reference to `design/art/{build,hand,mascot}.ts` or `bun design/art/build` remains outside `audit/` and `evidence/`.

Result: PASS.

## 4. Retained TypeScript

70 tracked `.ts` and `.mts` files outside `audit/` and `evidence/`, 25,360 lines (`logs/final/retained-ts.txt`).

| Directory | Files | Role |
| --- | --- | --- |
| `sdk/` | 9: `authorization`, `connect`, `errors`, `kit`, `preimage`, `scan`, `transaction`, `types`, `walleterm` | **Browser**: the SDK that websites load and the demo bundles |
| `demo/site/` | 5: `activity`, `app`, `code-view`, `contracts`, `syntax` | **Browser**: demo website source, bundled into the binary (`syntax.ts` is a build-only entry) |
| `demo/` | 1: `contracts.test.ts` | **Test** (mock keys, no network) |
| `scripts/` | 3: `build.ts`, `sdk-import.test.ts`, `syntax.test.ts` | **Build** (browser bundle for `build.rs` and packaging) and 2 **tests** |
| `tests/` | 23: 9 `*.test.ts` and 14 harnesses (`cap71`, `cap85`, `classic`, `cli-pipeline`, `contracts`, `extended-contracts`, `simulations`, `submission`, `types`, `live`, `live-utils`, `contract-auth-demo-live`, `openzeppelin-auth-live`, `1password-failure`) | **Test**: offline self-tests and the opt-in live harnesses (`bun run test:live`), which are not in `make test` |
| `tests/browser/` | 19: 16 `*.test.ts` plus `fixture.ts`, `host.ts`, `support.ts` | **Test**: browser SDK and demo tests against `walleterm-test-host` |
| `fixtures/kit/` | 3: `check.mts`, `tabs.mts`, `tab.mts` | **Interoperability**: Stellar Wallets Kit 2.7.0 checks |
| `fixtures/kit/live/` | 4: `check.mts`, `negatives.mts`, `page.mts`, `serve.mts` | **Interoperability**: the SEP-43 live acceptance page, with its offline check. `serve.mts` is a loopback page server for manual acceptance; it starts only under `import.meta.main`. |
| `fixtures/parity/` | 1: `dotenv.ts` | **Test fixture producer** (Bun `parseEnv` corpus) |
| `.agents/skills/walleterm-site-bridge/scripts/` | 2: `classic-attach.ts`, `legacy-freighter.ts` | **Skill helpers** |

Every file fits one of the allowed roles. No file is a signer, bridge, tunnel host, package, install, or release tool.
The one server is `fixtures/kit/live/serve.mts`, a test-page server that is not shipped.

Result: PASS.

## 5. `MEASUREMENTS.md` against the final package

Package: `cargo run --locked -q -p walleterm-tools -- package <scratch> 0.0.0-final` at 1bda24a (the document's version string).

| Item | Document | Measured | Match |
| --- | --- | --- | --- |
| Base bytes | 3,397,074 + 66,338,418 | same (`baseline/pkg`, verified in 7b) | yes |
| Base gzip -9 | 1,407,131 + 26,521,270 | same | yes |
| Base `NOTICES.txt` | 111,760 | same | yes |
| Rust `walleterm` | 4,011,600 | **4,011,600** | yes |
| Rust gzip -9 | 1,501,047 | **1,501,047** | yes |
| Rust `NOTICES.txt` | 274,617 | 274,617 (byte-identical to 7c) | yes |
| Forbidden strings | | `walleterm-bridge` 0, `WALLETERM_TEST_HOST_ONLY_V1` 0, `stellar-sdk.js` 0 | ok |
| `Cargo.lock` packages | 135 | 135 | yes |
| Crates compiled (`cargo tree -e normal --no-default-features`, arm64) | 100 | 100 | yes |
| Crates reachable in `cargo metadata` | 107 | 107 | yes |
| `bun.lock` packages | 101 → 71 | 101 → 71 | yes |
| Go source / tests | 638 / 688 | 638 / 688 | yes |
| TS host source / tests | 2,467 / 8,372 | 2,467 / 8,372 | yes |
| TS art generator | 714 | 714 (`design/art/*.ts` at base and 381bf9f) | yes |
| Rust application (`src/`, `build.rs`, `build/`) | 6,651 | 6,651 | yes |
| Rust tools (`tools/src/`) | 1,814 | 1,814 | yes |
| Rust tests | 4,846 | 4,846 | yes |
| SDK | 2,554 → 2,667 | 2,554 → 2,667 | yes |
| TS tests and harnesses | 20,192 → 18,852 | 20,192 → 18,852 | yes |
| Tests at 8841ddd | 144 Rust / 472 Bun | 144 / 472 (phase 7a) | yes |
| Tests at 1bda24a | 158 Rust / 509 Bun | 158 / 509 | yes |

Timing: 60 interleaved runs per binary with `tests/phase-7b-timing.pl` (`env PATH=/usr/bin:/bin`, from `/private/tmp`). The load average was **8.6 to 8.7**, like the document's 8.8. All runs gave the expected exit code.

| Command | Doc base median / min | Measured base median / min | Doc Rust median / min | Measured Rust median / min |
| --- | --- | --- | --- | --- |
| `--version` | 15.2 / 9.8 ms | 10.93 / 6.99 ms | 15.8 / 10.4 ms | 13.23 / 7.95 ms |
| `sign` `{}` | 15.0 / 9.1 ms | 10.67 / 7.35 ms | 15.6 / 9.6 ms | 12.44 / 8.40 ms |
| `sign-auth` `{}` | 49.1 / 38.3 ms | 42.78 / 34.42 ms | 19.1 / 11.2 ms | 17.03 / 8.81 ms |

Max RSS, 25 runs each with `/usr/bin/time -l` (median):

| Command | Doc base / Rust | Measured base / Rust |
| --- | --- | --- |
| `--version` | 4.8 / 6.1 MB | 5.0 / 6.1 MB |
| `sign` | 5.5 / 6.3 MB | 5.7 / 6.3 MB |
| `sign-auth` | 31.8 / 6.2 MB | 32.0 / 6.3 MB |

- The absolute times differ from the document, as expected under load. The pattern matches.
- Go is faster by 0.96 ms (`--version`) and 1.05 ms (`sign`) at the minimum, and by 2.3 ms and 1.8 ms in the median. The document says "about 0.5 to 1 ms". The minimums agree; the medians show a slightly larger gap under this load.
- `sign-auth` is 2.5 times faster in the median (the document says 2.6), and 3.9 times faster at the minimum.
- RSS is within 0.2 MB. `sign-auth` RSS is about 5 times smaller.

Result: PASS. Every size, dependency count, line count, and test total matches exactly. Timing matches in pattern.

## 6. Leftovers

Checked with `find` after all runs:

| Pattern | `/private/tmp` | `$TMPDIR` |
| --- | --- | --- |
| `wt-sup-*`, `wtt-*`, `wtf-*`, `wtr-*`, `wt-rs-*` | 0 | 0 |
| `walleterm-package-*`, `walleterm-site-bridge-*` | 0 | 0 |
| `walleterm-tunnel-*` | 0 | 8 (not from the test agent; see below) |

- Processes: no `walleterm-test-host`, `cloudflared`, `tunnel-child`, or mock tunnel process.
- `$TMPDIR/walleterm-tunnel-*` held **10** directories before this run. These are the supervisor's private config directories (`src/tunnel.rs:206`).
  **0** new ones appeared during this run.
- Two of them (15:53:14 and 15:53:15) came from the test agent's 7b old-code tunnel run. Their `child.json` has `parent_pid` 27565, the same test process as the 7b `wt-sup-647b15af` record. The test agent removed both.
- The other 8 were created outside the test agent's run windows: 13:15 and 13:17 (before this session, with legacy short names), 14:22, 15:30, and 15:40. They were left in place for their owner.
- `96fb0b7` adds a `Cleanup` `Drop` guard to the test scratch directory. `src/tunnel.rs:218` removes the supervisor directory on drop. The remaining directories date from runs where a process died before the drop ran.

Result: PASS. None of the test agent's runs left a leftover.

## Not run

- No live 1Password signing, real `cloudflared`, Cloudflare, testnet, or real release.
- `make art` was not run in the test worktree. It ran in a scratch clone, and `git status` there was clean.

## Verdict

PASS. The full matrix is green at `1bda24a`: 158 Rust tests, 509 Bun tests, the package, kit, live-page, contract self-tests, and cargo-deny.
All 18 art files match the TS generator byte for byte. The retained TS is limited to browser, build, test, interoperability, and skill-helper files.
`MEASUREMENTS.md` matches on every size, count, and total. No leftovers remain from the test agent's runs.
