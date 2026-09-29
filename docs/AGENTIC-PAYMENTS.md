# Agentic payments: x402 and MPP

Status: research and design only. No implementation, live signature, or testnet payment exists.
Research ran on 2026-09-28. A review on the same day checked it against `main` at `e40f0f7`.
That review covered the one `sign` command (#39), SEP-53 messages (#40), and the SEP-43 wallet (#22).

## Summary

- x402 is the best fit. walleterm already has the two signing surfaces that it needs.
  The only blocker is the stock client, which requests V1 credentials.
- MPP Charge waits for upstream changes. Its client accepts only a synchronous `Keypair`.
- MPP push and MPP Session are out of scope by design. They sign raw bytes, not a Stellar artifact.
- No runtime change to walleterm is required for x402. The first work is a pinned test fixture and a live acceptance run.

## Current walleterm surfaces

| Surface | Input | Use for payments |
| --- | --- | --- |
| `walleterm sign`, preimage shape | `public_key`, `network_passphrase`, `preimage_xdr` | A local agent's x402 or MPP auth-entry signer. |
| `walleterm sign`, transaction shape | `public_key`, `network_passphrase`, `transaction_xdr` | Trustlines, MPP channel open, close, and refund. |
| SDK `Walleterm.signAuthEntry` through `walleterm tunnel` | Base64 `HashIdPreimage` | A website that buys from an x402 service on testnet. |
| SDK `Walleterm.signMessage` and the message shape | SEP-53 text | No payment use. See [signing limits](#signing-limits). |

Both preimage surfaces sign `SHA-256(preimage)` and return the raw 64-byte signature.
That is the exact SEP-43 contract that x402 expects from `signAuthEntry`.
See [the interface](INTERFACE.md) and [the SEP-43 wallet](SEP-43.md).

### Signing limits

These limits are deliberate. The [sign design](../audit/2026-09-28-sign-design/DESIGN.md) section 3.2 records them.

- walleterm signs only `address_v2` preimages and entries. V1 permits cross-address replay (CAP-71-02).
- walleterm accepts no raw digest and no binary message. It computes each digest from a typed artifact.
- SEP-53 signs `SHA-256("Stellar Signed Message:\n" || text)`. That prefix differs from any MPP message.
- The CLI preimage shape checks no bound address. The calling agent must check it.
- The bridge also requires testnet and the selected G-address or a C-address.
- No path reads a ledger. Expiration ledger 0 fails. The network enforces expiry.

## Sources

Research used Stellar Raven MCP, `parallel-cli` 0.9.3, npm tarballs, and GitHub source.
Local tools were Stellar CLI 28.0.0 and walleterm `b50236d`.

| Source | Version and evidence |
| --- | --- |
| [`@x402/stellar`](https://www.npmjs.com/package/@x402/stellar), `@x402/core`, `@x402/mcp` | 2.27.0, published 2026-09-22. Depends on `@stellar/stellar-sdk` `^16.3.0`. |
| [x402-foundation/x402](https://github.com/x402-foundation/x402/tree/c84154b5d6a31d77fd5b9dbb01213053fd9cb9eb) | Commit `c84154b5`. Paths below are under `typescript/packages/mechanisms/stellar/src/`. |
| [x402 exact Stellar scheme spec](https://github.com/x402-foundation/x402/blob/c84154b5d6a31d77fd5b9dbb01213053fd9cb9eb/specs/schemes/exact/scheme_exact_stellar.md) | Lines 126–127 require facilitators to accept V1 and V2 credentials. |
| [x402 Stellar changelog](https://github.com/x402-foundation/x402/blob/c84154b5d6a31d77fd5b9dbb01213053fd9cb9eb/typescript/packages/mechanisms/stellar/CHANGELOG.md) | Commit `7488a46` (#3279) added facilitator V2 acceptance. It records Protocol 28 on testnet from 2026-08-27 and a mainnet vote on 2026-09-16. |
| [OpenZeppelin x402 facilitator plugin](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator/tree/7583ebcb526606a66c2c97665a6a059388cbc22c) | v0.5.0, commit `7583ebcb`. Accepts V1 and V2. Uses SDK 17. |
| [`@stellar/mpp`](https://www.npmjs.com/package/@stellar/mpp) | 0.7.1, published 2026-07-02. Peers `@stellar/stellar-sdk` `^15.1.0` and `mppx` `^0.6.29`. |
| [stellar/stellar-mpp-sdk](https://github.com/stellar/stellar-mpp-sdk/tree/afd8fb58410e066c0f9b28b571ab089be722c269) | Research used `main` at `afd8fb58`. `main` later reached `88fa767a` (#83). No release after v0.7.1. |
| [`mppx`](https://www.npmjs.com/package/mppx) | 0.11.0. General MPP framework and CLI. No Stellar plugin. |
| [stellar-experimental/one-way-channel](https://github.com/stellar-experimental/one-way-channel/tree/25dea1b303495a7a4184af7605bbb7671ff08da6) | Commit `25dea1b3`, 2026-07-30. Experimental and not audited. |
| `@stellar/stellar-sdk` | 16.3.0 and 17.1.0 were read. 17.2.0 was published on 2026-09-28. |
| [Stellar agentic payments docs](https://developers.stellar.org/docs/build/agentic-payments) | x402 and MPP pages, read through Stellar Raven. |
| [MPP protocol](https://mpp.dev/protocol) | Tempo and Stripe, launched 2026-03-18. Internet-Draft `draft-httpauth-payment-00`, not an IETF standard. |

Live read-only checks on 2026-09-28:

- Testnet RPC and core reported `29.0.0`, with `protocolVersion: 28`.
- `https://x402.org/facilitator/supported` listed `stellar:testnet` with `areFeesSponsored: true`. It listed no `stellar:pubnet`.
- `https://channels.openzeppelin.com/x402/testnet/supported` returned 401 without an API key.
- Mainnet Horizon reported `current_protocol_version` 28 and stellar-core 29.0.0.

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
| x402, stock `@x402/stellar` 2.27.0 client | Fails | SDK 16.3.0 simulation returns V1 credentials. walleterm rejects V1. |
| x402, custom client with `useUpgradedAuth: true`, local agent | Expected to work | The preimage shape of `walleterm sign` takes the V2 preimage. Both facilitators accept V2. Not run. |
| x402, custom client with `useUpgradedAuth: true`, website | Expected to work on testnet | SDK `signAuthEntry` has the SEP-43 shape. Not run. |
| MPP Charge, `@stellar/mpp` 0.7.1 | Fails | V1 only, and the client accepts only a `Keypair`. |
| MPP Charge, `main` | Blocked | `useUpgradedAuth` exists but defaults to `false`. The client still accepts only a `Keypair`. |
| MPP Charge, push | Out of scope | The binding message is about 90 raw bytes. |
| MPP Session commitments | Out of scope | The contract verifies Ed25519 over 192 raw XDR bytes. |
| MPP channel open, close, and refund | Works | These are ordinary transactions. Use the transaction shape. |
| C-account payer | x402 custom client only. MPP Charge: no. | See the findings below. |

A `Keypair` proxy no longer helps MPP Charge.
The client passes only a 32-byte hash to `Keypair.sign`, and walleterm accepts no raw digest.

## Findings

### Why V1 matters

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
- The client passes `this.signer.signAuthEntry` unbound.
  Wrap an SDK wallet: `signAuthEntry: (xdr, opts) => wallet.signAuthEntry(xdr, opts)`.
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

The hosted facilitators' deployed versions were not confirmed.

### MPP Charge client

- The client accepts `keypair?: Keypair` or `secretKey?: string` (`sdk/src/charge/client/Charge.ts:442-446`).
  It has no signer callback.
- All signatures use that key: `authorizeEntry` (line 326), `prepared.sign` (line 381), and `clientKP.sign` (line 410).
- Sponsored pull expiry is `latest + ceil(secondsUntilExpiry / 5)`. The 300-second default gives about 60 ledgers.
- Version 0.7.1 signs and verifies only V1 (`dist/charge/client/Charge.js:176-180`, `dist/shared/verify-auth.js:26`).
- Push signs `` Buffer.from(`${challenge.id}:${canonicalHash}`) `` with raw Ed25519 (`Charge.ts:409-410`).
- The client sets `from` to the Keypair's G-address. The server rejects contract authorizers.
- `mppx` exposes `Method.toClient(method, { createCredential })`. A custom credential can call walleterm with typed artifacts.

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
The funder opens the channel through `__constructor`, which calls `from.require_auth()`.
The funder refunds through `close_start` and `refund`. The transaction shape covers these calls.

### Agent tooling

- `@x402/mcp` 2.27.0 accepts any registered scheme, so it can use a custom Stellar signer.
- The `mppx` CLI has evm, stripe, tempo, and x402 plugins. It has no Stellar plugin.
- No x402 or MPP feature needs SEP-53 on Stellar.
  x402 SIWX supports EVM and Solana only. The MPP attestation extension uses RFC 9421 with WebCrypto keys.

## Future work

Follow the [development plan](PLAN.md) change process. Items appear in priority order.
The [project rules](../AGENTS.md) keep complex orchestration in test fixtures until a use case needs runtime support.

### 1. x402 testnet acceptance fixture

Add an isolated package, `fixtures/x402/`, like `fixtures/kit/`. Pin `@x402/*` and the Stellar SDK.
Add a live runner, for example `tests/x402-live.ts`.

The fixture holds:

1. A copy of `exact/client/scheme.ts` with `useUpgradedAuth: true` in `AssembledTransaction.build`.
2. A `ClientStellarSigner` whose `signAuthEntry` does these steps:
   1. Parse the preimage. Require the V2 type, the testnet network ID, and the payer G-address.
   2. Decode the invocation tree. Require one SAC `transfer` from the payer, with no sub-invocations.
   3. Match the asset, `payTo`, and amount against the 402 requirements that the agent approved.
   4. Call `walleterm sign` with the preimage shape. Check `ok`, `verified`, the key, and the digest.
   5. Return `{ signedAuthEntry: <Base64 signature>, signerAddress }`.
3. A local seller with `ExactStellarScheme` and the x402.org facilitator.
   The `https://x402.org/protected` route offers no Stellar option. It listed `eip155:84532` and Solana devnet only.

Reuse `inspectAuthPreimage` from `sdk/preimage.ts` for step 2.1 where it fits.

Completion checks:

- Offline tests with mock keys: V1, wrong network, wrong address, extra invocations, and wrong amount fail before signing.
- A live 1Password signature over a V2 x402 preimage.
- One accepted testnet payment through `https://x402.org/facilitator`. Record the hash, ledger, and USDC balances.
- A separate result for the OZ Channels testnet facilitator, if an API key is available.

### 2. Upstream changes

- x402: expose `useUpgradedAuth` on the Stellar client, or move it to SDK 17. Then the fixture can drop its client copy.
- stellar-mpp-sdk: accept an asynchronous signer in place of `keypair`, and release V2 support.
  The signer should receive a transaction or a preimage, not a hash.

Check the [upstream watch list](#upstream-watch-list) before starting either item.

### 3. Skill reference

After item 1 passes, add a walleterm skill reference for the x402 buyer flow.
Cover the 402 review, the signer, the retry, the USDC trustline, the [Circle faucet](https://faucet.circle.com/), and 7 decimal places.

### 4. Website x402 buyer

A website can pass the SDK wallet as the x402 signer through `walleterm tunnel`.
The bridge already enforces V2, testnet, and the bound address.
Add a demo action only if a website use case needs it. The bridge `review` hook can later check payment amounts.

### 5. MPP Charge

Start after item 2 lands upstream. Use sponsored pull with the same checks as item 1.
Alternatively, build a custom `mppx` client method with `Method.toClient` in the fixture.

### Not planned

- MPP push and MPP Session. They need raw-byte signing, which the sign design removed.
  Session also needs one 1Password signature per request.
  A separate session key outside 1Password breaks the project rules.
- V1 credentials, including an SDK or client downgrade.
- C-account payers for x402. They need a custom client that does not call `Keypair.fromPublicKey`.

## Open decisions

- Spending policy. Cached 1Password approval can permit signatures without a prompt.
  The signer's invocation check is the main safeguard. A per-payment amount cap needs a decision.
  For websites, the planned bridge `review` hook can apply the same policy.
- Runtime support. Decide whether a payment signer becomes an SDK export after the fixture passes.
- Mainnet. Mainnet runs protocol 28, and real services settle USDC there.
  The project rules permit testnet only. The CLI accepts any network passphrase, so the signer must check it.

## Upstream watch list

Check these values before resuming work. The values below were current on 2026-09-28.

| Item | Value | Check |
| --- | --- | --- |
| `@x402/stellar` | 2.27.0, SDK `^16.3.0`, V1 default | `npm view @x402/stellar version dependencies` |
| x402 Stellar client | No `useUpgradedAuth` option | x402 Stellar `CHANGELOG.md` |
| `@stellar/mpp` | 0.7.1, V1 only, `Keypair` only | `npm view @stellar/mpp version peerDependencies` |
| stellar-mpp-sdk `main` | `88fa767a`. Open PRs #64, #76, #80, and #86. | `gh api repos/stellar/stellar-mpp-sdk/releases` |
| x402.org facilitator | `stellar:testnet` only | `curl -s https://x402.org/facilitator/supported` |

## Evidence status

| Kind | Status |
| --- | --- |
| Source research | Complete for the versions above. |
| Live read-only checks | Testnet and mainnet protocol, x402.org `/supported`, and `/protected`, 2026-09-28. |
| Local probes | Recording-signer simulation, mock-key Keypair proxy, and commitment length. No private keys. |
| Live 1Password signatures | Not run. |
| Testnet payments | Not run. No x402 or MPP payment passed. |

The probe scripts stayed in a session scratch directory. Git does not include them.
To repeat the V1 check, simulate a USDC SAC `transfer` with `AssembledTransaction.build`.
Then read the credential arm with `useUpgradedAuth` set to `false` and to `true`.
