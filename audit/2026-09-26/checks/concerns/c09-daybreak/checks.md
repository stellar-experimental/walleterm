# C09 Daybreak checks

Date: 2026-09-26.
Frozen revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Source: `/private/tmp/walleterm-audit-40d6cca9db73`.

## Source identity

Command:

```text
jq '.file_sha256 | length' audit/2026-09-26/manifest.json
shasum -a 256 /private/tmp/walleterm-audit-40d6cca9db73/demo/site/app.ts /private/tmp/walleterm-audit-40d6cca9db73/demo/site/activity.ts
```

Result: passed.

- The manifest contains 199 tracked file hashes.
- `demo/site/app.ts`: `7b59656b9b06900054620024d52ac55a1e5789136741c0dae528ab4573b79218`.
- `demo/site/activity.ts`: `48e20167239941fd6614f3ccab5c11619593a044f3dcc46b4456dbf9fcfb54a5`.

Both hashes match `audit/2026-09-26/manifest.json`.

## Existing reproduction

Command:

```text
bun test audit/2026-09-26/checks/05-demo-astra/adversarial.test.ts -t 'restored|normal reload|storage failure before submission|unavailable Web Locks'
```

Result: passed with five tests and eight filtered tests.

- A restored journal submitted another valid signed envelope.
- A restored unsigned envelope reached the mocked Horizon submission.
- A storage failure before submission sent no bytes.
- An unreadable journal blocked submission.
- A normal reload submitted the original verified envelope.

The tests used SDK 17.1.0 and isolated mock keys.
The tests used in-memory network functions and opened no listener.
Passing finding tests confirms the current fault.
It does not confirm a fix.

## Baseline evidence

`checks/baseline-permitted-results.json` records the central Go race and Bun suite passes.
This review did not repeat those complete suites.

## Prohibited or unnecessary checks

- Live 1Password signing: `not_run`.
- Live testnet submission: `not_run`.
- Public tunnel startup: `not_run`.
- Private-key field access: `not_run`.
- New reproduction code: `not_run` because the existing reproduction was decisive.
