CHANGES — Six findings require fixes. The original Phase 3 regression cases now pass.

I reviewed these commits in detached checkouts:

| Scope | Commit |
| --- | --- |
| Native tunnel | `df834c02c0cc5a50b2d008596d17543542de5c16` |
| Embedded demo | `0efec43e7efad750ceddf673afb13a6a1f3c12bf` |
| Maintainer tools | `08768c07666cdd02702c094ab8c6b03b674fe80b` |
| Phase 3 fixes | `2804700dc1f776137e92844c3a4c6938c6d8004c` |
| Phase 6 addendum; final review head | `353a8b2d90cc6d536282a7bc41462384765ec7f9` |

The review compares these changes with `e01e8279ac6e56e0c4d515a9473aab349b047b96`.
Source links below refer to the detached `353a8b2` checkout.
The addendum leaves the reported tunnel, bridge, asset, and release defects unchanged.
I did not change the shared worktree or use real signing, tunnel, notarization, or publication services.

**P4-S1 — High: Failed signature inspection permits publication.**

Location: [tools/src/release.rs:183](/private/tmp/walleterm-p4-review/complete/tools/src/release.rs:183).

The entitlement check converts every command failure into an empty string with `unwrap_or_default()`.
An empty string then satisfies the check for no entitlements.
The separate `codesign -dvv` call also ignores its exit status if stderr contains the expected text.

I ran the complete release flow with fake external programs and a mock executable.
An entitlement-reader exit of 7 still produced success and reached the fake release and PR commands.
A details-reader exit of 7, with expected text on stderr, produced the same result.
The earlier `codesign --verify --strict` check does not establish the entitlement result that the later command failed to read.

Fix: Require successful exits from both inspection commands. Distinguish a successful empty entitlement result from an inspection failure.
Keep the existing authority, team, runtime, and entitlement checks after those exit checks.
Add fake-tool regressions that assert no archive or publication after either inspection failure.

The controls behaved correctly: an unexpected entitlement or verification failure stopped before archive creation.
Wrong base, missing successful CI, and rejected notarization stopped before publication.
A changed download stopped before the cask PR, after the fake upload.
All external actions in these probes were local mock calls.

Evidence: [release fault matrix](/private/tmp/walleterm-reviews/p4-evidence/release-publish-faults.json), [local-only release matrix](/private/tmp/walleterm-reviews/p4-evidence/release-faults.json).

**P4-S2 — High: Every replacement supervisor encounters the first supervisor's `child.json`.**

Locations: [src/tunnel.rs:211](/private/tmp/walleterm-p4-review/complete/src/tunnel.rs:211), [src/tunnel.rs:411](/private/tmp/walleterm-p4-review/complete/src/tunnel.rs:411), [src/tunnel.rs:740](/private/tmp/walleterm-p4-review/complete/src/tunnel.rs:740).

The launcher reuses one private working directory for successive supervisors.
Each supervisor writes `child.json` with `create_new(true)`. Nothing removes or replaces that record between tunnel generations.
The second supervisor therefore fails its record write and stops its new cloudflared child.

The probe started and stopped the real supervisor with a mock cloudflared.
It then started a second supervisor in the same directory, as recovery does.
The second supervisor exited 1, and the first record remained unchanged.
The mock launcher recovery tests bypass `run_supervisor()`, so they do not detect this failure.

Fix: Give each generation its own owned record, or safely replace the previous record after its process group stops.
Keep exclusive creation and private permissions where they protect a new path.
Add a recovery test that uses the real supervisor twice in one launcher lifetime.
Require the replacement to remain alive and its record to identify the replacement processes.

Evidence: `review_a_second_supervisor_can_reuse_the_launch_directory` in [tunnel probes](/private/tmp/walleterm-reviews/p4-evidence/tunnel-probes.log).

**P4-S3 — Medium: Cancellation during URL discovery returns before stopping the owned tunnel.**

Locations: [src/tunnel.rs:315](/private/tmp/walleterm-p4-review/complete/src/tunnel.rs:315), [src/tunnel.rs:411](/private/tmp/walleterm-p4-review/complete/src/tunnel.rs:411).

`connect()` keeps the new tunnel in a local variable while it awaits its URL.
During that await, `stop_all()` sees no shared tunnel. It removes the private directory and completes shutdown.
`connect()` then stores the tunnel, but the completed `OnceCell` prevents another cleanup pass.

A controlled cancellation before URL output returned exit 0 without calling the mock tunnel's stop function.
The private directory was already absent.
The packaged demo reproduced the process consequence with a mock cloudflared that ignored SIGTERM.
The parent exited 0 while that child remained alive. The supervisor's EOF fallback later stopped it.
This finding concerns early shutdown completion, not a permanent process leak.

Fix: Preserve cleanup ownership across startup and recovery awaits.
Stop and await an outstanding local tunnel before completing shutdown or removing its directory.
Test cancellation before URL discovery with a stubborn mock child, including the replacement path.

Evidence: [launcher cancellation](/private/tmp/walleterm-reviews/p4-evidence/tunnel-probes.log), [packaged process result](/private/tmp/walleterm-reviews/p4-evidence/package-demo.json).

**P4-S4 — Medium: Tunnel output accumulates without a bound after startup.**

Locations: [src/tunnel.rs:661](/private/tmp/walleterm-p4-review/complete/src/tunnel.rs:661), [src/tunnel.rs:412](/private/tmp/walleterm-p4-review/complete/src/tunnel.rs:412).

Both supervisor pipes feed an unbounded channel.
`wait_for_tunnel()` stops receiving when it finds a URL. The stored tunnel retains the receiver, but nothing drains it afterward.
The 16,384-byte limit applies only to the temporary search string.

After URL discovery, a mock cloudflared wrote 4,194,304 bytes.
All 4,194,304 bytes remained queued until the probe drained them.
A long-running or noisy tunnel can therefore consume memory without a limit.

Fix: Bound the startup buffer and continue draining or discarding later output.
Do not merely drop the receiver if that closes the forwarding pipes and stops the supervisor.
Add a sustained-output test that measures retained data after readiness and verifies normal shutdown.

Evidence: `review_supervisor_output_does_not_accumulate_after_readiness` in [tunnel probes](/private/tmp/walleterm-reviews/p4-evidence/tunnel-probes.log).

**P4-S5 — Medium: Bridge shutdown still does not await website discovery cleanup.**

Locations: [src/bridge.rs:650](/private/tmp/walleterm-p4-review/complete/src/bridge.rs:650), [src/bridge.rs:1486](/private/tmp/walleterm-p4-review/complete/src/bridge.rs:1486).

The P3-S4 fix correctly awaits discovery inside the signing worker.
The shared website lookup in `keys()` is separate from `pending_jobs`.
With only `/v1/signers` discovery active, `close()` returns as soon as it sets cancellation.
It does not wait for that lookup's CLI cleanup.

The first probe used the new cancellation-aware mock listing.
Its cleanup count was zero at `close()` return and one after the request completed.
A second probe used the actual vault lookup with two mock CLI children that ignored SIGTERM.
Both children remained alive when `close()` returned. Both stopped before the pending request returned.

Fix: Include an active shared website lookup in shutdown completion.
Cancel it, then await its bounded cleanup before reporting the bridge closed.
Preserve handler completion after client disconnection. Keep immediate socket closure for canceled native signing.
Add this website-discovery case beside the new signing-worker cleanup regression.

This is an additional cleanup path. The original signing-worker regression is fixed.
No probe established a permanent child leak or a released signature.

Evidence: [listing completion](/private/tmp/walleterm-reviews/p4-evidence/website-cleanup.log), [actual vault cleanup with mock children](/private/tmp/walleterm-reviews/p4-evidence/website-vault-children.log).

**P4-S6 — Medium: The build accepts assets that disagree with their recorded hashes.**

Location: [build.rs:25](/private/tmp/walleterm-p4-review/complete/build.rs:25).

`build.rs` checks the hash string's length but never compares it with the file contents.
It copies the supplied hash into `Asset` and embeds the current file bytes.
Changing a file after manifest generation therefore produces an inconsistent embedded asset without a build failure.

The probe recorded a valid digest, changed the referenced HTML, and ran the unchanged build script.
The script succeeded and generated an entry with the old hash.
`cargo build --locked --bin walleterm` also succeeded with that stale manifest.
The existing Cargo asset test detects the mismatch only when tests run against those assets.
The package build does not run that asset test.

Fix: Verify each referenced file against its manifest digest before embedding it.
Add a build failure test that changes an asset after manifest generation.
Keep the missing-file and empty-manifest failures too.

The two normal packages and all served route hashes passed this review.
This finding identifies a missing stale-asset gate, not corruption in those tested packages.

Evidence: [stale manifest probe](/private/tmp/walleterm-reviews/p4-evidence/stale-assets.json), [successful stale-asset build](/private/tmp/walleterm-reviews/p4-evidence/stale-assets-build.log).

**Phase 3 fix disposition.**

| Prior finding | Result |
| --- | --- |
| P3-S1: dotenv removes vault filtering | Accepted for the reported cases and frozen corpus |
| P3-S2: shutdown permits signing or stores `Signed` | Accepted; checks and transitions share the state lock |
| P3-S3: late selection panics after session removal | Accepted; checked session lookups return disconnection |
| P3-S4: failure order and dropped worker discovery | Accepted for those paths; P4-S5 covers separate website discovery |

I regenerated the 2,106-case dotenv corpus with Bun 1.4.2. It matched the committed file byte for byte.
Cargo passed the corpus, configuration-to-discovery, both shutdown schedules, late selection, and all four batch failure positions.
I did not repeat the claimed 120,000-input fuzz campaign.
I do not request another rejection layer for a valid `OP_VAULT=` setting. Preserve its established explicit no-filter meaning.

The new native signing path still uses cancellation that drops the socket future.
The vault path drains batch completions and waits for child cleanup when its caller awaits it.
The native bridge retains protocol v3 and the existing session, grant, revision, and result-withholding checks.

**Package, demo, tooling, and helper checks.**

Two concurrent package builds at `353a8b2` produced identical binary and notice bytes.
The package contains only `walleterm` and `NOTICES.txt`.
Its 4,819,760-byte executable has SHA-256 `ec31f0363335fa3de91665118fcf5147aa75ae54440f0725e523297daba98d04`.
It lacks `WALLETERM_TEST_HOST_ONLY_V1` and rejects the invented `--mock` option.
The package command selects only `walleterm`, disables default features, clears build overrides, and uses a private target directory.

The binary ran from an empty directory with `PATH=/usr/bin:/bin`.
Version output passed; malformed `sign-auth` and invalid demo port returned exit 2.
With only a mock cloudflared added, the packaged demo served all 24 minified manifest routes with exact bytes and MIME types.
Those responses carried the strict CSP. The test emitted no public tunnel URL and made no public readiness request.

NOTICES contains sections for all 107 normal Rust dependencies and 45 browser dependency packages found by the implemented traversal.
It also includes the vendored syntax license. No Rust section fell back to a license identifier without text.
The Rust `qrcode 0.14.1` notice belongs in this native package. The removed browser QR dependency is a separate package.

The install tests passed with fake build programs and temporary prefixes.
They cover failed-build preservation, retained previous releases, matching alias targets, and refusal to replace a regular alias file.
I did not change the user's installation.

The attachment helper retains all six flags, independent Ed25519 verification, full body/signature comparison, and exclusive output creation.
Its existing integration test passed with isolated mock keys and offline Stellar CLI operations.
Additional controlled CLI faults rejected an unsafe JSON number, changed body, and changed signature.
A file created during verification remained unchanged, and the helper refused the write.
The normal helper result created a 0600 file.

Evidence: [package identity and CLI checks](/private/tmp/walleterm-reviews/p4-evidence/package-check.json), [packaged demo](/private/tmp/walleterm-reviews/p4-evidence/package-demo.json), [notices coverage](/private/tmp/walleterm-reviews/p4-evidence/notices-check.json), [helper fault checks](/private/tmp/walleterm-reviews/p4-evidence/attach-faults.json).

**Addendum and test results.**

The new Rust fixture writers reproduce both committed manifests byte for byte.
The fixture build tests use isolated Git data and fake compiler programs.
They preserve existing artifacts and the Git index after staged or unstaged source changes.
The hand-ordered writer avoids enabling `serde_json/preserve_order` in the application dependency graph.
I found no additional defect in the addendum's fixture writer changes.

| Check | Observed result |
| --- | --- |
| `cargo test --workspace --locked` at `2804700` | 137 passed |
| `cargo test --workspace --locked` at `353a8b2` | 143 passed |
| Browser SDK/demo suite through the native test host | 40 passed; 84 assertions |
| Existing attachment integration test | 1 passed |
| Additional attachment fault cases | Normal case passed; all four fault cases refused safely |
| Concurrent native packages | Binary and notices identical |
| Packaged minified demo | 24 routes matched bytes and MIME types |
| Release fault matrix | Two inspection failures incorrectly reached fake publication |
| Added lifecycle and stale-asset probes | Failed the required guards as described above |

The browser host run used `2804700`. Its runtime and browser source files are unchanged in `353a8b2`.
The final workspace tests, package builds, fixture checks, and release fault matrix used `353a8b2`.
I did not rerun full `make test`, Clippy, advisory checks, or contract self-tests.
The existing test-agent report remains separate evidence for its earlier commit.

One extra injected-tunnel probe found that output EOF bypasses the URL deadline while the exit notification remains pending.
That branch awaits exit outside the timeout and cancellation selection at [src/tunnel.rs:109](/private/tmp/walleterm-p4-review/complete/src/tunnel.rs:109).
The production supervisor normally keeps those output descriptors open until exit.
I did not establish that stalled state through the production supervisor, so I do not count it as another blocker.
Keep the deadline and cancellation active in that branch when repairing startup ownership.

SIGHUP support and the inherited demo help wording remain the stated follow-ups.
The demo currently accepts GET only; its HEAD rejection matches the legacy handler, despite the request's GET-or-HEAD wording.
Phase 7 still owns removal of the legacy hosts, scripts, and remaining old test paths.

No check used real 1Password, real cloudflared, testnet, real codesign, notarization, or remote publication.
The release probes used fake `git`, `gh`, `security`, `codesign`, `ditto`, `xcrun`, and build programs.
All observed mock tunnel and vault children stopped after their cleanup checks.

Evidence and reproduction sources: [index](/private/tmp/walleterm-reviews/p4-evidence/REPRODUCTION.md), [final workspace tests](/private/tmp/walleterm-reviews/p4-evidence/cargo-353-tests.log), [browser tests](/private/tmp/walleterm-reviews/p4-evidence/browser-tests.log), [checkout records](/private/tmp/walleterm-reviews/p4-evidence/checkout-state.json).
