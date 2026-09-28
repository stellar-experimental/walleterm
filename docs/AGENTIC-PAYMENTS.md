# Agentic payments: x402 and MPP

Status: research only, recorded on 2026-09-28. No implementation, live signature, or testnet payment exists yet.
This document records how walleterm can pay x402 and MPP services. It lists the work to pick up later.

## Decision

Neither protocol works unchanged with walleterm today.
x402 fits best. A small local signer and one client option make it work.
MPP Charge can work after a V2-capable `@stellar/mpp` release, or through a synchronous Keypair proxy.
MPP Session does not fit. Do not build it without an accepted use case.

The signing primitive is not the blocker. Both protocols sign Soroban authorization entries.
Their digest is `SHA-256(XDR(HashIdPreimage))`, which `walleterm sign` accepts.
The blockers are client library defaults and non-digest messages.

## Sources

Research used Stellar Raven MCP, `parallel-cli` 0.9.3, npm tarballs, and GitHub source.
Local tools were Stellar CLI 28.0.0 and walleterm `main` at `0e55592`.

| Source | Version and evidence |
| --- | --- |
| [`@x402/stellar`](https://www.npmjs.com/package/@x402/stellar), `@x402/core`, `@x402/mcp` | 2.27.0, published 2026-09-22. Depends on `@stellar/stellar-sdk` `^16.3.0`. |
| [x402-foundation/x402](https://github.com/x402-foundation/x402/tree/c84154b5d6a31d77fd5b9dbb01213053fd9cb9eb) | Commit `c84154b5`. Paths below are under `typescript/packages/mechanisms/stellar/src/`. |
| [x402 exact Stellar scheme spec](https://github.com/x402-foundation/x402/blob/c84154b5d6a31d77fd5b9dbb01213053fd9cb9eb/specs/schemes/exact/scheme_exact_stellar.md) | Lines 126–127 require facilitators to accept V1 and V2 credentials. |
| [OpenZeppelin x402 facilitator plugin](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator/tree/7583ebcb526606a66c2c97665a6a059388cbc22c) | v0.5.0, commit `7583ebcb`. Accepts V1 and V2. Uses SDK 17. |
| [`@stellar/mpp`](https://www.npmjs.com/package/@stellar/mpp) | 0.7.1. Peers `@stellar/stellar-sdk` `^15.1.0` and `mppx` `^0.6.29`. |
| [stellar/stellar-mpp-sdk](https://github.com/stellar/stellar-mpp-sdk/tree/afd8fb58410e066c0f9b28b571ab089be722c269) | `main` at `afd8fb58`, 2026-09-22. Unreleased. Peers SDK `^16.3.0` and `mppx` `^0.10.1`. |
| [`mppx`](https://www.npmjs.com/package/mppx) | 0.11.0. General MPP framework and CLI. No Stellar plugin. |
| [stellar-experimental/one-way-channel](https://github.com/stellar-experimental/one-way-channel/tree/25dea1b303495a7a4184af7605bbb7671ff08da6) | Commit `25dea1b3`, 2026-07-30. Experimental and not audited. |
| `@stellar/stellar-sdk` | 16.3.0 and 17.1.0. |
| [Stellar agentic payments docs](https://developers.stellar.org/docs/build/agentic-payments) | x402 and MPP pages, read through Stellar Raven. |
| [MPP protocol](https://mpp.dev/protocol) | Tempo and Stripe, launched 2026-03-18. Internet-Draft `draft-httpauth-payment-00`, not an IETF standard. |

Live read-only checks on 2026-09-28:

- Testnet RPC and core reported `29.0.0`, with `protocolVersion: 28`.
- `https://x402.org/facilitator/supported` listed `stellar:testnet` with `areFeesSponsored: true`. It listed no `stellar:pubnet`.
- `https://channels.openzeppelin.com/x402/testnet/supported` returned 401 without an API key.

## The protocols on Stellar

### x402

1. The server returns 402 with payment requirements: asset, amount, `payTo`, network, and `maxTimeoutSeconds`.
2. The client simulates a SAC `transfer(from, to, amount)` and signs its authorization entry.
3. The client sends the transaction XDR in the `PAYMENT-SIGNATURE` header (x402 v2).
4. The facilitator rebuilds the transaction with its own source, pays the fee, and submits it.

The payer needs a USDC trustline and balance. It needs no XLM for fees.
The client requires `extra.areFeesSponsored: true` (`exact/client/scheme.ts`).

### MPP

MPP is a 402 protocol for many payment networks. The Stellar method has no facilitator.

| Mode | Client signs | Submits |
| --- | --- | --- |
| Charge, pull, sponsored | SAC `transfer` authorization entry | Server, with its fee payer |
| Charge, pull, unsponsored | Full transaction envelope | Server |
| Charge, push | Envelope, then the string `challenge.id:hash` | Client |
| Session | One off-chain channel commitment for each request | Server closes the channel |

## Compatibility

| Flow | Result | Reason |
| --- | --- | --- |
| x402 with the stock `@x402/stellar` 2.27.0 client | Fails | SDK 16.3.0 simulation returns V1 credentials. walleterm rejects V1. |
| x402 with a walleterm signer and `useUpgradedAuth: true` | Expected to work | The signer type is SEP-43-shaped. Both facilitators accept V2. Not yet run live. |
| MPP Charge pull, sponsored, `@stellar/mpp` 0.7.1 | Fails | The client signs and the server verifies V1 only. |
| MPP Charge pull, sponsored, `main` `afd8fb58` | Expected to work after release | `useUpgradedAuth` exists but defaults to `false`. The client still needs a Keypair. |
| MPP Charge pull, unsponsored | Workaround only | Envelope hash signing fits. The client accepts only a synchronous Keypair. |
| MPP Charge push | Fails | The binding message has about 90 bytes, not 32. |
| MPP Session commitments | Fails | The contract verifies Ed25519 over 192 XDR bytes, not a hash. |
| MPP channel open, close, and refund | Works | These are ordinary transactions. walleterm signs their envelope hash. |
| C-account payer | x402 custom client only. MPP Charge: no. | See the findings below. |

## Findings

### Why V1 matters

walleterm rejects V1 `sorobanCredentialsAddress` in `sign-auth`, the bridge, and the SEP-43 design.
V1 has no address binding, so a signature can serve another address (CAP-71-02).
Raw `walleterm sign` can sign a V1 digest. Do not use that path to bypass the V1 rule.
Request V2 credentials from simulation instead.

SDK 16.3.0 sets `useUpgradedAuth` to `false` by default (`rpc/server.js:1056`).
SDK 17.1.0 sets it to `true` by default (`rpc/server.js:1121`).
A live testnet probe on 2026-09-28 used the stock x402 client with a recording signer.
The signer received preimage discriminant 9, which is V1.
With `useUpgradedAuth: true`, the same simulation returned `sorobanCredentialsAddressV2`.
An npm override to SDK 17.1.0 produced discriminant 10, which is V2. That path changes the XDR API and is fragile.

### x402 client

- `ClientStellarSigner` is `{ address, signAuthEntry, signTransaction? }` (`signer.ts:37-41`).
  `isClientStellarSigner` checks only this shape, so a custom object works.
- The client calls `AssembledTransaction.build` for the SAC transfer (`exact/client/scheme.ts:69-81`).
  It then calls `tx.signAuthEntries({ address, signAuthEntry, expiration })` and simulates again.
- `signAuthEntry` receives Base64 `HashIdPreimage` XDR.
  It must return Base64 of the raw 64-byte signature over `sha256(preimage)`.
- The client passes `this.signer.signAuthEntry` unbound. Define the signer method as an arrow function.
- Expiry is `latest + ceil(maxTimeoutSeconds / ledgerSeconds)`. A 60-second timeout gave `latest + 12`.
  The server sets the timeout. The facilitator rejects expiry beyond `maxLedger + 2`.
- The default testnet RPC is `https://soroban-testnet.stellar.org`. Ledger time estimates use testnet Horizon.
- The payload transaction source is the null account `GAAA…WHF` with sequence 1.
- The stock client fails for a C-address payer. `authorizeEntry` calls `Keypair.fromPublicKey` on the credential address.

### x402 facilitator checks

The facilitator verify step (`exact/facilitator/scheme.ts:404-567`, `750-821`) requires:

- x402 version 2, one `invokeHostFunction` operation, and a SAC `transfer` with three arguments.
- The asset contract, `payTo`, and exact amount from the requirements.
- Address credentials only, V1 or V2. It rejects source-account and delegated credentials.
- No sub-invocations, a bounded expiry, and a successful re-simulation with a fee of 50,000 stroops or less.
- Exactly one matching `transfer` event, and the payer's signature.

V2 acceptance landed on 2026-09-02 in x402 PR #3279, commit `7488a46`.
The hosted facilitators' deployed versions were not confirmed.

### MPP Charge client

- The client accepts `keypair?: Keypair` or `secretKey?: string` (`sdk/src/charge/client/Charge.ts:442-446`).
  It has no signer callback.
- All signatures use that key: `authorizeEntry` (line 326), `prepared.sign` (line 381), and `clientKP.sign` (line 410).
- A Keypair-shaped object with `publicKey`, `sign`, `signatureHint`, and `signDecorated` passed a mock-key test.
  Its `sign()` received only 32-byte inputs for envelope and V2 entry signing.
- `sign()` is synchronous. A walleterm proxy would need a synchronous child process call. This is inferred and untested.
- Sponsored pull expiry is `latest + ceil(secondsUntilExpiry / 5)`. The 300-second default gives about 60 ledgers.
  That value is at the limit of `sign-auth`.
- Version 0.7.1 signs and verifies only V1 (`dist/charge/client/Charge.js:176-180`, `dist/shared/verify-auth.js:26`).
- Push signs `` Buffer.from(`${challenge.id}:${canonicalHash}`) `` with raw Ed25519 (`Charge.ts:409-410`).
- The client sets `from` to the Keypair's G-address. The server rejects contract authorizers.

### MPP Session

The channel contract verifies the full commitment bytes (`contracts/channel/src/lib.rs:241-250`):

```rust
fn into_bytes(&self) -> Bytes { self.to_xdr(env) }
fn verify(self, sig: &BytesN<64>) {
    // ...
    env.crypto().ed25519_verify(&commitment_key, &payload, sig);
}
```

The payload is an `ScVal::Map` of `amount`, `channel`, `domain: "chancmmt"`, and `network`. It has 192 bytes.
The client calls `commitmentKey.sign(Buffer.from(commitmentBytes))` (`sdk/src/channel/client/Channel.ts:222`).
Each paid request needs one new commitment signature.

The commitment key is a raw Ed25519 public key. A 1Password G-account key could serve as that key.
A walleterm path would need to sign 192 raw bytes, not a 32-byte digest.
The funder opens the channel through `__constructor`, which calls `from.require_auth()`.
The funder refunds through `close_start` and `refund`. walleterm can sign these transactions today.

### Agent tooling

- `@x402/mcp` 2.27.0 accepts any registered scheme, so it can use a custom Stellar signer.
- The `mppx` CLI has evm, stripe, tempo, and x402 plugins. It has no Stellar plugin.
  An `mppx.config.ts` can add a Stellar method.
- No x402 or MPP feature needs SEP-53 message signing on Stellar.
  x402 SIWX supports EVM and Solana only. The MPP attestation extension uses RFC 9421 with WebCrypto keys.

## Work to pick up

Follow the [development plan](PLAN.md) change process for each item.

### 1. Local SEP-43 signer for agents

Add one small export, for example `createWalletermSigner({ publicKey })`. It returns `{ address, signAuthEntry }`.
It adds no CLI command and does not change the digest contract.

`signAuthEntry` should:

1. Parse the preimage. Require the V2 type `envelopeTypeSorobanAuthorizationWithAddress`, the expected network, and the selected G-address.
2. Check the expiry against a trusted current ledger.
3. Decode the invocation tree. Require one SAC `transfer` from the selected address, with no sub-invocations.
4. Match the asset, recipient, and amount against the payment the caller approved.
5. Compute `sha256(preimage)`, call `walleterm sign`, and check `ok` and `verified`.
6. Return `{ signedAuthEntry: <Base64 signature>, signerAddress }`.

Reuse the preimage validation from the SEP-43 branch (`docs/sep-43-design`, `sdk/preimage.ts`) when it merges.
The signer also serves any `AssembledTransaction.signAuthEntries` caller.

Completion checks:

- Mock-key unit tests: V1 rejection, network mismatch, address mismatch, extra invocations, and amount mismatch.
- A live 1Password signature over a V2 x402 preimage on testnet.
- One accepted x402 testnet payment through `https://x402.org/facilitator`. Record the hash, ledger, and balances.

### 2. V2 auth in the x402 client

Keep a local copy of `exact/client/scheme.ts` with `useUpgradedAuth: true` until upstream supports it.
Send an upstream PR that exposes the option on `ExactStellarScheme`.
Do not depend on an npm override to SDK 17.

### 3. Skill reference

Add a walleterm skill reference for the x402 buyer flow: 402, review, signer, and retry.
Cover the USDC trustline, the [Circle faucet](https://faucet.circle.com/), and USDC's 7 decimal places.

### 4. MPP Charge

Wait for a `@stellar/mpp` release that includes V2 support. Then use sponsored pull with the same signer rules.
Alternatively, send an upstream PR that accepts an asynchronous signer in place of `keypair`.
Do not implement push mode.

### Not planned

- MPP Session. It needs raw 192-byte signing and one 1Password signature per request.
  A separate session key outside 1Password breaks the [project rules](../AGENTS.md).
- C-account payers for x402. They need a custom client that does not call `Keypair.fromPublicKey`.

## Open decisions

- Spending limits. Cached 1Password approval can permit signatures without a prompt.
  The signer's invocation check is the main safeguard. A per-payment amount cap needs a decision.
- Mainnet. Real x402 and MPP services settle USDC on mainnet. The project rules permit testnet only.
  `walleterm sign` does not check the network. The signer's network check does.

## Evidence status

| Kind | Status |
| --- | --- |
| Source research | Complete for the versions above. |
| Live read-only checks | Testnet protocol and x402.org `/supported`, 2026-09-28. |
| Local probes | Recording-signer simulation, mock-key Keypair proxy, and commitment length. No private keys. |
| Live 1Password signatures | Not run. |
| Testnet payments | Not run. No x402 or MPP payment passed. |

The probe scripts stayed in a session scratch directory. Git does not include them.
To repeat the V1 check, simulate a USDC SAC `transfer` with `AssembledTransaction.build`.
Then read the credential arm with `useUpgradedAuth` set to `false` and to `true`.
