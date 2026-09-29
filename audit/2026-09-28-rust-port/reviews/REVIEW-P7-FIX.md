CHANGES — One new shutdown regression requires a fix.

I reviewed `aa5ca73c62b892e063beb239586386d125176209` against its parent, `05911ef293028aed841697ed285fb123fc3d3e32`.
Both checkouts remained detached.
The original three reproductions are resolved, but the retirement lock delays bridge cancellation.

## P7-FIX-S1 — Medium: cancel bridge signing before waiting for tunnel retirement

Sources: [src/tunnel.rs:542](/private/tmp/walleterm-p7-fix-review/final/src/tunnel.rs:542), [src/tunnel.rs:334](/private/tmp/walleterm-p7-fix-review/final/src/tunnel.rs:334), [src/service.rs:90](/private/tmp/walleterm-p7-fix-review/final/src/service.rs:90).

The new `retire` closure holds `starting` while it stops the old tunnel.
`stop_all()` waits for that lock before it starts `service.close()`.
Its earlier `controller.cancel()` cancels launcher work, but does not cancel the bridge's signing worker.
Therefore, the bridge remains open during the retirement wait.
A pending signature can complete and reach the website after shutdown starts.

I reproduced this with the real `BridgeService`, real loopback HTTP, and the real tunnel supervisor.
The signer used an isolated mock key.
The cloudflared stand-in ignored SIGTERM, and mock health failures triggered retirement.

The sequence was:

1. Start a signing request and hold its mock signature response.
2. Trigger retirement of the old tunnel.
3. Call `running.stop(0)` and wait 50 milliseconds.
4. Release the mock signature and poll through HTTP.

At step 3, shutdown remained pending, `bridge.closing()` was false, and the signing cancellation flag was false.
At step 4, HTTP returned `state: signed` with `signed_tx_xdr`.
Shutdown later returned `0`, after the mock child stopped.

The same probe passes on parent `05911ef`.
There, the bridge closes and cancels signing before the held response returns.
This comparison isolates the new cancellation delay introduced by the retirement lock.
The evidence proves a local mock result-delivery regression; it does not establish a live signing incident.

Start bridge closure concurrently with the wait for tunnel ownership.
Keep the directory until both bridge closure and tunnel cleanup finish.
Moving the lock acquisition inside the existing `stop_tunnel` future permits the existing `tokio::join!` to do this.
A temporary experiment passed both the original process-cleanup probe and the new signing-cancellation probe.
I restored the exact reviewed source afterward.

Evidence:

- [Failing candidate probe](p7-fix-evidence/retirement-signing.log)
- [Passing parent probe](p7-fix-evidence/parent-retirement-signing.log)
- [Reproduction source](p7-fix-evidence/review_p7_tunnel.rs)
- [Tested minimal experiment](p7-fix-evidence/concurrent-close-experiment.patch)
- [Experiment results](p7-fix-evidence/concurrent-close-experiment.log)

## Prior finding results

| Finding | Result |
| --- | --- |
| P7-S1: early shutdown completion | The original probe passes. Shutdown waits about one second; the child and directory are gone at return. The new cancellation regression remains. |
| P7-S2: missing SDK names in the VM | Fixed. All 119 demo tests pass within the full Bun suite. |
| P7-S3: duplicated signature counts | Fixed. The test host emits one event before each signer dependency call. The live harness counts that event. |

The four signer-event tests pass for delivered, undelivered, canceled, and failed requests.
Additional mock checks confirm events precede signer entry and count pending calls.
Repeated creation adds no event; separate requests with the same digest each add one event.
Malformed requests, denied reviews, and cancellation before signing produce zero events.
The production and mock dependency branches share the same event wrapper.
I did not activate the production test-host mode.

The test-host feature boundary remains intact.
Building that target without `test-host` fails as expected.
The default binary contains neither test-host marker, production switch, nor `sign_called` event name.
The package command remains unchanged and selects only `walleterm` without default features.

## Independent validation

| Check on unmodified `aa5ca73` | Result |
| --- | --- |
| Cargo workspace tests | 155 passed |
| Full Bun suite | 476 passed; zero failures |
| Rust formatting and both Clippy configurations | Passed |
| TypeScript checking and SDK declaration generation | Passed |
| Prettier | Passed |
| Three offline contract self-tests | Passed |
| Original retirement reproduction | Passed |
| Additional signer-event checks | Passed |
| New shutdown/signing reproduction | Failed as P7-FIX-S1 |

The CAP-71 artifacts came from the existing build; their fixture sources did not change in this commit.
I used only mock keys and mock external programs.
I did not use 1Password, real cloudflared, testnet, real codesign, notarization, or publication.
I restored all experimental source changes and removed the review tests from both detached checkouts.
The shared worktree remained unchanged.

[SHA256SUMS](p7-fix-evidence/SHA256SUMS) records the evidence file hashes.
