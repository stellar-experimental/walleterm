# walleterm

A small macOS signing companion for agents using Stellar and 1Password.

`walleterm` lists public Ed25519 keys and signs 32-byte digests through the 1Password desktop SSH agent.
It verifies each signature before returning it. The Go binary has no third-party dependencies.
`walleterm tunnel` also lets a connected testnet website request signatures.

## Install

Install Go, Bun 1.4.2 or later, cloudflared, the 1Password desktop app, and the Stellar CLI first.
Enable the 1Password SSH agent in the desktop app.

```sh
brew install go oven-sh/bun/bun cloudflared
make install
make install-skill
walleterm --help
stellar walleterm --help
```

`make install` installs the binary and `stellar-walleterm` executable alias into `~/.local/bin`.
Keep that directory on `PATH`, including in non-interactive agent shells.
Both commands work from any directory. They do not require a shell alias.
Run `make install` again after source changes to update the binary and bridge files together.
The installer prepares all dependencies before it switches the command to a complete version.
A failed build or Bun install preserves the previous command. Existing processes keep their original files.
Version directories stay under `~/.local/share/walleterm/releases` for running processes and rollback.
Use `make build` for a build under this checkout's `bin/` directory.
`make install-skill` links this checkout's signing and site bridge skills through `~/.agents/skills`.
Claude Code and Codex use links from their own skill directories to that shared path.
OpenCode and Grok discover the shared path directly.
Edit `.agents/skills/` in this checkout. New sessions read those edits without another copy or install.
Keep this checkout at its current path. The installer preserves conflicting destinations and reports them.
These local source links have no remote update record in `npx skills`.
The CLI can install global copies from this checkout with the following command:

```sh
npx skills add /absolute/path/to/walleterm-v2/.agents/skills -g \
  -s walleterm -s walleterm-site-bridge \
  -a claude-code -a codex -a opencode -a grok -y
```

Run that command from a scratch directory. It replaces the shared source links with copies.
Use `make install-skill` for source-linked development. Back up existing copies before restoring those links.
Check Codex's own skill directory after an `npx skills` install. Its runtime still needs the mirror here.
Claude Desktop Chat and Cowork use separate uploaded skill archives.
Upload a new archive after source edits. Local CLI links do not update those copies.
See [the skill audit](docs/SKILLS-AUDIT.md) for installation checks and coverage.

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
The [site bridge skill](.agents/skills/walleterm-site-bridge/SKILL.md) covers tunnel setup, website integration, and compatible website interception.

## Connect a website

Run the bridge in one terminal and the example website in another:

```sh
export OP_VAULT=Private
walleterm tunnel
walleterm demo
```

`OP_VAULT` limits the website wallet list to SSH keys in that 1Password vault.
Save `OP_VAULT=Private` in `.env` in the directory where you run `walleterm tunnel`.
Bun loads this file automatically. An exported shell variable overrides the file.
Keep `.env` local. Git ignores it, and the installer does not copy it.
Restart the tunnel after changing the setting. Reconnect the website with the new tunnel URL and code.
Use a vault name or ID. Vault filtering requires the 1Password CLI (`brew install 1password-cli`).
Enable 1Password CLI integration in the desktop app, or sign in before starting the tunnel.
The bridge reads only item metadata and public keys. It matches the full public key against the SSH agent.
A vault lookup failure stops wallet discovery. An empty vault returns an empty list.
An unset or empty `OP_VAULT` lists all available Ed25519 agent keys.
The bridge checks vault membership again before signing. `walleterm list` still lists all available Ed25519 agent keys.

The tunnel shows a public URL and an eight-digit connection code. It shows a QR code when the terminal is wide enough.
Open the demo with your phone camera, or on your desktop. In the demo, click Scan tunnel for the tunnel QR code.
You can also type the tunnel URL and code.
Review the permission for the displayed wallets, then select a dedicated testnet wallet.
The demo changes wallets within that connection. It needs no new scan or code.
New wallets require a new connection. Wallet changes preserve transaction records and the session expiry.
The services check public access every 15 seconds. Healthy checks produce no log output.
They replace failed public tunnels with bounded retries. Each replacement prints a new URL and QR code.
See [connection recovery and signing deadlines](docs/CONNECTION-LIFECYCLE.md).
Create a request in the demo.
Review it in the demo and select Sign. Approve 1Password on the Mac if it asks.
The demo submits the signed transaction to testnet.

A website integrates through [the browser client](sdk/walleterm.ts). The website approves its own requests, so use dedicated testnet keys.
The bridge supports testnet native payments, data entries, sell offers, and supported Soroban transactions.
The [contract authorization demo](docs/CONTRACT-AUTHORIZATION.md) signs an explicit C-account entry before the transaction envelope.
See [the bridge guide](docs/WEB-BRIDGE.md) for setup, recovery, and integration details.
The [demo activity log](docs/DEMO-ACTIVITY.md) keeps browser history and supports JSON export.

## Boundaries

The signing commands are `list`, `sign`, and `sign-auth`. Manage key creation, names, and archival in 1Password.
The signing command does not know a digest's network, amount, destination, or contract policy.
Inspect and approve the source artifact before signing it.
The 1Password prompt identifies the application and key. Cached approval can allow later signatures without another prompt.

The fixed socket avoids accidental use of another SSH agent.
It does not provide cryptographic proof of 1Password origin or protection against a compromised local user.
Use dedicated wallet keys. A shared SSH key can authorize other systems with the same key.

The runtime supports Ed25519. Passkeys are not planned and are out of scope.
Contract accounts require their exact authorization digest and signature structure.

## Tests

```sh
bun install --frozen-lockfile --ignore-scripts
cargo build --locked --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none
make test
```

Tests run offline with mock keys after dependency installation and fixture compilation.
The Bun suite needs the CAP-71 Rust fixture build shown above.
Install Rust and its `wasm32v1-none` target for that build.
The tunnel, demo, and test tools use Bun. The installer includes production dependencies and browser assets.
See [the live test guide](docs/LIVE-TESTS.md) for fixture builds and dedicated 1Password test keys.
Live tests request signatures and create testnet transactions and contracts.
An unknown submission blocks further signing and submission across process restarts.
Run `bun tests/live.ts reconcile` to query the saved hash without submitting it again.

## Verified coverage

The 2026-09-25 testnet run passed classic multisig, fee bumps, mixed G/C accounts, replay, and signer rotation.
It also passed OpenZeppelin authorization, native CAP-71 delegation, and CAP-85 external executable tests.
The earlier mobile web proof passed live signing on an iPhone and desktop Chrome.
The current tunnel passed live 1Password signing on testnet from desktop Chromium and a real iPhone.
See [the evidence index](evidence/README.md) for exact coverage and limits.

Git includes source, lockfiles, pinned contract artifacts, and acceptance summaries.
Local signer metadata, submission journals, raw evidence, and build caches stay ignored.
Keep unresolved submission journals until their original transaction hashes are resolved.

## TypeScript development

Use Bun 1.4.2 or later. The Go binary keeps signing keys inside 1Password.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
make test
```

`bun run build` creates browser JavaScript and SDK declarations in `dist/`.
TypeScript checks all source files, tests, and fixture tools in strict mode.
The package exports the client, connection UI, scanner, and connection stylesheet.
Browser integrations can copy `dist/` and `sdk/connect.css`, or import the package exports.
The package remains private; this change does not publish a package.

See [the Bun migration research](docs/BUN-MIGRATION.md) for tool choices and source references.
