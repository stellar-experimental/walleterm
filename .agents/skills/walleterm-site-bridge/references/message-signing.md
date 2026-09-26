# Website message signing

Use this path for arbitrary messages, login challenges, or signatures that derive application keys.
Walleterm signs one supplied 32-byte digest. The public tunnel has no arbitrary-message signing method.
Use direct `walleterm sign` outside the browser after reviewing the captured request.

## Review the message

Identify the exact payload bytes, encoding, selected key, origin, request ID, signature consumer, and response format.
Check any domain, network, contract, expiry, or purpose binding in the message and its consumer.
A wallet field does not add a binding to the signed bytes by itself.
Confirm the digest algorithm from the deployed client and current primary sources.
Stop when the required bytes, digest, or signature use remain unknown.

An application can derive a separate private key from the returned signature.
Apply the task's key-storage rules and existing user grant to that effect.
Keep the Stellar signing key inside 1Password. The application key does not replace or enter that signer.
Treat a signature as secret material when it can reproduce a private key or grant access.
Preserve such signatures only in private local records. Exclude them from public reports and terminal output.
If the application stores such a key, inspect entry names or counts without reading private-key values.

## Compute and return one signature

For a confirmed [SEP-53](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md) request, compute:

```text
SHA-256(UTF8("Stellar Signed Message:\n") || messageBytes)
```

Convert a text message to UTF-8 bytes. Preserve a binary message's bytes.
Hash once. Character counts can differ from byte counts.
Use another digest rule only when the confirmed protocol requires it.
Do not hash a message as transaction XDR.

Send the selected G-address and reviewed digest to `walleterm sign` once.
Require a successful exit, `ok: true`, `verified: true`, and the same public key and digest.
Independently verify the raw 64-byte Ed25519 signature against the reviewed digest.
Use the exact response encoding and field names required by the confirmed wallet transport.
Bind the reply to the unchanged payload, original request ID, selected key, and exact website origin.
Return it only once. Record delivery separately from login or application acceptance.

For [legacy Freighter](legacy-freighter.md), use its message response fields after confirming the deployed API.
The helper's transaction `reply` command cannot return message signatures.
Create only the bounded page reply that the confirmed transport needs.
Capture any later transaction or authorization request for a separate review.
