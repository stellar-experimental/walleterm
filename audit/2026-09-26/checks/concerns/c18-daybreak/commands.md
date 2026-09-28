# C18 Daybreak check record

Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
Date: 2026-09-26.

## Existing reproductions

I inspected both original verification check scripts and their preserved results.
I also inspected the existing C18 provenance script and results.
I did not read the paired C18 report.

- `checks/07-verification-astra/evidence-check.py`
- `checks/07-verification-astra/evidence-check.json`
- `checks/07-verification-daybreak/audit-checks.ts.txt`
- `checks/07-verification-daybreak/audit-checks-result.json`
- `checks/concerns/c18-astra/verify-provenance.py`
- `checks/concerns/c18-astra/provenance.stdout`

## Exact checks

```sh
python3 audit/2026-09-26/checks/07-verification-astra/evidence-check.py |
  cmp - audit/2026-09-26/checks/07-verification-astra/evidence-check.json
```

Result: `passed`. The reproduced JSON matched the preserved result exactly.

```sh
jq -e '.date == "2026-09-25" and .submission_guard.reconcile_command == "node tests/live.mjs reconcile"' \
  /private/tmp/walleterm-audit-40d6cca9db73/evidence/acceptance-summary.json
jq -e '.source_sha256 | keys == ["tests/cap71.mjs","tests/cap71.test.mjs","tests/cap85.mjs","tests/cap85.test.mjs","tests/live.mjs"]' \
  /private/tmp/walleterm-audit-40d6cca9db73/evidence/protocol-acceptance.json
jq -e '.revision == "3bf7810" and .website_approval_run.revision == "a9b2982"' \
  /private/tmp/walleterm-audit-40d6cca9db73/evidence/tunnel-testnet-2026-09-25.json
```

Result: `passed`. All three commands returned `true` and exit status `0`.

```sh
git -C /Users/kalepail/Desktop/walleterm-v2 merge-base --is-ancestor \
  3bf7810772fc3314261c8dd0f445ade6d150b192 40d6cca9db732a0db16d154c80d4a153bf33c6b7
git -C /Users/kalepail/Desktop/walleterm-v2 merge-base --is-ancestor \
  a9b2982e003aa4955f9e8da1c5f5ca741e049e21 40d6cca9db732a0db16d154c80d4a153bf33c6b7
git -C /Users/kalepail/Desktop/walleterm-v2 rev-list --count \
  3bf7810772fc3314261c8dd0f445ade6d150b192..40d6cca9db732a0db16d154c80d4a153bf33c6b7
git -C /Users/kalepail/Desktop/walleterm-v2 rev-list --count \
  a9b2982e003aa4955f9e8da1c5f5ca741e049e21..40d6cca9db732a0db16d154c80d4a153bf33c6b7
```

Result: `passed`. Both tested revisions are ancestors of the baseline.
The baseline follows them by 30 and 23 commits, respectively.

The claim search found one currentness phrase at `README.md:150`.
`docs/BUN-MIGRATION.md:47-49` gives the controlling current verification limit.

Live signing, submission, receipt reconciliation, and public tunnels were `not_run`.
No product test or baseline suite ran in this focused review.
No ignored live record was read.
No production file changed.
