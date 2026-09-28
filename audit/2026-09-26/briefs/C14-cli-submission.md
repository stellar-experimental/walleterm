# C14: CLI acceptance submission bypass

Read `CONCERN.md` and both `reports/07-verification-*.md` reports when available.
Source: `tests/cli-pipeline.ts`, `tests/live-utils.ts`, and `tests/submission.ts`.
Evidence: `checks/07-verification-astra/offline-probes.ts.txt` and `offline-probes.json`.

Check whether the CLI send records a durable pending gate before network submission.
Check send timeout, successful send with an uncertain lookup, and the next process run.
Determine whether later signing waits for original-hash reconciliation.
Keep this testnet acceptance path separate from the Go signer and normal guarded harness paths.
Specify a minimum fix that retains actual Stellar CLI submission coverage.
Do not run the live CLI pipeline. Use only isolated mocked commands and state.

Write `reports/concerns/c14-cli-submission-MODEL.md`.
Use `checks/concerns/c14-MODEL/` and `research/concerns/c14-MODEL/` when needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
