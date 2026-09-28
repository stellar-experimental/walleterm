# Service runtime and tunnel lifecycle

Read `COMMON.md` in this directory first.

Primary files: `service.go, service_test.go, bridge/runtime.ts, bridge/launch.ts, bridge/tunnel-child.ts, demo/entry.ts, bridge/entry.ts and corresponding tests`.

Focus: Process ownership, loopback listeners, private config, environment containment, timeouts, restart limits, shutdown, orphan cleanup, service isolation.

Follow direct dependencies when necessary. Cite exact source lines in the frozen snapshot.
