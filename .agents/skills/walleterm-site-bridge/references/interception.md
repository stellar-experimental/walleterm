# Website interception

Use this path when the website cannot add the Walleterm SDK or Kit module.
First check for a simpler path: many websites accept a public key or export unsigned XDR.
In this path, the agent captures each request, runs `walleterm sign` outside the browser, and returns one result.
It does not use `walleterm tunnel`.

## Find the seam

A **seam** is the point where the website hands a request to its wallet and waits for the answer.
Answer at exactly one seam. Choose the highest seam that still carries the exact unsigned artifact.

Inspect the deployed code, not only the repository. Read the modules that the active route loads.
Find the wallet library, the request method, the request and response fields, the network fields, and who submits.
A wallet button does not identify the transport. Confirm the call that actually runs.

| Seam | How to recognize it | How to answer it |
| --- | --- | --- |
| Page messages | `window.postMessage` requests to an extension content script | Add a page listener that answers the same messages. It works after page load. See [Freighter](freighter.md). |
| Injected provider | The website reads a global object, such as `window.rabet`, `window.hanaWallet.stellar`, `window.bitkeep.stellar`, or `window.kleverWallet.stellar` | Define an object with the same methods and result shapes before the website reads it. Read the wallet's own API documentation. |
| Stellar Wallets Kit | `StellarWalletsKit` calls and a picker with many wallets | The Kit calls one module for the selected wallet. Answer at that module's transport, which is one of the other seams. |
| Popup, redirect, or remote relay | Albedo intents, a web-wallet popup, WalletConnect, or a mobile wallet | The page cannot answer these. Use the website's own signing function, or an unsigned-XDR export. |
| In-page keystore | The website generates or imports a secret key | Replace the website's signing function. See [in-page signing](#in-page-signing). |

Answer only the request types that the website sends. Record every other request type as unsupported.
Missing account or network fields do not establish identity or network permission. Treat them as unknown.
Record wallet library versions and loaded resource hashes in the task's evidence, not in this skill.

Classify each captured request:

- A transaction envelope: use the skill's review steps and the matching direct `walleterm` reference.
- An authorization entry or preimage: inspect the complete invocation tree, then use the matching direct `walleterm` reference.
- A message, challenge, or key derivation: use [message signing](message-signing.md).

## Return one reviewed transaction

1. Save the request ID, origin, selected key, signing-account and network fields, and exact unsigned XDR.
2. Complete the skill's review steps. Compute the hash with the confirmed network passphrase. XDR alone does not name the network.
3. Before signing, recheck that the request is still pending and that the XDR, key, network, and expiry are unchanged.
4. Record the original hash and selected key in a durable attempt record. A new page capture can reuse a request number.
5. Send one `walleterm sign` request with the transaction shape. Require a successful exit, `ok: true`, `verified: true`, the same key, and the reviewed hash as `digest`.
6. Decode `signed_transaction_xdr`. It is the same envelope with one appended signature. Verify its body and hash.
7. Return the result only to its pending request, in the exact response format of the wallet transport.
8. The website can submit immediately. Verify ledger acceptance and resulting state.

Cancel an unsigned request before signing begins. Later cancellation cannot undo a signature.
Close the page bridge after all requests settle.

## In-page signing

Some websites offer only local key generation or secret-key import. An injected wallet does not replace that signer.
Use a public-only identity and adapt the website's signing function when the task permits a temporary adapter.
Keep private-key creation, import, storage, and export controls outside that adapter.
For a synchronous signer, capture the unsigned envelope before the website's submission call.
Pause submission until the original request receives its reviewed signed envelope.
Keep the website's construction, simulation, submission, and result handling when practical.
Verify the signing path that actually runs. A changed wallet label does not prove interception.
Report the temporary adapter separately from a native website integration. Keep site-specific patches in task evidence.
