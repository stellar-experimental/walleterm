# Manual website interception

Use this path when a site cannot use the Walleterm browser client or export unsigned XDR.
Prefer public-key connection or unsigned-XDR export when the site supports it.
Inspect the deployed wallet adapter. A Wallets Kit button can use Freighter, WalletConnect, or another provider.
Identify its request method, response shape, network fields, and submission owner.
Repository code can differ from the deployed code. Confirm the loaded transport before injecting an adapter.
Inspect the resources loaded by the active route when script tags omit its modules.
Record source versions and loaded resource hashes in the task's evidence, not in reusable instructions.

Intercept only the selected website origin. Give it the selected public key.
Capture signing requests for agent review. Run `walleterm sign` outside the browser.
This manual path uses a review queue. It does not use the automatic public tunnel service.

Classify the captured request before choosing a signing path:

- For transaction envelopes, use the transaction steps below and the matching direct `walleterm` reference.
- For authorization entries, inspect the complete invocation tree and use the matching direct `walleterm` reference.
- For messages, challenges, or application key derivation, use [message signing](message-signing.md).

For WalletConnect, verify the chain ID, method, and session response before writing a compatible adapter.

Use [legacy Freighter](legacy-freighter.md) only for its exact `window.postMessage` protocol.
Its helper captures XDR without automatic signing. It does not provide a general Freighter or Wallets Kit implementation.
For another transport, make only the site-specific adapter that the task requires.

## Return one reviewed transaction

Save the request ID, origin, selected key, `accountToSign`, network fields, and exact unsigned XDR.
Wallet adapters can omit signing-account or network fields. Treat missing fields as unknown.
Confirm the selected key, XDR sources, authorization principals, live signer weights, and network against the user's grant.
Decode it with `stellar tx decode`. Compute its hash with the confirmed testnet passphrase.
XDR alone does not identify the network. Check the material terms against the user's grant.
Read the matching core `walleterm` reference for its signing format.

For V1 envelopes, [classic-attach.py](../scripts/classic-attach.py) verifies and attaches one raw Ed25519 signature.
It preserves the body and existing signatures. It refuses an existing output file.
It needs Python 3, Bun, Stellar CLI, and [verify-signature.ts](../scripts/verify-signature.ts) beside it.
Use it only after reviewing the transaction. It does not check ledger state, signer thresholds, or user authority.
It preserves Soroban bodies in V1 envelopes too. Review their contract effects and authorization separately.

Send one `walleterm sign` request. Require a successful exit, `ok: true`, and `verified: true`.
Require the same public key and digest in the response. Decode the final envelope and verify its body and hash.
Return the signature only to its pending request. The website can submit immediately after receiving it.
Record the original hash before that return. Query it after any uncertain result before a replacement request.
Verify ledger acceptance and resulting state. Close the manual browser bridge after all requests settle.
