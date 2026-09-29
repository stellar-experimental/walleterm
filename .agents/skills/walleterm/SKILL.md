---
name: walleterm
description: Sign a reviewed Stellar transaction, Soroban authorization, or SEP-53 message through the local 1Password Ed25519 agent. Use for direct signing with Stellar CLI or SDK. For website connections through walleterm tunnel, use walleterm-site-bridge.
---

# Walleterm signing

`walleterm list` lists public keys. `walleterm sign` signs one reviewed artifact. It computes the digest itself.
It never submits transactions.
Use `walleterm-site-bridge` for `walleterm tunnel`, `walleterm demo`, website integration, or wallet request interception.
Use `walleterm --help` for the installed command contract. Use `stellar --version` before following a pinned reference.
Use Stellar CLI to build, inspect, simulate, encode, and submit. Use Stellar Raven for protocol questions and contract discovery.
Signing needs macOS, the installed Walleterm binary, and the enabled 1Password desktop SSH agent.
If the execution environment lacks that socket, use a local Mac agent for signing.
Exchange only public artifacts and signatures. Do not copy a private key into a cloud execution environment.
The references describe pinned protocol examples. They do not limit the installed CLI to their recorded version.

## Select a reference

Read only the references that the current artifact needs.

- Read [classic and native G auth](references/classic-native.md) for V1 envelopes, multisig co-signers, or G-account Soroban auth.
- Read [fee bumps](references/fee-bump.md) when the envelope has an outer fee payer.
- Read [pinned OpenZeppelin auth](references/openzeppelin.md) for an OpenZeppelin smart account.
- Read [CAP-71 delegation](references/delegation.md) for `address_with_delegates` entries. It also compares the digest of each scheme.
- Read [contract code](references/contract-code.md) when a signature depends on contract code, including a CAP-85 external executable.
- Read the [acceptance snapshot](references/acceptance.md) before citing prior live coverage or its limits.

These files stay beside this skill after installation. Resolve links from this `SKILL.md`, independent of the caller directory.

## Sign one artifact

1. Select the network and the full G-address from `walleterm list`. Treat comments as display text.
2. Inspect the exact unsigned artifact, source accounts, operations, fees, destination, and contract effects.
   Check each authorization tree against the intended action and the contract's authorization rules before signing it.
3. Select the shape. Each request has `public_key` and exactly these other fields:

   | Artifact | Fields | Result besides `signature` |
   | --- | --- | --- |
   | V1 or fee-bump envelope | `network_passphrase`, `transaction_xdr` | `signed_transaction_xdr` |
   | Authorization preimage from `buildAuthorizationEntryPreimage` | `network_passphrase`, `preimage_xdr` | None |
   | Unsigned AddressV2 entry through an adapter | `network_passphrase`, `auth_entry_xdr`, `address`, `adapter` | `signed_auth_entry_xdr` |
   | SEP-53 text of 1–1024 UTF-8 bytes | `message` | None |

4. Show the artifact, network, and selected key. Use the requesting user or parent agent's existing grant when it covers the action.
5. Send the JSON object to `walleterm sign` on standard input, then send EOF.
6. Require `ok: true`, `verified: true`, and the same key. Compare `digest` with an independent computation.
7. Use the signed artifact, or insert the raw signature into the account's format. Verify all required weights and authorization entries.
8. Submit only the authorized final artifact. Check its transaction hash, ledger result, and resulting state.

One invocation returns one signature. Do not retry an uncertain signing request automatically.
Use a request file when practical: `walleterm sign < request.json > result.json`.
Check the exit status before reading the result. Failure returns `ok: false` with an error code.
Invalid input exits with code 2 before any 1Password request.
Ask for a new decision only when the action exceeds the grant's network, signer, amount, fee, contract trust, or time window.
After a submission timeout, query the original transaction hash before any new submission.
Use dedicated testnet keys in this project. This skill does not grant signing or submission authority.

## Authorization rules

Walleterm reads no ledger and applies no expiry window. It refuses expiration ledger 0.
The network refuses an expired entry. Choose the shortest expiry that fits the flow.
Preserve an uncertain signing result until its authorization expiry passes or the outcome becomes known.
Walleterm signs only `address_v2` credentials. V1, SourceAccount, and delegated credentials require another workflow.
SourceAccount authorization remains valid inside ordinary transaction envelopes.
The CLI checks no transaction signer role and no preimage bound address, so a multisig co-signer can sign.
Check account signers and thresholds before signing for another account.

Entry adapters:

- `account` signs for a native G-address. `address` equals `public_key`.
- `contract-ed25519` returns raw signature bytes. Other contracts can require another format.
- The pinned `openzeppelin-ed25519` adapter also requires `verifier` and one `context_rule_ids` value per context.
  Use [pinned OpenZeppelin auth](references/openzeppelin.md) to review those fields.

An entry rooted at `__check_auth` approves a digest for another account.
Recompute that digest from the outer entry before signing. See [pinned OpenZeppelin auth](references/openzeppelin.md).

## Messages

A SEP-53 signature is a permanent, portable proof that the key approved the text.
It binds no network, site, nonce, or expiry, unless the text contains them.
Sign only text that names its purpose, audience, nonce, and expiry.
Never use a Walleterm key as an identity or a key-derivation source for another service.
Verify with `stellar message verify "<message>" --signature <Base64> --public-key G...`. Pass the message as an argument.

## Boundary

The 1Password prompt identifies the process and key. It does not show Stellar transaction details.
Cached approval can permit later signatures without a new prompt. `signing_refused` reports generic SSH agent failure.
Create and manage private keys inside 1Password. Never read or export private-key fields.
The fixed macOS socket is the only runtime socket. The CLI does not use `SSH_AUTH_SOCK`.
`--vault` filters website wallet selection through `walleterm tunnel`. It accepts a vault name or ID.
Filtering requires the 1Password CLI. Local `walleterm list` and `walleterm sign` remain independent of `--vault`.
The signature proves key possession. It does not prove vault history, network choice, policy approval, or transaction acceptance.
Passkeys are not planned and are out of scope.
Another C-account format needs a matching adapter, or the preimage shape with a signature layout that the caller builds.
