# C14 Daybreak check record

- Date: 2026-09-26.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Network requests: 0.
- Signer calls: 0.
- Submissions: 0.

## Independent unit check

Command: `stellar --version`.

Result: `stellar 28.0.0 (300aaf69ab100536678bdb641428b06f06b318ea)`.

Command: `stellar tx new payment --help`.

Result: The installed CLI defines `--amount` in stroops.
It defines one stroop as `0.0000001` of the asset.
Therefore, `100` stroops equals `0.0000100` XLM.
The command also shows a default maximum inclusion fee of 100 stroops.

The supplied `checks/stellar-payment-help.txt` contains the same text.
The frozen pipeline passes `--amount`, then `100`, at `tests/cli-pipeline.ts:18-19`.

## Reused focused evidence

I inspected `checks/07-verification-astra/offline-probes.ts.txt` and `offline-probes.json`.
The probes execute the frozen pipeline body with isolated command and signer mocks.
Both fault cases leave no `pending-submission.json` file.
Both cases permit a second mock signature after the failed run.
The timeout case performs no original-hash lookup.
The `NOT_FOUND` case performs one original-hash lookup.

I did not rerun these probes because their mocks and results answer the structural question.
The probes do not prove that either fault occurred during a live CLI run.
