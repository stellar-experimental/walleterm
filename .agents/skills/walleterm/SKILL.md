---
name: walleterm
description: Sign a reviewed Stellar transaction, Soroban authorization, or SEP-53 message through the local 1Password Ed25519 agent. Use for direct signing with Stellar CLI or SDK. For website connections through walleterm tunnel, use walleterm-site-bridge.
---

# Walleterm signing

`walleterm list` lists public keys. `walleterm sign` signs one reviewed artifact. It computes the digest itself.
It never submits transactions.
Use `walleterm --help` for the installed command contract.
Use Stellar CLI to build, inspect, simulate, encode, and submit. Use Stellar Raven, when available, for protocol questions and contract discovery.
Signing runs on the Mac that runs 1Password and its SSH agent. Move only public artifacts and signatures to another machine.
For `walleterm tunnel`, `walleterm demo`, or a website, use the `walleterm-site-bridge` skill.

## Select a reference

Read only the references that the current artifact needs. Resolve each link from this `SKILL.md`, not from the caller directory.

- Read [classic and native G auth](references/classic-native.md) for V1 envelopes, multisig co-signers, or G-account Soroban auth.
- Read [fee bumps](references/fee-bump.md) when the envelope has an outer fee payer.
- Read [pinned OpenZeppelin auth](references/openzeppelin.md) for an OpenZeppelin smart account.
- Read [CAP-71 delegation](references/delegation.md) for `address_with_delegates` entries. It also compares the digest of each scheme.
- Read [contract code](references/contract-code.md) when a signature depends on contract code, including a CAP-85 external executable.

## Sign one artifact

1. Select the network and the full G-address from `walleterm list`. Treat comments as display text.
2. Inspect the exact unsigned artifact, source accounts, operations, fees, destination, and contract effects.
   Check each authorization tree against the intended action and the contract's authorization rules before signing it.
   Simulate with the default authorization mode. Ask the user before you use `--auth-mode non-root`.
   A non-root entry does not bind its signature to the transaction's call.
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
One call has a 120-second deadline for input, approval, and signing. After it, the call fails with `timeout`.
Ask for a new decision only when the action exceeds the grant's network, signer, amount, fee, contract trust, or time window.
After a submission timeout, query the original transaction hash before any new submission.
Use dedicated keys. Use testnet unless the user's grant names another network. This skill does not grant signing or submission authority.

## Authorization rules

Walleterm reads no ledger and applies no expiry window. It refuses expiration ledger 0.
Read the latest ledger with `stellar ledger latest`. Put the expiration ledger in the credential before signing.
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

After you attach signatures, simulate again in enforce mode. Repeated simulation can raise the fee, so inspect the final fee before envelope signing.
After confirmation, decode `resultMetaXdr` for contract return values. RPC `getTransaction` can omit `returnValue`.

## Messages

A SEP-53 signature is a permanent, portable proof that the key approved the text.
It binds no network, site, nonce, or expiry, unless the text contains them.
Sign only text that names its purpose, audience, nonce, and expiry.
Never use a Walleterm key as an identity or a key-derivation source for another service.
`walleterm sign` returns hexadecimal. Stellar CLI verifies Base64: `sig=$(printf %s "$hex" | xxd -r -p | base64)`.
Then run `stellar message verify "<message>" --signature "$sig" --public-key G...`.

## Boundary

The 1Password prompt identifies the process and key. It does not show Stellar transaction details.
Cached approval can permit later signatures without a new prompt.
The user can set 1Password to ask for approval of each request. Do not assume that a prompt appears for each signature.
`signing_refused` reports a generic SSH agent failure. It does not prove that the user denied the request.
Create and manage private keys inside 1Password. Never read or export private-key fields.
The fixed macOS socket is the only runtime socket. The CLI does not use `SSH_AUTH_SOCK`.
The signature proves key possession. It does not prove vault history, network choice, policy approval, or transaction acceptance.
Another C-account format needs a matching adapter, or the preimage shape with a signature layout that the caller builds.
