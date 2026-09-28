# C03 exact checks

The source working directory was `/private/tmp/walleterm-audit-40d6cca9db73` unless stated otherwise.
The report and evidence directory was `/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26`.

## Source verification

From `/Users/kalepail/Desktop/walleterm-v2`:

```sh
python3 audit/2026-09-26/checks/concerns/c03-astra/verify-snapshot.py > audit/2026-09-26/checks/concerns/c03-astra/snapshot-verification.json
```

Outcome: **passed**. All 199 hashes matched, and the baseline Git tree matched the manifest file list.
The script uses `git ls-tree` against the exact revision. It makes no Git changes.
A read-only inline check used the same comparison before test creation. It also passed.

The final report check ran from `/Users/kalepail/Desktop/walleterm-v2`:

```sh
python3 audit/2026-09-26/checks/concerns/c03-astra/validate-report.py > audit/2026-09-26/checks/concerns/c03-astra/report-validation.json
```

It verifies the report, evidence files, costs, test results, and frozen source hashes.

## Existing reproduction inspection

```sh
cat /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/02-bridge-daybreak/targeted-results.json
nl -ba bridge/server.test.ts | sed -n '1,205p'
```

The preserved record reports two passed checks for pairing and the review queue.
Only the pairing test was relevant to C03. The original evidence contains no separate reproduction script.

## Targeted test commands

```sh
BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-bun-cache bun test bridge/server.test.ts /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c03-astra/pairing.test.ts --test-name-pattern 'short codes expire|C03:' > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c03-astra/targeted-tests.log 2>&1
```

Outcome: **failed**, exit 1. Both selected tests failed to open loopback listeners with `EADDRINUSE`.
No behavioral assertion ran in that attempt.
Automatic approval review permitted the retry with loopback access.

```sh
BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-bun-cache bun test bridge/server.test.ts /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c03-astra/pairing.test.ts --test-name-pattern 'short codes expire|C03:' > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c03-astra/targeted-tests-permitted.log 2>&1
```

Outcome: **passed**, exit 0. Two tests passed; 43 tests were filtered; zero tests failed.
The added test log records response statuses without session tokens or connection codes.
Its first cycle uses one attacker Origin. Its second cycle uses a forged victim Origin and four invented Origins.
It advances the injected clock by two one-minute intervals. It does not wait two real minutes.
It checks that intervening blocked requests do not extend the deadline.
It closes the loopback listener in `finally` and does not start a public service.
The existing test uses isolated random mock keys. The added test uses no keys.

## Runtime and tool discovery

```sh
bun --version
uname -srm
readlink node_modules
command -v stellar-raven-jev parallel-cli
```

Results: Bun `1.4.2`; host `Darwin 25.6.0 arm64`.
The snapshot links `node_modules` to `/Users/kalepail/Desktop/walleterm-v2/node_modules`.
Jev resolves to `/Users/kalepail/.cargo/bin/stellar-raven-jev`.
parallel-cli resolves to `/Users/kalepail/.local/bin/parallel-cli`.
Local session metadata exposed Raven, Parallel Search, and Perplexity tool names.
This discovery sent no provider query. No CLI research command ran.

## Evidence files

| File | Purpose |
|---|---|
| `pairing.test.ts` | Added bounded HTTP reproduction |
| `targeted-tests.log` | Initial sandbox failure |
| `targeted-tests-permitted.log` | Passed tests and response transcript |
| `verify-snapshot.py` | Manifest and baseline-tree verification |
| `snapshot-verification.json` | Verification result |
| `validate-report.py` | Final report and artifact validation |
| `report-validation.json` | Final report and artifact checks |
| `../../../research/concerns/c03-astra/usage.json` | Research calls, charges, and preserved source provenance |

The preserved primary source is `research/02-bridge-astra/perplexity.json`, relative to the audit directory.
The report uses only its MDN CORS excerpt for browser behavior.
The frozen source and direct HTTP requests establish the C03 conclusion.
The full baseline and all live checks remain **not_run** in this review.
