# walleterm

A small macOS signing companion for agents using Stellar and 1Password.

`walleterm` lists public Ed25519 keys and signs 32-byte digests through the 1Password desktop SSH agent.
It verifies each signature before returning it. The runtime has no third-party Go dependencies.

## Install

Install Go, the 1Password desktop app, and the Stellar CLI first.
Enable the 1Password SSH agent in the desktop app.

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
`make install-skill` links this checkout's signing and site bridge skills through `~/.agents/skills`.
Claude Code and Codex use links from their own skill directories to that shared path.
OpenCode and Grok discover the shared path directly.
Edit `.agents/skills/` in this checkout. New sessions read those edits without another copy or install.
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

Signing success returns JSON with the public key, digest, hexadecimal signature, and `verified: true`.
Failure returns JSON with a stable error code and a nonzero exit status.
See [the interface](docs/INTERFACE.md) for exact fields and limits.

Use the official Stellar CLI to construct and inspect transactions.
Use the CLI or official SDK to calculate digests and insert returned signatures.
Use Stellar Raven MCP for Stellar questions and contract discovery.
See [Stellar CLI integration](docs/STELLAR-CLI.md) and [OpenZeppelin formats](docs/OPENZEPPELIN.md).
The [companion skill](.agents/skills/walleterm/SKILL.md) gives agents the signing workflow.
The [site bridge skill](.agents/skills/walleterm-site-bridge/SKILL.md) connects testnet websites through reviewed XDR requests.

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

## Tests

```sh
make test
npm ci --ignore-scripts
cargo build --locked --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none
npm test
```

Tests run offline with mock keys after dependency installation and fixture compilation.
The Node suite needs the CAP-71 Rust fixture build shown above.
Install Rust and its `wasm32v1-none` target for that build.
Node dependencies support the test tools only.
See [the live test guide](docs/LIVE-TESTS.md) for fixture builds and dedicated 1Password test keys.
Live tests request signatures and create testnet transactions and contracts.
An unknown submission blocks further signing and submission across process restarts.
Run `node tests/live.mjs reconcile` to query the saved hash without submitting it again.

## Verified coverage

The 2026-09-25 testnet run passed classic multisig, fee bumps, mixed G/C accounts, replay, and signer rotation.
It also passed OpenZeppelin authorization, native CAP-71 delegation, and CAP-85 external executable tests.
See [the evidence index](evidence/README.md) for exact coverage and limits.

Git includes source, lockfiles, pinned contract artifacts, and acceptance summaries.
Local signer metadata, submission journals, raw evidence, and build caches stay ignored.
Keep unresolved submission journals until their original transaction hashes are resolved.
