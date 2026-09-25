# walleterm

A small macOS signing companion for agents using Stellar and 1Password.

`walleterm` lists public Ed25519 keys and signs 32-byte digests through the 1Password desktop SSH agent.
It verifies each signature before returning it. The runtime has no third-party Go dependencies.

## Install

```sh
make install
make install-skill
walleterm --help
stellar walleterm --help
```

`make install` installs the binary and `stellar-walleterm` executable alias into `~/.local/bin`.
Keep that directory on `PATH`, including in non-interactive agent shells.
Both commands work from any directory. They do not require a shell alias.
Run `make install` again after source changes to update the installed binary.
Use `make build` for a build under this checkout's `bin/` directory.
`make install-skill` links this checkout's skill through `~/.agents/skills/walleterm`.
Claude Code and Codex use links from their own skill directories to that shared path.
OpenCode and Grok discover the shared path directly.
Edit `.agents/skills/walleterm/` in this checkout. New sessions read those edits without another copy or install.
Keep this checkout at its current path. The installer preserves conflicting destinations and reports them.

Generate an Ed25519 SSH key inside the 1Password desktop app.
Enable that item in the 1Password SSH agent configuration.
Keep its private-key field concealed. Use its public G-address to select it.

## Use

```sh
walleterm list
walleterm list --human
printf '%s\n' '{"public_key":"G...","digest":"64 lowercase hexadecimal characters"}' | walleterm sign
```

Success returns JSON containing the public key, digest, raw signature in hexadecimal, and `verified: true`.
Failure returns JSON with a stable error code and a nonzero exit status.
See [the interface](docs/INTERFACE.md) for exact fields and limits.

Use the official Stellar CLI to construct and inspect transactions.
Use the CLI or official SDK to calculate digests and insert returned signatures.
Use Stellar Raven MCP for Stellar questions and contract discovery.
See [Stellar CLI integration](docs/STELLAR-CLI.md) and [OpenZeppelin formats](docs/OPENZEPPELIN.md).
The [companion skill](.agents/skills/walleterm/SKILL.md) gives agents the signing workflow.

## Boundaries

The two commands are `list` and `sign`. Manage key creation, names, and archival in 1Password.
The signing command does not know a digest's network, amount, destination, or contract policy.
Inspect and approve the source artifact before signing it.
The 1Password prompt identifies the application and key. Cached approval can allow later signatures without another prompt.

The fixed socket avoids accidental use of another SSH agent.
It does not provide cryptographic proof of 1Password origin or protection against a compromised local user.
Use dedicated wallet keys. A shared SSH key can authorize other systems with the same key.

The runtime supports Ed25519. Passkeys remain a separate future task.
Contract accounts require their exact authorization digest and signature structure.

## Tests and execution plan

```sh
make test
npm ci --ignore-scripts
node tests/live.mjs classic
node tests/live.mjs contracts
node tests/live.mjs extended
```

Live tests use dedicated testnet keys and request 1Password approvals.
They create testnet transactions and contracts.
An unknown submission blocks further signing and submission across process restarts.
Run `node tests/live.mjs reconcile` to query the saved hash without submitting it again.
Read [the plan](docs/PLAN.md) and [test matrix](docs/TEST-MATRIX.md) before running them.

The live raw signing proof passed. See [the evidence](evidence/1password-feasibility.json).
All ten classic scenarios and the Stellar CLI pipeline passed on testnet.
Contract acceptance also passed, including OpenZeppelin multisig, mixed G/C accounts, nested calls, replay, and rotation.
See [the evidence index](evidence/README.md) for coverage, corrections, and limits.
