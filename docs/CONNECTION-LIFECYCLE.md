# Connection recovery and signing deadlines

## Signing

The demo transaction expires 180 seconds after construction. Review time reduces the remaining signing time.
The demo shows a countdown and stops waiting at the transaction deadline.
The default SDK signing deadline is five minutes. A caller can supply an earlier cancellation signal.
Each ordinary bridge HTTP request permits 15 seconds. Wallet discovery and selection permit 135 seconds.
The signer permits 120 seconds for each signing call. Vault lookup can also require up to 120 seconds.
The bridge signs requests one at a time. Queue time counts against transaction expiration.

The SDK polls successful requests every second. Network failures and server errors retry the same request ID.
Retry delays increase from one second to five seconds. Client errors stop retries.
Retries never create another signer operation for an identical request ID in the same session.
The bridge never retries its signer. Neither service automatically submits a transaction.

Cancellation permits three attempts within ten seconds. Failed cancellation preserves an uncertain signing outcome.
Cancellation cannot undo a produced signature. A 401 response cannot prove that signing stopped.
The demo preserves uncertain signing and submission records. Check an uncertain submission by its original transaction hash.

## Public services

Each command owns its local server and public tunnel. Stopping one command does not stop the other.
Each command checks `/api/session` every 15 seconds. The response must identify the exact service.
Probe DNS lookup and HTTP response each permit 2.5 seconds.
Healthy checks produce no log output. The terminal reports failures and recovery when they occur.
The terminal repeats an ongoing failure at most once per minute.

Cloudflared handles its own temporary connection failures. Walleterm permits six failed checks before replacing a running tunnel.
A stopped tunnel process also starts recovery. Recovery keeps the local server running.
Recovery permits three replacement attempts per ten minutes. The delays are two, four, and eight seconds.
Each replacement permits 30 seconds for its URL and 45 seconds for public readiness.
At the replacement limit, recovery pauses. The local server stays available, and public checks continue.
Recovery resumes when the oldest attempt leaves the ten-minute window. The terminal reports the pause.
Ctrl+C cancels recovery and stops the current child. Recovery never starts a child after shutdown.

Quick Tunnel replacement produces a new public URL. The command prints its new URL and QR code.
Use the new bridge URL and current code to reconnect. Existing pages do not automatically discover a new URL.
A new demo URL creates a different website origin. Browser storage remains attached to the old origin.
Keep an existing page open when it contains an unresolved transaction. Preserve its activity export before changing demo origins.

## Browser sessions and sleep

The demo saves the bridge URL and session token in `localStorage`. All tabs of the website share them.
Reload checks `/v1/account` before it publishes the wallet or enables transaction actions.
The bridge supplies the current wallet scope and selection revision.
Recovery never reuses a connection code or repeats signing or submission.
Disconnect and 401 responses remove the saved session.
Browser storage failures leave the connection in memory.
Every website gets this behavior from `Walleterm`. It saves the session under `walleterm:session` for all tabs of the website.
`new Walleterm({ storageKey: null })` keeps the session in memory only.

The connection UI checks `/v1/account` every 15 seconds while the page is visible.
Focus, network recovery, and restored pages also trigger a check. Checks never overlap.
A failed network check shows an unavailable connection and retains its credentials.
The demo disables new transaction creation and signing while the connection is unavailable.
A successful check restores the connection display. A 401 response requires a new connection code.
The connection menu offers Reconnect when the old URL remains unavailable.
Manual replacement can discard the previous connection locally when the old tunnel cannot confirm disconnection.
Manual disconnection also permits local discard. The website reports that remote revocation remains unconfirmed.
Local discard cancels browser signing waits. It cannot prove that an earlier signature was never produced.
The old bridge session can remain active until expiration. Stop the old bridge to revoke all its sessions.
An expired session requires another connection. Health checks never extend its one-hour lifetime.

Sleep makes the local public services unavailable. After wake, the existing cloudflared process can recover its connection.
Walleterm resumes public health checks and uses bounded replacement when recovery fails.
The demo checks its signing deadline against wall-clock time after wake. Sleep never renews transaction validity.

## Named tunnels and evidence

The current commands use temporary Quick Tunnels. The user selected this mode on 2026-09-26.
A named Cloudflare tunnel and configured hostname can provide a stable public URL.
Named tunnels require Cloudflare account configuration, tunnel credentials, and a hostname route.
These changes do not provision named tunnels or modify existing Cloudflare settings.

Source inspection used cloudflared 2026.9.3, built on 2026-09-24.
The [versioned supervisor source](https://github.com/cloudflare/cloudflared/blob/2026.9.3/supervisor/tunnel.go) defines connection retries.
The [Quick Tunnels documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) explains temporary public URLs.
The [named tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/) defines hostname routing and tunnel startup.
The named tunnel documentation reports an update date of 2026-08-25.
Local tests cover recovery, retry limits, shutdown, session expiration, countdowns, and uncertain cancellation.
Browser checks use isolated mock keys and local services. Live 1Password, lid-close, and testnet acceptance require separate evidence.
