# Overall review research

Access date: 2026-09-27 UTC. The review used all five requested research surfaces.
The review reused settled primary evidence from the area and focused reports.
No further research is necessary for the substantive assessment.
Search results do not establish provider incidents or complete coverage.

## Soroban authorization: Raven and Jev

Question: Does signing authorize the complete invocation tree, and does provider-supplied expiration independently bound its lifetime?
Raven discovered `stellarDocs.search_soroban_contract_docs` and `stellarDocs.search_docs` before execution.
The queries used `authorization tree` and `signatureExpirationLedger`, with full section content.
Evidence: `raven-discovery.json` and `raven.json`.
Jev asked one scoped question. Its successful transport retry returned partial evidence.

Read primary material:

- [Authorization](https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization).
- [Authorization XDR](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction#authorization-data).
- [Transaction simulation](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation).
- [Signing Soroban invocations](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations).

The host authenticates the signed tree and checks its nonce and expiration.
Recording simulation collects authorization requirements. Enforcing simulation checks signatures after their creation.
These facts support checking all expected trees before any signer callback.
They do not prove a hostile RPC incident or live acceptance of the synthetic changed tree.
Inference: a ledger value from the challenged RPC cannot independently prove a short remaining lifetime.
The complete authorized effects, network, nonce, and expiration still constrain the signature.
An envelope failure cannot revoke an already disclosed authorization signature.

Applicability: the frozen JavaScript SDK is `17.1.0`.
Actual Cargo locks specify SDK `27.0.2` for CAP-71, `27.0.6` for base/legacy, and `28.0.0` for current CAP-85.
The coordinator's `checks/locked-soroban-versions.json` agrees with all four frozen locks.
The reviewed fixture code uses the documented authorization entry and simulation structures.
CAP-71 and CAP-85 already validate their expected roots in the inspected paths.
The ordinary contract helper lacks equivalent complete intent validation.
This review does not claim that current documentation establishes a deployed network protocol version.

Read text lives under `jev/1790482309-a4b85cf3-32a1-41db-b3cc-63d3d56535b1/search-documents/`.
Relevant files: `0001.txt`, `0018.txt`, `0101.txt`, and `0128.txt`.
The full selected-document inventory was inspected because compact output omitted selected results.
Raven and Jev returned overlapping primary pages. Those pages count once as underlying evidence.

## Fixture build provenance: Parallel Search MCP

Evidence: `parallel-mcp.json`; one `sku_search` unit.
Read [Git diff documentation](https://git-scm.com/docs/git-diff).
The documentation distinguishes working-tree, index, and commit comparisons.
Applicability: `fixtures/build.sh:19` checks `HEAD`, then compiles the cached working tree.
That check does not establish unchanged tracked source.
Require both staged and unstaged tracked changes to be absent before compilation.
An untracked-input policy could extend protection. It is not necessary for the demonstrated tracked-edit correction.
The retrieved versioned `2.16.6` page added no necessary evidence. The current command documentation supplies the relevant semantics.

## Camera cleanup: parallel-cli

Evidence: `parallel-cli.json`; one successful `sku_search` unit.
Read [W3C Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams).
The result identifies publication date `2025-10-09`.
The specification describes explicit track stopping and source shutdown after all dependent tracks end.
It does not promise that removing an application component stops its tracks.
Applicability: `sdk/scan.ts` already stops acquired tracks when its signal aborts.
It also stops tracks after a late permission grant when that signal already aborted.
Therefore, aborting the component-owned signal reuses existing cleanup.
This conclusion does not claim that an AbortSignal cancels the browser's permission prompt.
The three historical draft results, from 2012–2014, were discarded.

## C07 deployment challenge: Perplexity MCP

Evidence: `perplexity.json`; one fast search, four results.
Read the returned primary excerpts:

- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
- [Cloudflare Tunnel troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/).
- [Cloudflare 401 responses](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-401/).

Quick Tunnel documentation describes proxying to localhost and a `429` concurrency limit.
Troubleshooting describes origin failures as `502` and tunnel disconnection as `1033`.
The generic `401` page describes authentication requirements.
None demonstrates the non-JSON `401` producer required by C07 in the shipped deployment.
The Sandbox SDK result describes application authentication in another product. It does not establish Walleterm behavior.
Conclusion: deployment occurrence remains inconclusive. Optional status-first parsing remains a small compatibility improvement.

## Failures, cost, and stopping

Jev first returned exit `1`, no documents, three lost evidence reports, and a `$0.008729397` charge or reservation.
The permitted retry returned exit `2`, 29 selected results, eight cut source families, and eight lost evidence reports.
It reported `$0.014946393`, zero scoring failures, and zero currentness failures.
Zero currentness failures do not prove currentness. The report assessed zero documents for currentness.
Original reads reported four attempts: one used, one failed, and two refused. Eight eligible reads were capped.
Combined visible Jev cost or reservation: `$0.023675790`; 297 reported requests.
The Jev retry budget was `$0.90`. No rate-limit retry occurred.
The first Parallel CLI run failed with a transport error and exit `4`.
Its permitted retry succeeded with exit `0`. Provider billing for the failed transport remains unknown.
Raven, Parallel MCP, and Perplexity succeeded, but they returned no dollar totals.
The authorized overall cap is `$10`, including at most `$1` for Jev.
The total provider invoice remains unverified. Unknown charges are not reported as zero.
No deep-research processor, added credits, private input, or further paid retry was used.
Machine-readable usage appears in `usage.json`.
