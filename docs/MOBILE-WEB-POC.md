# Mobile web proof

Status: local tests and live iPhone, desktop Chrome, 1Password, and testnet acceptance passed on 2026-09-25.
The live iPhone used Wi-Fi through iPhone Mirroring. A cellular-only connection remains untested.
Desktop Chrome used the same public tunnel and completed all four testnet actions.
This proof runs only on Stellar testnet. It leaves the `walleterm` CLI interface unchanged.

## Goal and route

The phone opens one website through a Cloudflare Quick Tunnel. The website and API use the same HTTPS origin.
The Mac runs the site server on `127.0.0.1:8787`. The server builds a fixed testnet transaction with the official Stellar SDK.
The phone reviews the transaction and approves the request. The Mac calls `walleterm sign` for its 32-byte digest.
The server returns signed XDR to the phone page. A separate phone action sends that exact XDR to Stellar testnet.
The server records the original hash before submission and polls its ledger result.

The pairing link contains a random, single-use code in its URL fragment. The phone sends that code in one HTTPS request.
The server then issues a one-hour `HttpOnly`, `SameSite=Strict` cookie. The cookie uses `Secure` over HTTPS.
The server accepts writes only from its exact configured origin. It binds one phone session per process.
The link holder can pair first, so keep the link private. Restart the server to revoke a session and create a new link.

The phone approval does not approve a 1Password prompt. The Mac may still need a local desktop approval or unlock.
The 1Password prompt identifies the application and key. It does not display Stellar transaction details.
Cached 1Password approval can let a later phone request sign without another desktop prompt.
The phone review remains mandatory for each request. See [1Password authorization](https://www.1password.dev/ssh/agent/authorization).

## Demo actions

The signer is a dedicated 1Password testnet key. Set it explicitly with `DEMO_SIGNER`.
Set a dedicated recipient with `DEMO_RECIPIENT`. The server offers these fixed actions:

| Action | Exact operation | Expected effect |
| --- | --- | --- |
| Note | `manageData` on `walleterm-poc` | The account stores a short request ID. |
| Payment | `payment` of `0.0100000` test XLM | The recipient balance rises. |
| Offer | `manageSellOffer` selling `0.1000000` XLM at 10 testnet USDC per XLM | The offer rests or trades. |
| Cancel offer | `manageSellOffer` with amount zero and the recorded offer ID | A resting demo offer disappears. |

The testnet USDC issuer is `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
Circle lists this issuer in its [USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).
The offer needs an authorized trustline and free buying capacity. The server checks both before it builds the offer.
The server rejects a new offer when Horizon reports an existing offer on the signer.
An offer can trade before cancellation. The server must inspect the offer effect after submission.

## Run

Install dependencies and check the local flow:

```sh
npm ci --ignore-scripts
node --test poc/server.test.mjs tests/submission.test.mjs
go test ./...
```

Start a temporary tunnel in one terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
```

Copy its HTTPS origin. Start the server in another terminal with explicit testnet public keys:

```sh
PUBLIC_ORIGIN='https://YOUR-TUNNEL.trycloudflare.com' \
DEMO_SIGNER='G...' DEMO_RECIPIENT='G...' \
DEMO_STATE_DIR='poc/.state/live' node poc/server.mjs
```

The server prints a one-time pairing link. Open that link on the phone. Keep the URL fragment out of screenshots and logs.
Use a separate `DEMO_STATE_DIR` for each local mock or live run. Preserve the live directory for reconciliation.
Quick Tunnels have no uptime guarantee. They suit this proof, not a permanent signer endpoint.
Cloudflare documents [Quick Tunnel limits](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

## Acceptance

Record each expected result and its observation separately.

1. Pair a real phone over cellular. Confirm that another phone cannot redeem the same link.
2. Prepare the note and payment. Compare the phone review with unsigned XDR and the transaction hash.
3. Approve one request on the phone. Record whether 1Password required a fresh Mac prompt.
4. Return signed XDR and verify its Ed25519 signature before submission.
5. Submit once. Record the hash, ledger, result, and account state change.
6. Open an offer. Record its ID, amount, trade effect, balances, and liabilities.
7. Cancel any resting demo offer. Confirm the offer disappears.
8. If submission status is unknown, reconcile the original hash before another signing request.

The submission guard keeps an unresolved hash in `poc/.state/`. Preserve that directory during recovery.
`NOT_FOUND` alone does not prove that a submission failed. See Stellar's [getTransaction result rules](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction).

The Astra review found and rechecked recovery risks. The final attempt-bound recovery check passed.
See [live acceptance evidence](../evidence/mobile-poc/live-acceptance.json) for transaction hashes and account state.
See [desktop Chrome evidence](../evidence/mobile-poc/browser-acceptance.json) for its separate transaction hashes and account state.
Another offer, `826443`, appeared before the Chrome offer. The Chrome run created and canceled only `826445`.
That run exposed a missing existing-offer check. The server now rejects new offers when Horizon reports an open offer.
The phone observed no new 1Password desktop prompt during these four signatures. Cached approval can explain this result.
