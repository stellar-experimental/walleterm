# Requirements and decisions

## Confirmed

- Build a minimal signing companion for the official Stellar CLI.
- Target agents. Return JSON by default and provide `--human`.
- Target macOS first.
- Permit 1Password approval prompts, including Touch ID.
- Keep private keys within 1Password throughout generation, storage, and signing.
- Use Ed25519. Passkeys are not planned and are out of scope.
- Support classic G-account transactions and Soroban authorization for G-accounts and C-accounts.
- Test OpenZeppelin accounts and the multisig smart account example.
- Test complex multisig and multiple accounts on Stellar testnet.
- Use Herdr with Astra, Fable, Opus, Grok, and Sol for suitable tasks.
- Use Stellar Raven MCP and `parallel-cli` for research.
- Use a vault authorized for dedicated test items.
- Use new dedicated test keys. Preserve all existing vault items.

## Current evidence

The acceptance run used Stellar CLI 27.1.0 and 1Password CLI 2.39.0.
The live signing feasibility check passed with a fresh desktop-generated key.
Independent Node.js verification passed, and an altered payload failed verification.
G01-G10 passed on testnet, including weighted multisig, fee bumps, multiple sources, and signer rotation.
The suite restored the original classic signer settings.
The official Stellar CLI build, hash, decode, encode, and submission pipeline also passed.

## Completion evidence

Separate source research, local protocol tests, live 1Password signing, and accepted testnet transactions.
Record each scenario as passed, failed, blocked, or not run.
A generated signature alone does not prove account authorization.
An accepted transaction alone does not prove the intended balance or policy change.
