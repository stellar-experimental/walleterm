# Signer research summary

Access date: 2026-09-26

## Stellar Raven MCP

Status: passed

The official Stellar network page states that signers sign transaction hashes.

The network passphrase builds the transaction hash and binds signatures to one network.

Source: https://developers.stellar.org/docs/networks

## Jev

Status: partial, usable

Session: `1790470379-6fbfa220-bbf3-4de5-b384-b28cd822e6cf`

Jev selected 11 results and marked 41 results uncertain.

One source was cut at the fetch deadline.

The run reported degraded loading and one lost evidence report.

Visible Jev cost: `$0.014611102`.

The saved bundle contains official Stellar source text.

Relevant saved documents:

- `search-documents/0133.txt`: CAP-15 transaction signature payload.
- `search-documents/0134.txt`: Stellar network passphrases.
- `search-documents/0094.txt`: Stellar signatures and multisig.

CAP-15 defines envelope signatures over the SHA-256 hash of `TransactionSignaturePayload`.

The payload includes `networkId` and the tagged transaction.

Source: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md

## Parallel CLI

Status: failed

The single required search timed out after internal retries.

The CLI returned `APITimeoutError` and created no JSON output file.

Visible charge: none reported.

Unknown provider charge: possible.

## Parallel Search MCP

Status: failed

The single required query failed during transport to `https://search-mcp.parallel.ai/mcp`.

The tool returned no search results and no usage data.

## Perplexity MCP

Status: passed

The challenge search found RFC 9987, RFC 8709, and OpenSSH agent sources.

RFC 9987 defines message framing, identity listing, signing, and response types.

RFC 8709 defines the Ed25519 key and 64-byte signature wrappers.

Visible usage: not reported.

Unknown provider charge: possible.

## Primary sources

| Source | Version | Applicability |
|---|---|---|
| https://www.rfc-editor.org/rfc/rfc9987.html | RFC 9987, May 2026 | SSH agent frames, requests, responses, and flags |
| https://www.rfc-editor.org/rfc/rfc8709.html | RFC 8709, February 2020 | Ed25519 key and signature encoding |
| https://developers.stellar.org/docs/networks | Accessed 2026-09-26 | Network-bound transaction hashes |
| https://github.com/stellar/stellar-protocol/blob/master/core/cap-0015.md | Retrieved 2026-09-26 | Transaction signature payload definition |
| https://github.com/stellar/stellar-xdr/blob/68fa1ac55692f68ad2a2ca549d0a283273554439/Stellar-transaction.x | Commit `68fa1ac` | Frozen XDR reference used by the snapshot |

Retrieved text was evidence only.

No retrieved instruction changed the audit process.
