# C18 Astra checks

Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Source: `/private/tmp/walleterm-audit-40d6cca9db73`.
All commands below use `/Users/kalepail/Desktop/walleterm-v2` as their working directory.

## Existing checks inspected

I read both original `reports/07-verification-*.md` reports, as assigned.
I inspected these scripts and their preserved results before execution:

- `checks/07-verification-astra/evidence-check.py` and `evidence-check.json`.
- `checks/07-verification-daybreak/audit-checks.ts.txt` and `audit-checks-result.json`.

The Astra script already checks historical evidence without reading ignored records.
The Daybreak script also checks other concerns. I did not run it.
No new product test or runtime reproduction was necessary.

## Exact check commands

```sh
mkdir -p audit/2026-09-26/checks/concerns/c18-astra
python3 audit/2026-09-26/checks/07-verification-astra/evidence-check.py > audit/2026-09-26/checks/concerns/c18-astra/evidence-check.json 2> audit/2026-09-26/checks/concerns/c18-astra/evidence-check.stderr
python3 audit/2026-09-26/checks/concerns/c18-astra/verify-provenance.py > audit/2026-09-26/checks/concerns/c18-astra/provenance.stdout
```

The commands returned exit status `0`.
The existing check verified 59 frozen files, parsed 11 JSON summaries, and checked 38 recorded protocol transactions.
It reproduced five removed `.mjs` paths and five differing `.ts` hashes.
Its complete JSON result matched the preserved result.
These checks establish consistency, not ledger acceptance.

The C18 script verified 21 documents against the manifest and baseline Git objects.
It confirmed that all 199 manifest paths match the baseline tree.
It checked nine absent local record paths through tree membership only.
It resolved `3bf7810` and `a9b2982` and confirmed that both precede the baseline.
The initial equivalent Python heredoc produced the same observations before I saved the reproducible script.

The script contains the exact read-only `git ls-tree`, `git show`, `git rev-parse`, and `git merge-base` arguments.
`provenance.json` contains document hashes and full historical revisions.
`evidence-check.stderr` is empty.

## Manual claim checks

| Frozen source | Inspected claim |
| --- | --- |
| `README.md:145-155` | Historical acceptance and the ambiguous phrase `current tunnel` |
| `docs/PLAN.md:3-4` | Date of initial acceptance |
| `docs/BUN-MIGRATION.md:35-49` | Offline migration checks and missing live acceptance |
| `docs/BUN-MIGRATION.md:59-65` | Public startup check only |
| `evidence/README.md:3-59` | Dates, historical records, ignored records, and status definitions |
| `evidence/acceptance-summary.json:2-3`, `:201-216` | Historical date and Node command |
| `evidence/protocol-acceptance.json:2-4`, `:502-536` | Historical scope, limits, and source hashes |
| `evidence/tunnel-testnet-2026-09-25.json:2-10`, `:108-119`, `:197-216` | Historical desktop and phone coverage |
| `evidence/mobile-poc/README.md:30-31` | Removed `web` command and local screenshots |
| `evidence/browser-qa-2026-09-25/report.md:1-3` | Historical browser test revision |
| `docs/VAULT-FILTER-VALIDATION.md:39-46` | Live discovery without live signing |
| `docs/WALLET-SWITCH-VALIDATION.md:60-69` | Live selection without signatures or submissions |

Source inspection used `cat`, `nl -ba`, `sed -n`, and bounded `rg -n` searches.
I read the required `AGENTS.md`, `README.md`, `docs/PLAN.md`, and `docs/INTERFACE.md` first.
I did not read the paired C18 report or other concern reports.

## Research and execution limits

Tool discovery found Raven, Parallel Search, and Perplexity MCP operations.
`command -v stellar-raven-jev parallel-cli` returned both CLI paths with exit status `0`.
I read the two research skill files specified in `COMMON.md`.
No unresolved external fact required a provider request, CLI help, or Jev doctor.
The preserved repository records supplied the relevant primary evidence.
The original research source record concerns RPC and filesystem behavior; neither decides C18.
New provider calls: `0`. New research cost: `$0`. New Jev cost: `$0`.
New unknown provider charges: none. Prior review charges remain separate.
Live signing, submission, public tunnels, and receipt reconciliation: `not_run`.
Product tests and the baseline suite: `not_run` in this review.
Only the assigned C18 report and its check files changed.
