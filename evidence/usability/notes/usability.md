# Walleterm usability notes (fresh-context agent, wt-opus)

Date: 2026-09-25. Tools: walleterm 0.1.0, stellar 27.1.0 (8e402ea), stellar-xdr 27.0.0, SDK 17.1.0.
Network: testnet, protocol 28. Inputs: /tmp/walleterm-usability-inputs.json only.

## Pre-live verification (read-only)

- account WASM sha256 0c20d696...6f0d0: matches the pinned `multisig_account_example.wasm` value.
- verifier WASM sha256 875b095d...209b4: matches the pinned Ed25519 verifier value.
- target WASM sha256 04a9a33c...cdf5: no expected value in the inputs or skill. Interface: ping, count, outer, ping2.
- policy contract CAT33LBV...OXKOMV, WASM sha256 9525e493...c16a: no expected value in the inputs or skill.
- Rule 0 "multisig", Default, signers External(verifier, A|B|C raw keys), policy_ids [0], threshold 2. Matches inputs.
- `get_context_rules_count` = 1. count(account) before = 2.

## Usability issues

U1 (high). Record-mode simulation returned the legacy `address` credential, not `address_v2`.
The acceptance snapshot says the observed variant was `address_v2`, and legacy `address` has no live claim.
The skill says to keep the simulated variant, so this task uses an untested live path.
The skill does not say when each variant appears, or whether an agent must stop.
A zero-signature enforce simulation showed the host passed the computed `soroban_authorization` payload.

U2 (medium). `stellar tx new payment --build-only` and `contract invoke --build-only` give `cond: none`.
The skill says to inspect time bounds, but it does not advise setting them.
A signed envelope without time bounds stays valid until its sequence is consumed.
I added a 900-second max_time through decode, jq, and encode before the digest.

U3 (medium). The skill pins no WASM hash for the threshold policy contract.
The inputs also omit the policy address. The rule read gives it.
I could verify the threshold value, but not the policy code, against a trusted value.

U4 (low). The skill gives no method to check the OZ auth digest before a live signature.
A zero-signature enforce simulation exposes the host `signature_payload` and the verifier digest.
This check confirmed both values offline from walleterm. The skill could name this check.

U5 (low). The skill says "Sort map keys in host order" but does not state the result for External signers.
For one verifier, the order is increasing raw public key. B (594f...) sorts before A (656f...).

U6 (low). The skill does not advise an auth expiration window or how to read the latest ledger.
I used RPC getLatestLedger + 150 ledgers.

U7 (low, CLI). `stellar tx decode --input` is a format flag, not a file argument. The file is positional or stdin.

U8 (low). SKILL.md step 4 says "request approval" but does not name the approver for an agent run.
Here, the parent live-window grant is the approval.

## Live results (parent-granted window, 2026-09-25)

- U1 update: the legacy `address` credential passed live with the pinned OZ account. See task 2.
  The preimage was `HashIdPreimage.soroban_authorization`. It had no address field.
U9 (low). `stellar tx simulate` adds the new resource fee to the existing fee field.
  The record-mode fee was 399025. After the enforce simulation, the fee was 432998 (399025 + 33973).
  The fee stayed below the 1 XLM limit. The charged fee was 23603. The skill does not warn about this.
U10 (low). RPC getTransaction gives no `returnValue` field here. I decoded `resultMetaXdr` to get the return value u32 3.
U11 (info). walleterm writes "Request a signature for public key ... and digest ..." to stderr for each request.
  This line helps an operator match the 1Password prompt to a digest.
