# Follow-up execution

The parent coordinates all live 1Password tests and testnet submissions.
Workers do not sign, change vault items, or submit transactions until the parent assigns a live execution window.

| Agent | Task | Write ownership |
| --- | --- | --- |
| wt-astra | Core review, output fix, submission guard, extended test review | Review report; `main.go`, `main_test.go`; new submission module and tests, assigned sequentially |
| wt-grok | Final orchestration review | `evidence/review-tests-next.md` only |
| wt-sol | Portable skill packaging | `.agents/skills/walleterm/**`, `Makefile`, `evidence/skill-portability.json` |
| wt-fable | Extended authorization coverage | `tests/extended-contracts.mjs`; new fixtures only if required |
| wt-opus | Agent usability from outside checkout | Assigned after skill installation; separate temporary directory |
| Parent | Integration and live execution | Shared helpers, runtime fixes after review, live evidence, other documentation |

The signing core remains frozen during review.
The parent grants shared helper exports before workers use them.
Workers request ownership changes before editing another worker's files.
The parent serializes all live signing, account changes, and desktop lock tests.

## Acceptance

- Resolve supported final review findings and verify each correction.
- Record live refusal, lock, cancellation, and connection-loss behavior without changing approval settings.
- Install a self-contained skill and verify its references outside the checkout.
- Complete an independent agent payment and OpenZeppelin multisig workflow using installed commands.
- Test native G-account Soroban multisig, delegated signers, and context-specific account rules.
- Preserve previous evidence and distinguish new execution from reused results.

Passkeys remain a separate project.

## Completed on 2026-09-25

All acceptance items above are complete. The parent serialized each live test window.
The core output fix passed offline tests and is installed.
The submission guard passed 35 offline tests and an independent integration review.
Two checkpoint tests passed. A classic recovery mock made zero signatures after an unknown submission.
Observed denial, cancellation, and locked-app connection closure returned no signature.
Opus completed an independent payment and OpenZeppelin multisig call from outside the checkout.
The second task used legacy `address` credentials successfully.
The parent completed E01-E03 on testnet and verified account B's restoration.
All workers released file ownership after their tasks. No live submission remains unresolved.
See `../evidence/acceptance-summary.json` and `../evidence/review-followup-resolutions.md`.

## Protocol compatibility extension

See `PROTOCOL-UPDATES.md` for the subsequent CAP-71 and CAP-85 work and its file ownership.
The assignments in that document supersede the table above for that work.
