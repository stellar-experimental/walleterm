# Fee-bump envelopes

This reference uses [Stellar XDR commit `68fa1ac`](https://github.com/stellar/stellar-xdr/blob/68fa1ac55692f68ad2a2ca549d0a283273554439/Stellar-transaction.x) and Stellar CLI [`v27.1.0`](https://github.com/stellar/stellar-cli/tree/8e402ea28202950b272fbabc34caad4d2f64fe87).
The inner and outer envelopes have different signing digests.

1. Complete and inspect every inner V1 signature first. Keep the signed inner envelope fixed.
2. Build `tx_fee_bump.tx` with the exact fee source, outer fee, and signed inner envelope.
3. Build `TransactionSignaturePayload` with the chosen network ID and `tagged_transaction.tx_fee_bump` equal to `tx_fee_bump.tx`.
4. Compute `SHA-256(XDR(TransactionSignaturePayload))` with `stellar xdr encode --type TransactionSignaturePayload payload.json | base64 -d | shasum -a 256`.
5. Show both envelopes, both fees, the fee source, the outer digest, and the selected signer before approval.
6. Sign the outer digest. Add a `DecoratedSignature` to `tx_fee_bump.signatures`.
7. Re-encode the envelope and verify the inner and outer signatures before submission.

Compact shapes follow. Replace each angle-bracket placeholder with the correct JSON value.

```text
{"tx_fee_bump":{"tx":{"fee_source":"G...","fee":"<i64>","inner_tx":{"tx":<signed V1 envelope body>},"ext":"v0"},"signatures":[]}}
{"network_id":"<32-byte hex>","tagged_transaction":{"tx_fee_bump":<same tx_fee_bump.tx object>}}
```

`stellar tx hash` in CLI 27.1.0 accepts V1 envelopes and rejects fee-bump envelopes.
Changing any inner signature changes the outer digest. Never reuse an outer signature after such a change.
Testnet acceptance covered an outer fee payer and missing inner or outer signatures on 2026-09-25.
