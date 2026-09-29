CHANGES — Three findings require fixes.

The original Phase 4 regression cases pass.
Shutdown still has an ownership gap while recovery stops an old tunnel.
The Phase 7 demo test harness also fails, and the live harness miscounts signing calls.

## Review scope

I reviewed detached commit `05911ef293028aed841697ed285fb123fc3d3e32` against `353a8b2d90cc6d536282a7bc41462384765ec7f9`.
The checkout is `/private/tmp/walleterm-p7-review/final`.
The scope includes `8841ddd`, `bcbd050`, `6c33155`, `d5c4725`, `02b4fcb`, `7f14df3`, and `05911ef`.
`7f14df3` corrects the documented CLI case count without changing its fixture.

I used mock keys, mock signing dependencies, and mock external release programs.
I did not use 1Password, real cloudflared, testnet, real codesign, notarization, or publication.
I did not change the shared worktree.

## Findings

### P7-S1 — Medium: shutdown returns before the old tunnel stops

Source: [src/tunnel.rs:641](/private/tmp/walleterm-p7-review/final/src/tunnel.rs:641), [src/tunnel.rs:334](/private/tmp/walleterm-p7-review/final/src/tunnel.rs:334).

Recovery takes the old tunnel from `shared.tunnel` before it awaits `old.stop()`.
It does not hold the new `starting` mutex during that wait.
A concurrent `stop_all()` therefore sees no tunnel and reports successful cleanup.
It also removes the private directory while the old child still runs.

I triggered recovery through failed mock health checks.
The real supervisor owned a mock cloudflared that ignored SIGTERM.
`running.stop(0)` returned `0` after `764.041µs`.
The old child remained alive, and its process-record directory was gone.
The child stopped later through supervisor cleanup.
This proves an early successful return, not a permanent process leak.

The `02b4fcb` mutex fixes startup ownership, but leaves this recovery interval outside its protection.
Keep retirement under the same lifecycle lock, or make shutdown await the active retirement operation.
Do not report success or remove the directory before that operation finishes.
Add a regression for shutdown while the old tunnel stops.

Evidence: [retirement-shutdown.log](p7-evidence/retirement-shutdown.log), [reproduction source](p7-evidence/review_p7_tunnel.rs).

### P7-S2 — Medium: the SDK import change breaks 55 demo tests

Source: [demo/site/app.ts:17](/private/tmp/walleterm-p7-review/final/demo/site/app.ts:17), [tests/browser/site.test.ts:69](/private/tmp/walleterm-p7-review/final/tests/browser/site.test.ts:69).

`d5c4725` replaces the `StellarSdk` global with named module imports.
`browserScript()` removes imports before the VM runs the source.
The test context still supplies only `StellarSdk`, so names such as `TransactionBuilder` become undefined.

The exact review head returns `417 pass` and `55 fail` across `472` Bun tests.
All 55 failures occur in `tests/browser/site.test.ts`.
That file alone returns `64 pass` and `55 fail`.
These failures block the required offline suite and obscure journal, submission, and signing checks.

Supply the imported SDK names from each test's SDK mock.
A temporary context binding, `...(extras.StellarSdk as Record<string, unknown>)`, restored all `119` tests.
I restored the original file after that check.
Keep the single bundled SDK and repair the test context.
This finding concerns the test harness; it does not establish a browser runtime failure.

Evidence: [complete Bun run](p7-evidence/bun-test-fixtures.log), [original demo run](p7-evidence/site-tests.log), [temporary binding check](p7-evidence/site-tests-with-vm-bindings.log).

### P7-S3 — Medium: terminal outcome lines do not count signer calls

Source: [tests/openzeppelin-auth-live.ts:428](/private/tmp/walleterm-p7-review/final/tests/openzeppelin-auth-live.ts:428).

The new counter increments for both `Signed` and `Signature withheld or stopped` lines.
One request can correctly emit both lines.
The bridge first signs, then withholds an undelivered result after cancellation, disconnection, expiry, or a wallet change.
`05911ef` intentionally preserves both lines for undelivered results.

The mock reproduction made exactly one signer call.
It disconnected before retrieving the result.
The live harness's counting rule reported two signature requests.
These terminal lines also arrive after the signing call starts.
They therefore cannot provide the claimed signer-boundary measurement.

Emit a dedicated test-host event when the production `sign` dependency is called.
Keep that event behind the existing `test-host` feature.
Count those events, and test delivered, undelivered, canceled, and failed requests.
Keep the production terminal logging behavior from `05911ef`.

Evidence: [signature-count.log](p7-evidence/signature-count.log), [reproduction source](p7-evidence/review_p7_counts.rs).

## Phase 4 fix review

| Prior finding | Result at the review head |
| --- | --- |
| P4-S1: failed signature inspection | Fixed. Both inspection commands require success. The mock release fault matrix passes. |
| P4-S2: reused supervisor record | Fixed. Replacement supervisors use distinct `run-N` directories. The real-supervisor regression passes. |
| P4-S3: shutdown during startup | Original cases fixed. First and replacement URL waits clean up before returning. P7-S1 remains. |
| P4-S4: queued output after readiness | Fixed. The 4 MiB regression passes. The receiver drains after URL discovery. |
| P4-S5: website discovery cleanup | Fixed for the reported case. Shutdown waits for lookup cleanup and receives its completion notification. |
| P4-S6: stale asset manifest | Fixed. Hash validation and copied embedding pass review. A changed asset makes a real Cargo build fail. |

The closed-output deadline and cancellation regression also passes.
The launcher still bounds service closure at 3.5 seconds.

## Phase 7 and addendum checks

The default package contains only `walleterm` and `NOTICES.txt`.
Building `walleterm-test-host` without its feature fails.
The packaged executable contains neither the test-host marker nor `WALLETERM_TEST_HOST_PRODUCTION`.
The package command explicitly selects `--no-default-features --bin walleterm`.
The production test-host mode binds loopback and uses the production bridge dependencies.
Offline `createHost()` calls exclude the shell environment and the production switch.
I reviewed that production mode without activating it.

I found no active Go or sidecar dispatch path.
The application starts no Bun, Node, or runtime JavaScript module.
Its file configuration extracts only `OP_VAULT`.
The retained inventory contains 64 `.ts` files, one `.mts` file, and one active Python file.
Their purposes fit the accepted browser, compiler, interoperability, verification, and art categories.
The Python file is `design/tools/artcheck.py`; dated audit scripts remain historical evidence.
See the [retained script inventory](p7-evidence/retained-scripts.tsv) and [coverage map](p7-evidence/coverage-map.md).

The legacy producer reproduced `vectors.json` byte for byte: 99 cases, including the 12 Soroban additions.
The first 87 cases remain unchanged.
Native tests consume the signing vectors and the 26 `sign-auth.json` cases.
The Rust QR fixture and browser decoder checks pass.
All 153 notice headings remain, with no lost license text after whitespace normalization.
Current protocol links and native workflow instructions match the new layout.

`05911ef` matches main's `!delivered` logging guard.
Its delivered and undelivered matrix passes for switching, disconnection, expiry, cancellation, and repeated creation.
It preserves unknown outcomes and suppresses returned artifacts after termination.
P7-S3 concerns the new harness counter, not this logging fix.

## Independent validation

| Check | Result |
| --- | --- |
| `cargo test --workspace --locked` | 154 passed |
| Rust formatting and both Clippy configurations | Passed |
| TypeScript check and Prettier | Passed |
| Full Bun suite, with CAP-71 artifacts present | 417 passed; 55 failed as P7-S2 |
| Contract, extended-contract, and CAP-85 self-tests | All three passed |
| Real Stellar Wallets Kit 2.7.0 with mock keys | Passed |
| Legacy vector reproduction | Exact byte match |
| Package builds | Three identical outputs; two builds ran concurrently |
| Packaged binary with system-only PATH | Version and malformed-input checks passed |
| Packaged demo with mock cloudflared | All 23 routes matched their hashes and MIME types |
| Packaged startup shutdown | Exit 0; mock child stopped before parent exit |
| Changed asset with stale manifest | Cargo rejected the build |

The unsigned package binary measures `4,011,520` bytes.
`NOTICES.txt` measures `274,617` bytes.
The binary SHA-256 is `93138349a77605c32017338f519fd9e09f847adaefe3a30e5a3fff21110290ce`.
The package version is `0.0.0-p7-review`.
The CAP-71 artifacts came from the existing build; their fixture sources did not change in this scope.
I did not repeat live acceptance, signing, notarization, publication, or a real-browser session.
These checks provide no new evidence for those separate gates.

The evidence directory contains logs, reproductions, the pinned request, and the reviewed diff.
[SHA256SUMS](p7-evidence/SHA256SUMS) records its file hashes.
