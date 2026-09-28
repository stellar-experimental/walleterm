# Protocol compatibility work

This work started on 2026-09-25. It extends the existing Ed25519 testnet acceptance suite.
The production signing interface is one selected public key and one artifact per signature.
On 2026-09-28, `walleterm sign` replaced its 32-byte digest input with artifacts. Walleterm now computes each digest.

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

CAP-72 remains a draft. Passkeys and CAP-72 are not planned and are out of scope.
Neither item blocks these Ed25519 compatibility tests.

## Completed acceptance

Both live suites completed on protocol 28 testnet on 2026-09-25.

| Suite | Result | Successful transactions |
| --- | --- | --- |
| CAP-71 | CAP71-01 through CAP71-12 passed | 19 |
| CAP-85 | X01-X06 passed; X07 recorded observations | 19 |

The 38 transactions include uploads, deployments, and positive controls.
Negative cases used live enforce simulation and checked unchanged state where applicable.
The test accounts kept their original signers and thresholds. Both local checkpoints and the shared submission gate are clear.
The Go source and installed binary hashes remain unchanged.
The installed `walleterm` command and `stellar walleterm` plugin command both work from `/tmp`.

CAP71-07 initially stopped because the RPC omitted its diagnostic reason.
The corrected test uses a successful identical control and changes only the delegate array.
CAP71-07 and CAP71-08 then passed at root and nested levels.
They returned exactly `Error(Auth, InvalidInput)` with no diagnostic reason.
The duplicate case proves invalid-array rejection; it cannot distinguish duplicate rejection from ordering rejection.
The evidence retains the expected reason as an expectation. That reason was not observable live.

All three CAP-85 review blockers were resolved before live execution.
SUCCESS recovery now checks durable counter preconditions. Startup reconciles both journals before funding or signing.
X04 checks the created address, reference owner, tag, version, and resolved hash.
It requires version 2 because X03 upgrades the reference first.
The nine focused regression tests and the adapter self-test passed.
The shared submission and checkpoint tests passed all 37 cases.

X07 observed different behavior in two older accounts.
The simple account accepted external-reference creation. The pinned OpenZeppelin account rejected its unsupported `ExternalRef` context.
X07 remains an observation row. It does not count as an asserted pass.

The skill review and independent offline usage test completed.
The skill now covers native delegation and executable resolution through optional references.
The local skill links resolve to the maintained project source. Its structure and relative links validate.

## Evidence

- [Protocol results and all transaction hashes](../evidence/protocol-acceptance.json)
- [Evidence storage and interpretation](../evidence/README.md)

Raw reviews, account snapshots, installation checks, and skill usage artifacts remain local under `evidence/`.
The protocol summary lists their paths. Git excludes these machine-specific records.

OpenZeppelin `Delegated` C-address adapters remain outside these claims. Passkeys and CAP-72 are not planned.
Native CAP-71 C-address delegation passed with the dedicated fixtures.
