# Connection recovery and signing deadlines

This page covers signing deadlines, public tunnel health, tunnel recovery, and sleep.
See [the connection component](CONNECTION-UI.md) for browser sessions and health checks.
[Network values and limits](NETWORKS.md) lists every hard-coded limit.

## Signing

The demo transaction expires 180 seconds after construction. Review time reduces the remaining signing time.
The demo shows a countdown and stops waiting at the transaction deadline.
The default SDK signing deadline is five minutes. A caller can supply an earlier cancellation signal.
Each ordinary bridge HTTP request permits 15 seconds. Wallet discovery and selection permit 135 seconds.
The bridge permits 125 seconds for each 1Password signing call. Vault lookup can also take up to 120 seconds.
The bridge signs requests one at a time. Queue time counts against transaction expiration.

The SDK polls a request every second. Network failures and server errors retry the same request ID.
Retry delays increase from one second to five seconds. Client errors stop retries.
Retries never create another signer operation for an identical request ID in the same session.
The bridge never retries its signer. Neither service submits a transaction.

Cancellation permits three attempts within ten seconds. Failed cancellation keeps an uncertain signing outcome.
Cancellation cannot undo a produced signature. A 401 response cannot prove that signing stopped.
The demo keeps uncertain signing and submission records. Check an uncertain submission by its original transaction hash.

## Public services

`walleterm tunnel` and `walleterm demo` each own a local server and a public tunnel.
Stopping one command does not stop the other.
Each command checks `/api/session` every 15 seconds. The response must identify the exact service.
Each probe permits 2.5 seconds for DNS, connection, TLS, and the response. The DNS lookup permits 2 seconds of that.
Probes ask the `/etc/resolv.conf` nameservers directly and keep no DNS cache.
Healthy checks produce no log output. The terminal reports failures and recovery when they occur.
The terminal repeats an ongoing failure at most once per minute.

The DNS parser accepts a CNAME only when its name uses exactly the record's declared data.
Malformed names, unmatched questions, unrelated addresses, and truncated answers cannot supply a probe address.
TLS still checks the tunnel hostname. The resolver changes only the connection address.

A new Quick Tunnel name resolves several seconds after cloudflared prints it. Cloudflare calls this delay a DNS warm-up.
Walleterm prints the URL and QR code only after the public URL answers.
It never asks the macOS resolver early, so that resolver cannot cache a negative answer.
The readiness check has three known limits:

- It asks for IPv4 addresses only. On an IPv6-only network, readiness can fail.
- It skips a nameserver with an interface suffix, such as `fe80::1%en0`.
  If that is the only nameserver, readiness fails with "The DNS configuration has no nameserver."
- A caching nameserver can keep the first negative answer for up to 60 seconds, the negative TTL of `trycloudflare.com`.
  Readiness permits 45 seconds. If startup fails with "The DNS lookup found no such tunnel name", run the command again.

## Tunnel recovery

Cloudflared handles its own temporary connection failures. Walleterm permits six failed checks before it replaces a running tunnel.
A stopped tunnel process also starts recovery. Recovery keeps the local server running.
Recovery permits three replacement attempts per ten minutes. The delays are two, four, and eight seconds.
Each replacement permits 30 seconds for its URL and 45 seconds for public readiness.
At the replacement limit, recovery pauses. The local server stays available, and public checks continue.
Recovery resumes when the oldest attempt leaves the ten-minute window. The terminal reports the pause.
Ctrl+C cancels recovery and stops the current child. Recovery never starts a child after shutdown.

A Quick Tunnel replacement produces a new public URL. The command prints its new URL and QR code.
Use the new bridge URL and current code to reconnect. Open pages do not discover a new URL.
A new demo URL creates a different website origin. Browser storage stays attached to the old origin.
Keep an existing page open when it contains an unresolved transaction.
Export its activity before you change to a new demo origin.

## Sleep

Sleep makes the local public services unavailable. After wake, the existing cloudflared process can recover its connection.
Walleterm resumes public health checks and uses bounded replacement when recovery fails.
The demo checks its signing deadline against wall-clock time after wake. Sleep never renews transaction validity.

## Quick Tunnels and named tunnels

Both commands use temporary Cloudflare Quick Tunnels. A Quick Tunnel has no uptime guarantee.
A named Cloudflare tunnel with a configured hostname can give a stable public URL.
It needs Cloudflare account configuration, tunnel credentials, and a hostname route. Walleterm does not support it.

The retry behavior above matches cloudflared 2026.9.3.
Sources: [cloudflared supervisor source](https://github.com/cloudflare/cloudflared/blob/2026.9.3/supervisor/tunnel.go),
[Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/),
and [named tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/create-local-tunnel/).
