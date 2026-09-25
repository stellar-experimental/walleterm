# Walleterm bridge protocol v2

The bridge signs supported unsigned classic testnet transactions. It never builds or submits transactions.
All routes return JSON. Errors contain `{ "error": { "message": "..." } }`.
The public bridge URL contains no credential. The connection code is the only credential a website receives.
A connected website can list the public keys, comments, and fingerprints of all 1Password Ed25519 keys.

## Connection code

`walleterm tunnel` prints the public URL, an eight-digit connection code, and a QR code.
The QR code contains `{"walleterm":2,"url":"...","code":"...","expires_at":"..."}`.
A code works once and expires after five minutes. The bridge prints a new code after each use or expiry.
During an open review, the bridge prints the new code after the review ends.
Five incorrect codes replace the code and pause connection for one minute.

## Website routes

Requests require an exact HTTPS Origin, or a loopback HTTP Origin for development.
The Origin must differ from the bridge origin. These routes use narrow CORS and no cookies.

- `POST /v1/connect`, body `{code}`: returns `token`, `connection_id`, `expires_at`.
- `GET /v1/signers`: returns the available 1Password Ed25519 keys as `signers`.
- `POST /v1/select`, body `{public_key}`: binds one key to the connection. It returns `public_key` and `network_passphrase`.
- `GET /v1/account`: returns `connection_id`, `public_key`, `network_passphrase`, `expires_at`.
- `POST /v1/requests`: accepts `id`, `transaction_xdr`, `network_passphrase`, `public_key`.
- `GET /v1/requests/:id`: returns `id`, `state`, `hash`, `expires_at`, and `signed_xdr` only when signed.
- `POST /v1/requests/:id/cancel`: cancels a pending request or suppresses an in-progress result.
- `POST /v1/disconnect`: revokes the website session and suppresses its outstanding results.

All routes except `/v1/connect` require `Authorization: Bearer TOKEN` and the connected Origin.
A connection without a selected key lasts five minutes. Key selection extends it to one hour.
A connection cannot change its key. Disconnect and connect again to use another key.
The request ID is client-generated, with 1–64 letters, digits, underscores, or hyphens.
An identical retry returns the same record. A changed payload with the same ID fails.
A signing request lasts at most five minutes. The bridge scopes request IDs to a website session.
A connection permits 1000 requests. The bridge permits 32 active requests and 64 live connections.
The browser SDK keeps credentials in memory. A reload requires a new connection code.

## Approval

No HTTP route can approve a signature. The tunnel terminal reviews one request at a time.
It shows the claimed website Origin, the signing key's comment and fingerprint, and every transaction field.
The Origin is not independently verified.
Ctrl+C stops the bridge, including during a review.
The operator types `sign` and a random challenge to approve. Any other answer denies the request.
After terminal approval, 1Password can still require its own approval on the Mac.
The selected key must still exist before signing. The bridge independently verifies every returned signature.

## Transaction limits

The bridge accepts TESTNET, unsigned v1 transaction envelopes, and one operation per transaction.
The transaction source and optional operation source must match the selected account.
Supported operations are native payment, manageData, and manageSellOffer with explicit assets.
The bridge shows all operation fields, exact rational offer price, memo, fee, sequence, hash, and time bounds.
The maximum fee is 100000 stroops. Time bounds are required and end within five minutes.
Fee bumps, additional preconditions, Soroban, additional signatures, and other operations fail before approval.
These limits describe the first adapter. They do not claim support for every Stellar application.

## Durability and cancellation

The bridge writes each request before returning it and before invoking the signer.
It flushes the file, atomically replaces it, and flushes the directory.
It persists the signature before reporting success. It never retries an uncertain signing request.
Restart invalidates website sessions. Interrupted signing becomes unknown; pending requests expire.
Old signed records remain private on disk. A new session cannot claim them automatically.
Cancellation or revocation during signing can suppress delivery but cannot undo a signature already produced.
The bridge permits one active signing operation. The journal permits one bridge process.
