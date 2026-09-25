# Protocol compatibility work

This work started on 2026-09-25. It extends the existing Ed25519 testnet acceptance suite.
The production signing interface remains one selected public key and one 32-byte digest.

## Ownership

| Owner | Files | Task |
| --- | --- | --- |
| wt-astra | `fixtures/cap71/**`, `tests/cap71.mjs`, `tests/cap71.test.mjs` | Native delegation contracts, adapter, and tests |
| wt-fable | `fixtures/cap85/**`, `tests/cap85.mjs`, `tests/cap85.test.mjs` | External executable reference contracts, adapter, and tests |
| wt-opus | `.agents/skills/walleterm/**` | Holistic skill review and focused improvements |
| Parent | Shared harness, documentation, acceptance summaries | Integration and serialized live execution |

Workers request ownership changes before editing shared files.
The parent assigns independent reviews after each implementation is ready.
Only the parent or its designated live worker signs and submits testnet transactions.
The existing submission guard stops signing and submission after an unknown outcome.

## Acceptance

### CAP-71

- Exercise native C-account delegation to G-accounts and nested C-accounts.
- Check threshold combinations with dedicated 1Password Ed25519 keys.
- Reject unauthorized delegates, missing signatures, duplicates, and incorrect ordering.
- Reject expired credentials and replay of consumed credentials for the intended reason.
- Reject account substitution with shared keys and address-bound credentials.
- Use official SDK assembly helpers where they fit.
- Keep native delegation distinct from OpenZeppelin's existing `require_auth_for_args` delegation.

### CAP-85

- Create a contract using an external executable reference.
- Resolve its effective executable and record the reference owner and tag.
- Observe an authorized executable change at the same contract address.
- Reject an unauthorized manager change.
- Exercise custom-account authorization for contract creation using `ExternalRef`.
- Establish the behavior of the tested older and newer account context decoders.

### Skill and evidence

- Keep the skill useful across ordinary and advanced signing tasks.
- Put optional protocol guidance behind a relevant reference link.
- Preserve existing user authorization and local skill links.
- Validate the skill and independently evaluate realistic use.
- Record builds, source versions, test commands, hashes, ledgers, and observed state changes.
- Separate offline checks, live simulations, and submitted transactions.
- Report unsupported cases and incomplete checks explicitly.

## Sources

- [CAP-71-01: native delegation](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-01.md)
- [CAP-71-02: address-bound credentials](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md)
- [CAP-85: external executable references](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0085.md)
- [Protocol 28 guide](https://stellar.org/blog/developers/adapter-protocol-28-upgrade-guide)

CAP-72 remains a draft. Passkeys remain outside this work.
Neither item blocks these Ed25519 compatibility tests.
