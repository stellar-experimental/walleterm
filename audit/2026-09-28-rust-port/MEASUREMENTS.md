# Final measurements: base 52a7fc3 against the Rust branch at 1bda24a

Measured on 2026-09-28 on this Mac (Apple silicon, macOS 26.7, Rust 1.93.0, Bun 1.4.2).
The base package is `baseline/pkg` from `52a7fc3`. The Rust package came from `walleterm-tools package` at
`1bda24a` with version `0.0.0-final`. The branch includes main up to `ad684c8` (#25, #27, #29, #31).

## Release package

| Item | Base | Rust | Change |
| --- | --- | --- | --- |
| Executables | `walleterm` (Go) + `walleterm-bridge` (Bun compile) | `walleterm` | 2 to 1 |
| Executable bytes | 3,397,074 + 66,338,418 = 69,735,492 | 4,011,600 | -94.2% |
| gzip -9 bytes | 1,407,131 + 26,521,270 = 27,928,401 | 1,501,047 | -94.6% |
| `NOTICES.txt` | 111,760 | 274,617 | Rust crates add license texts; each distinct text appears once |
| Entitlements | JIT for the Bun binary | none | hardened runtime only |

Two concurrent package builds give identical bytes (`make test-package`).
The Rust binary is 0.6 MB larger than the old Go signer alone, and it also holds the demo website, the bridge,
and the tunnel supervisor. The demo used to load the Stellar SDK twice; it now loads it once from its bundle.

## Start time and memory

60 interleaved runs of each binary, `env PATH=/usr/bin:/bin`, from `/private/tmp`, at `1bda24a`.
The load average was about 8.8 because other agent sessions ran. Minimums show the unloaded cost best.
Every command fails on input or prints its version before any agent, vault, or network use.

| Command | Base median / min | Rust median / min | Base RSS | Rust RSS |
| --- | --- | --- | --- | --- |
| `walleterm --version` | 15.2 / 9.8 ms | 15.8 / 10.4 ms | 4.8 MB | 6.1 MB |
| `walleterm sign` with `{}` | 15.0 / 9.1 ms | 15.6 / 9.6 ms | 5.5 MB | 6.3 MB |
| `walleterm sign-auth` with `{}` | 49.1 / 38.3 ms | 19.1 / 11.2 ms | 31.8 MB | 6.2 MB |

The Go signer starts about 0.5 to 1 ms sooner; both are dominated by process creation.
`sign-auth` was a Go wrapper that started the Bun sidecar. It is now native: about 2.6 times faster, 5 times smaller.
An earlier quiet-machine run (bcbd050) gave the same pattern at lower absolute times.

## Dependencies

| Item | Base | Rust |
| --- | --- | --- |
| Go modules | standard library only | none |
| Cargo.lock packages (all targets, tools, dev) | none | 135 (budget 160) |
| Crates compiled into the release binary (`cargo tree -e normal --no-default-features`) | none | 100 (budget 130) |
| Crates reachable in `cargo metadata` (workspace-unified features; NOTICES uses this upper bound) | none | 107 |
| bun.lock packages | 101 | 71 |

`cargo deny` checks advisories, licenses, and sources in CI with a checksum-pinned binary.

## Source size (lines)

| Area | Base | Rust branch |
| --- | --- | --- |
| Go source / Go tests | 638 / 688 | 0 / 0 |
| TypeScript host source (`bridge/*.ts`, `demo/server.ts`, package, install, release) | 2,467 | 0 |
| TypeScript host tests (`bridge/*.test.ts`, package and install tests) | 8,372 | 0 |
| TypeScript art generator (`design/art/*.ts`) | 714 | 0 |
| Rust application (`src/`, `build.rs`, `build/manifest.rs`) | 0 | 6,651 |
| Rust maintainer tools (`tools/src/`, including the art generator) | 0 | 1,814 |
| Rust tests (`tests/`, `tools/tests/`) | 0 | 4,846 |
| TypeScript SDK (`sdk/`) | 2,554 | 2,667 (main's #27 and #31 added 113) |
| TypeScript tests and harnesses (`*.test.ts`, `tests/`) | 20,192 | 18,852 |

Correction (2026-09-28): The Rust art generator was reverted after this measurement.
The generator stays in TypeScript at `design/art/*.ts`, and `tools/src/` has no art generator.
The numbers above are the original measurements at 1bda24a. They do not include the revert.

The Rust application is larger than the Go and TS host source it replaces (6,651 against 3,105 lines).
It now does work that libraries and runtimes did before: the HTTP server and limits (`Bun.serve`), transaction and
authorization inspection (the JS SDK), Bun's exact `.env` rules, Go's JSON and `%q` escaping, and process supervision.

## Tests

| Point | Rust tests | Bun tests |
| --- | --- | --- |
| Base 52a7fc3 | 0 (Go tests at the base) | 586 |
| 8841ddd (host code removed) | 144 | 472 |
| 1bda24a (final) | 158 | 509 |

`make test-kit` (Kit 2.7.0, one tab and across tabs) and `make test-package` pass at the final commit.
