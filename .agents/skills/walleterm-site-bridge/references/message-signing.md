# Website message signing

Use this path for text messages, login challenges, or signatures that derive application keys.
Walleterm signs [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md) text only:

```text
SHA-256(UTF8("Stellar Signed Message:\n") || messageBytes)
```

It accepts 1–1024 UTF-8 bytes. The limit counts bytes, not characters.
It computes the digest itself. It accepts no precomputed hash, no binary message, and no other digest rule.

## Review the message

Identify the exact payload bytes, encoding, selected key, origin, request ID, signature consumer, and response format.
Check any domain, network, contract, expiry, or purpose binding in the message and its consumer.
A wallet field does not add a binding to the signed bytes.
Confirm from the deployed client and current primary sources that the consumer verifies SEP-53.
Stop when the required bytes, digest, or signature use remain unknown.

A SEP-53 signature binds no network, site, nonce, or expiry, unless the text contains them.
The tunnel network rule therefore does not limit it. A website can use it as a login proof at any service that trusts the key.
Connect only dedicated test keys. Never use such a key as an identity or a key-derivation source for another service.

An application can derive a separate private key from the returned signature.
Treat such a signature as secret material. Keep it out of public reports and terminal output.
If the application stores such a key, inspect entry names or counts without reading private-key values.

## Bridge `signMessage`

`wallet.signMessage(text)` sends the text to the tunnel. The connected website approves it by sending it.
Before signing, the tunnel prints the origin, key, byte count, digest, and escaped text on one line.
That line is the only display of the text. The 1Password prompt shows no text.
The result `signedMessage` is the Base64 raw 64-byte signature. `signerAddress` is the selected G-address.
SEP-43 specifies hexadecimal. Walleterm returns Base64, as Freighter and Stellar CLI do.
The SDK verifies the signature with `Keypair.verifyMessage` before it returns it.

## Sign a captured request

1. Send `{"public_key":"G...","message":"<exact text>"}` to `walleterm sign` once.
2. Require a successful exit, `ok: true`, `verified: true`, and the same public key.
3. Check that `digest` equals the SEP-53 digest of the reviewed text.
4. `walleterm sign` returns lowercase hexadecimal. Convert it to the encoding that the wallet transport needs. Freighter uses Base64.
5. Verify the signature independently, for example with `stellar message verify`.
6. Return it once, bound to the unchanged payload, the original request ID, the selected key, and the exact origin.

Record delivery separately from login or application acceptance.
For [Freighter](freighter.md), use its `SUBMIT_BLOB` response fields. The helper's `reply` command returns transactions only.
Capture any later transaction or authorization request for a separate review.
