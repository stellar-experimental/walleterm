# walleterm

A small macOS signing companion for agents using Stellar and 1Password.

Run `walleterm tunnel` to start the independent testnet signing bridge.
Run `walleterm demo` separately to try the example website.
The demo uses the same browser client that another integrated website can use.
See [the bridge guide](docs/WEB-BRIDGE.md) and [protocol](bridge/PROTOCOL.md).

`walleterm` lists public Ed25519 keys and signs 32-byte digests through the 1Password desktop SSH agent.
It verifies each signature before returning it. The runtime has no third-party Go dependencies.

## Install

Install Go, Node.js 22 or later, npm, and cloudflared. Homebrew includes npm with Node.js.
The 1Password desktop app must expose a dedicated Ed25519 key through its SSH agent.

```sh
brew install go node cloudflared
make install
make install-skill
walleterm --help
stellar walleterm --help
```

`make install` installs the binary and `stellar-walleterm` executable alias into `~/.local/bin`.
Keep that directory on `PATH`, including in non-interactive agent shells.
Both commands work from any directory. They do not require a shell alias.
Run `make install` again after source changes to update the binary and web files together.
The installer prepares all dependencies before it switches the command to a complete version.
A failed build or npm install preserves the previous command. Existing processes keep their original files.
Version directories stay under `~/.local/share/walleterm/releases` for running processes and rollback.
Use `make build` for a build under this checkout's `bin/` directory.
`make install-skill` links this checkout's skill through `~/.agents/skills/walleterm`.
Claude Code and Codex use links from their own skill directories to that shared path.
OpenCode and Grok discover the shared path directly.
Edit `.agents/skills/walleterm/` in this checkout. New sessions read those edits without another copy or install.
Keep this checkout at its current path. The installer preserves conflicting destinations and reports them.

Generate an Ed25519 SSH key inside the 1Password desktop app.
Enable that item in the 1Password SSH agent configuration.
Keep its private-key field concealed. Use its public G-address to select it.

## Start the signing bridge and demo

In one terminal:

```sh
walleterm tunnel
```

It shows a public bridge URL, an eight-digit connection code, and a QR code.
Keep this terminal visible. You approve each signing request here.

In another terminal:

```sh
walleterm demo
```

Open the public demo URL or scan its QR code. In the demo, click Scan tunnel and scan the tunnel QR code.
You can also type the bridge URL and code. Click Connect wallet and select a dedicated testnet wallet.
Create a demo request. Type the `sign` challenge in the tunnel terminal, then approve 1Password if it asks.
Submit the signed transaction from the demo.
The demo selects an existing testnet payment recipient automatically. The bridge needs no recipient.

Both commands show readable links and QR codes without extra flags.
Either command can stop without stopping the other. Neither command starts automatically at login.
Keep the Mac awake and the tunnel command running. The tunnel URL changes after a restart.
Each connection code works once and expires after five minutes. A website session lasts one hour.
Websites must reconnect after a reload or bridge restart.
Use only dedicated testnet accounts. This version supports native payments, data entries, and sell offers.
Other transaction types and mainnet requests fail before approval.

The private bridge journal is `~/Library/Application Support/walleterm/bridge`.
A crash can leave `.web-lock`; verify its recorded processes stopped before removing only the lock.
Preserve request records. Interrupted signing remains unknown and never retries automatically.
The demo stores its submitted hash and signed XDR in browser local storage.
After an uncertain submission, check the original hash. Do not submit a replacement.
See [the bridge guide](docs/WEB-BRIDGE.md) for recovery and integration details.

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
