# C18 — Historical versus current live acceptance

| Field | Result |
| --- | --- |
| Reviewer | Astra; effort `xhigh`, as assigned |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Verdict | **Accepted verification limit; no confirmed false claim of fresh acceptance for this revision** |
| Priority / confidence | Informational / high |
| Concern count | One accepted limit; zero confirmed defects |
| Affected users | Maintainers and reviewers who need acceptance evidence for the exact source revision |

## Scope and decision

I reviewed README coverage, the evidence index, acceptance summaries, tunnel records, and Bun migration notes.
I checked linked browser, mobile, vault, and wallet validation statements only for their claimed acceptance scope.
Both assigned original verification reports informed this review. I did not read the paired C18 report.

The frozen documents disclose historical runs and the migration's missing live acceptance.
They do not establish fresh live acceptance for `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
That evidence limit does not establish a false acceptance claim or a runtime defect.

## Exact claims and counterevidence

| Reference in frozen source | Evidence and implication |
| --- | --- |
| `README.md:147-148`; `docs/PLAN.md:3-4` | Both explicitly date initial acceptance to 2026-09-25. |
| `README.md:150-151` | “The current tunnel passed live 1Password signing on testnet from desktop Chromium and a real iPhone.” The next sentence links limits. |
| `evidence/tunnel-testnet-2026-09-25.json:3-10`, `:110`, `:198` | The record names older revisions `3bf7810` and `a9b2982`, Node `v24.13.0`, and phone changes. |
| `evidence/mobile-poc/README.md:30` | The older proof explicitly excludes `walleterm tunnel`; it tested the removed `web` command. |
| `docs/BUN-MIGRATION.md:47-48` | Browser checks used mocks. Camera capture, live 1Password signing, and testnet acceptance did not run. |
| `evidence/README.md:48-54` | The index discloses ignored raw records and distinguishes historical, prepared, and observed results. |
| `evidence/acceptance-summary.json:2`, `:201-216` | The dated summary retains its historical Node reconciliation command and labels offline checks. |
| `evidence/protocol-acceptance.json:2-4`, `:531-536` | The dated protocol record hashes five earlier `.mjs` files, not the current TypeScript files. |

The README's word “current” creates the strongest possible ambiguity.
A reader could interpret it as acceptance of the latest installed bytes.
In context, it identifies the separate tunnel workflow after the combined `web` command.
Its linked dates, older revisions, and explicit migration limits defeat a claim of demonstrated false freshness.
This wording merits optional clarification; it does not prove fresh acceptance or require a security finding.

The later live vault and wallet checks cover discovery and selection only.
They explicitly exclude new signatures and transactions (`docs/VAULT-FILTER-VALIDATION.md:46`; `docs/WALLET-SWITCH-VALIDATION.md:69`).
The public startup check concerns DNS and tunnel readiness only (`docs/BUN-MIGRATION.md:59-65`).
Neither supplies missing migration acceptance.

## Minimum mitigation and verification

No mandatory runtime mitigation follows from C18.
For clearer wording, replace the README sentence with: “The 2026-09-25 tunnel runs passed live signing on desktop Chromium and iPhone.”
Add: “The Bun migration did not receive fresh live signing or testnet acceptance.”
Keep the historical summaries and their original commands unchanged.

A small future manifest is optional. Create it only for an actual, separately authorized live run.
Record its date, tested commit, commands, versions, result statuses, and relevant artifact hashes.
If the tested tree contains edits, record the tested source hashes. Do not invent a historical commit binding.
Keep credentials, signer metadata, signatures, and signed envelopes local.
Verify manifest hashes against the tested artifacts before any future claim of current acceptance.
No live rerun or receipt reconciliation is required to close this documentation concern.

## Checks, sources, costs, and limits

| Check | Result |
| --- | --- |
| Inspected original evidence checks before execution | **passed**; reused the existing Astra check; no new product tests |
| Existing evidence reproduction | **passed**; 59 matching files, 11 valid JSON summaries, 38 recorded protocol transactions |
| Historical source comparison | **passed**; five removed `.mjs` paths; five different `.ts` hashes |
| C18 provenance check | **passed**; 21 documents match the manifest and Git; 199 manifest paths match the tree |
| Historical references | **passed**; nine local paths absent from Git; both tunnel revisions precede the baseline |
| Live signing, submission, receipt reconciliation | **not_run**; outside this review |

Exact commands and evidence: [commands.md](../../checks/concerns/c18-astra/commands.md).
Results: [evidence-check.json](../../checks/concerns/c18-astra/evidence-check.json) and [provenance.json](../../checks/concerns/c18-astra/provenance.json).
Primary sources are the frozen repository records cited above; their baseline defines their applicable version.
No external source can establish which private live run tested these bytes.
I reused preserved primary evidence. No unresolved external fact required new research.
New provider calls: **0**. New research cost: **$0**. Jev cost: **$0**, within the `$0.25` cap.
No new unknown provider charges arose. Earlier review charges remain separate from this `$1` allocation.
These checks establish document consistency and provenance. They do not verify historical ledger outcomes or current live behavior.
I changed only the assigned report and its C18 check files. Completion blockers: **none**.
