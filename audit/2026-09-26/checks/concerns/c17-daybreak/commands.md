# C17 Daybreak checks

Date: 2026-09-26 EDT.
Frozen revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Existing reproduction review

I inspected these files before running checks:

- `checks/concerns/c17-astra/checkpoint-versions.ts.txt`
- `checks/concerns/c17-astra/checkpoint-versions.json`
- `checks/concerns/c17-astra/checkpoint-versions.stderr`

The script uses synthetic checkpoints and denied network, signing, and submission functions.
It removes only its private temporary directory.

## Commands and results

```sh
bun /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c17-daybreak/cap71-partial-reuse.ts
```

Result: passed reproduction with Bun 1.4.2.
The row emitted `passed` with protocol 29.
Both reused checks retained protocol 28.
The row had no `reused_evidence` field and emitted no `passed_previous_run` event.
No blocked live function ran.
See `cap71-partial-reuse.json`.

```sh
bun /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c17-astra/checkpoint-versions.ts
```

Result: passed with Bun 1.4.2.
The script verified all 199 tracked files against `manifest.json`.
The rerun matched the preserved result structure.
It made no network, signer, or submission call.

```sh
bun test tests/checkpoint.test.ts
```

Result: 2 passed and 0 failed.

```sh
bun test tests/cap71.test.ts --test-name-pattern "checkpoint fails closed|restart reuses confirmed steps"
```

Result: 2 passed, 15 filtered out, and 0 failed.

All commands ran from `/private/tmp/walleterm-audit-40d6cca9db73`.
No command requested a signature or contacted Stellar RPC.
No command changed production source, dependencies, configuration, or Git state.
