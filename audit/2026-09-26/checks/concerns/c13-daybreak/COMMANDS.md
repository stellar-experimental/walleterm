# C13 Daybreak checks

All commands ran from `/Users/kalepail/Desktop/walleterm-v2`.

## Preserved reproduction

```sh
TMPDIR=/private/tmp bun audit/2026-09-26/checks/06-contracts-astra/x06-recovery-repro.ts
```

The command passed with exit code `0`.
The saved-success case failed before any operation or checkpoint write.
The control completed one final operation.

## Inflight reproduction

```sh
TMPDIR=/private/tmp bun audit/2026-09-26/checks/concerns/c13-daybreak/x06-inflight-repro.ts
```

The final command passed with exit code `0`.
It tested saved success and `SUCCESS` inflight reconciliation.
Both cases cached the final step and made zero operation calls during resume.
Both cases failed the stale `adopt_ref` assertion.
Neither case returned from X06.

The first local run failed before testing the concern.
The extracted code retained an `export` keyword.
The corrected harness removes module exports before evaluation.

## Reused checks

I reused `checks/baseline-permitted-results.json`.
The permitted Go race and Bun test commands passed centrally.
I reused `checks/06-contracts-astra/source-verification.json`.
That check matched 199 frozen blobs and 14 CAP-85 source hashes.

No command used a network, live key, signature request, or public service.
