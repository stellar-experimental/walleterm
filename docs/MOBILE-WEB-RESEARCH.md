# Mobile web research and Astra review

Date: 2026-09-25. Research used `parallel-cli 0.9.3`, primary sources, and Stellar Raven MCP documentation searches.
Installed versions: Node `v24.13.0`, Stellar CLI `27.1.0`, Stellar SDK `17.1.0`, cloudflared `2026.9.1`, and 1Password `8.12.34`.
The live testnet used protocol 28 and `Test SDF Network ; September 2015`.

## Decisions

| Research finding | Proof decision |
| --- | --- |
| [1Password authorization](https://www.1password.dev/ssh/agent/authorization) can approve an application beyond one request. Its prompt does not show the Stellar transaction. | Require phone review for each exact XDR request. Treat Mac authorization as a separate step. Record whether a fresh prompt appears. |
| [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) use temporary hostnames and have request limits. | Use one HTTPS origin for the phone site and API. Bind the local server to loopback. Use a one-time pairing link and one phone session. |
| [Stellar transaction lookup](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) can return `NOT_FOUND` before a final result. | Save the original hash and signed envelope before sending. Never send a replacement while that hash stays unresolved. |
| [Circle's USDC address list](https://developers.circle.com/stablecoins/usdc-contract-addresses) identifies the testnet issuer. | Fix the demo offer to that issuer. Review its full address on the phone. |
| [Stellar operation definitions](https://developers.stellar.org/docs/learn/fundamentals/transactions/list-of-operations) define `manageSellOffer` creation and deletion. | Inspect the result XDR for the offer ID. Cancel only the tracked ID through a new reviewed request. |

## Astra review

The Astra agent first found request races, restart recovery gaps, and offer lifecycle gaps.
The implementation now reserves request preparation before network calls and recovers the original hash after a restart.
The agent then found stale Horizon offer checks. The server now queries the exact offer ledger key through Stellar RPC.
The agent found a rejection archive collision when two attempts used the same hash.
The server now stores the submission attempt ID before sending and uses it during recovery.
The final focused Astra check found no remaining issue in that recovery path.
The later Chrome run found that offer preparation ignored an existing offer on the signer.
The server now blocks new offers when Horizon lists any existing offer. A live Chrome retry showed that block.

The [local tests](../poc/server.test.mjs) and [live acceptance](../evidence/mobile-poc/live-acceptance.json) are separate evidence.
The iPhone test used Wi-Fi through iPhone Mirroring. It did not prove cellular-only operation.
