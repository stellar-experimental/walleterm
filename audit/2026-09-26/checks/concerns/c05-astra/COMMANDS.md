# C05 Astra check record

Date: 2026-09-26. All runtime source came from `/private/tmp/walleterm-audit-40d6cca9db73`.
Only the assigned C05 report and evidence directories received audit writes.

## Source verification

Python compared each frozen file with the stdout bytes from this command:

```sh
git -C /Users/kalepail/Desktop/walleterm-v2 show 40d6cca9db732a0db16d154c80d4a153bf33c6b7:<file>
```

Files: `sdk/walleterm.ts`, `sdk/connect.ts`, `bridge/server.ts`, `bridge/transaction.ts`,
`bridge/PROTOCOL.md`, `demo/site/app.ts`, and `bridge/server.test.ts`.
`source-identity.json` records each SHA-256 and byte-comparison result. All seven matched.
This read-only comparison did not change Git state.

## Existing probes

Working directory: `/private/tmp/walleterm-audit-40d6cca9db73`.
Environment override: `BUN_RUNTIME_TRANSPILER_CACHE_PATH=/private/tmp/c05-astra-cache`.

```sh
bun test /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/04-sdk-astra/remote-switch.test.ts
bun test bridge/server.test.ts --test-name-pattern 'switches cancel queued reviews|a switch during .* withholds the old result|SDK withholds a delayed successful signature|SDK preserves signing uncertainty when session expiry'
```

Python invoked these commands with argument arrays and a 45-second timeout for each command.
It captured stdout and stderr together without changing the probes.
Initial runs could not bind the local listener. Both returned exit 1 with `EADDRINUSE` for port 0.
The same commands passed after automatic approval permitted loopback access.
The bridge bound only `127.0.0.1`; no public service ran.
`results.json` preserves the initial command outcomes. `results-permitted.json` preserves the successful rerun.
The reproduction passed two assertions of defective behavior. The counterevidence run passed six tests and filtered out 38.

## Test interpretation

The existing reproduction injects mock discovery and mock signing, then uses the real bridge and SDK.
It holds an already-produced signed HTTP response, changes the session remotely, and reads the new revision locally.
Both cases return the old signed XDR after that read. Each calls its mock signer once.
Fresh bridge reads return `unknown` without signed XDR after the switch.
The six counterevidence tests establish cancellation, stale-admission rejection, local-switch suppression, and cancellation uncertainty.
No new executable check was necessary. No live keys, live signatures, or submissions were used.
