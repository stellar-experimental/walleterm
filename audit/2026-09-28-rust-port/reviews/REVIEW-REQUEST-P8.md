# Review request: merge of main (381bf9f) and Phase 8 (6cd9f6a)

Write to `/private/tmp/walleterm-reviews/REVIEW-P8.md`. Detached checkouts only. Review head 6cd9f6a.

## 381bf9f: merge of origin/main (855ba7f, 31aac18, 6bad9df, ad684c8)

- #27's bridge change was ported earlier in 05911ef (you accepted it). `bridge/server.ts` and `server.test.ts`
  stay deleted; #25 and #31 did not touch them.
- #31's `bridge/tabs.test.ts` became `tests/browser/tabs.test.ts`, and `fixtures/kit/tabs.mts` now uses `createHost`.
  `make test-kit` runs `tabs.mts` too. #25's `fixtures/kit/live/check.mts` also uses `createHost`.
- Git merged #31's edits to `bridge/{sep43,connect,kit}.test.ts` into their `tests/browser/` copies by rename.
  Please check that those merges kept both sides (host imports and the new storageKey cases).
- `sdk/` should equal origin/main exactly. `docs/SEP-43.md` keeps main's tab text with test-host commands.
- make test: 156 Rust, 509 Bun. make test-kit and `bun fixtures/kit/live/check.mts` pass with mock keys.

## 6cd9f6a: Phase 8, the art generator in Rust

- `tools/src/art.rs` replaces `design/art/{build,hand,mascot}.ts`; `make art` runs `walleterm-tools art`.
- Byte equality: all 18 outputs (10 scenes, 8 site crops) equal the TS generator's output at 381bf9f; the TS run
  also reproduced the committed `site/art`. A Cargo test compares `site/art` with the generator on every run.
- JavaScript rules emulated: `Math.round` (floor-based, exact fraction), `Number#toString` (shortest digits; an exact
  decimal tie takes the even digit), and `x ** 6` as repeated multiplication. Probes with 200,000 random inputs found
  bit-identical `sin`, `cos`, `atan2`, and `hypot` between Bun 1.4.2 and Rust on this Mac, and a `powf` mismatch
  that `powi`/multiplication fixes. Unit tests pin -0, integers, the tie case, and the round edge cases.
- `artcheck.py compare` passes for 15-moss-circle and 16-hourglass; the sheets look unchanged.
- Docs: `design/ILLUSTRATION.md`, the illustration skill, and README name the Rust generator.
- Risk to judge: the libm equality is measured on macOS arm64 only. The Cargo test would catch a platform drift.

Reply with only the review path and ACCEPT or CHANGES.
