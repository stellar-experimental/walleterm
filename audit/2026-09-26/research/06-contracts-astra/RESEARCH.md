# Research record

Access date: 2026-09-26 EDT, also 2026-09-27 UTC.
The audit used every provider requested in `COMMON.md`.
It sent only public technical questions.
It used the smart-contracts skill and its security reference.
It also read both required Jev and parallel-cli skills, CLI help, and Jev doctor.

## Provider calls

| Provider | Question | Evidence | Outcome and visible usage |
| --- | --- | --- | --- |
| Stellar Raven | Authorization, delegated accounts, and external executables | `raven-discovery.json`, `raven-research.json` | Useful official source discovery; charge unavailable |
| Jev | CAP-71 payload, delegate binding, nonce, replay, and G signatures | `jev-compact.json`, `jev-retry-compact.json`, `jev/` | Partial usable evidence; total reported/reserved cost `$0.032566751` |
| parallel-cli | Pinned OpenZeppelin digest and external Ed25519 formats | `parallel-cli.json` and matching stdout/stderr files | One successful search; `sku_search: 1`; dollar charge unavailable |
| Parallel Search MCP | CAP-85 reference, tag, context compatibility, and stale executable semantics | `parallel-mcp.json` | Useful primary specification; charge unavailable |
| Perplexity MCP | Challenge CAP-71 replay, ordering, and duplicate assumptions | `perplexity.json` | Inconclusive; results missed the requested CAP-71 detail; charge unavailable |

Raven ran first. Its search discovered `stellarDocs.search_docs`.
The following operation read three source groups:

```js
async () => {
  return await Promise.all(
    ['authorization nonce expiration', 'delegated signers', 'external executable']
      .map(query => stellarDocs.search_docs({query, hitsPerPage: 3, includeContent: true}))
  );
}
```

The Jev command used one question. A transport failure required one identical retry.
Both attempts used the same bounded settings:

```sh
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
stellar-raven-jev search 'What exact authorization payload, delegate binding, nonce and replay rules does Stellar CAP-71 use for AddressWithDelegates and classic Ed25519 delegate signatures?' --budget-usd 0.8 --retain-days 0 --bundle --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/jev --host-dir /private/tmp/walleterm-audit-06-jev-host
parallel-cli search --help
parallel-cli search 'Find primary OpenZeppelin Stellar smart account source explaining AuthPayload context_rule_ids digest binding and External Ed25519 verifier encoding at commit a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640.' -q 'OpenZeppelin stellar AuthPayload context_rule_ids auth_digest' --max-results 5 --excerpt-max-chars-total 14000 --json -o /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/06-contracts-astra/parallel-cli.json
python3 audit/2026-09-26/research/06-contracts-astra/fetch-primary.py
```

Jev's first attempt exited `1`, with 3 requests and a charged reservation of `$0.008729397`.
The successful transport retry exited `2`, with 344 requests and reported cost `$0.023837354`.
It scored 294 documents, selected 9, and marked 32 uncertain.
Its 191 diagnostic entries include bounded retrieval, planning omissions, stale indexes, and source limits.
It reported no rate-limited requests. The audit did not retry its partial result.
The audit read the retained official CAP-71 replay text in `search-documents/0063.txt`.
Direct CAP source reads resolved the relevant details.
The parallel-cli sandbox attempt failed with connection errors. Its permitted retry succeeded.
No rate limit triggered a retry. No paid deep-research job ran.

Parallel Search MCP used `model_name: gpt-6-astra` after runtime verification.
Its search queries were `Stellar CAP-85 external executable specification` and `CAP-0085 executable tag authorization context`.
Perplexity used a fast search with four results and `max_tokens_per_page: 1000`.
Its query was `site:github.com/stellar/stellar-protocol CAP-0071 delegated authorization signature preimage duplicates ordering replay protection`.

## Primary sources and applicability

`primary-source-index.json` records exact URLs, access timestamps, file sizes, and SHA-256 hashes for eight direct reads.
`fetch-primary.py` used `curl -fsSL --max-time 30` for each public source.
All eight reads passed.

| Source | Version and retained text | Application |
| --- | --- | --- |
| [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-01.md) | Master snapshot; `cap-0071-01.md` | Address-bound shared payload; sorted unique delegates; explicit delegate authentication |
| [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md) | Master snapshot; `cap-0071-02.md` | V2 address binding; legacy credentials remain distinct |
| [CAP-85](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0085.md) | Master snapshot; `cap-0085.md` | Owner/tag references, storage constraints, executable switches, and context decoding |
| [OpenZeppelin account storage](https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/packages/accounts/src/smart_account/storage.rs) | Pinned commit; `oz-storage.rs` | Exact payload, digest binding, signer membership, and delegated authorization |
| [OpenZeppelin Ed25519 example](https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/examples/multisig-smart-account/ed25519-verifier/src/contract.rs) | Pinned commit; `oz-ed25519.rs` | Raw public-key and signature byte types |
| [OpenZeppelin example account](https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/examples/multisig-smart-account/account/src/contract.rs) | Pinned commit; `oz-account.rs` | Constructor default rule and `AuthPayload` entry point |
| [Simple threshold](https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/packages/accounts/src/policies/simple_threshold.rs) | Pinned commit; `oz-threshold.rs` | Nonzero attainable threshold and authenticated-signer count |
| [Weighted threshold](https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/packages/accounts/src/policies/weighted_threshold.rs) | Pinned commit; `oz-weighted.rs` | Checked weight sum and policy threshold |

The CAP documents describe protocol semantics. They do not prove current network deployment.
The pinned OpenZeppelin files directly match the adapter's declared source version.
Current OpenZeppelin documentation provided corroboration, not pinned implementation authority.
The SDK 17.1.0 local implementation agrees with both authorization preimage variants.
Different provider results for one page count as one source.

## Cost and limits

The initial allocation was `$10`, with Jev limited to `$1`.
Known Jev cost and reserved cost total `$0.032566751`.
Other provider dollar charges were unavailable, so the audit cannot verify the aggregate charge.
No further allocation is necessary for this bounded report.
