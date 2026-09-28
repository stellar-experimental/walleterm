# Runtime research evidence

Access date: 2026-09-26

## Stellar Raven MCP

The first source search used official Stellar documentation.

Question: `official Stellar testnet development network reset test assets not real`

The selected official page says Testnet resets clear ledger entries and history.

The page also says developers must not depend on Testnet balances or account persistence.

The evidence applies to the bridge's documented testnet boundary.

It does not reduce the need for local process cleanup.

## stellar-raven-jev

The first call failed during Jev transport.

It spent `$0.008729397` and saved its failure record.

The permitted retry returned `partial` evidence.

It selected 11 documents, retained 31 uncertain documents, and rejected 299 documents.

It reported zero rate-limited requests.

The retry spent `$0.024306173`.

Two official documents directly supported the testnet boundary.

- `search-documents/0136.txt` covers reset effects and persistence limits.
- `search-documents/0049.txt` covers testing without real assets.
- `search-documents/0001.txt` is the full companion page.

Jev remained degraded because one original read was refused.

The selected official text was sufficient for this bounded claim.

## Parallel CLI

The query searched official Node.js documentation for child-process lifetime behavior.

Output: `parallel-cli-node-child-lifecycle.json`

Search ID: `search_fe63fe4759add61477e072ce74e89512`

Usage: one `sku_search`; the provider did not report a price.

The current Node.js page states that non-Windows child processes can survive a parent exit.

The local Bun reproduction establishes applicability to this implementation.

Output SHA-256: `3c6ab399370bd56d8234c081bf12dd29a6e3962f76644c8f9f19ffbb3df79324`

## Parallel Search MCP

The query searched official Cloudflare Quick Tunnel documentation.

Search ID: `search_85c637aac305be7bcbd7370d19ee7133`

Session ID: `6b2ba152-4447-4d0a-8da1-79ee976fcb0c`

The official page defines Quick Tunnels as testing tools without an uptime guarantee.

It also states that each process receives a random public hostname.

This evidence makes URL stability and production uptime accepted limits here.

The provider did not report a price.

## Perplexity MCP challenge

The challenge searched official Cloudflare documentation and source discovery results.

Query: `cloudflare cloudflared source parent process exit stdin EOF signal shutdown SIGTERM quick tunnel`

The pass returned 10 results.

It found the current cloudflared repository, run parameters, and Quick Tunnel source paths.

It found no direct guarantee that cloudflared exits after its supervisor receives `SIGKILL`.

The provider did not report a price.

## Sources

- [Stellar networks](https://developers.stellar.org/docs/networks), retrieved 2026-09-26.
- [Stellar reset automation](https://developers.stellar.org/docs/build/guides/basics/automate-reset-data), retrieved 2026-09-26.
- [Node.js child processes](https://nodejs.org/api/child_process.html), version 26.10.0, retrieved 2026-09-26.
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), updated 2026-04-20.
- [cloudflared source](https://github.com/cloudflare/cloudflared/blob/2026.9.3/cmd/cloudflared/tunnel/cmd.go), version 2026.9.3.
