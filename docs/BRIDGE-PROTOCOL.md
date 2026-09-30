# Walleterm bridge protocol version 4

The bridge signs transaction envelopes, authorization payloads, and SEP-53 messages for one network.
That network is testnet, or the network of `walleterm tunnel --network` or `--network-passphrase`.
It never builds or submits transactions.
The bridge and `walleterm sign` share one Rust core for each artifact. The bridge adds only its website rules.
The browser SDK exposes this protocol through a SEP-43 wallet. See [the SEP-43 design](SEP-43.md).
All routes return JSON. Errors contain `{ "error": { "code": -3, "message": "...", "ext": ["walleterm:..."] } }`.
`code` is a SEP-43 error code. `ext[0]` is a stable reason. The HTTP status stays meaningful.
The public bridge URL contains no credential. The website exchanges the connection code for an origin-bound session token.
A connected website can list available 1Password Ed25519 public keys, comments, and fingerprints.
The tunnel flag `--vault` limits this list to one vault. See [the vault filter](WEB-BRIDGE.md#limit-the-wallets-to-one-vault).

## Connection code

`walleterm tunnel` prints the public URL, an eight-digit connection code, and a QR code.
The QR code contains `{"walleterm":4,"url":"...","code":"...","expires_at":"..."}`.
`GET /api/session` returns `{"service":"walleterm","protocol":4}`. The SDK accepts only version 4.
Version 4 replies can name a network other than testnet. An older SDK would still report testnet.
So `/v1/connect` refuses a request without `"protocol": 4` before it checks the code. That attempt does not count.
A code works once and expires after five minutes. The terminal shows each expiry in local time, such as "3:04 PM (in 5 minutes)".
After a use or a lockout, the tunnel prints a new code block with its reason, the URL, and a QR code.
When an unused code expires, the tunnel prints one line with the new code and no QR code. So idle rotation stays short.
That line says that the QR code above it no longer works.
A website that sends the last expired code gets "The connection code expired." This attempt does not count as incorrect.
Five incorrect codes replace the code and pause connection for one minute. The new block says when connections resume.
The bridge checks the code, session, and request deadlines against the wall clock once each second.
A deadline that passed while the Mac slept applies within one second after wake.

## Website routes

Requests require an exact HTTPS Origin, or a loopback HTTP Origin for development.
The Origin must differ from the bridge origin. These routes use narrow CORS and no cookies.
A rejected Origin gets status 403 and a message that names the cause: plain HTTP, `null`, a malformed value, or the bridge origin.
The preflight and the 403 answer carry CORS headers for that Origin, so the website can read the message.
No route runs for a rejected Origin, and the answer holds only that message. A request without an Origin gets no CORS headers.

- `POST /v1/connect`, body `{code, wallet_scope, protocol}`: returns `token`, `connection_id`, `expires_at`, `wallet_scope`, `selection_revision`.
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
Omitting `--vault` means the grant can cover all available Ed25519 agent keys.

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
Each request keeps its original public key, artifact, and hash.
A signature already delivered can remain in the website's recovery journal.
A wallet change cannot undo that signature or submit a transaction.

## Request kinds

Every request has `id`, `kind`, `network_passphrase`, and `address`. `address` is the selected G-address that signs.
An `available` session also sends `selection_revision`. Unknown fields fail. The error names the first bad field.

| `kind` | Artifact fields | Signed result field |
| --- | --- | --- |
| `transaction` | `xdr`: a canonical V1 or fee-bump envelope | `signed_tx_xdr`: the envelope with one appended signature |
| `auth_entry` | `preimage_xdr`: a CAP-71 address-bound `HashIdPreimage` | `signed_auth_entry`: the Base64 64-byte Ed25519 signature |
| `authorization` | `auth_entry_xdr`, `auth_address`, and `adapter` | `signed_auth_entry_xdr`: the signed AddressV2 entry |
| `message` | `message`: SEP-53 text of 1–1024 UTF-8 bytes | `signed_message`: the Base64 64-byte Ed25519 signature |

`hash` holds the transaction hash, the SHA-256 digest of the preimage, the adapter digest, or the SEP-53 digest.
The request ID is client-generated, with 1–64 letters, digits, underscores, or hyphens.
An identical retry returns the same request. A changed payload with the same ID fails.
A signing request lasts at most five minutes. A transaction request ends sooner at a nonzero `max_time`.
The bridge scopes request IDs to a website session.
A connection permits 1000 requests. The bridge permits 32 active requests and 64 live connections.

## Errors

| Code | Reason | Cause |
| --- | --- | --- |
| `-3` | `walleterm:not_connected` | No session, an expired session, or no selected key. |
| `-3` | `walleterm:network_unsupported` | A network other than the tunnel network. |
| `-3` | `walleterm:address_mismatch` | A signer other than the selected key, or a key that the envelope does not need. |
| `-3` | `walleterm:invalid_request` | Malformed fields or artifacts, a body that is not valid UTF-8, message text outside 1–1024 bytes, an expired `max_time`, or expiration ledger 0. |
| `-3` | `walleterm:unsupported` | A V1 authorization preimage. |
| `-3` | `walleterm:conflict` | A stale selection, grant, or revision, or a reused request ID. |
| `-3` | `walleterm:rate_limited` | A code, connection, or request limit. |
| `-3` | `walleterm:expired` | The request expired before signing. |
| `-4` | `walleterm:rejected` | The website canceled, the session ended, the wallet changed, the approver denied it, the selected key left 1Password, or 1Password did not sign. |
| `-2` | `walleterm:bridge_unavailable` | The bridge is stopping, or 1Password discovery failed or timed out. |
| `-1` | `walleterm:result_unknown` | Signing started and the bridge withheld or lost the result. |
| `-1` | `walleterm:internal` | Any other failure. |

A failed request stores its error object and `requestState`. The SDK returns it unchanged.
`denied` means that the request ended and nothing was signed. It has `-4`, or `-2` when wallet discovery failed.
A removed key is `-4`, as a wallet change is. The bridge cannot sign for it, and no signature exists.
After signing starts, a request that ends without a delivered signature becomes `unknown`, with one exception.
1Password can answer the signing call with an SSH agent failure and no signature.
A declined prompt gives this answer. Then the request becomes `denied` with `-4`, because no signature exists.
Its message is "1Password did not sign. You declined the prompt, or 1Password refused the request."
An unanswered prompt that times out closes the agent connection instead. That request stays `unknown`.

## Approval

On testnet, futurenet, and a local network, a connected website approves a request by sending it.
There, the connection code is the only gate. A website with a valid session can request any valid signature.
On mainnet and on a custom passphrase, each request also waits for `walleterm approve`. `--approve` adds that step on a test network.
The request stays `pending` while it waits. `walleterm approve` shows it with the `stellar-xdr` decode of its artifact.
An approval lets the bridge continue. A denial ends the request as `denied` with `-4` and "The approval was declined."
No answer before the request expires ends it as `expired` with `-3`.
A cancel, a wallet change, a disconnection, or shutdown ends the wait. A late answer then fails.
The bridge signs one request at a time. A request that waits for approval holds every later request, so answer or deny it promptly.
1Password can still require its own approval on the Mac. Cached 1Password approval can skip that prompt.
A 1Password setting can require approval of each request. See [the README](../README.md#ask-for-approval-of-each-signature).
A message signature is valid on every network. See [Messages](#messages).
See [the approve command](INTERFACE.md#approve) for the local approval channel.
A declined 1Password prompt ends the request as `denied`. The selected key must still exist before signing.
The bridge independently verifies every returned signature.

## Transaction envelopes

The bridge filters no operations. The website reviews the content of each request.
It keeps these structural invariants:

- The tunnel network only. A canonical V1 or fee-bump envelope. V0 envelopes fail.
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
3. The network ID of the tunnel network.
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

## Messages

`message` implements SEP-43 `signMessage` with [SEP-53](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0053.md).
The bridge computes the digest from the text: `SHA-256("Stellar Signed Message:\n" || text bytes)`.
No request accepts a precomputed hash. The bridge checks the message before signing:

1. The request body is valid UTF-8. JSON with a lone surrogate escape fails. The bridge never replaces a character.
2. The text has 1–1024 UTF-8 bytes. The limit counts bytes, not characters.
3. `network_passphrase` is the tunnel network. This is a session check only. The signature binds no network.
4. `address` is the selected G-address.

The bridge applies no Unicode normalization and no content filter. NUL, control, and bidirectional characters are accepted.
The website approves a message by sending it, as for every kind.
Before signing, the tunnel prints the origin, key, byte count, digest, and escaped text. See [the bridge guide](WEB-BRIDGE.md#run-the-bridge).
The line escapes control, format, bidirectional, separator, and private-use characters. The usual result line follows.
A SEP-53 signature is a permanent, portable proof that the key approved the text.
It binds no network, origin, nonce, or expiry, unless the text contains them.
So the network rule does not limit a message signature.
The 1Password prompt shows no text. Cached 1Password approval can skip that prompt.
Connect only dedicated test keys. Never use a Walleterm key as an identity or a key-derivation source for another service.

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
The bridge never retries a signing request. The terminal prints one line for each request that ends.
The line says that the request was signed, not signed, signed but not sent, or stopped during signing, and why.
It names the kind, the full hash, and the short signer address. Each terminal line starts with the local time.
It also prints one line for each message request before signing.
Each connection event prints one line: a connected website with its wallet scope, a changed wallet, a disconnection,
an expired connection, an incorrect code, and a failed wallet list. These lines hold no code, token, or grant ID.
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
The bridge exposes no arbitrary digest route. A message request signs only the SEP-53 digest of its text.
