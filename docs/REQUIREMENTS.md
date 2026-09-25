# Requirements and decisions

## Confirmed

- Build a minimal signing companion for the official Stellar CLI.
- Target agents. Return JSON by default and provide `--human`.
- Target macOS first.
- Permit 1Password approval prompts, including Touch ID.
- Keep private keys within 1Password throughout generation, storage, and signing.
- Prefer Ed25519. Treat passkeys as optional work after feasibility review.
- Support classic G-account transactions and Soroban authorization for G-accounts and C-accounts.
- Test OpenZeppelin accounts and the multisig smart account example.
- Test complex multisig and multiple accounts on Stellar testnet.
- Use Herdr with Astra, Fable, Opus, Grok, and Sol for suitable tasks.
- Use Stellar Raven MCP and `parallel-cli` for research.
- Dedicated test items may use vault `kxx6p3pmtgq2hsrsjh4gakqfdi`.
- Use new dedicated test keys. Preserve all existing vault items.

## Current evidence

The workspace started empty, without Git metadata.
The installed Stellar CLI reports version 27.1.0.
The installed 1Password CLI reports version 2.39.0.
The standard macOS 1Password SSH agent socket exists.
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
