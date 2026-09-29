# Review request: P7-FIX-S1 (3ea4cd2)

Write to `/private/tmp/walleterm-reviews/REVIEW-P7-FIX2.md`. Detached checkout of 3ea4cd2 only.

- `stop_all` now takes `starting` inside the `stop_tunnel` future (your experiment patch), so `service.close()` runs
  concurrently through the existing `tokio::join!`. The directory is removed after both.
- Regression `shutdown_during_retirement_cancels_bridge_signing_first` in `tests/tunnel.rs` is your probe with the real
  `BridgeService`, the real supervisor, and a held mock signature. On aa5ca73's `src/tunnel.rs` it fails with
  "closing false, canceled false, delivered true"; at 3ea4cd2 it passes, and so does the P7-S1 retirement test.
- Full `make test` at 3ea4cd2: 156 Rust and 476 Bun tests pass.

Reply with only the review path and ACCEPT or CHANGES.
