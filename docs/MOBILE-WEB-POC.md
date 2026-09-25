# Historical mobile web proof

The combined `web` command below was removed. `walleterm tunnel` and `walleterm demo` replace it.
Its code remains in the `mobile-web-poc` branch history.
These records describe the earlier proof. Use [WEB-BRIDGE.md](WEB-BRIDGE.md) for the current commands.
Earlier live signing evidence does not establish acceptance of the new bridge.

Status: local tests and live iPhone, desktop Chrome, 1Password, and testnet acceptance passed on 2026-09-25.
The live iPhone used Wi-Fi through iPhone Mirroring. A cellular-only connection remains untested.
Picker and tunnel hardening passed 68 offline tests and a public browser check on 2026-09-25.
Those checks did not repeat live signing. See [the hardening evidence](../evidence/mobile-poc/picker-tunnel-hardening.json).
Desktop Chrome used the same public tunnel and completed all four testnet actions.
This proof runs only on Stellar testnet. The current `web` command runs a fixed site and its tunnel.
It does not provide the general signing service for other websites.

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

The browser lists Ed25519 keys from the 1Password SSH agent. Select a dedicated testnet key before preparing an action.
`--signer G...` suggests a key but does not select it.
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

Install the CLI and web files:

```sh
make install
```

Start the site and tunnel with dedicated testnet public keys:

```sh
walleterm web --recipient G... --signer G... --human
```

The CLI starts both processes and shows a QR code and a copyable pairing link. Scan the code or open the link in a browser.
Omit `--signer` when the caller has no preferred key. The browser still lists available keys.
A paired browser can open `/?preferred=G...` to emphasize a listed key. The user must select the key.
The link expires after five minutes and pairs one browser. Restart the command to pair another browser.
The browser stores a session cookie for one hour. Keep the pairing link private.
The default output is one JSON `web_ready` event. Use `--human` for the terminal QR code.
Press Ctrl+C to stop the site and tunnel. The CLI preserves the journal in `~/Library/Application Support/walleterm/web`.
Use `--state-dir PATH` to select a different journal. Preserve a live journal for reconciliation.
Quick Tunnels have no uptime guarantee. They suit this proof, not a permanent signer endpoint.
Cloudflare documents [Quick Tunnel limits](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

## Shutdown and recovery

The command uses a private temporary Cloudflare configuration and a restricted child environment.
It keeps your existing Cloudflare configuration and credentials unchanged.
The site and metrics listen only on loopback. The public route serves the fixed demo site and its paired API.
A parent pipe connects the command to the tunnel supervisor. Closing that pipe stops the tunnel child.
The supervisor also receives kernel EOF after a hard parent crash.
Startup, network checks, and shutdown have deadlines. Shutdown closes incomplete browser requests.
The command terminates a child that ignores normal termination.

Each journal has one owner. A second command with the same journal fails with a specific error.
Normal exit removes `.web-lock`. It preserves all submission records.
A hard crash can leave `.web-lock/owner.json` in the selected state directory.
That file records the original process and tunnel supervisor, including the temporary tunnel directory and local port.
The temporary directory's `child.json` records the cloudflared process.
Check those process identities and confirm that they stopped before removing only `.web-lock`.
A reused PID does not identify the original process. Do not kill a process from its PID alone.
Never delete submission journals to bypass recovery. Restart with the same state directory and reconcile the original hash.

The installer builds and installs dependencies in a separate version directory.
It switches `~/.local/bin/walleterm` only after that version is complete.
Existing processes continue with their original version. A failed build or dependency install leaves the command unchanged.

The tunnel is a development service. Cloudflare provides no production availability guarantee for Quick Tunnels.
See [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
The check used cloudflared `2026.9.1` and documentation marked updated April 20, 2026.

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
