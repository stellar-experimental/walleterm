# Security policy

walleterm signs Stellar artifacts with keys that stay in the 1Password desktop SSH agent.
Report security problems privately.

## Security model

- 1Password holds the private key and computes each signature. walleterm receives only the signature.
- walleterm parses and checks each artifact, then computes its digest. It rejects requests that fail its rules.
- Any process of the same macOS user can connect to the 1Password SSH agent socket.
  Such a process can request a signature without walleterm, so walleterm's checks do not apply to it.
- 1Password approval applies to every request, from walleterm or from another program.
  See [ask for approval of each signature](README.md#ask-for-approval-of-each-signature).
- The 1Password prompt shows the process and the key. It does not show the Stellar artifact.
- `walleterm approve` answers the tunnel through a socket in a private directory of the same user.
  Any process of that user can use it, as it can use the 1Password SSH agent socket.

## Report a vulnerability

Use GitHub private vulnerability reporting:
[open a private report](https://github.com/stellar-experimental/walleterm/security/advisories/new).
Do not open a public issue for a vulnerability.

Include these items:

- the output of `walleterm --version`;
- the steps that show the problem;
- the effect, for example a wrong signature, a signature without approval, or exposed data.

Never send private keys, recovery phrases, or 1Password exports.
Use testnet accounts and dedicated test keys to show the problem.

## Scope

In scope: the `walleterm` binary, the bridge and tunnel, the browser SDK, the demo website,
the install and release tools, and the agent skills in this repository.

Out of scope: 1Password, the Stellar network, the Stellar CLI, cloudflared, and third-party wallets.
Report problems in those products to their maintainers.

## Supported versions

walleterm is before version 1.0. Only the latest release receives fixes.
