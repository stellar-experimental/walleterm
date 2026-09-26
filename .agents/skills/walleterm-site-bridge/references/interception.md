# Manual website interception

Use this path when a site cannot use the Walleterm browser client or export unsigned XDR.
Prefer public-key connection or unsigned-XDR export when the site supports it.
Inspect the deployed wallet adapter. A Wallets Kit button can use Freighter, WalletConnect, or another provider.
Identify its request method, response shape, network fields, and submission owner.
Repository code can differ from the deployed code. Confirm the loaded transport before injecting an adapter.

Intercept only the selected website origin. Give it the selected public key.
Capture signing requests for agent review. Run `walleterm sign` outside the browser.
This manual path uses a review queue. It does not use the automatic public tunnel service.

For signed login challenges, confirm the exact bytes, domain binding, digest rule, response format, and use.
Stop when that mapping is unknown or the signature creates a private key outside 1Password.
The Walleterm CLI signs 32-byte digests. The public bridge has no arbitrary-message or login-challenge signing method.
For WalletConnect, verify the chain ID, method, and session response before writing a compatible adapter.

Use [legacy Freighter](legacy-freighter.md) only for its exact `window.postMessage` protocol.
Its helper captures XDR without automatic signing. It does not provide a general Freighter or Wallets Kit implementation.
For another transport, make only the site-specific adapter that the task requires.

## Return one reviewed request

Save the request ID, origin, selected key, `accountToSign`, network fields, and exact unsigned XDR.
Decode it with `stellar tx decode`. Compute its hash with the confirmed testnet passphrase.
XDR alone does not identify the network. Check the material terms against the user's grant.
Read the matching core `walleterm` reference for its signing format.

For V1 envelopes, [classic-attach.py](../scripts/classic-attach.py) verifies and attaches one raw Ed25519 signature.
It preserves the body and existing signatures. It refuses an existing output file.
It needs Python 3, Bun, Stellar CLI, and [verify-signature.ts](../scripts/verify-signature.ts) beside it.
Use it only after reviewing the transaction. It does not check ledger state, signer thresholds, or user authority.

Send one `walleterm sign` request. Require a successful exit, `ok: true`, and `verified: true`.
Require the same public key and digest in the response. Decode the final envelope and verify its body and hash.
Return the signature only to its pending request. The website can submit immediately after receiving it.
Record the original hash before that return. Query it after any uncertain result before a replacement request.
Verify ledger acceptance and resulting state. Close the manual browser bridge after all requests settle.
