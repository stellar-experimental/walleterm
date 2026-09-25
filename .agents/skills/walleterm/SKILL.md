---
name: walleterm
description: Sign Stellar envelope or Soroban authorization digests with a selected 1Password Ed25519 key. Use with Stellar CLI for classic transactions, fee bumps, native G-account auth, pinned OpenZeppelin accounts, or CAP-71 delegated signers.
---

# Walleterm signing

`walleterm` lists public keys and signs one supplied 32-byte digest. It does not build XDR or submit transactions.
Use [the site bridge skill](../walleterm-site-bridge/SKILL.md) for browser wallet login and website XDR requests.
Use `walleterm --help` for the installed command contract. Use `stellar --version` before following a pinned reference.
Use Stellar CLI to build, inspect, simulate, encode, and submit. Use Stellar Raven for protocol questions and contract discovery.

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
Ask for a new decision only when the action exceeds the grant's network, signer, amount, fee, contract trust, or time window.
After a submission timeout, query the original transaction hash before any new submission.

## Boundary

The 1Password prompt identifies the process and key. It does not show Stellar transaction details.
Cached approval can permit later signatures without a new prompt. `signing_refused` reports generic SSH agent failure.
Create and manage private keys inside 1Password. Never read or export private-key fields.
The fixed macOS socket is the only runtime socket. The CLI does not use `SSH_AUTH_SOCK`.
The signature proves key possession. It does not prove vault history, network choice, policy approval, or transaction acceptance.
Passkeys require separate support.
Another C-account signature format needs a matching adapter for its digest and signature layout. `walleterm sign` stays the same Ed25519 digest signer.
