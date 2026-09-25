# Development plan

The initial implementation and acceptance work completed on 2026-09-25.
See [the acceptance summary](../evidence/acceptance-summary.json) for coverage and limits.

## Keep the core small

- Support macOS and the 1Password desktop SSH agent.
- Keep key creation, storage, and signing inside 1Password.
- Provide `list` and `sign`, with JSON output and optional `--human` formatting.
- Require one explicit public key and one 32-byte digest per signature.
- Verify each returned signature before reporting success.
- Keep network calls, XDR assembly, and contract adapters outside the Go binary.

The [interface](INTERFACE.md) defines the input, output, socket checks, and limits.
Use Stellar CLI or the official SDK to build and inspect transactions.
Use Stellar Raven for protocol questions and contract discovery.

## Change process

1. Define the smallest required interface change.
2. Add tests for the behavior or failure being changed.
3. Review signing and submission changes independently.
4. Run offline tests before requesting live signatures.
5. Run authorized testnet cases with dedicated keys and one live runner at a time.
6. Record transaction results and the resulting account or contract state.
7. Update the interface, skill, and acceptance summary where needed.

For parallel work, assign exact files before agents edit them.
Keep source review, offline tests, live signatures, and testnet acceptance separate in reports.
A signature alone does not prove authorization or transaction acceptance.

## Recovery

An unknown submission stops new signing and submission.
Query its original transaction hash before continuing.
Preserve submission journals and checkpoints until the outcome is known.
See [live tests](LIVE-TESTS.md) for setup and recovery commands.

## Future scope

Passkeys require a separate implementation and acceptance suite.
New C-account formats require adapters for their digest and signature rules.
The existing tests do not establish compatibility with every smart account.
