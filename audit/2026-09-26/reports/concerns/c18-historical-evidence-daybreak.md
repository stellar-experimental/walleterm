# C18 Historical Evidence — Daybreak

## Assignment

Concern: `C18`. Model / effort: Daybreak / xhigh. Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
Review date: 2026-09-26. Scope: Current wording, historical evidence, migration limits, and revision binding.
I reviewed only C18, read no paired report, and changed no production files.

## Verdict

Verdict: **accepted verification limit**. Priority: **Informational**. Confidence: **High**.

No exact frozen sentence claims that baseline `40d6cca9db73` received fresh live acceptance.
The repository accurately records older live acceptance and current offline verification.
`README.md:150` uses the ambiguous phrase `current tunnel`.
That phrase can mislead a reader who does not open the linked evidence.
In context, it distinguishes `walleterm tunnel` from the removed combined `web` command.
The linked records date and limit the live runs.
Therefore, I do not confirm a false current-revision claim.

No runtime user has a direct impact. Release reviewers can misread the standalone README sentence.

## Reachable scenario

A reviewer reads only `README.md:145-151` and interprets `current tunnel` as baseline `40d6cca9db73`.
That interpretation lacks revision-specific evidence.
The linked index and migration notes correct it and disclose the missing live rerun.

## Evidence

| Source | Decisive evidence |
| --- | --- |
| `README.md:147-151` | The first run has a date. Line 150 lacks a tested revision. |
| `evidence/README.md:3-17,33-54` | The index dates, separates, and limits historical acceptance records. |
| `evidence/tunnel-testnet-2026-09-25.json:3-4` | The desktop tunnel record binds to `3bf7810`. |
| `evidence/tunnel-testnet-2026-09-25.json:108-120` | The phone record names mixed historical code states. |
| `evidence/tunnel-testnet-2026-09-25.json:197-226` | The website approval run binds to `a9b2982`. |
| `evidence/browser-qa-2026-09-25/report.md:1-4` | The browser report binds its test to `3bf7810`. |
| `docs/BUN-MIGRATION.md:35-49` | Current TypeScript checks passed offline. Live signing and testnet acceptance were not run. |
| `evidence/acceptance-summary.json:2-3,201-216` | The dated summary still records the historical Node reconciliation command. |
| `evidence/protocol-acceptance.json:531-536` | Protocol evidence hashes five removed `.mjs` sources. |
| `docs/PLAN.md:3-4` | The plan dates the initial acceptance work to 2026-09-25. |

The tested tunnel revisions precede the baseline by 30 and 23 commits.
Relevant bridge, demo, SDK, and test files changed after those runs.
The old evidence cannot establish live acceptance of the frozen baseline.

## Counterevidence and non-issues

The records include hashes, ledgers, results, dates, and explicit limits.
They support historical outcomes without private signer metadata or signed envelopes in Git.

The 2026-09-26 confidential-token record shows later live signing without a Walleterm revision.
It records `tunnel_started: false` at `evidence/confidential-token-2026-09-26.json:226-229`.

Later vault and wallet-switch checks requested no signature or transaction.
See `docs/VAULT-FILTER-VALIDATION.md:40-46` and `docs/WALLET-SWITCH-VALIDATION.md:60-69`.

Missing ignored records reduce reproduction, but their absence does not make dated claims false.

## Minimum mitigation

No correctness mitigation is required.
Use a small clarity edit in `README.md:150` during the next documentation change.

Suggested wording: “Historical `walleterm tunnel` builds passed live 1Password signing on testnet on 2026-09-25.”

Add one sentence stating that `40d6cca9db73` has no fresh live acceptance run.
This edit removes the only material ambiguity.

An optional manifest needs only seven fields.
Use `date`, `tested_revision`, `installed_release`, `flow`, `result`, `limits`, and `evidence_sha256`.
Do not publish credentials, vault identifiers, signer metadata, signatures, or signed envelopes.

## Checks

| Check | Outcome |
| --- | --- |
| Preserved evidence reproduction | **passed**; output matched the original result exactly |
| Frozen source and manifest check | **passed** in preserved checks; 59 selected files matched |
| Tracked JSON parsing | **passed** in preserved checks; 11 summaries parsed |
| Historical source comparison | **passed**; five `.mjs` paths are absent and current hashes differ |
| Tunnel revision ancestry | **passed**; `3bf7810` and `a9b2982` are earlier ancestors |
| Current-claim search | One ambiguous phrase at `README.md:150` |
| Live signing and submission | **not_run**, as required |

Exact commands and outcomes are in `checks/concerns/c18-daybreak/commands.md`.
Central offline checks passed earlier and were not repeated.

## Research usage and limits

No unresolved external fact required provider research.
I reused the preserved repository evidence and primary Git history.
New research cost was `$0`. New Jev cost was `$0` of the `$0.25` cap.
New provider charges were none.

I did not read ignored signer data or local live journals.
I did not perform live signing, submission, or receipt reconciliation.
The review is complete without blockers.
