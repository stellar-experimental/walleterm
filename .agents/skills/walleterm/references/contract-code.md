# Contract code trust

Read this when a signature depends on contract code. Examples include a custom account's `__check_auth`, its verifiers or policies, a C-address delegate, and a contract that the user pinned by code.
An ordinary payment, or a call to a contract that the user chose, does not need a code audit.

## Resolve the executable

1. Read the contract instance entry through RPC `getLedgerEntries` or an equivalent tool. The key is `ledger_key_contract_instance`, and the durability is persistent.
2. Read the instance `executable`:
   - `wasm`: compare the hash with the expected value.
   - `stellar_asset`: identify the asset from the contract address and its instance storage.
   - `external_ref` (CAP-85): read `executable_owner` and `tag`. Then read the owner contract's persistent entry keyed by `SCV_EXECUTABLE_TAG(tag)`.
     That value is the resolved 32-byte Wasm hash. Compare the resolved hash, not the reference.
3. When you need the code bytes, fetch them by the resolved hash and check their SHA-256.

CAP-85 is in [stellar-protocol `9cd7030`](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0085.md). Its preamble lists protocol 28, and its transition section says TBD. Confirm network support.
A tool that cannot decode the executable must stop. A decode failure is not evidence of `wasm`.
`@stellar/stellar-sdk` 17.2.0 includes `ContractExecutableExternalRef` and `scvExecutableTag`.
A tool that returns a Wasm hash for an address may hide the reference. The host function `get_address_executable` returns only the resolved hash.

## Manager trust

The owner contract of an `external_ref` can change the tag entry at any time. Every contract that uses the tag then runs the new code.
The protocol only makes sure that the entry exists and names uploaded Wasm. It does not limit what that Wasm does.
A resolved hash is a fact at one point in time. Resolve it again before a new signing session.

The trust set includes the owner contract, its own executable, and each party that can update the tag entry.
Identify them before you rely on the account's authorization logic.
When a grant or pin names a Wasm hash but not the manager, ask before signing for a manager-controlled contract.

A contract-creation authorization with an `ExternalRef` executable names the owner and tag, not a code hash.
Approval then accepts the manager's later code choices. A custom account that cannot parse `ExternalRef` can reject that creation.
