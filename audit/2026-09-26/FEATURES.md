# Capability and feature assessment

Status: complete after both independent overall reviews.
The baseline is `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Product promises

| Promise | Current implementation | Audit evidence | Boundary |
|---|---|---|---|
| Small macOS signer for agents | Go `list` and `sign`, JSON output, fixed SSH agent socket | Paired signer reviews and mock race tests | The caller reviews the artifact before digest signing. |
| Keep private keys in 1Password | Public metadata discovery and SSH signing requests | Source review and mock protocol tests | This audit did not access live keys or renew live acceptance. |
| Verify returned signatures | Independent Ed25519 verification before output | Signer tests and adversarial response checks | A valid signature does not establish transaction acceptance. |
| Support classic and contract signing | Digest signer plus CLI/SDK workflows and exact adapters | Existing acceptance records; fixture hashes and local tests | The website bridge supports fewer operations than direct signing. |
| Connect a testnet website | Tunnel, pairing, wallet grants, SDK, and connection component | Paired service reviews and local browser smoke | The connected website approves its supported requests. |
| Recover uncertain work | Request identifiers, cancellation limits, and journals | Recovery controls passed; C14 needs CLI01 guard integration | Unknown submissions require original-hash reconciliation. |
| Install a complete service version | Versioned releases and executable links | Two isolated installation reviews passed | Current package exports remain private. |

Wallet switching adds a separate requirement for current results.
C05 violates that requirement when a delayed result uses an older wallet revision.

## Meaningful opportunities

### Wallet integration adapter

The SDK provides familiar address and transaction methods.
It does not register Walleterm with Stellar Wallets Kit.
Existing websites therefore need an explicit integration or the documented interception workflow.

A small Wallets Kit module could reduce repeated website integration work.
It should advertise the testnet and supported-operation limits before requesting a transaction.
It should translate error results without hiding an unknown signing outcome.
Acceptance needs one unchanged example website and tests for unsupported requests.

This opportunity improves adoption. The current documentation already states the integration limit.
It does not justify expanding signing authority or adding unsupported methods.

### Preserve review details through submission

C10 checks a small gap in the normal demo workflow.
The signed state asks for review but hides decoded amount, fee, sequence, and expiry.
Keep the validated transaction details visible until the request reaches a terminal state.
This change uses the existing decoder and does not add a new workflow.

### Improve diagnosis without expanding the command surface

Expose the installed release identifier with the existing version output.
Agents can then match the binary to its source and instructions.

### Preserve recovery evidence

An unreadable journal currently blocks transaction actions and permits Disconnect.
A raw journal export could help an operator retain evidence before manual recovery.
The export must not clear the journal or permit another transaction.
Its value depends on actual recovery needs; it is not a current acceptance requirement.

### Clarify example prerequisites

The offer example needs the intended testnet asset and issuer.
Small setup instructions could reduce confusion when the selected account lacks the required trustline or balance.
The instructions should use an exact issuer and show the prerequisite before signing.
This does not require asset discovery, swaps, or portfolio features.

## Deliberate limits

Passkeys need a separate feasibility review and acceptance suite.
Each new contract account format needs its exact digest and signature adapter.
Mainnet website support needs a separate trust and approval design.
Portfolio management, swaps, key custody, and a general contract platform exceed the current companion scope.
The audit does not treat these absent features as defects.

## Evidence and recommendation

Both product reviewers found no significant missing capability against the stated companion scope.
They checked installation, commands, dependencies, skills, and documented limits.

- [Astra product review](reports/08-product-astra.md)
- [Daybreak product review](reports/08-product-daybreak.md)
- [Architecture and authority](ARCHITECTURE.md)

Prioritize correctness and accurate integration instructions before optional additions.
A small Wallets Kit adapter offers the clearest adoption benefit after those corrections.
Do not add every opportunity merely because the audit lists it.
