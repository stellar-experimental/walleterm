# Website message signing

Use this path for text messages, login challenges, or signatures that derive application keys.
Walleterm signs SEP-53 text only. It computes the digest itself and never accepts a precomputed hash.
A website with the Walleterm SDK calls SEP-43 `signMessage` through the tunnel. See [the bridge method](#bridge-signmessage).
For a request captured from an unchanged website, use the message shape of `walleterm sign` after review.

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

## Bridge `signMessage`

`wallet.signMessage(text)` sends the text to the tunnel. The connected website approves it by sending it.
The bridge has no terminal approval step. The optional review hook applies, as for every request.
Before signing, the tunnel prints the origin, key, byte count, digest, and escaped text on one line.
That line is the only display of the text. The 1Password prompt shows no text.
The result `signedMessage` is the Base64 raw 64-byte signature. `signerAddress` is the selected G-address.
The SDK verifies the signature with `Keypair.verifyMessage` before it returns it.

Walleterm differs from SEP-43 in two ways:

- It returns Base64 in place of hexadecimal, as Freighter and Stellar CLI do.
- The connected website confirms by sending. No wallet display shows the text.

A message signature binds no network. The testnet rule does not limit it.
A connected website can use a signature as a login proof or a claim at any service that trusts the key.
Connect only dedicated testnet keys to the tunnel.
Never use such a key as an identity or a key-derivation source for another service.

## Sign a captured request and return one signature

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
Freighter and Stellar CLI use Base64. `walleterm sign` returns lowercase hexadecimal.
Bind the reply to the unchanged payload, original request ID, selected key, and exact website origin.
Return it only once. Record delivery separately from login or application acceptance.

For [legacy Freighter](legacy-freighter.md), use its message response fields after confirming the deployed API.
The helper's transaction `reply` command cannot return message signatures.
Create only the bounded page reply that the confirmed transport needs.
Capture any later transaction or authorization request for a separate review.
