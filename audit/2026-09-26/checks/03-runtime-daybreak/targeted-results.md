# Runtime targeted checks

Date: 2026-09-26

Snapshot: `/private/tmp/walleterm-audit-40d6cca9db73`

Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`

## Environment

- macOS: `Darwin 25.6.0 arm64`
- Bun: `1.4.2`
- Go: `go1.27.1 darwin/arm64`
- cloudflared: `2026.9.3`, built `2026-09-24T15:31:10Z`
- Bun cache: `/private/tmp/walleterm-bun-cache-daybreak`
- Go cache: `/private/tmp/walleterm-go-cache-daybreak`
- Test temporary files: `/private/tmp/walleterm-runtime-daybreak`

## Results

| Status | Command | Outcome |
|---|---|---|
| passed | `bun test bridge/runtime.test.ts bridge/tunnel-child.test.ts bridge/launch.test.ts` | 19 passed, 0 failed |
| passed | `go test -run 'Test(ServiceOptions|SeparatedHelp|BunVersion)$' .` | Package passed |
| failed | `bun audit/2026-09-26/checks/03-runtime-daybreak/listener-shutdown-check.ts` | The sandbox returned `EADDRINUSE` for port `0` |
| passed | Same listener check with permitted loopback access | Both listeners refused connections after `close()` |
| passed | `bun audit/2026-09-26/checks/03-runtime-daybreak/orphan-supervisor-check.ts` | A mock child survived supervisor `SIGKILL` |
| passed | `bun audit/2026-09-26/checks/03-runtime-daybreak/orphan-recovery-check.ts` | Recovery started a replacement while the old child remained alive |

The orphan checks expect the current defect. A zero exit confirms the reproduction.

No check started `cloudflared`, a public service, a signer, or a Stellar transaction.

## Exact reproduction output

```json
{"supervisor_alive":false,"cloudflared_alive_after_supervisor_sigkill":true}
{"replacement_supervisors_started":2,"old_cloudflared_alive_after_recovery":true}
{"bridge_listener_closed":true,"demo_listener_closed":true}
```

## Check file hashes

```text
996af7233f82808a19443b107d9f98157611113c80802c3bc05f2f58335a4762  orphan-supervisor-check.ts
9c097003c80f8716b81644f8a8222e5ffb19653bf58ca4664927cb4bf82f8fe8  listener-shutdown-check.ts
78a2fa10d5b5f1209434501b65a9d21b80efcbd64cccab6e02a03e816edd068f  orphan-recovery-check.ts
```
