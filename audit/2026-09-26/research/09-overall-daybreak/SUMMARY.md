# Daybreak overall research summary

## Question

The research challenged the C11 scope and severity. It asked which data a Soroban authorization signature binds. It also asked whether a failed enforcing simulation revokes the signature.

## Research surfaces

Stellar Raven searched current official Stellar documentation first. It returned the authorization, transaction, simulation, and invocation-signing documentation. Its artifact was `f0a2a2f5-4416-4fd2-abec-4bb0566d5dd2`.

Jev ran one bounded search with a `$1` limit. Three evidence reports failed, so Jev returned no documents. It recorded `$0.008729397` and a failed status. The audit did not retry it.

`parallel-cli` returned ten results. Its search ID was `search_2c4bb2b4333fd41a4b1e12f5f9d0ec74`. Parallel Search MCP returned `search_cec05b9db92576abcadbac313b2eb93e`. Perplexity returned eight results.

The tools did not expose complete provider billing. The visible Jev cost stayed below both research limits.

## Evidence

CAP-46-11 defines the authorization signature preimage. It binds the network ID, nonce, expiration ledger, and `rootInvocation`. It excludes the transaction source, fee payer, and complete envelope.

A signed entry can move to another transaction with the same invocation tree. The nonce prevents reuse after successful on-chain consumption. Simulation discards state changes.

A failed enforcing simulation does not persist nonce consumption. The entry remains usable until network consumption or expiration.

These facts make unexpected-tree signing a meaningful test-harness risk. The current scenario still requires a changed or compromised RPC response.

No review showed an actual Stellar RPC incident. The fixed endpoint and dedicated testnet scope reduce impact. The evidence supports conditional Low for C11.

## Minimum mitigation

Validate the full authorization tree before any signer callback runs. Compare each contract, function, argument, authorizer, nonce, and nested invocation.

Keep enforcing simulation before submission. Do not treat a failed simulation as signature revocation.

## Primary sources

- [CAP-46-11](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-11.md)
- [Authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization)
- [Transaction simulation](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation)
- [Stellar transaction authorization data](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction)
- [Signing Soroban contract invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations)
