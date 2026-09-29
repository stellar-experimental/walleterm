# Agentic payments: x402 and MPP

Status: research and design only. Walleterm has no payment feature, and no x402 or MPP payment has passed.
The research date is 2026-09-28. Upstream versions change; check the [upstream watch list](#upstream-watch-list) first.

## Summary

- x402 is the best fit. Walleterm already has the two signing surfaces that it needs.
  The only blocker is the stock client, which requests V1 credentials.
- MPP Charge waits for upstream changes. Its client accepts only a synchronous `Keypair`.
- MPP push and MPP Session are out of scope. They sign raw bytes, not a Stellar artifact.
- x402 needs no runtime change to Walleterm. The first work is a pinned test fixture and a live acceptance run.

## Walleterm signing surfaces

| Surface | Input | Use for payments |
| --- | --- | --- |
| `walleterm sign`, preimage shape | `public_key`, `network_passphrase`, `preimage_xdr` | A local agent's x402 or MPP authorization-entry signer. |
| `walleterm sign`, transaction shape | `public_key`, `network_passphrase`, `transaction_xdr` | Trustlines, and MPP channel open, close, and refund. |
| SDK `Walleterm.signAuthEntry` through `walleterm tunnel` | Base64 `HashIdPreimage` | A website that buys from an x402 service on testnet. |
| SDK `Walleterm.signMessage` and the message shape | SEP-53 text | No payment use. See [signing limits](#signing-limits). |

Both preimage surfaces sign `SHA-256(preimage)` and return the raw 64-byte signature.
That is the exact SEP-43 contract that x402 expects from `signAuthEntry`.
See [the interface](INTERFACE.md) and [the SEP-43 wallet](SEP-43.md).

### Signing limits

These limits are deliberate.

- Walleterm accepts no raw digest and no binary message. It computes each digest from a typed artifact.
  A raw digest hides what it approves: any network, any address, a V1 payload, or a SEP-53 hash. Each caller must use a typed shape.
- Walleterm signs only `address_v2` preimages and entries. V1 permits cross-address replay (CAP-71-02).
- SEP-53 signs `SHA-256("Stellar Signed Message:\n" || text)`. That prefix differs from any MPP message.
- The CLI preimage shape checks no bound address. The calling agent must check it.
- The bridge also requires testnet and the selected G-address or a C-address.
- No path reads a ledger. Expiration ledger 0 fails. The network enforces expiry.

## The protocols on Stellar

### x402

1. The server returns 402 with payment requirements: asset, amount, `payTo`, network, and `maxTimeoutSeconds`.
2. The client simulates a SAC `transfer(from, to, amount)` and signs its authorization entry.
3. The client sends the transaction XDR in the `PAYMENT-SIGNATURE` header (x402 v2).
4. The facilitator rebuilds the transaction with its own source, pays the fee, and submits it.

The payer needs a USDC trustline and balance. It needs no XLM for fees.
The client requires `extra.areFeesSponsored: true`.

The facilitator accepts V1 and V2 address credentials. It rejects SourceAccount and delegated credentials.
It requires one SAC `transfer` with the exact asset, `payTo`, and amount, and no sub-invocations.
It also requires a bounded expiry and a successful simulation with a fee of 50,000 stroops or less.

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
| x402, stock `@x402/stellar` 2.27.0 client | Fails | Its Stellar SDK 16.3.0 simulation returns V1 credentials. Walleterm rejects V1. |
| x402, custom client with `useUpgradedAuth: true`, local agent | Expected to work; not run | The preimage shape of `walleterm sign` takes the V2 preimage. Both facilitators accept V2. |
| x402, custom client with `useUpgradedAuth: true`, website | Expected to work on testnet; not run | SDK `signAuthEntry` has the SEP-43 shape. |
| MPP Charge, `@stellar/mpp` 0.7.1 | Fails | V1 only, and the client accepts only a `Keypair`. |
| MPP Charge, `main` | Blocked | `useUpgradedAuth` exists but defaults to `false`. The client still accepts only a `Keypair`. |
| MPP Charge, push | Out of scope | The binding message is about 90 raw bytes. |
| MPP Session commitments | Out of scope | The contract verifies Ed25519 over 192 raw XDR bytes. |
| MPP channel open, close, and refund | Works | These are ordinary transactions. Use the transaction shape. |
| C-account payer | x402 custom client only | The stock x402 client calls `Keypair.fromPublicKey` on the payer address. MPP Charge rejects contract payers. |

### Why V1 matters

Stellar SDK 16.3.0 sets `useUpgradedAuth` to `false` by default. SDK 17.1.0 sets it to `true`.
A testnet probe of the stock x402 client received a V1 preimage (discriminant 9).
With `useUpgradedAuth: true`, the same simulation returned `sorobanCredentialsAddressV2` (discriminant 10).
An npm override to SDK 17.1.0 also produced V2. That path changes the XDR API and is fragile.

### Client details

- The x402 signer is `{ address, signAuthEntry, signTransaction? }`. The client checks only this shape, so a custom object works.
- `signAuthEntry` receives Base64 `HashIdPreimage` XDR. It must return Base64 of the raw 64-byte signature over `sha256(preimage)`.
- The x402 client passes `signAuthEntry` unbound. Wrap an SDK wallet: `signAuthEntry: (xdr, opts) => wallet.signAuthEntry(xdr, opts)`.
- The x402 expiry is `latest + ceil(maxTimeoutSeconds / ledgerSeconds)`. The facilitator rejects expiry beyond `maxLedger + 2`.
- The MPP Charge client takes `keypair` or `secretKey`, with no signer callback. It passes only a 32-byte hash to `Keypair.sign`.
  Walleterm accepts no raw digest, so a `Keypair` proxy cannot work.
- `mppx` exposes `Method.toClient(method, { createCredential })`. A custom credential can call Walleterm with typed artifacts.
- An MPP Session commitment is a 192-byte `ScVal::Map` of `amount`, `channel`, `domain: "chancmmt"`, and `network`.
  Each paid request needs one new commitment signature.
- No x402 or MPP feature needs SEP-53 on Stellar.

## Future work

Items appear in priority order.
The [project rules](../AGENTS.md) keep complex orchestration in test fixtures until a use case needs runtime support.

### 1. x402 testnet acceptance fixture

Add an isolated package, `fixtures/x402/`, like `fixtures/kit/`. Pin `@x402/*` and the Stellar SDK.
Add a live runner, for example `tests/x402-live.ts`.

The fixture holds:

1. A copy of the x402 Stellar client scheme with `useUpgradedAuth: true` in `AssembledTransaction.build`.
2. A signer whose `signAuthEntry` does these steps:
   1. Parse the preimage. Require the V2 type, the testnet network ID, and the payer G-address.
   2. Decode the invocation tree. Require one SAC `transfer` from the payer, with no sub-invocations.
   3. Match the asset, `payTo`, and amount against the 402 requirements that the agent approved.
   4. Call `walleterm sign` with the preimage shape. Check `ok`, `verified`, the key, and the digest.
   5. Return `{ signedAuthEntry: <Base64 signature>, signerAddress }`.
3. A local seller with `ExactStellarScheme` and the x402.org facilitator.

Use `inspectAuthPreimage` from `sdk/preimage.ts` for step 2.1 where it fits.

Completion checks:

- Offline tests with mock keys: V1, wrong network, wrong address, extra invocations, and wrong amount fail before signing.
- A live 1Password signature over a V2 x402 preimage.
- One accepted testnet payment through `https://x402.org/facilitator`. Record the hash, ledger, and USDC balances.
- A separate result for the OpenZeppelin Channels testnet facilitator, if an API key is available.

### 2. Upstream changes

- x402: expose `useUpgradedAuth` on the Stellar client, or move it to Stellar SDK 17. Then the fixture can drop its client copy.
- stellar-mpp-sdk: accept an asynchronous signer in place of `keypair`, and release V2 support.
  The signer should receive a transaction or a preimage, not a hash.

### 3. Skill reference

After item 1 passes, add a Walleterm skill reference for the x402 buyer flow.
Cover the 402 review, the signer, the retry, the USDC trustline, the [Circle faucet](https://faucet.circle.com/), and 7 decimal places.

### 4. Website x402 buyer

A website can pass the SDK wallet as the x402 signer through `walleterm tunnel`.
The bridge already enforces V2, testnet, and the bound address.
Add a demo action only if a website use case needs it. The bridge `review` hook can later check payment amounts.

### 5. MPP Charge

Start after item 2 lands upstream. Use sponsored pull with the same checks as item 1.
Alternatively, build a custom `mppx` client method with `Method.toClient` in the fixture.

### Not planned

- MPP push and MPP Session. They need raw-byte signing, which Walleterm does not offer.
  Session also needs one 1Password signature per request. A separate session key outside 1Password breaks the project rules.
- V1 credentials, including an SDK or client downgrade.
- C-account payers for x402. They need a custom client that does not call `Keypair.fromPublicKey`.

## Open decisions

- Spending policy. Cached 1Password approval can permit signatures without a prompt.
  See [ask for approval of each signature](../README.md#ask-for-approval-of-each-signature).
  The signer's invocation check is the main safeguard. A per-payment amount cap needs a decision.
  For websites, the bridge `review` hook can apply the same policy.
- Runtime support. Decide whether a payment signer becomes an SDK export after the fixture passes.
- Mainnet. Real services settle USDC on mainnet. The project rules permit testnet only.
  The CLI accepts any network passphrase, so the signer must check it.

## Upstream watch list

Check these values before work starts. The values were current on 2026-09-28.

| Item | Value | Check |
| --- | --- | --- |
| `@x402/stellar` | 2.27.0, Stellar SDK `^16.3.0`, V1 default | `npm view @x402/stellar version dependencies` |
| x402 Stellar client | No `useUpgradedAuth` option | [x402 Stellar changelog](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/stellar/CHANGELOG.md) |
| `@stellar/mpp` | 0.7.1, V1 only, `Keypair` only | `npm view @stellar/mpp version peerDependencies` |
| stellar-mpp-sdk | No release after v0.7.1 | `gh api repos/stellar/stellar-mpp-sdk/releases` |
| x402.org facilitator | `stellar:testnet` only | `curl -s https://x402.org/facilitator/supported` |

## Sources

| Source | Version |
| --- | --- |
| [`@x402/stellar`](https://www.npmjs.com/package/@x402/stellar), `@x402/core`, `@x402/mcp` | 2.27.0 |
| [x402-foundation/x402](https://github.com/x402-foundation/x402/tree/c84154b5d6a31d77fd5b9dbb01213053fd9cb9eb) | Commit `c84154b5`. Stellar code is under `typescript/packages/mechanisms/stellar/src/`. |
| [x402 exact Stellar scheme](https://github.com/x402-foundation/x402/blob/c84154b5d6a31d77fd5b9dbb01213053fd9cb9eb/specs/schemes/exact/scheme_exact_stellar.md) | Lines 126–127 require facilitators to accept V1 and V2 credentials. |
| [OpenZeppelin x402 facilitator plugin](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator/tree/7583ebcb526606a66c2c97665a6a059388cbc22c) | v0.5.0. Accepts V1 and V2. |
| [`@stellar/mpp`](https://www.npmjs.com/package/@stellar/mpp) | 0.7.1 |
| [stellar/stellar-mpp-sdk](https://github.com/stellar/stellar-mpp-sdk) | `main` after v0.7.1 |
| [stellar-experimental/one-way-channel](https://github.com/stellar-experimental/one-way-channel/tree/25dea1b303495a7a4184af7605bbb7671ff08da6) | Commit `25dea1b3`. Experimental and not audited. |
| [Stellar agentic payments docs](https://developers.stellar.org/docs/build/agentic-payments) | x402 and MPP pages |
| [MPP protocol](https://mpp.dev/protocol) | Internet-Draft `draft-httpauth-payment-00`, not an IETF standard |
