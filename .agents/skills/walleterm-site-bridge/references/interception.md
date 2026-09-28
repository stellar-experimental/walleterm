# Manual website interception

Use this path when a site cannot use the Walleterm browser client or export unsigned XDR.
Prefer public-key connection or unsigned-XDR export when the site supports it.
Inspect the deployed wallet adapter. A Wallets Kit button can use Freighter, WalletConnect, or another provider.
Check whether the site uses an external wallet or signs with an in-page keystore.
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

## In-page signing

Some sites offer only local key generation or secret-key import. Wallet extension injection does not replace that signer.
Use a public-only identity and adapt the site's signing boundary when the task permits a temporary local adapter.
Keep private-key creation, import, storage, and export controls outside that adapter.
For a synchronous SDK signer, capture the unsigned envelope before the site's submission call.
Pause submission until the original request receives its reviewed signed envelope.
Preserve the site's transaction construction, simulation, submission, and result handling when practical.
Verify the actual signing path. A changed wallet label does not prove interception.
Report the temporary adapter separately from native website integration. Keep site-specific patches in task evidence.

## Return one reviewed transaction

Save the request ID, origin, selected key, `accountToSign`, network fields, and exact unsigned XDR.
Wallet adapters can omit signing-account or network fields. Treat missing fields as unknown.
Confirm the selected key, XDR sources, authorization principals, live signer weights, and network against the user's grant.
Decode it with `stellar tx decode`. Compute its hash with the confirmed testnet passphrase.
XDR alone does not identify the network. Check the material terms against the user's grant.
For Soroban transactions, inspect every authorization invocation tree, including nested token transfers.
Read the matching core `walleterm` reference for its signing format.

The transaction shape of `walleterm sign` returns `signed_transaction_xdr`: the same envelope with one appended signature.
It keeps the body and existing signatures. It does not check ledger state, signer thresholds, or user authority.
Review Soroban contract effects and authorization separately.

Before signing, recheck the live pending request, exact unsigned XDR, selected key, network, and expiry.
Record the original hash and selected key in a durable attempt before calling the signer.
Use that attempt for recovery. A new page capture can reuse a local request number.
Unsigned cancellation must stop before signing begins. Later cancellation cannot undo a signature.
Send one `walleterm sign` request with the transaction shape. Require a successful exit, `ok: true`, and `verified: true`.
Require the same public key and the reviewed hash as `digest`. Decode `signed_transaction_xdr` and verify its body and hash.
Return the signature only to its pending request. The website can submit immediately after receiving it.
Record the original hash before that return. Query it after any uncertain result before a replacement request.
Verify ledger acceptance and resulting state. Close the manual browser bridge after all requests settle.
