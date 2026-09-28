# Walleterm bridge protocol version 3

The bridge signs testnet transaction envelopes and authorization payloads. It never builds or submits transactions.
The bridge and `walleterm sign` share one Rust core for each artifact. The bridge adds only its website rules.
The browser SDK exposes this protocol through a SEP-43 wallet. See [the SEP-43 design](SEP-43.md).
All routes return JSON. Errors contain `{ "error": { "code": -3, "message": "...", "ext": ["walleterm:..."] } }`.
`code` is a SEP-43 error code. `ext[0]` is a stable reason. The HTTP status stays meaningful.
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
The QR code contains `{"walleterm":3,"url":"...","code":"...","expires_at":"..."}`.
`GET /api/session` returns `{"service":"walleterm","protocol":3}`. The SDK accepts only version 3.
A code works once and expires after five minutes. The bridge prints a new code after each use or expiry.
Five incorrect codes replace the code and pause connection for one minute.

## Website routes

Requests require an exact HTTPS Origin, or a loopback HTTP Origin for development.
The Origin must differ from the bridge origin. These routes use narrow CORS and no cookies.

- `POST /v1/connect`, body `{code, wallet_scope}`: returns `token`, `connection_id`, `expires_at`, `wallet_scope`, `selection_revision`.
- `GET /v1/signers`: returns eligible public keys as `signers`. Before an `available` selection, it also returns `grant_id`.
- `POST /v1/select`: selects an eligible key. It returns `address`, `network`, `network_passphrase`, `selection_revision`, and `expires_at`.
- `GET /v1/account`: returns `connection_id`, `address`, `network`, `network_passphrase`, `expires_at`, `wallet_scope`, `selection_revision`.
- `POST /v1/requests`: accepts one signing request. See the request kinds below.
- `GET /v1/requests/:id`: returns `id`, `kind`, `state`, `hash`, `expires_at`, and `error` after a failure.
  A signed request adds `signer_address` and its signed artifact.
- `POST /v1/requests/:id/cancel`: cancels a pending request, or withholds an in-progress or signed result.
  A cancel for an ID that has not arrived blocks that ID for the session.
- `POST /v1/disconnect`: revokes the website session and suppresses its outstanding results.

All routes except `/v1/connect` require `Authorization: Bearer TOKEN` and the connected Origin.
A connection without a selected key lasts five minutes. The first selection sets a one-hour expiry.
Later wallet changes preserve that expiry.

## Wallet scopes

`wallet_scope` is required. `selected` permits one key for the connection. It is the least-privilege scope.
Its selection body is `{public_key}`. Its signing requests omit `selection_revision`.
`available` permits changes among the wallets covered by the first selection grant.
The website must explain this broader permission before the first selection.
An unset `OP_VAULT` means the grant can cover all available Ed25519 agent keys.

An `available` selection sends `{public_key, expected_revision}`.
Its first selection also sends the `grant_id` returned with the displayed wallet list.
A refreshed list replaces the grant ID. An old grant ID fails with 409.
The first selection pins the displayed public keys that remain available.
Keys added after that display cannot enter the grant without a new reviewed list before selection.
After selection, discovery returns only granted keys that remain available.
Later additions require a new connection. Removal and lookup errors stop selection or signing.

`selection_revision` starts at 0 and increases when the selected key changes.
The first selection sets it to 1. Selecting the current key preserves it.
A selection compares `expected_revision` after discovery. Missing or stale revisions fail with 409.
`available` signing requests require the current `selection_revision`, including identical retries.
This rejects delayed requests after a wallet changes away and back.
Wallet changes cancel pending and approved requests. Their state becomes `denied`.
They withhold in-progress and completed bridge results. Their state becomes `unknown`.
A result that the bridge already sent also becomes `unknown`. The terminal does not report it as withheld.
Each request keeps its original public key, signer metadata, artifact, and hash.
A signature already delivered can remain in the website's recovery journal.
A wallet change cannot undo that signature or submit a transaction.

## Request kinds

Every request has `id`, `kind`, `network_passphrase`, and `address`. `address` is the selected G-address that signs.
An `available` session also sends `selection_revision`. Unknown fields fail.

| `kind` | Artifact fields | Signed result field |
| --- | --- | --- |
| `transaction` | `xdr`: a canonical V1 or fee-bump envelope | `signed_tx_xdr`: the envelope with one appended signature |
| `auth_entry` | `preimage_xdr`: a CAP-71 address-bound `HashIdPreimage` | `signed_auth_entry`: the Base64 64-byte Ed25519 signature |
| `authorization` | `auth_entry_xdr`, `auth_address`, and `adapter` | `signed_auth_entry_xdr`: the signed AddressV2 entry |

`hash` holds the transaction hash, the SHA-256 digest of the preimage, or the adapter digest.
The request ID is client-generated, with 1–64 letters, digits, underscores, or hyphens.
An identical retry returns the same request. A changed payload with the same ID fails.
A signing request lasts at most five minutes. A transaction request ends sooner at a nonzero `max_time`.
The bridge scopes request IDs to a website session.
A connection permits 1000 requests. The bridge permits 32 active requests and 64 live connections.

## Errors

| Code | Reason | Cause |
| --- | --- | --- |
| `-3` | `walleterm:not_connected` | No session, an expired session, or no selected key. |
| `-3` | `walleterm:network_unsupported` | A network other than testnet. |
| `-3` | `walleterm:address_mismatch` | A signer other than the selected key, or a key that the envelope does not need. |
| `-3` | `walleterm:invalid_request` | Malformed fields or artifacts, an expired `max_time`, or expiration ledger 0. |
| `-3` | `walleterm:unsupported` | A V1 authorization preimage. |
| `-3` | `walleterm:conflict` | A stale selection, grant, or revision, or a reused request ID. |
| `-3` | `walleterm:rate_limited` | A code, connection, or request limit. |
| `-3` | `walleterm:expired` | The request expired before signing. |
| `-4` | `walleterm:rejected` | The website canceled, the session ended, the wallet changed, or the review denied the request. |
| `-1` | `walleterm:result_unknown` | Signing started and the bridge withheld or lost the result. |
| `-1` | `walleterm:internal` | Any other failure. |

A failed request stores its error object and `requestState`. The SDK returns it unchanged.
No path reports `denied` or `-4` after signing started. Those requests become `unknown`.

## Approval

A connected website approves a request by sending it. The bridge asks for no approval in its terminal.
The bridge signs every structurally valid request, one at a time.
1Password can still require its own approval on the Mac. Cached 1Password approval can skip that prompt.
The connection code is the only gate. A website with a valid session can request any valid signature.
This fits testnet use only. An automated agentic review will use the bridge's `review` hook.
A review denial returns `-4`. The selected key must still exist before signing.
The bridge independently verifies every returned signature.

## Transaction envelopes

The bridge filters no operations. Review of each request decides its content.
It keeps these structural invariants:

- Testnet only. A canonical V1 or fee-bump envelope. V0 envelopes fail.
- The selected key is the transaction source, an operation source, or the fee-bump fee source.
  Muxed accounts use their base key.
- At most 19 existing signatures. The selected key must not have signed already.
  The result keeps them in order and appends one signature.
- A nonzero `max_time` at or before now fails. A fee bump uses the time bounds of its inner transaction.
  Time bounds are optional, and no other time rule applies. The network enforces them.

Operation types, operation count, fees, other preconditions, and embedded authorization entries are not filtered.
The envelope signature covers any embedded entries exactly. It never signs an entry by itself.
The website must simulate, build, and submit the transaction.
Transaction XDR permits 262144 Base64 characters. Request bodies permit 393216 bytes.

## Authorization preimages

`auth_entry` implements SEP-43 `signAuthEntry`. The bridge checks the preimage before signing:

1. Canonical Base64 `HashIdPreimage` XDR of 32768 characters or fewer.
2. Type `envelopeTypeSorobanAuthorizationWithAddress`. The V1 preimage fails because it permits cross-address replay.
3. The testnet network ID.
4. A bound address that is the selected G-address or a C-address.
5. At most 256 invocation contexts and 32 levels.
6. A set expiration. Expiration ledger 0 fails.

The bridge signs `SHA-256(preimage bytes)` and verifies the signature before it returns it.
The website attaches the signature in its account's format.
A preimage cannot show the credential variant or the contract's policy. The signature approves only its bound tree.

## Adapter authorization

`authorization` is a Walleterm extension outside SEP-43. The SDK method is `signAuthorization`.
It accepts an unsigned AddressV2 entry with `auth_address` and one adapter:
`account`, `contract-ed25519`, or `openzeppelin-ed25519` with `verifier` and `context_rule_ids`.
It rejects V1, SourceAccount, and delegated credentials. The signer never converts credential variants.
Expiration ledger 0 fails. See [the CLI interface](INTERFACE.md) for schemas and helpers.
C-account policy and ownership checks remain the website's responsibility.

## Expiry

No request reads a ledger. The bridge has no RPC endpoint and no authorization expiry window.
The network refuses an expired authorization or transaction.
Expiration ledger 0 is the only authorization expiry rule. Ledger 0 is always in the past.
Simulation leaves it at 0 when the caller never sets it.
A request expires after five minutes, independent of the authorization expiry.

## State and cancellation

The bridge keeps sessions and requests in memory. A restart ends all of them.
The browser SDK shares one session token among the tabs of a website. The bridge treats them as one client.
A wallet change, a disconnection, or an expiry applies to every tab. Each tab generates random request IDs.
The bridge never retries a signing request. The terminal prints a line for each produced or withheld signature.
A signature is withheld only when the bridge never sent it to the website.
A signed transaction applies at most once, because its sequence number limits it.
An authorization applies at most once, because its nonce limits it. Both stay usable until the network refuses them.
Cancellation or revocation during signing can suppress delivery but cannot undo a signature already produced.
Each bridge process permits one active signing operation.
The SDK retries identical request IDs after network failures and server errors.
Retry delays increase from one second to five seconds. Successful polling uses one-second intervals.
The SDK never retries the signer itself. It bounds cancellation checks to ten seconds and three attempts.
Unconfirmed cancellation returns `-1` with `requestState: "unknown"`.
A 4xx answer to the first create attempt returns that error without a cancel request, because no request exists.
Canceled requests never expose late signatures. The bridge and SDK each verify returned signatures independently.
The bridge exposes no arbitrary digest route and no message signing route.
