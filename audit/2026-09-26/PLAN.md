# Repository audit plan

Status: complete. The final report preserves the checkout TypeScript limitation.

## Scope and authority

The user requests paired Astra and Daybreak reviews for each major area and each material concern.
The user also requests paired overall reviews and an indexed final report.
The audit reads a fixed source revision. It does not implement mitigations.
Each reviewer starts with a separate context. Both requested models belong to the OpenAI model family.
Model agreement supports review coverage, but reproducible evidence decides each concern.
The baseline is `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
The repository was clean when the baseline was captured.
Other agents have active work. Final source comparisons will identify drift.

## Review matrix

| Area | Primary responsibility | Astra | Daybreak |
|---|---|---|---|
| 01-signer | Go signer and 1Password boundary | complete | complete |
| 02-bridge | Bridge service and authorization | complete | complete |
| 03-runtime | Service runtime and tunnel lifecycle | complete | complete |
| 04-sdk | Browser SDK and connection UI | complete | complete |
| 05-demo | Demo website and transaction recovery | complete | complete |
| 06-contracts | Contract authorization and protocol fixtures | complete | complete |
| 07-verification | Test harness, submission journals, and acceptance evidence | complete | complete |
| 08-product | Installation, dependencies, agent skills, and product scope | complete | complete |
| 09-overall | Cross-area trust boundaries, report challenge, and summary | complete | complete |

## Sequence

1. Capture source hashes, instructions, tool availability, and the research allocation.
2. Run independent paired area reviews in bounded Herdr waves.
3. Run the relevant offline checks and preserve their outputs.
4. Reproduce consequential concerns and assign both models a bounded concern review.
5. Resolve disagreements through source evidence and minimum safe reproductions.
6. Run fresh paired overall reviews after area reports exist.
7. Write the final report, mitigation options, evidence limits, and index.
8. Verify source hashes, report links, coverage, model identity, and research usage.

## Evidence rules

Confirmed concerns require a reachable scenario, code evidence, and a material impact.
A negative result means no material concern appeared within the stated checks.
Green tests do not prove live signing, mobile behavior, deployment, or complete security.
Previously recorded live acceptance remains historical evidence.
Tests use mock keys and temporary state. Live signing and testnet writes remain not_run.
The audit treats documented testnet website approval as an accepted boundary.
It separates useful capability gaps from speculative complexity.

## Research allocation

The user authorized up to $250 for paid research.
Reserve $160 for 16 area reviews, $20 for overall reviews, $60 for concern reviews, and $10 centrally.
Each initial area reviewer may run one Jev question with at most $1 allocation.
Each reviewer may use one query through each requested general search provider.
Unused allocation remains unused. Report unknown charges honestly.
Do not increase allocations, add credits, or purchase subscriptions.

## Artifacts

- `manifest.json`: baseline revision, hashes, model identifiers, and authority.
- `briefs/`: shared contract and bounded area briefs.
- `reports/`: independent reviews, concern reviews, and overall reviews.
- `research/`: compact provider records and primary-source evidence.
- `checks/`: commands, results, and targeted offline reproductions.
- `REPORT.md`: reconciled final assessment and mitigation options.
- `INDEX.md`: coverage and direct links to all final reports.
