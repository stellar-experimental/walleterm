# Website signing bridge

Status: design boundary. The bridge does not exist yet.

The bridge, tunnel, and demo site have different roles:

| Part | Role | Current state |
| --- | --- | --- |
| Signing bridge | Accept a paired website request, review it, call `walleterm sign`, and return a signed result. | Not built. |
| Tunnel | Give the local bridge a public HTTPS route. | The demo command manages a temporary Quick Tunnel. |
| Demo site | Act as one website that uses the bridge protocol. | Built, but it currently calls its own server directly. |

The current live tests prove that one fixed site can pair, send requests through a tunnel, and receive signed XDR.
They do not prove that an independent website can connect to a general signing bridge.
The demo server builds its own four fixed testnet actions. It is not a general signing API.

A future bridge command should own the local bridge process and its tunnel.
The bridge should issue a pairing QR code or link for a website origin.
The site should use a documented request protocol, without access to private keys or unrestricted digest signing.
The bridge should display the exact transaction for human approval before it calls `walleterm sign`.
The bridge should return signed XDR to the requesting site. The site should choose when to submit it.
The demo site should then use that same protocol as any other integrated website.

Before a production claim, test pairing from an independent origin, origin binding, session renewal, request validation, approval, cancellation, and tunnel shutdown.
Use a stable tunnel hostname for production. A Cloudflare Quick Tunnel is only a temporary test route.
