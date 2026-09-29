**ACCEPT.** Commit `3ea4cd2` resolves P7-FIX-S1. I found no new issue in this change.

I reviewed `3ea4cd23b9fe5647331e1316f0128f8ef3158fba` against parent `aa5ca73c62b892e063beb239586386d125176209`.
I used only the detached checkout at `/private/tmp/walleterm-p7-fix2-review/final`.
The change contains the shutdown fix and its regression test.

In [src/tunnel.rs:335](/private/tmp/walleterm-p7-fix2-review/final/src/tunnel.rs:335), `stop_tunnel` now acquires `starting` inside its future.
The existing `tokio::join!` starts `service.close()` while tunnel cleanup waits for that lock.
This permits immediate bridge cancellation during tunnel retirement.
The lock still prevents shutdown from finishing before retirement stops the old tunnel.
The code removes the private directory and announces completion after both futures finish.
The existing closure timeout and failure result remain intact.

The [new regression test](/private/tmp/walleterm-p7-fix2-review/final/tests/tunnel.rs:869) uses the actual bridge and supervisor with mock signing and tunnel programs.
I also ran both original independent probes against the unchanged source.

| Independent check | Result |
| --- | --- |
| `cargo test --workspace --locked` | 156 passed; zero failures |
| Original signing cancellation probe | Passed; shutdown remained pending while the bridge closed and canceled signing |
| Original tunnel retirement probe | Passed; shutdown waited about 998 ms; the old child stopped; the private directory disappeared |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Passed |
| `git diff --check HEAD^ HEAD` | Passed |

The signing probe delivered no signed artifact after shutdown started.
The native suite also passed the startup, replacement, output, and retirement shutdown tests.

I used mock keys and mock external programs only.
I did not use 1Password, real cloudflared, testnet, real codesign, notarization, or publication.
I did not rerun Bun, contract self-tests, package checks, or live acceptance checks for this native-only fix.
Opus reported 476 passing Bun tests; this review does not independently confirm that count.

I removed the temporary probe and dependency symlink.
The detached checkout is clean, and I made no changes in the shared worktree.
The [checkout record](p7-fix2-evidence/checkout-status.json) records both final states.
Evidence includes the [native test log](p7-fix2-evidence/cargo-test.log), [original probe results](p7-fix2-evidence/original-probes.log), and [SHA-256 manifest](p7-fix2-evidence/SHA256SUMS).
