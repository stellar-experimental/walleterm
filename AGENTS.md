# Project rules

Build the smallest workable Stellar signing companion for agents.
Target macOS first. Permit human approval through 1Password.

## Scope

- Keep private keys inside 1Password. Never export, print, log, cache, or read private key fields.
- Generate production signer keys inside 1Password. Do not generate them externally and then import them.
- Local unit tests may use isolated mock keys. Never import these keys or use them for live signing.
- Use Ed25519. Passkeys and CAP-72 contract signers are not planned and are out of scope.
- Use the official Stellar CLI for transaction construction, network access, and submission where practical.
- Use Stellar Raven MCP for Stellar research and contract discovery.
- Research with `parallel-cli` and primary sources. Record source versions and evidence.
- Return JSON for commands consumed by agents. Use readable output for interactive setup and service commands.
- Build only the requested features. Keep commands, dependencies, and code minimal.
- Prefer one clear workflow with sensible defaults. Derive routine values from reliable context or live data when practical.
- Add flags, parameters, settings, or prompts only for meaningful choices that cannot be inferred safely.
- Automate setup and discovery. Keep consequential choices visible for review and preserve required human approval.
- Do not add speculative abstractions or configuration for hypothetical future needs.
- Keep custom contracts and complex orchestration in test fixtures unless an accepted use case requires runtime support.

Read `docs/INTERFACE.md` before changing the CLI. Read `docs/PLAN.md` for phase ownership and acceptance.
Read `docs/OPENZEPPELIN.md` before changing its contract adapters.

## Work process

- Establish the exact signing interface before implementing the CLI.
- Prove that 1Password signs the required bytes without exposing private keys.
- Coordinate requested agents through Herdr. Preserve the caller directory and focus.
- Give each agent a bounded task, file ownership, and a completion check.
- Do not delegate further unless the parent explicitly requests it.
- Use dedicated testnet accounts and contracts. Never use mainnet funds.
- Do not change existing 1Password items or sign with unrelated keys.
- Record live transaction hashes, ledger results, account states, and contract versions.
- Distinguish local tests, live 1Password tests, and testnet acceptance.
- Do not claim a skipped or blocked test passed.
- Review security-sensitive signing code independently before accepting it.

## Writing

Use ASD-STE100 Simplified Technical English for user-facing prose.
Use active voice and sentences of 20 words or fewer.
Keep technical identifiers exact.
