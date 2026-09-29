<a href="https://walleterm.com"><img src="site/og.png" alt="A red folded wallet with thin legs stands under a cream moon on a green field." width="100%"></a>

# walleterm

**Your agent asks. 1Password signs.**
A small macOS signing companion for agents that use Stellar and 1Password.

[Website](https://walleterm.com) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md)

`walleterm` lists public Ed25519 keys and signs Stellar artifacts through the 1Password desktop SSH agent.
It accepts a transaction, an authorization preimage or entry, or a SEP-53 message. It computes the digest itself.
It verifies each signature before it returns the signature. The private key stays in 1Password.
`walleterm tunnel` also lets a connected testnet website request signatures.
`walleterm` is one Rust binary. It embeds the demo website and needs no JavaScript runtime.

## Status and safety

Walleterm is experimental and before version 1.0. Interfaces can change without notice.

- 1Password shows the application and the key. It does not show the network, amount, destination, or contract policy.
  Review each artifact before you sign it. Cached 1Password approval can permit later signatures without a prompt.
- Use dedicated wallet keys. A shared SSH key can also authorize other systems.
- The website bridge signs for Stellar testnet only. A connected website approves its own requests.
- Walleterm supports Ed25519 keys only. A contract account needs its exact authorization adapter.

## Install

You need an Apple silicon Mac with macOS 13 or later. Turn on the SSH agent in the 1Password desktop app.

```sh
curl -fsSL https://walleterm.com/install.sh | sh
npx skills add stellar-experimental/walleterm -g
```

The script installs `walleterm` and its `stellar-walleterm` alias into `~/.local/bin`. It does not use `sudo`.
It checks the release checksum and the Developer ID team before it replaces the command. Run it again to update.
Set `WALLETERM_INSTALL_DIR` for another directory, or `WALLETERM_VERSION=0.2.0` for one release.
The script is [`site/install.sh`](site/install.sh). Read it before you run it.
`npx skills add` installs the `walleterm` signing skill and the `walleterm-site-bridge` website skill for your agents.

You can also install with Homebrew. The cask also installs cloudflared. Update with `brew upgrade --cask walleterm`.

```sh
brew tap stellar-experimental/walleterm https://github.com/stellar-experimental/walleterm
brew install --cask stellar-experimental/walleterm/walleterm
```

Install these tools too:

- The Stellar CLI builds, inspects, and submits transactions: `brew install stellar-cli`.
- `walleterm tunnel` and `walleterm demo` need cloudflared: `brew install cloudflared`.
- The 1Password CLI is optional. Only `walleterm tunnel --vault` needs it: `brew install --cask 1password-cli`.

Generate an Ed25519 SSH key inside the 1Password desktop app. Enable that item in the 1Password SSH agent.
Then run `walleterm list --human` to see its public G-address.

## Sign from an agent

```sh
unsigned=$(stellar tx new payment --network testnet --source-account G... --destination G... --amount 10000000 --build-only)
printf '{"public_key":"G...","network_passphrase":"Test SDF Network ; September 2015","transaction_xdr":"%s"}' "$unsigned" | walleterm sign
```

The `--amount` value is in stroops. 10000000 stroops is 1 XLM.
A transaction result contains `signed_transaction_xdr`: the same envelope with one more signature.
Each success also returns the public key, the digest, the signature, and `verified: true`.
A failure returns JSON with a stable error code and a nonzero exit status.
See [the CLI interface](docs/INTERFACE.md) for the four input shapes and [the Stellar CLI guide](docs/STELLAR-CLI.md) for the full pipeline.

## Connect a website

Run the bridge in one terminal and the example website in another:

```sh
walleterm tunnel --vault Private
walleterm demo
```

1. The tunnel shows a public URL, an eight-digit connection code, and a QR code.
2. Open the demo URL, or scan the demo QR code with your phone.
3. Select Connect Walleterm. Select Scan tunnel QR code, or type the tunnel URL and code.
4. Select a dedicated testnet wallet. Create a request in the demo, review it, and select Sign.
5. Approve the 1Password prompt on the Mac if it appears. The demo submits the transaction to testnet.

`--vault` limits the website wallets to one 1Password vault. Omit it to offer all Ed25519 agent keys.
See [the website bridge guide](docs/WEB-BRIDGE.md) for setup, recovery, and website integration.

## Documentation

| Document | Contents |
| --- | --- |
| [INTERFACE.md](docs/INTERFACE.md) | The `list` and `sign` commands: input shapes, output, errors, and limits |
| [STELLAR-CLI.md](docs/STELLAR-CLI.md) | Build, sign, and submit with the Stellar CLI. Digest and JSON reference |
| [WEB-BRIDGE.md](docs/WEB-BRIDGE.md) | Run and operate `walleterm tunnel` and `walleterm demo` |
| [BRIDGE-PROTOCOL.md](docs/BRIDGE-PROTOCOL.md) | The bridge HTTP routes, request kinds, and errors |
| [SEP-43.md](docs/SEP-43.md) | The browser SDK, its SEP-43 wallet, and the Stellar Wallets Kit module |
| [CONNECTION-UI.md](docs/CONNECTION-UI.md) | The website connection component |
| [CONNECTION-LIFECYCLE.md](docs/CONNECTION-LIFECYCLE.md) | Signing deadlines and public tunnel recovery |
| [DEMO.md](docs/DEMO.md) | The demo website |
| [CONTRACT-AUTHORIZATION.md](docs/CONTRACT-AUTHORIZATION.md) | Contract account authorization in the demo |
| [OPENZEPPELIN.md](docs/OPENZEPPELIN.md) | The OpenZeppelin smart account adapter |
| [AGENTIC-PAYMENTS.md](docs/AGENTIC-PAYMENTS.md) | x402 and MPP compatibility |
| [NETWORKS.md](docs/NETWORKS.md) | Network restrictions and hard-coded limits |
| [LIVE-TESTS.md](docs/LIVE-TESTS.md) | Live 1Password and testnet tests |
| [MAINTAINING.md](docs/MAINTAINING.md) | Releases, the Homebrew cask, and the website |

The [signing skill](.agents/skills/walleterm/SKILL.md) and the [site bridge skill](.agents/skills/walleterm-site-bridge/SKILL.md) give agents the workflows.

## Verified coverage

Live testnet runs passed with dedicated 1Password keys. They covered classic multisig, fee bumps, contract accounts, and the OpenZeppelin adapter.
They also covered SEP-53 messages and the SEP-43 wallet through the Stellar Wallets Kit.
Fixture runs covered CAP-71 address-bound authorization and CAP-85.
See [the evidence index](evidence/README.md) for each record, its revision, and its limits.

## Develop

See [CONTRIBUTING.md](CONTRIBUTING.md) to build from source, run the checks, and link the skills.

## License and security

Walleterm uses the [Apache License 2.0](LICENSE).
Report a vulnerability as [SECURITY.md](SECURITY.md) describes. Do not open a public issue for it.
