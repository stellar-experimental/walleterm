# C04 daybreak check results

Date: 2026-09-26, America/New_York.

Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.

Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Environment

- macOS: `Darwin 25.6.0 arm64`
- Bun: `1.4.2`
- cloudflared: `2026.9.3`, built `2026-09-24T15:31:10Z`

## Checks

Audit reproduction commands ran from `/Users/kalepail/Desktop/walleterm-v2`.
The focused Bun test ran from the frozen source directory.

| Status | Command | Outcome |
| --- | --- | --- |
| passed | `shasum -a 256 /private/tmp/walleterm-audit-40d6cca9db73/bridge/launch.ts /private/tmp/walleterm-audit-40d6cca9db73/bridge/tunnel-child.ts` | Both hashes matched `manifest.json`. |
| passed | `bun audit/2026-09-26/checks/03-runtime-daybreak/orphan-supervisor-check.ts` | The mock child survived supervisor `SIGKILL`. |
| passed | `bun audit/2026-09-26/checks/03-runtime-daybreak/orphan-recovery-check.ts` | Recovery started a second supervisor while the old mock child lived. |
| passed | `bun test bridge/tunnel-child.test.ts` | One main-parent crash test passed. |
| passed | `bun --version`; `cloudflared --version`; `uname -mrs` | The versions matched the environment section. |
| blocked | `ps -axo pid,ppid,command` with a narrow mock-process filter | The sandbox denied process listing. |

The orphan checks use Bun scripts instead of `cloudflared`.
The direct check samples child liveness 100 milliseconds after supervisor exit.
No check started a public tunnel, signer, or transaction.
The blocked process listing does not change the completed reproduction results.

## Exact output

```text
17df546db6ae4b9c192202870c5aed5dd14adf819ec8f1e40c17967bd0b52355  bridge/launch.ts
3dec6c2b29b273fb0801f34d03c801ccabc1dfae04ee2396a5baffc19b001f96  bridge/tunnel-child.ts
{"supervisor_alive":false,"cloudflared_alive_after_supervisor_sigkill":true}
{"replacement_supervisors_started":2,"old_cloudflared_alive_after_recovery":true}
1 pass
0 fail
```

No new reproduction was necessary.
