# Stellar Raven results

Status: passed.

The search used the official Stellar documentation service.
It returned the native delegation example and transaction authorization data.
It also returned protocol 28 and CAP-85 documentation entries.

Relevant URLs:

- https://developers.stellar.org/docs/build/smart-contracts/example-contracts/delegate-auth
- https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction#authorization-data
- https://developers.stellar.org/docs/networks/software-versions
- https://developers.stellar.org/docs/build/guides/auth/contract-authorization#set_auths

The result confirms that an authorization entry contains `rootInvocation`.
The native example confirms the `AddressWithDelegates` structure.

