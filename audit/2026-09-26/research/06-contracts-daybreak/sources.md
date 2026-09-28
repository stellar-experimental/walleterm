# Research record

Access date: 2026-09-26.

## Tool outcomes

| Tool | Result | Usage |
| --- | --- | --- |
| Stellar Raven MCP | passed | Official Stellar pages returned relevant text. |
| stellar-raven-jev | failed | Three transport failures cost `$0.008729397`. |
| parallel-cli | failed | The API returned `APIConnectionError`. |
| Parallel Search MCP | passed | One `sku_search` unit. |
| Perplexity MCP | passed | Provider charge was not visible. |

The Jev run used a `$1` cap.
It returned no source documents.
Its full record remains in the timestamped subdirectory.
No rate limit occurred.
No retry occurred.

The `parallel-cli` call used `basic` mode.
It made internal connection retries before failure.
The provider charge was not visible.

No paid deep-research processor ran.
The visible total cost was `$0.008729397`.
Other provider charges remain unknown.

## Primary sources

1. [CAP-46-11](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-11.md)
   defines the original authorization payload.
   It binds the network, nonce, expiration, and `rootInvocation`.
   It also permits the entry root to differ from the transaction root.

2. [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-01.md)
   defines native authorization delegation.
   `AddressWithDelegates` uses the address-bound authorization preimage.

3. [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md)
   defines `SOROBAN_CREDENTIALS_ADDRESS_V2`.
   This credential also uses the address-bound preimage.

4. [CAP-85](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0085.md)
   defines externally managed contract executables.

5. [Authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization)
   says an authorization entry contains credentials and an invocation tree.
   The signature covers the tree through the protocol preimage.

6. [Transaction simulation](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation)
   says recording mode returns invocation trees and nonces.
   Enforcement mode validates supplied signatures against a simulated transaction.

7. [Signing Soroban contract invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations)
   describes record, sign, enforce, and fee-payer review steps.

8. [Native delegate example](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/delegate-auth)
   shows `AddressWithDelegates` entries and `delegate_auth`.

## Applicability

The frozen project uses `@stellar/stellar-sdk` `17.1.0`.
The CAP-71 fixtures use `soroban-sdk` `27.0.2`.
The CAP-85 fixtures use `soroban-sdk` `28.0.0` and `27.0.6`.
The reviewed testnet recorded protocol version 28.

CAP-46-11 explains why enforcement simulation does not revoke a leaked signature.
Another transaction can consume a valid tree when protocol matching permits it.
This conclusion is an inference from the protocol rules.

## Research limits

The sources define protocol behavior.
They do not state that every client must distrust its RPC.
The finding applies the protocol facts to this harness trust boundary.

