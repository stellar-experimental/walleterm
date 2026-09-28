# C10 Daybreak checks

Date: 2026-09-26.
Frozen revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Source: `/private/tmp/walleterm-audit-40d6cca9db73`.

## Frozen source

Command:

```text
shasum -a 256 /private/tmp/walleterm-audit-40d6cca9db73/demo/site/app.ts /private/tmp/walleterm-audit-40d6cca9db73/demo/site/index.html
```

Result: passed.

- `demo/site/app.ts`: `7b59656b9b06900054620024d52ac55a1e5789136741c0dae528ab4573b79218`
- `demo/site/index.html`: `1561e9193cda6b33ebe951d5e64c98c8a19c768872025ee1e6a790c34b4b03ea`
- Both hashes match `audit/2026-09-26/manifest.json`.

## Existing reproductions

Command:

```text
bun test audit/2026-09-26/checks/05-demo-astra/adversarial.test.ts --test-name-pattern 'normal signed review|normal reload'
```

Result: passed with two tests, zero failures, and 11 filtered tests.
Bun reported version `1.4.2`.

- Normal signing removed the decoded operation before submission.
- Normal reload submitted the exact stored signed envelope.
- Normal reload confirmed the original stored hash.

The coordinator also recorded both passing reproductions.
See `audit/2026-09-26/checks/coordinator-reproductions.txt:9,15`.

## Static reload trace

Result: confirmed.

- `demo/site/app.ts:251-281` restores a valid `signed` journal.
- `demo/site/app.ts:400-414` omits `transaction` unless the state is `review`.
- `demo/site/app.ts:415-417` shows the submission action for `signed`.
- `demo/site/app.ts:785-799` renders and opens the restored unfinished journal.

No new test was necessary. The source and existing reproductions decide the concern.

## Excluded checks

- Live 1Password signing: `not_run`.
- Live testnet submission: `not_run`.
- Public tunnel startup: `not_run`.
- Mainnet activity: `not_run`.
