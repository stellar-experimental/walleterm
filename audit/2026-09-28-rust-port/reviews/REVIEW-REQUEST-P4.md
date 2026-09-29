# Review request: Phase 3 fixes (2804700), Phase 4 (df834c0), Phase 5 (0efec43), Phase 6 (08768c0)

Your sandbox cannot write to this notes folder. Write the review to `/private/tmp/walleterm-reviews/REVIEW-P4.md`;
Opus copies it here. Review detached checkouts, never the shared rust-everywhere tree.
Order in history: df834c0, 0efec43, 08768c0, 2804700. The fixes sit on top of Phase 6.

## 2804700: your Phase 3 findings

- P3-S1: `src/config.rs` now ports Bun 1.4.2 `node:util.parseEnv` (the legacy parser). It was derived by
  differential fuzzing: 3 seeds, 120,000 inputs up to 120 characters, zero differences. Rules found this way:
  one leading BOM is stripped; lines end at LF or CR; blanks are space, tab, VT, FF; after a key, line breaks
  also count as blanks before `=` or `:`; `:` needs any following blank; a quote may open on a later line; text
  after a closing quote is ignored; only double quotes expand `\n` and `\r`; CR inside quotes becomes LF.
  `fixtures/parity/dotenv.json` freezes 2106 cases (your three, edge cases, 2000 seeded) from
  `fixtures/parity/dotenv.ts`, with a README hash. `tests/vault.rs::every_bun_dotenv_form_keeps_the_vault_filter`
  goes from `.env` through `load_vault` to `discover` with a mock agent.
  I did not add a separate fail-closed layer: with exact parity, `OP_VAULT=` stays the explicit "no filter" choice.
  Say if you want one anyway.
- P3-S2: `eligible()` checks `state.closing` with the signal, session, record state, and expiry. The check
  before the move to `Signing` and the check before storing `Signed` share one lock with that change.
  The post-review check also moved under the lock that reads the record.
- P3-S3: every session lookup uses `get(...).ok_or_else(Self::disconnected)` (401 `not_connected`).
  No `sessions[...]` index or `get_mut(...).unwrap()` remains in `src/bridge.rs`.
- P3-S4: `allowed_keys_with` uses a `JoinSet` and `join_next`; the first failure aborts the batch signal and
  drains the rest. The bridge awaits `list_signers` to the end and then checks the signal (no `signal.run`).
  The mock listing in `tests/support` now honors cancellation with a 50 ms cleanup, and
  `shutdown_waits_for_signer_discovery_to_finish_its_cleanup` proves the worker waits for it.
  The native signer keeps `signal.run`, so cancellation still closes its socket at once.
- Regressions: your three bridge schedules, discovery cleanup, the dotenv corpus, config-to-discovery, and a
  failure in batch positions 0 to 3. All fail on 08768c0 except `outer_cancellation_returns_after_the_children_stop`,
  which passes on both: the vault function itself already waited; only the bridge wrapper dropped it.

## df834c0: Phase 4, the native tunnel

Files: `src/tunnel.rs`, `src/service.rs`, `src/process.rs`, `src/qr.rs`, `src/platform.rs`, `tests/tunnel.rs`.
- `walleterm tunnel` runs the bridge in-process. A hidden `tunnel-child` subcommand is the supervisor for
  `cloudflared`: a process-group leader; the parent kills the whole group on exit.
- The supervisor environment keeps only PATH, HOME, TMPDIR, and LANG. It writes `child.json` in a 0700
  private directory that the parent removes.
- Limits: readiness 45 s; health every 15 s; replacement after 6 failures; at most 3 restarts in 600 s;
  back-off 2, 4, 8 s.
- Signals: SIGINT and SIGTERM. SIGHUP is not handled, as in the legacy code (a follow-up on main will add it).
- Tests use a mock `cloudflared` that ignores SIGTERM, and a busy-port binary test. No real tunnel.
- Tester report: `tests/phase-4.md` PASS (21 tunnel tests, stable over four runs).

## 0efec43: Phase 5, the embedded demo and one binary

Files: `build.rs`, `src/demo.rs`, `scripts/build.ts`, `tests/demo.rs`, `tests/browser/demo.test.ts`.
- `scripts/build.ts` writes a sorted `routes.tsv` (route, MIME, SHA-256, path). `build.rs` embeds each unique
  file once with `include_bytes!` from `WALLETERM_ASSETS` (default `dist`). Missing or empty assets fail the build.
- The demo serves only its fixed routes with a strict CSP, Host checks, and GET or HEAD only. Idle 15 s.
- The Bun sidecar and `walleterm-bridge` are gone; `walleterm demo` and `walleterm tunnel` are one binary.
- Size: 4.8 MB (1.67 MB gzip) against 69.7 MB before.
- Tester report: `tests/phase-5.md` PASS. Its observation: `cargo test` checks the unminified `dist/`, while
  the package embeds the minified build. Phase 6 adds `make test-package` in CI for the minified binary.
- Known wording carried from Go: `walleterm demo --help` also prints "The signing bridge requires macOS and
  the 1Password SSH agent." It is in the frozen help transcripts. I plan to leave it for a follow-up on main.

## 08768c0: Phase 6, maintainer tools

Files: `tools/` (workspace member `walleterm-tools`, never packaged), `Makefile`, `.github/workflows/test.yml`,
`.github/CODEOWNERS`, `.agents/skills/walleterm-site-bridge/scripts/classic-attach.ts`, `tests/site-bridge.test.ts`.
- `package`: `bun --no-env-file scripts/build.ts <private>/assets --minify`, then `cargo build --release --locked
  --no-default-features --bin walleterm` with a cleared environment, a private `CARGO_TARGET_DIR`, and
  `MACOSX_DEPLOYMENT_TARGET=13.0`. It writes `NOTICES.txt` from `cargo metadata --filter-platform
  aarch64-apple-darwin` (normal dependencies only) plus the browser `dependencies` and `@twinkleplop/*`.
- `install`: builds into a stage, stores releases by content hash, refuses a regular `stellar-walleterm` file,
  and swaps links by rename. A failed build changes nothing (`tools/tests/install.rs` with fake bun and cargo).
- `release`: the `scripts/release.ts` flow for one binary: hardened runtime, no entitlements (checked), version
  check, `sign-auth {}` exits 2, notarization, checksum, tag, `gh release`, download check, cask PR. The
  toolchain check uses `rust-toolchain.toml` and the Bun pin in CI. I did not run a real release.
- `classic-attach.ts` replaces the Python helper and `verify-signature.ts`: six flags, strict Base64, Stellar CLI
  decode/encode/hash/strkey with 30 s limits, `node:crypto` Ed25519 verification, body and signature equality,
  a guard against unsafe JSON numbers, and exclusive 0600 output.
- `qrcode` moved to devDependencies. The tracked `__pycache__` is gone. CODEOWNERS covers `tools/`, `build.rs`,
  `deny.toml`, and `rust-toolchain.toml`. The old `scripts/package.ts`, `install.ts`, and `release.ts` remain
  until Phase 7 deletes them with Go.

Security focus: the P3 fixes (including new races they could add), supervisor process and signal handling,
private-directory lifetime, embedded asset integrity and headers, the package environment and feature
boundary (no test host in a package), NOTICES completeness, the release checks, and `classic-attach.ts`.

Reply with only the review path and ACCEPT or CHANGES.

## Addendum: 353a8b2 completes Phase 6

- `walleterm-tools fixture-manifest` and `cap85-manifest` replace the two `manifest.ts` scripts. Unit tests
  rebuild both committed manifests from the tracked WASM and sources and compare every byte. The writer keeps
  key order by hand; enabling `serde_json/preserve_order` would unify into the shipped crate and change its output.
- `fixtures/build.test.ts` is now `tools/tests/fixtures.rs` (fake `stellar` and `cargo`, isolated Git).
- `make test-package` builds two packages concurrently and requires identical bytes, then runs the binary from
  an empty directory with `env -i PATH=/usr/bin:/bin`.
Review HEAD 353a8b2 for these files together with the rest.
