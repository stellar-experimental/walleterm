---
name: walleterm
description: Sign a reviewed Stellar transaction or Soroban authorization digest through the local 1Password Ed25519 agent. Use for direct signing with Stellar CLI or SDK. For website connections through walleterm tunnel, use walleterm-site-bridge.
---

# Walleterm signing

`walleterm list` lists public keys. `walleterm sign` signs one supplied 32-byte digest.
Neither command builds XDR or submits transactions.
Use `walleterm-site-bridge` for `walleterm tunnel`, `walleterm demo`, website integration, or wallet request interception.
Use `walleterm --help` for the installed command contract. Use `stellar --version` before following a pinned reference.
Use Stellar CLI to build, inspect, simulate, encode, and submit. Use Stellar Raven for protocol questions and contract discovery.
Signing needs macOS, the installed Walleterm binary, and the enabled 1Password desktop SSH agent.
If the execution environment lacks that socket, use a local Mac agent for signing.
Exchange only public artifacts and signatures. Do not copy a private key into a cloud execution environment.
The references describe pinned protocol examples. They do not limit the installed CLI to their recorded version.

## Select a reference

Read only the references that the current artifact needs.

- Read [classic and native G auth](references/classic-native.md) for V1 envelopes, G-account Soroban auth, or the `address` and `address_v2` choice.
- Read [fee bumps](references/fee-bump.md) when the envelope has an outer fee payer.
- Read [pinned OpenZeppelin auth](references/openzeppelin.md) for an OpenZeppelin smart account.
- Read [CAP-71 delegation](references/delegation.md) for `address_with_delegates` entries. It also compares the digest of each scheme.
- Read [contract code](references/contract-code.md) when a signature depends on contract code, including a CAP-85 external executable.
- Read the [acceptance snapshot](references/acceptance.md) before citing prior live coverage or its limits.

These files stay beside this skill after installation. Resolve links from this `SKILL.md`, independent of the caller directory.

## Sign one digest

1. Select the network and the full G-address from `walleterm list`. Treat comments as display text.
2. Inspect the exact unsigned artifact, source accounts, operations, fees, destination, and contract effects.
   Check each authorization tree against the intended action and the contract's authorization rules before signing it.
3. Compute and independently check the required 32-byte digest. Keep the artifact fixed after this step.
4. Show the artifact, network, digest, and selected key. Use the requesting user or parent agent's existing grant when it covers the action.
5. Send `{"public_key":"G...","digest":"64 lowercase hexadecimal characters"}` to `walleterm sign` on standard input, then send EOF.
6. Require `ok: true`, `verified: true`, and the same key and digest in the JSON response.
7. Insert the raw 64-byte signature into the correct XDR structure. Verify all required weights and authorization entries.
8. Submit only the authorized final artifact. Check its transaction hash, ledger result, and resulting state.

One invocation returns one signature. Do not retry an uncertain signing request automatically.
Use a request file when practical: `walleterm sign < request.json > signature.json`.
Check the exit status before reading the result. Failure returns `ok: false` with an error code.
`--human` changes formatting for `list` and `sign` only. Agents should use the default JSON output.
Ask for a new decision only when the action exceeds the grant's network, signer, amount, fee, contract trust, or time window.
After a submission timeout, query the original transaction hash before any new submission.
Use dedicated testnet keys in this project. This skill does not grant signing or submission authority.

## Boundary

The 1Password prompt identifies the process and key. It does not show Stellar transaction details.
Cached approval can permit later signatures without a new prompt. `signing_refused` reports generic SSH agent failure.
Create and manage private keys inside 1Password. Never read or export private-key fields.
The fixed macOS socket is the only runtime socket. The CLI does not use `SSH_AUTH_SOCK`.
`OP_VAULT` filters website wallet selection through `walleterm tunnel`. It accepts a vault name or ID.
Filtering requires the 1Password CLI. Local `walleterm list` and `walleterm sign` remain independent of `OP_VAULT`.
The signature proves key possession. It does not prove vault history, network choice, policy approval, or transaction acceptance.
Passkeys require separate support.
Another C-account signature format needs a matching adapter for its digest and signature layout. `walleterm sign` stays the same Ed25519 digest signer.
