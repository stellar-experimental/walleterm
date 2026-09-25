# Website signing bridge

Status: design proposal. The general bridge does not exist yet.
The current `walleterm web` command runs a fixed testnet demo server and its tunnel.
The live tests prove that fixed flow. They do not prove independent website integration.

## Components

| Part | Owns | Current state |
| --- | --- | --- |
| Signing bridge | Pairing, request records, review, approval, signing, and signed results. | Not built. |
| Tunnel | An HTTPS route to the local bridge. | The demo command manages a temporary Quick Tunnel. |
| Demo site | One client of the same protocol as another integrated website. | It currently calls its own server directly. |
| `walleterm sign` | One verified Ed25519 signature over a supplied 32-byte digest. | Built. |

A future bridge command should start the local bridge and manage the tunnel lifecycle.
The tunnel hostname must not grant signing authority.
The bridge must bind its listener to loopback before it starts the tunnel.
The bridge should use a stable, named tunnel hostname for a production deployment.
[Cloudflare describes Quick Tunnels as test routes with limits](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

## Two separate sessions

The website session can create a signing request and read only its own result.
It cannot select the final signer, approve a request, or call `walleterm sign` directly.
The approval session belongs to the bridge page on the user's phone or desktop.
It can review, approve, deny, and select an available signer.
The CLI shows a private QR code or link that starts this approval session.
Never give that link or the approval credential to a website.

A website must first pair with the bridge.
The bridge must show the website's exact origin to the user during pairing.
The bridge then issues a short-lived website capability for that exact origin and account scope.
The bridge must also check the browser `Origin` header and return narrow CORS headers.
The website capability remains necessary because non-browser callers can set an `Origin` header.
Do not use the approval page's `SameSite=Strict` cookie as the website credential.
Keep approval routes outside cross-origin access.

A website needs the bridge's public URL and a small integration adapter.
The bridge can show a copyable URL and QR code for discovery.
An unmodified website needs an extension or another provider adapter.
A future adapter can accept [SEP-7 signing requests](https://developers.stellar.org/docs/build/apps/wallet/sep7).
The first bridge protocol should still use its own explicit request and result contract.

The first pairing flow can use these steps:

1. The website creates a pairing intent from its browser origin. It receives a private claim token and a short display code.
2. The user opens the bridge approval page from the CLI QR code. The user enters the display code.
3. The bridge shows the exact website origin and account scope. The user approves or denies the intent.
4. The website claims a short-lived capability with its private claim token. The bridge binds it to the approved origin.

The display code only identifies an intent. It never grants access by itself.
Limit intent creation and expiry so an attacker cannot fill the approval page with requests.

| Route | Caller | Result |
| --- | --- | --- |
| `POST /v1/pair-intents` | Website origin | An intent, private claim token, display code, and expiry. |
| `POST /v1/pair-intents/{id}/claim` | Website with claim token | A website capability after user approval. |
| `POST /v1/requests` | Paired website | An immutable request ID and pending state. |
| `GET /v1/requests/{id}` | Owning website | State and signed XDR when available. |
| Approval routes | Bridge approval page only | Pair, approve, deny, revoke, and select a signer. |

Use no wildcard CORS response for a credentialed route.
The website capability must never authorize an approval route.
Reject requests with a missing, changed, or unapproved browser origin.
Authenticate non-browser clients with the same capability checks.

## Request contract

Start with unsigned transaction-envelope XDR and a fixed supported network.
Do not expose a public endpoint that signs an arbitrary digest.
The website sends an immutable request identifier, unsigned XDR, network, requested account, and expiry.
The bridge decodes the XDR, checks limits, calculates the digest, and shows the exact effect.
Start with explicitly supported classic transaction types. Reject unknown types before approval.
The user selects the final signer and approves the exact immutable request.
The bridge calls `walleterm sign` once, verifies the response, and stores signed XDR for that website.
The website retrieves signed XDR and decides whether to submit it.
The bridge must not submit a website's transaction automatically.

Use these request states: `pending`, `approved`, `signing`, `signed`, `denied`, `expired`, and `unknown`.
Only the approval session can move `pending` to `approved` or `denied`.
Store each state transition before an external signing call or result response.
If the signing result becomes uncertain, preserve the request and require a new human decision.

Record the website origin, account, network, XDR hash, digest, signer, expiry, state, and result durably.
Define duplicate request handling, cancellation, denial, revocation, expiry, and restart recovery before release.
A changed XDR, network, or signer must require a new approval.
A signing timeout must not silently start a second signature.
Stopping the bridge must stop or settle active signing children and close the tunnel.

## Acceptance gate

Serve the demo from an independent origin. It must use the same protocol as another website.
Use two independent website origins and one bridge origin in browser tests.
Verify that a website cannot call an approval route or read another website's result.
Test a changed payload, expired capability, denied request, duplicate request, and restart.
Test shutdown during signing and public tunnel errors during startup.
Verify the approved XDR matches the returned signed XDR and the selected signer.
Keep production status blocked until these tests and a live independent-origin test pass.
