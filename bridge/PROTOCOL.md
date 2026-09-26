# Walleterm bridge protocol v2

The bridge signs supported unsigned classic testnet transactions. It never builds or submits transactions.
All routes return JSON. Errors contain `{ "error": { "message": "..." } }`.
The public bridge URL contains no credential. The website exchanges the connection code for an origin-bound session token.
A connected website can list available 1Password Ed25519 public keys, comments, and fingerprints.
`OP_VAULT` limits this list to SSH keys in the selected vault, by name or ID.
The bridge uses the 1Password CLI to read only item metadata and public key fields.
It matches full public keys against the agent list and checks membership again before signing.
Lookup failures stop discovery. An empty vault returns no wallets.
An unset or empty `OP_VAULT` lists all available Ed25519 agent keys.
The SDK permits 135 seconds for discovery and selection, with caller cancellation.
Vault lookup permits 120 seconds after agent discovery. Failed lookups never return an unfiltered list.

## Connection code

`walleterm tunnel` prints the public URL, an eight-digit connection code, and a QR code.
The QR code contains `{"walleterm":2,"url":"...","code":"...","expires_at":"..."}`.
A code works once and expires after five minutes. The bridge prints a new code after each use or expiry.
Five incorrect codes replace the code and pause connection for one minute.

## Website routes

Requests require an exact HTTPS Origin, or a loopback HTTP Origin for development.
The Origin must differ from the bridge origin. These routes use narrow CORS and no cookies.

- `POST /v1/connect`, body `{code, wallet_scope?}`: returns `token`, `connection_id`, `expires_at`, `wallet_scope`, `selection_revision`.
- `GET /v1/signers`: returns eligible public keys as `signers`. Before a scoped selection, it also returns `grant_id`.
- `POST /v1/select`: selects an eligible key. It returns `public_key`, `network_passphrase`, `selection_revision`, and `expires_at`.
- `GET /v1/account`: returns `connection_id`, `public_key`, `network_passphrase`, `expires_at`, `wallet_scope`, `selection_revision`.
- `POST /v1/requests`: accepts `id`, `transaction_xdr`, `network_passphrase`, `public_key`, and scoped `selection_revision`.
- `GET /v1/requests/:id`: returns `id`, `state`, `hash`, `expires_at`, and `signed_xdr` only when signed.
- `POST /v1/requests/:id/cancel`: cancels a pending request, or withholds an in-progress or signed result.
  A cancel for an ID that has not arrived blocks that ID for the session.
- `POST /v1/disconnect`: revokes the website session and suppresses its outstanding results.

All routes except `/v1/connect` require `Authorization: Bearer TOKEN` and the connected Origin.
A connection without a selected key lasts five minutes. The first selection sets a one-hour expiry.
Later wallet changes preserve that expiry.

The default `wallet_scope` is `selected`. This legacy connection permits one key and cannot change it.
Its selection body remains `{public_key}`. Its signing requests omit `selection_revision`.
A website can explicitly request `wallet_scope: "available"` when it connects.
This scope permits changes among the wallets covered by the first selection grant.
The website must explain this broader permission before the first selection.
An unset `OP_VAULT` means the grant can cover all available Ed25519 agent keys.

A scoped selection sends `{public_key, expected_revision}`.
Its first selection also sends the `grant_id` returned with the displayed wallet list.
A refreshed list replaces the grant ID. An old grant ID fails with 409.
The first selection pins the displayed public keys that remain available.
Keys added after that display cannot enter the grant without a new reviewed list before selection.
After selection, discovery returns only granted keys that remain available.
Later additions require a new connection. Removal and lookup errors stop selection or signing.

`selection_revision` starts at 0 and increases when the selected key changes.
The first selection sets it to 1. Selecting the current key preserves it.
A selection compares `expected_revision` after discovery. Missing or stale revisions fail with 409.
Scoped signing requests require the current `selection_revision`, including identical retries.
This rejects delayed requests after a wallet changes away and back.
Wallet changes cancel pending and approved requests. Their state becomes `denied`.
They withhold in-progress and completed bridge results. Their state becomes `unknown`.
Each request keeps its original public key, signer metadata, XDR, and hash.
A signature already delivered can remain in the website's recovery journal.
A wallet change cannot undo that signature or submit a transaction.
The request ID is client-generated, with 1–64 letters, digits, underscores, or hyphens.
An identical retry returns the same request. A changed payload with the same ID fails.
A signing request lasts at most five minutes. The bridge scopes request IDs to a website session.
A connection permits 1000 requests. The bridge permits 32 active requests and 64 live connections.
The standalone browser SDK keeps credentials in memory.
The connection component can save the bridge URL and session token through its `sessionStorageKey` option.
The demo enables this option. Reload checks `/v1/account` before it publishes the connected wallet.
Disconnect and 401 responses clear the saved session. Recovery never repeats signing or submission.
The connection UI checks the account every 15 seconds while the page is visible.
Focus, restored pages, and network recovery also trigger a check.
Network failures preserve credentials. A 401 response clears the session and requires a new code.

## Approval

A connected website approves a request by sending it. The bridge asks for no approval in its terminal.
The bridge signs every request that passes the transaction limits below, one at a time.
1Password can still require its own approval on the Mac. Cached 1Password approval can skip that prompt.
The connection code is the only gate. A website with a valid session can request any supported signature.
This fits testnet use only. An automated policy review can later use the bridge's `review` hook.
The selected key must still exist before signing. The bridge independently verifies every returned signature.

## Transaction limits

The bridge accepts TESTNET, unsigned v1 transaction envelopes, and one operation per transaction.
The transaction source and optional operation source must match the selected account.
Supported operations are native payment, manageData, and manageSellOffer with explicit assets.
The maximum fee is 100000 stroops. Time bounds are required and end within five minutes.
Fee bumps, additional preconditions, Soroban, additional signatures, and other operations fail before signing.
These limits describe the first adapter. They do not claim support for every Stellar application.

## State and cancellation

The bridge keeps sessions and requests in memory. A restart ends all of them.
The bridge never retries a signing request. The terminal prints a line for each produced or withheld signature.
A signed transaction applies at most once, because its sequence number and five-minute expiry limit it.
Cancellation or revocation during signing can suppress delivery but cannot undo a signature already produced.
Each bridge process permits one active signing operation.
The SDK retries identical request IDs after network failures and server errors.
Retry delays increase from one second to five seconds. Successful polling uses one-second intervals.
The SDK never retries the signer itself. It bounds cancellation checks to ten seconds and three attempts.
Unconfirmed cancellation preserves signing uncertainty. An optional `onProgress` callback reports request states and network retries.
