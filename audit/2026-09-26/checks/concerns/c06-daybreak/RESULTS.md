# C06 Daybreak check results

Source revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

Command:

```sh
env TMPDIR=/private/tmp/c06-daybreak-cache BUN_INSTALL_CACHE_DIR=/private/tmp/c06-daybreak-cache bun test audit/2026-09-26/checks/concerns/c06-daybreak/pairing-after-destroy.test.ts
```

The first run failed before its evidence assertions.
The owned harness lacked the `dialog` member used by `connect()` cleanup.
The corrected rerun passed with one test and no failures.

Observed result:

```json
{"destroyed":true,"ownedSignalAborted":false,"selectSignalAborted":false,"oldDisconnectsImmediatelyAfterDestroy":0,"oldDisconnectsAfterLateCommit":1,"sessionWrites":1,"callbacks":1,"lateAccount":"GNEW"}
```

The test used the frozen `WalletermConnect` and `WalletermClient` classes.
It used controlled `Response` objects and made no network request.
It used no key, signature, submission, or public service.

Preserved camera evidence:

- `checks/04-sdk-astra/destroy-scan.test.ts.txt` uses the frozen component and scanner.
- `checks/04-sdk-astra/destroy-scan.log` reports zero stopped tracks after destruction.
- `checks/coordinator-reproductions.txt` records the same passing reproduction.
