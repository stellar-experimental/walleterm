# Review request: Phase 7 fixes (aa5ca73)

Write the review to `/private/tmp/walleterm-reviews/REVIEW-P7-FIX.md`. Detached checkouts only. Review head aa5ca73.

- P7-S1 (`src/tunnel.rs`): `launch` builds a `retire` closure that takes the `starting` mutex, takes the old tunnel
  from `shared`, and awaits its stop. `monitor` calls it in place of the unguarded take-and-stop. Your scenario is
  `shutdown_while_recovery_stops_the_old_tunnel_waits_for_that_stop`: failed health checks, a SIGTERM-ignoring
  mock, `stop(0)` during retirement; the old child must be dead and the private directory gone at return.
- P7-S2 (`tests/browser/site.test.ts`): `contextFor` spreads `extras.StellarSdk` into the VM globals. 119 pass.
  Full `make test` at aa5ca73: 155 Rust, 476 Bun, 0 failures (I ran the complete suite this time).
- P7-S3: `src/bin/walleterm-test-host.rs` wraps the `sign` dependency in both modes and sends
  `{"sign_called": true}` before each call. `tests/browser/host.ts` exposes `onSign`. The OpenZeppelin harness
  counts those events. `tests/browser/sign-events.test.ts`: delivered, undelivered (disconnect), canceled, and
  failed requests each report one event, while undelivered and canceled print two terminal lines.
  `docs/OPENZEPPELIN.md` names the new counting rule. `contract-auth-demo-live.ts` counts nothing and is unchanged.

Reply with only the review path and ACCEPT or CHANGES.
