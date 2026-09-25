# Acceptance follow-up

The follow-up work completed on 2026-09-25.

- Core output failures return nonzero status without another signing request.
- The submission guard stops signing after an unknown transaction outcome.
- Live denial, cancellation, and locked-app connection closure returned no signature.
- An independent agent used the installed CLI for a payment and OpenZeppelin multisig call.
- E01-E03 covered native multisig, delegated G signers, and contract-specific rules.
- CAP-71 and CAP-85 added native delegation and external executable coverage.

See [the acceptance summary](../evidence/acceptance-summary.json) and [protocol results](PROTOCOL-UPDATES.md).
The raw review reports and run journals remain local under `evidence/`.
Use [the development plan](PLAN.md) for future changes.
