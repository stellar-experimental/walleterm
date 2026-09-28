# Website message signing

Use this path for text messages, login challenges, or signatures that derive application keys.
Walleterm signs SEP-53 text only. It computes the digest itself and never accepts a precomputed hash.
The public tunnel has no message signing method. Its SEP-43 `signMessage` returns error `-3`.
Use the message shape of `walleterm sign` outside the browser after reviewing the captured request.

## Review the message

Identify the exact payload bytes, encoding, selected key, origin, request ID, signature consumer, and response format.
Check any domain, network, contract, expiry, or purpose binding in the message and its consumer.
A wallet field does not add a binding to the signed bytes by itself.
Confirm from the deployed client and current primary sources that the consumer verifies SEP-53.
Stop when the required bytes, digest, or signature use remain unknown.
A SEP-53 signature binds no network, site, nonce, or expiry, unless the text contains them.

An application can derive a separate private key from the returned signature.
Apply the task's key-storage rules and existing user grant to that effect.
Keep the Stellar signing key inside 1Password. The application key does not replace or enter that signer.
Treat a signature as secret material when it can reproduce a private key or grant access.
Preserve such signatures only in private local records. Exclude them from public reports and terminal output.
If the application stores such a key, inspect entry names or counts without reading private-key values.

## Sign and return one signature

A confirmed [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md) request signs:

```text
SHA-256(UTF8("Stellar Signed Message:\n") || messageBytes)
```

Walleterm accepts text of 1–1024 UTF-8 bytes. It supports no binary message and no other digest rule.
Stop when the consumer needs binary bytes or another digest. The limit counts bytes, not characters.

Send `{"public_key":"G...","message":"<exact text>"}` to `walleterm sign` once.
Require a successful exit, `ok: true`, `verified: true`, and the same public key.
Check that `digest` equals the SEP-53 digest of the reviewed text.
Independently verify the raw 64-byte Ed25519 signature, for example with `stellar message verify`.
Use the exact response encoding and field names required by the confirmed wallet transport.
Freighter and Stellar CLI use Base64. The CLI returns lowercase hexadecimal.
Bind the reply to the unchanged payload, original request ID, selected key, and exact website origin.
Return it only once. Record delivery separately from login or application acceptance.

For [legacy Freighter](legacy-freighter.md), use its message response fields after confirming the deployed API.
The helper's transaction `reply` command cannot return message signatures.
Create only the bounded page reply that the confirmed transport needs.
Capture any later transaction or authorization request for a separate review.
