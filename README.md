<a href="https://walleterm.com"><img src="site/og.png" alt="A red folded wallet with thin legs stands under a cream moon on a green field." width="100%"></a>

# walleterm

**Your agent asks. 1Password signs.**
A small macOS signing companion for agents using Stellar and 1Password.

[Website](https://walleterm.com) · [Docs](docs/INTERFACE.md) · [Website guide](docs/WEB-BRIDGE.md)

`walleterm` lists public Ed25519 keys and signs Stellar artifacts through the 1Password desktop SSH agent.
It accepts a transaction, an authorization preimage or entry, or a SEP-53 message, and it computes the digest itself.
It verifies each signature before returning it.
`walleterm tunnel` also lets a connected testnet website request signatures.
`walleterm` is one Rust binary. It embeds the demo website and needs no Bun, Node, or Go at runtime.
Its Rust dependencies are pinned in `Cargo.lock` and checked with `cargo deny`.
Packaging enforces a 10,000,000-byte executable limit and 160 packages in the root lockfile.
It also permits at most 130 resolved Apple silicon workspace packages, including build, test, and test-host dependencies.
The package check runs in CI. Independent contract and Kit workspaces are outside these limits.

## Install

Install Homebrew and the 1Password desktop app first. Enable the SSH agent in the desktop app.

```sh
brew tap stellar-experimental/walleterm https://github.com/stellar-experimental/walleterm
brew install --cask stellar-experimental/walleterm/walleterm
npx skills add stellar-experimental/walleterm -g -s walleterm -s walleterm-site-bridge
walleterm list --human
```

The cask installs `walleterm`, its `stellar-walleterm` alias, and `cloudflared`.
It needs macOS 13 or later on Apple silicon. Rust, Bun, and Node are not required.
The release contains one binary and `NOTICES.txt`. Developer ID signs the binary, and Apple notarizes it.
The binary runs `list`, `sign`, `tunnel`, and `demo`. It embeds the demo website files.
Homebrew 6 requires trust for third-party taps. The full cask name trusts only this cask.
Update with `brew upgrade --cask walleterm`.
Install the Stellar CLI for transaction construction: `brew install stellar-cli`.
The 1Password CLI is optional. Only vault filtering needs it.

### Install from source

Use this path for development. It needs Rust, Bun 1.4.2 or later, and cloudflared.
Install Rust with rustup from https://rustup.rs. `rust-toolchain.toml` pins Rust 1.93.0, and rustup installs it.
Bun builds the embedded browser files only.

```sh
brew install oven-sh/bun/bun cloudflared
make install
make install-skill
walleterm --help
stellar walleterm --help
```

`make install` builds the release binary and installs it into `~/.local/bin`. Set `PREFIX` for another location.
Keep that directory on `PATH`, including in non-interactive agent shells.
Run `make install` again after source changes. A failed build preserves the previous command.
Each build goes into a new directory under `~/.local/share/walleterm/releases`, named by its content hash.
The install then switches the `walleterm` and `stellar-walleterm` links atomically.
Old release directories stay for running processes and rollback.
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
unsigned=$(stellar tx new payment --network testnet --source-account G... --destination G... --amount 100 --build-only)
printf '{"public_key":"G...","network_passphrase":"Test SDF Network ; September 2015","transaction_xdr":"%s"}' "$unsigned" | walleterm sign
```

A transaction result contains `signed_transaction_xdr`: the same envelope with one appended signature.
Every success also returns the public key, the digest, the hexadecimal signature, and `verified: true`.
Failure returns JSON with a stable error code and a nonzero exit status.
See [the interface](docs/INTERFACE.md#sign) for the four input shapes, exact fields, and limits.

Use the official Stellar CLI to construct, inspect, and submit transactions.
Use Stellar Raven MCP for Stellar questions and contract discovery.
See [Stellar CLI integration](docs/STELLAR-CLI.md) and [OpenZeppelin formats](docs/OPENZEPPELIN.md).
The [companion skill](.agents/skills/walleterm/SKILL.md) gives agents the signing workflow.
The [site bridge skill](.agents/skills/walleterm-site-bridge/SKILL.md) covers tunnel setup, website integration, and compatible website interception.

## Connect a website

Run the bridge in one terminal and the example website in another:

```sh
walleterm tunnel --vault Private
walleterm demo
```

`--vault` limits the website wallet list to SSH keys in that 1Password vault.
The tunnel reads its vault filter only from this flag. It ignores `OP_VAULT` and `.env` files.
Use `walleterm tunnel --vault Private` when migrating an old `OP_VAULT=Private` setting.
Restart the tunnel after changing the setting. Reconnect the website with the new tunnel URL and code.
Use a vault name or ID. Vault filtering requires the 1Password CLI (`brew install --cask 1password-cli`).
Enable 1Password CLI integration in the desktop app, or sign in before starting the tunnel.
The bridge reads only item metadata and public keys. It matches the full public key against the SSH agent.
A vault lookup failure stops wallet discovery. An empty vault returns an empty list.
Omitting `--vault` lists all available Ed25519 agent keys. An empty flag value fails.
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

The signing commands are `list` and `sign`. Manage key creation, names, and archival in 1Password.
`sign` computes the digest from the artifact. 1Password does not display the network, amount, destination, or contract policy.
Inspect and approve the artifact before signing it.
The 1Password prompt identifies the application and key. Cached approval can allow later signatures without another prompt.

The fixed socket avoids accidental use of another SSH agent.
It does not provide cryptographic proof of 1Password origin or protection against a compromised local user.
Use dedicated wallet keys. A shared SSH key can authorize other systems with the same key.

The runtime supports Ed25519. Passkeys are not planned and are out of scope.
Contract accounts require their exact authorization adapter and signature structure.

## Tests

```sh
bun install --frozen-lockfile --ignore-scripts
rustup target add wasm32v1-none
cargo build --locked --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none
make test
make test-package
make test-kit
cargo deny --workspace --locked check advisories licenses sources
```

Tests run offline with mock keys after dependency installation and fixture compilation.
`make test` runs rustfmt, Clippy, the Cargo tests, the TypeScript check, and the Bun suite.
The Cargo tests compare the Rust signer with frozen vectors and transcripts in `fixtures/parity/`.
The Bun suite needs the CAP-71 Rust fixture build shown above.
Browser tests run the real SDK against the Rust bridge in `walleterm-test-host`. `make test` builds it.
That binary needs the `test-host` feature and never enters a release.
`make test-package` builds the release package twice and requires identical files.
It then runs the binary from an empty directory with only the system `PATH`.
`make test-kit` checks Stellar Wallets Kit 2.7.0 against the Rust bridge.
CI runs `cargo deny` with the pinned `cargo-deny` 0.20.2 binary.
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

## Website

`site/` holds the marketing page. It is static HTML with no build step. Open `site/index.html` to view it.
`wrangler deploy -c site/wrangler.jsonc` publishes it to https://walleterm.com. Use a Cloudflare login for the account that owns the domain.
Its illustrations come from `design/art/build.ts`. Read [the illustration standard](design/ILLUSTRATION.md) before you change them.
The Paper file "walleterm — marketing site" is the official design reference. Change Paper first, then the site. [The Paper workflow](.agents/skills/walleterm-illustration/references/paper.md) gives the steps.

## TypeScript development

TypeScript remains only where a browser or JavaScript runtime needs it.
It covers the browser SDK in `sdk/`, the demo website in `demo/site/`, and the browser build in `scripts/build.ts`.
It also covers browser and interoperability tests, two skill helpers, and the illustration generator.
Use Bun 1.4.2 or later. The Rust binary keeps signing keys inside 1Password.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
make test
```

`bun run build` creates browser JavaScript and SDK declarations in `dist/`.
TypeScript checks all TypeScript source files and tests in strict mode.
The package exports the client, connection UI, scanner, and connection stylesheet.
Browser integrations can copy `dist/` and `sdk/connect.css`, or import the package exports.
The package remains private; this change does not publish a package.

[The Bun migration research](docs/BUN-MIGRATION.md) is a historical record of an earlier design.

## Release

Releases run on the maintainer's Mac. The Developer ID signing key stays in its keychain.
Store the notary credentials once:

```sh
xcrun notarytool store-credentials walleterm-notary --apple-id <Apple ID> --team-id T4GBHCYB7P
```

`make release VERSION=0.2.0` builds, signs, and notarizes `release/0.2.0/walleterm-0.2.0-darwin-arm64.zip`.
It builds from a fresh worktree of `HEAD` with the Rust and Bun versions that CI pins.
It checks the Developer ID authority and the hardened runtime. The binary must have no entitlements.
It also runs the signed binary's version and input checks.
Add `NOTARIZE=0` to check the build and signature without Apple. That archive has an `-unnotarized` name.
`make release VERSION=0.2.0 PUBLISH=1` also tags the commit and creates the GitHub release.
It requires a passing Test workflow on `HEAD`, which must equal `origin/main`.
It downloads the uploaded archive and compares its checksum.
It then opens a pull request that points `Casks/walleterm.rb` at the new archive. Merging it updates Homebrew users.
The Homebrew install needs a public repository. The tap and release downloads use anonymous Git and HTTPS.
The tap is this repository, so anyone who can merge to `main` can change the cask.
Protect `main`, require code owner review, and turn on immutable releases.
