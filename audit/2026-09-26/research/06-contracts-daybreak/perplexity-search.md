# Perplexity challenge pass

Status: passed.

The search returned ten results.
The relevant results came from official Stellar documentation and protocol files.

The challenge did not refute the trust-gap finding.
Enforcement simulation validates signatures only after the signer creates them.
CAP-46-11 binds `rootInvocation` into the signature payload.
CAP-46-11 does not require that root to match the transaction root.

This protocol rule makes the leaked signature independently useful.
The attacker still needs a valid consumption path and an unexpired nonce.

Primary URLs:

- https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation
- https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations
- https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization
- https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-11.md

Provider usage was not visible.

