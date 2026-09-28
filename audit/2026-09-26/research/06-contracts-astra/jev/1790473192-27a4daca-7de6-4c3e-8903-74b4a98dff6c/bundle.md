# Evidence for: What exact authorization payload, delegate binding, nonce and replay rules does Stellar CAP-71 use for AddressWithDelegates and classic Ed25519 delegate signatures?

Contents (section: first line):
- Rank 1: Stellar Zipper, Protocol 27 Upgrade Guide: line 14
- Rank 1 companion: (same URL): line 43
- Rank 2: Contract signers for Stellar accounts: line 52
- Rank 3: rs-soroban-sdk v27.0.0 — 27.0.0: line 124
- Rank 4: js-stellar-sdk v16.1.0: line 137
- Rank 5: Stellar Protocol Meeting 2026-04-30: line 166
- Rank 6: Invoke and deploy smart contracts with the InvokeHostFunctionOp operation: line 187
- Rank 7: Stellar Weekly Roundup — week of Jul 3, 2026: line 323
- Rank 8: colibri: Authorization requirements: line 334

## Rank 1: Stellar Zipper, Protocol 27 Upgrade Guide
url: https://stellar.org/blog/foundation-news/stellar-zipper-protocol-27-upgrade-guide | scope: research_chunk | date: 2026-06-04 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0022.txt

## What’s New in Zipper

The following is a brief summary of what’s included in Protocol 27.

Authentication delegation for custom accounts (CAP-0071-01)What it does. Adds a first-class protocol mechanism for custom (smart contract) accounts to delegate their authentication logic to other addresses. Two new host functions are introduced: delegate_account_auth, which may be called inside a custom account’s __check_auth function to delegate authentication to a specified address, and get_delegated_signers_for_current_auth_check, which returns the list of delegated signer addresses populated in the current authorization entry.

A new credential type, SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES, allows all delegated signers and their (potentially nested) signatures to be bundled into a single authorization entry. This eliminates the need for a separate authorization entry per delegated signer, reducing transaction size and simplifying simulation. Delegation can be nested recursively, so any account—including ones with delegated signers of their own—can serve as a delegate.

The signature payload for this credential type uses a new ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS envelope, which explicitly binds the payload to the top-level account address, preventing cross-account signature replay.

Why it matters. The underlying capability—delegating authentication from a custom account to another address—already existed in the protocol, but only as an accidental side effect of the authorization framework design. In practice it was difficult to use: simulation required manually constructing inner authorization payloads and running multiple simulation passes; every delegated signer required its own authorization entry with its own nonce, increasing transaction cost; and forwarding authorization context to delegates bloated transaction size unnecessarily. Zipper makes delegation a proper, first-class feature that is dramatically simpler to implement correctly.

Who should care. Soroban developers building smart accounts—wallets, multisig schemes, account abstraction—will see the most direct benefit. Delegation goes from being a fragile workaround to a supported, efficient pattern. Transaction sizes shrink, simulation simplifies, and the boilerplate around payload construction largely disappears.

Developers following the broader account abstraction roadmap should also pay attention. CAP-0071-01 is explicitly foundational to CAP-0072, which adds contract-based authentication to classic Stellar (G-) accounts. The delegation mechanism introduced here is the same one that more visible features in future protocols will depend on.

End users and wallet holders benefit indirectly: cheaper transactions and more flexible account designs (social recovery, delegated signing keys, modular multisig) become practical to build.

Address-bound Soroban address credentials (CAP-0071-02)What it does. Introduces SOROBAN_CREDENTIALS_ADDRESS_V2, a new credential type that uses the same ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS signature payload introduced in CAP-0071-01. Unlike the existing SOROBAN_CREDENTIALS_ADDRESS, the new payload explicitly includes the signer’s address, preventing replay attacks between accounts that share private keys when the invocation payload does not otherwise bind the signer address.

Clients have some time to adopt the new credential type after the Protocol 27 upgrade; there is no requirement to migrate immediately. The existing SOROBAN_CREDENTIALS_ADDRESS type remains valid until the Protocol 28 upgrade.

Why it matters. The existing credential type is safe for the vast majority of use cases—the vulnerability it closes is narrow, requiring both shared private keys across accounts and an invocation payload that doesn’t bind the signer address. This CAP closes that gap in a non-disruptive way, offering a migration path rather than forcing an immediate switch.

Who should care. Developers building applications where multiple accounts may share keys, or who want to adopt a more conservative security posture, should plan to migrate to SOROBAN_CREDENTIALS_ADDRESS_V2 after the Protocol 27 upgrade. For everyone else, this is a low-urgency improvement to be aware of.

## Rank 1 companion: (same URL)
url: https://stellar.org/blog/foundation-news/stellar-zipper-protocol-27-upgrade-guide | scope: ai_summary | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0268.txt

Stellar Zipper, Protocol 27 Upgrade Guide

Protocol 27 Zipper upgrade launches July 8 with authentication delegation for smart accounts (CAP-0071), streamlining multisig implementations and reducing transaction costs. SDKs release June 5-11, testnet upgrade June 18. Developers must review breaking changes and update dependencies before mainnet vote.

Stellar Protocol 27 Zipper introduces authentication delegation for custom smart accounts via CAP-0071-01, enabling wallets and multisig schemes to delegate signing to other addresses without requiring separate authorization entries per signer. Signature payloads now explicitly bind to the top-level account address, preventing cross-account replay attacks. CAP-0071-02 adds address-bound Soroban credentials (V2), closing a narrow replay vulnerability. Release timeline: Stellar Core June 5, RPC and Galexie June 10, SDKs June 5-11, Horizon June 12, testnet upgrade June 18, mainnet protocol vote July 8. Developers should review breaking changes immediately and update SDK dependencies before mainnet vote. Key change: @stellar/stellar-base consolidates into @stellar/stellar-sdk.

## Rank 2: Contract signers for Stellar accounts
url: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0072.md | scope: research_chunk | date: 2025-09-04 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0038.txt

## Specification

The algorithm for verifying detached (non-`SOURCE_ACCOUNT`) smart contract authorization payload in Soroban host is updated to enable delegated account support. The authentication is updated in the following way:

- `get_delegated_signers_for_current_auth_check` host function (defined in CAP-71) is used to retrieve all the delegated signers corresponding to the authentication
- If the total number of signatures and delegated signers is `0` or exceeds `MAX_ACCOUNT_SIGNATURES` (20), fail
- If the delegated signers are not sorted in the ascending order, or contain duplicates, fail
- If any delegated signer is not stored in the `AccountEntry`, fail
- Call `delegate_account_auth` for every delegated signer, and fail if the call fails
- Add the weight of every delegated signer to the signature weight
- Process the regular signatures passed with the authorization entries according to [CAP-46-11](./cap-0046-11.md#stellar-account-authentication) and add their weights to the total weight
- Compare the total signature weight to the required threshold (`MEDIUM` or `HIGH`, see details below)

An additional change is made in order to use the proper signature threshold for the account management. Currently, G-account authentication rules in Soroban use `MEDIUM` threshold when authenticating an account for any Soroban operation, i.e. the built-in G-account contract ignores the authorization context completely.

With this CAP, if any contract call on a G-account is present in authorization context, then the threshold requirement will be raised to `HIGH`.

#### G-account contract (GAC)

Every G-account on-chain gets an implicit contract 'instance' which is just represented by the account entry itself. The contract will be called GAC further for simplicity.

When a contract call is performed on a G-address, the implementation of GAC built into host will handle the call. This is similar to the Stellar Asset contract handling (SAC), with the only difference being that a non-contract address is being used for routing the calls.

#### `AccountEntry` updates from Soroban host

All GAC operations have to update the `AccountEntry` that belongs to the corresponding G-account. Updates to the signers require following the base reserve semantics in the same fashion as for the `SetOptions` operation.

When a signer is added to the `AccountEntry`, the number of account sub-entries is increased, so the base reserve has to go up. If the account does not have sufficient balance for increasing the base reserve, then the function call will fail. Sponsorship is not supported for the Soroban operations in general, so there is no way to sponsor the base reserve instead.

When a signer is removed from the `AccountEntry`, it might be sponsored. If there is no sponsorship, then the sub-entries count is just reduced for the entry. If there is a sponsorship, then information is updated accordingly in both the affected account and its sponsor, i.e. base reserve is returned to the sponsor. This update does not require additional authorization from the sponsor, so it can be performed by the Soroban Host by just changing 2 account entries accordingly.

##### GAC functions

Every GAC function calls `require_auth` for the corresponding G-account. Authentication procedure will require `HIGH` signature threshold, as per G-account authentication semantics described in the authentication [section](#g-account-authentication).

The following sections describe semantics of all the GAC functions.

###### `update_ed25519_signer`

Adds a new ed25519 signer with the provided 32-byte public key to the account. If the signer already exists, updates its weight instead.

Fails if a new signer is being added and an account already has `MAX_SIGNERS` (20) signers.

###### `remove_ed25519_signer`

Removes an existing ed25519 signer from the account.

Fails if the signer does not exist.

###### `update_delegated_signer`

Adds a new delegated signer with the provided `Address` and the provided weight. If the signer already exists, updates the weight instead.

Fails if a new signer is being added and an account already has `MAX_SIGNERS` (20) signers.

###### `remove_delegated_signer`

Removes an existing delegated signer from the account.

Fails if the signer does not exist.

###### `set_master_weight`

Sets the weight of the 'master' key, i.e. the public key that identifies the account.

###### `update_thresholds`

Updates the signature thresholds of the account when the corresponding arguments are set for the low/medium/high thresholds.

## Rank 3: rs-soroban-sdk v27.0.0 — 27.0.0
url: https://github.com/stellar/rs-soroban-sdk/releases/tag/v27.0.0 | scope: research_chunk | date: 2026-07-08 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0019.txt

## What's Changed

### New Features

- **CAP-71 — Auth delegation for custom accounts** — Adds support for delegating a custom account's `__check_auth` to another address. `CustomAccount::delegate_auth` hands authorization to a G- or C-address that performs the actual authentication logic, and `CustomAccount::get_delegated_signers` returns the delegated signers supplied in the transaction's authorization payload for verification. (#1896)

### Improvements

- **Zero-copy `BytesN::from` for `[u8; N]`** — `BytesN::from` now uses `BytesN::to_array` instead of allocating, avoiding extra memory allocation and significantly reducing CPU cost on conversions (up to ~80% on larger arrays in end-to-end benchmarks). (#1888)

## Rank 4: js-stellar-sdk v16.1.0
url: https://github.com/stellar/js-stellar-sdk/releases/tag/v16.1.0 | scope: research_chunk | date: 2026-07-22 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0188.txt

## [v16.1.0](https://github.com/stellar/js-stellar-sdk/compare/v16.0.1...v16.1.0)

### Added
- `inspectAuthEntry(entry)`: decodes a `xdr.SorobanAuthorizationEntry` into a typed summary — credential type, authorizing address, nonce, `signatureExpirationLedger`, and a `signers` list covering top-level credentials and CAP-71 delegates. Adds the `AuthEntryInfo`, `AuthEntrySigner`, `AuthEntrySignature`, and `AuthEntryCredentialType` types ([#1529](https://github.com/stellar/js-stellar-sdk/pull/1529)).
- `checkAuthEntryReadiness(entry, currentLedgerSeq)`: reports whether an auth entry is ready to submit — `{ ready, expired, unsignedBy }` — as a pure decode with no network call ([#1529](https://github.com/stellar/js-stellar-sdk/pull/1529)).
- `Spec.nativeToScVal` now supports contract parameters typed as `Val` (`scSpecTypeVal`), so raw JS values can be passed to `Val`-typed arguments without building `xdr.ScVal` objects by hand ([#1485](https://github.com/stellar/js-stellar-sdk/pull/1485)).
- `rpc.Server.queryContract<T>(contractId, method, args?, networkPassphrase?)`: a one-line read-only contract call that returns `{ result, isReadCall }`, no transaction assembly or signing. Works for Wasm contracts and built-in Stellar Asset Contracts (SACs) ([#1502](https://github.com/stellar/js-stellar-sdk/pull/1502)).
- `rpc.Server.getContractMethods(contractId, networkPassphrase?)`: lists a contract's callable methods and their signatures. Adds the `Api.ContractMethod` and `Api.ContractMethodInput` types ([#1502](https://github.com/stellar/js-stellar-sdk/pull/1502)).
- `rpc.Server.getContractInstance(contractId)`: returns a contract's `xdr.ScContractInstance` ([#1501](https://github.com/stellar/js-stellar-sdk/pull/1501)).
- `contract.Client.from`, `fromWasm`, and `fromWasmHash` are now generic (`<T>`) and return `Client & T`, giving typed contract methods without code generation. `T` defaults to `unknown`, so untyped calls are unchanged ([#1502](https://github.com/stellar/js-stellar-sdk/pull/1502)).
- `ClientOptions.server`: pass an existing `rpc.Server` to `contract.Client.from` to reuse its transport instead of building a new one ([#1502](https://github.com/stellar/js-stellar-sdk/pull/1502)).
- `Keypair.signMessage(message)` and `Keypair.verifyMessage(message, signature)`: sign and verify arbitrary messages per [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md), matching the Python and Java SDKs and stellar-cli ([#1513](https://github.com/stellar/js-stellar-sdk/pull/1513)).
- `TransactionFailedError`: raised by `Horizon.Server.submitTransaction` and `submitAsyncTransaction` when Horizon rejects a transaction with result codes. Extends `BadResponseError` and adds `getResultCodes()` and `getTransactionResult()` ([#1526](https://github.com/stellar/js-stellar-sdk/pull/1526)).

### Changed
- `HorizonApi.TransactionFailedResultCodes` gained the transaction result codes it was missing: `tx_bad_sponsorship`, `tx_bad_min_seq_age_or_gap`, `tx_malformed`, `tx_soroban_invalid`, and `tx_frozen_key_accessed` ([#1526](https://github.com/stellar/js-stellar-sdk/pull/1526)).
- `contract.Client.from` now supports built-in Stellar Asset Contracts (SACs), building the client from the embedded SAC spec instead of downloading Wasm ([#1501](https://github.com/stellar/js-stellar-sdk/pull/1501)).
- `rpc.Server.getContractWasmByContractId` now rejects a SAC with a structured `{ code: 400 }` error pointing to `contract.Client.from`. The not-found rejection is now `{ code: 404, message: "Could not obtain contract instance from server" }` ([#1501](https://github.com/stellar/js-stellar-sdk/pull/1501)).
- The UMD (`dist/`) build now sets `inlineDynamicImports` so the single-file bundle stays whole despite the SAC spec's lazy `import()` ([#1501](https://github.com/stellar/js-stellar-sdk/pull/1501)).

### Fixed
- `Horizon.Server.submitTransaction` and `submitAsyncTransaction` now reject with SDK error types on HTTP failures, as documented: a `TransactionFailedError` for Horizon result codes, a `BadResponseError` otherwise. The wrapping branch used to be unreachable, so failures leaked through as raw HTTP-client errors. `err.response.data` and `err.response.status` are unchanged; the original error is now preserved as `err.cause` ([#1526](https://github.com/stellar/js-stellar-sdk/pull/1526)).
- `Federation.Server` resolution methods (`resolveAddress`, `resolveAccountId`, `resolveTransactionId`, `forDomain`) had the same unreachable branch and now reject HTTP failures with `BadResponseError` ([#1526](https://github.com/stellar/js-stellar-sdk/pull/1526)).
- `contract.AssembledTransaction.needsNonInvokerSigningBy` now treats an empty `scvVec` signature as unsigned, matching the existing `scvVoid` check. Such entries used to count as already signed and were left off the list ([#1529](https://github.com/stellar/js-stellar-sdk/pull/1529)).
- `Spec.nativeToScVal` no longer misclassifies plain objects that have a `constructor` key, and handles null-prototype objects (`Object.create(null)`) ([#1485](https://github.com/stellar/js-stellar-sdk/pull/1485)).

## Rank 5: Stellar Protocol Meeting 2026-04-30
url: https://developers.stellar.org/meetings/2026/04/30 | scope: research_chunk | date: 2026-04-30 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0063.txt

## CAP-71-02: Closing a Signature Replay Gap​

The reason a separate addendum exists: CAP-71 introduced a new kind of signature payload preimage, and that surfaced a small oversight in the original design. Soroban uses a unified format for signature payloads — a preimage carrying most of the necessary context, hashed with SHA-256 and then signed with an arbitrary cryptographic algorithm. "Most" is the key word: the standard authorization payload does not include the signer&#x27;s address.

Most of the time this doesn&#x27;t matter. In a typical token transfer from A to B, the authorizing address is present in the payload anyway. Even when it isn&#x27;t — like minting with a Stellar Asset Contract, where the admin address is not in the payload — a SAC has only a single admin, so the signature can&#x27;t be reused.

The one obscure case where it does matter, described in detail in the security notice published just before the meeting, requires a specific combination of factors to line up:

- An admin-style contract where the authorizing signer is implicit — fetched from storage rather than named in the payload

- That admin being rotated to a different public address

- The old and new addresses reusing the same private key

Sharing a private key across public addresses is rare and generally not something you should do, and an analysis showed this combination has never occurred on-chain. But if it ever did happen, the impact would be serious — a signature could be replayed to, for example, mint a token a second time. The gap was discovered through security audits.

The fix introduces a new credential type, SOROBAN_CREDENTIALS_ADDRESS_V2, whose only difference from the current address credentials is that the protocol uses an address-bound signature payload preimage — the signer&#x27;s address is guaranteed to be part of what gets signed. The structure is otherwise identical, so supporting it downstream is just a matter of switching from one credential type and payload format to the other.

## Rank 6: Invoke and deploy smart contracts with the InvokeHostFunctionOp operation
url: https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction | scope: research_chunk | date: 2026-07-30 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0135.txt

## XDR Usage​

- SOROBAN_CREDENTIALS_SOURCE_ACCOUNT - this simply uses the signature of the transaction (or operation, if any) source account and hence doesn&#x27;t require any additional payload.

- SOROBAN_CREDENTIALS_ADDRESS - contains SorobanAddressCredentials with the following structure:
struct SorobanAddressCredentials
{
 SCAddress address;
 int64 nonce;
 uint32 signatureExpirationLedger;
 SCVal signature;
};

The fields of this structure have the following semantics:

- When address is the address that authorizes invocation.

- signatureExpirationLedger the ledger sequence number on which the signature expires. Signature is still considered valid on signatureExpirationLedger, but it is no longer valid on signatureExpirationLedger + 1. It is recommended to keep this as small as viable, as it makes the transaction cheaper.

- nonce is an arbitrary value that is unique for all the signatures performed by address until signatureExpirationLedger. A good approach to generating this is to just use a random value.

- signature is a structure containing the signature (or multiple signatures) that signed the 32-byte, SHA-256 hash of the ENVELOPE_TYPE_SOROBAN_AUTHORIZATION preimage (XDR). The signature structure is defined by the account contract corresponding to the Address (see below for the Stellar account signature structure).

SorobanAuthorizedInvocation defines a node in the authorized invocation tree:

struct SorobanAuthorizedInvocation
{
 SorobanAuthorizedFunction function;
 SorobanAuthorizedInvocation subInvocations<>;
};

union SorobanAuthorizedFunction switch (SorobanAuthorizedFunctionType type)
{
case SOROBAN_AUTHORIZED_FUNCTION_TYPE_CONTRACT_FN:
 SorobanAuthorizedContractFunction contractFn;
case SOROBAN_AUTHORIZED_FUNCTION_TYPE_CREATE_CONTRACT_HOST_FN:
 CreateContractArgs createContractHostFn;
};

struct SorobanAuthorizedContractFunction
{
 SCAddress contractAddress;
 SCSymbol functionName;
 SCVec args;
};

SorobanAuthorizedInvocation consists of the function that is being authorized (either contract function or a host function) and the authorized sub-invocations that function performs (if any).

SorobanAuthorizedFunction has two variants:

- SOROBAN_AUTHORIZED_FUNCTION_TYPE_CONTRACT_FN is a contract function that includes the address of the contract, name of the function being invoked, and arguments of the require_auth/require_auth_for_args call performed on behalf of the address. Note, that if require_auth[_for_args] wasn&#x27;t called, there shouldn&#x27;t be a SorobanAuthorizedInvocation entry in the transaction.

- SOROBAN_AUTHORIZED_FUNCTION_TYPE_CREATE_CONTRACT_HOST_FN is authorization for HOST_FUNCTION_TYPE_CREATE_CONTRACT or for create_contract host function called from a contract. It only contains the CreateContractArgs XDR structure corresponding to the created contract.

Building SorobanAuthorizedInvocation trees may be simplified by using the recording auth mode in Soroban&#x27;s simulateTransaction mechanism (see the docs for more details).

Stellar Account Signatures​
signatureArgs format is user-defined for the custom accounts, but it is protocol-defined for the Stellar accounts.

The signatures for the Stellar account are a vector of the following Soroban structures in the Soroban SDK format:

#[contracttype]
pub struct AccountEd25519Signature {
 pub public_key: BytesN<32>,
 pub signature: BytesN<64>,
}

JavaScript Usage​
There are a couple of helpful methods in the SDK to make dealing with authorization easier:

- Once you&#x27;ve gotten the authorization entries from simulateTransaction, you can use the authorizeEntry helper to "fill out" the empty entry accordingly. You will, of course, need the appropriate signer for each of the entries if you are in a multi-party situation.

const signedEntries = simTx.auth.map(async (entry) =>
 // In this case, you can authorize by signing the transaction with the
 // corresponding source account.
 entry.switch() ===
 xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()
 ? entry
 : await authorizeEntry(
 entry,
 // The `signer` here will be unique for each entry, perhaps reaching out
 // to a separate entity.
 signer,
 currentLedger + 1000,
 Networks.TESTNET,
 ),
);

- If you, instead, want to build an authorization entry from scratch rather than relying on simulation, you can use authorizeInvocation, which will build the structure with the appropriate fields.

### Transaction resources​

Every Soroban transaction has to have a SorobanTransactionData transaction extension populated. This is needed to compute the Soroban resource fee.

The Soroban transaction data is defined as follows:

struct SorobanResources
{
 // The ledger footprint of the transaction.
 LedgerFootprint footprint;
 // The maximum number of instructions this transaction can use
 uint32 instructions;

 // The maximum number of bytes this transaction can read from disk backed entries
 uint32 diskReadBytes;
 // The maximum number of bytes this transaction can write to ledger
 uint32 writeBytes;
};

struct SorobanResourcesExtV0
{
 // Vector of indices representing what Soroban
 // entries in the footprint are archived, based on the
 // order of keys provided in the readWrite footprint.
 uint32 archivedSorobanEntries<>;
};

struct SorobanTransactionData
{
 union switch (int v)
 {
 case 0:
 void;
 case 1:
 SorobanResourcesExtV0 resourceExt;
 } ext;
 SorobanResources resources;
 // Amount of the transaction `fee` allocated to the Soroban resource fees.
 int64 resourceFee;
};

This data comprises the Soroban resources and the resourceFee. The resourceFee is the portion of the transaction fee allocated to Soroban resource fees. It has a non-refundable part (fees for instructions, ledger I/O, and transaction size) and a refundable part that is charged based on actual consumption of refundable resources: the contract events emitted by the transaction, the return value of the host function invocation, and the ledger space rent.

## Rank 7: Stellar Weekly Roundup — week of Jul 3, 2026
url: https://lumenloop.com/research/stellar-weekly-roundup-week-jul-3-2026 | scope: research_chunk | date: 2026-07-10 | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0017.txt

## Protocol 27 and Network Infrastructure

Protocol 27 activated on Stellar mainnet July 9. The Zipper upgrade ships auth delegation as a first-class smart account feature, combines all signer auth into one entry per transaction, simplifies simulation, and prevents signature replay.

CAP-711 adds built-in delegation support for modular custom accounts. CAP-712 fixes a signature vulnerability: the standard authorization pre-image did not include the signer&#x27;s address, creating a replay risk when private keys are shared across accounts during simultaneous signer rotation. Both CAPs were discussed at the July 8 Stellar Developers Meeting.

Alchemy now participates directly in SCP consensus as a tier-1 validator, adding to its existing Stellar RPC and read support. At Thursday&#x27;s developer meeting, @0xkaancar presented CAP-0084 and CAP-0085 for community review.

## Rank 8: colibri: Authorization requirements
url: https://github.com/fazzatti/colibri/blob/main/docs/core/authorization.md | scope: research_chunk | date: none | text_path: /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev/1790473192-27a4daca-7de6-4c3e-8903-74b4a98dff6c/search-documents/0020.txt

## Delegated authorization

Assemble [`DelegatedSigner`](signer/delegated-signer.md) topology before
invoking a pipeline. Only the top-level signer belongs in the pipeline's list;
it recursively authorizes its `nestedDelegates`. Completed operation XDR, not
the presence of a signer in a list, triggers the extra assembly and enforcing
simulation. Ordinary entries pass through those steps without an extra RPC
simulation.

Read [delegated signers](signer/delegated-signer.md),
[the invoke sequence](pipelines/invoke-contract.md), and
[auth-entry signing](processes/sign-auth-entries.md).

For smart-account WebAuth, the separate
[SEP-45 handler](../packages/webauth/sep45.md) delegates contract-specific
authorization to the application. Core's transaction capability does not imply
that every credential type is accepted in a
[SEP-45](../packages/webauth/sep45.md) server challenge.

