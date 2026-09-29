# Security policy

walleterm signs Stellar artifacts with keys that stay in the 1Password desktop SSH agent.
Report security problems privately.

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
