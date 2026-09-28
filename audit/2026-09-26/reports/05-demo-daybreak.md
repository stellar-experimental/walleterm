# 05 Demo audit — Daybreak

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Conclusion

The audit found one low-severity concern.
The main transaction, signing, submission, and journal controls are conservative.
The signed journal needs another validation and display step before submission.

## Scope

- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Model and effort: Daybreak, xhigh, as assigned.
- Review mode: independent, read-only, and offline.
- The review did not read another area report before this report.
- The review changed no runtime source, dependency, configuration, or Git state.

## Code coverage

| Area | Files and lines | Result |
| --- | --- | --- |
| Construction and review | `demo/site/app.ts:77-92,194-310,488-562` | Traced |
| Signing result | `demo/site/app.ts:564-650` | Traced |
| Submission recovery | `demo/site/app.ts:681-771` | Traced |
| Durable journal | `demo/site/app.ts:246-281,311-472,785-800` | Traced |
| Activity accuracy | `demo/site/activity.ts:33-304,325-524` | Traced |
| Demo service | `demo/server.ts:8-94` | Traced |
| Browser adapter | `sdk/walleterm.ts:264-385` | Traced dependency |
| Bridge byte limits | `bridge/transaction.ts:11-132` | Traced dependency |
| Tunnel origin changes | `bridge/launch.ts:279-415` | Traced dependency |
| Tests | Three assigned files and selected server tests | Executed |

The review read `README.md`, `docs/PLAN.md`, and `docs/INTERFACE.md`.
It also read the bridge, activity, and connection lifecycle documents.

## Finding 1: Low — the signed journal is not revalidated or fully shown before submission

Severity: low. Confidence is high for the display gap. Confidence is medium for the damaged-storage consequence.

Files: `demo/site/app.ts:251-281,400-416,618-629,701-720`.

### Reachable scenario

The user signs a reviewed transaction. The journal changes to `signed`. The user closes the review or reloads.

The reopened review shows the network, wallet, recipient, and stored hash. It omits the operation, fee, sequence, memo, and time bounds.
Line 408 includes `transaction` only for the `review` state.

The status still requests review at line 629. `readJournal()` decodes XDR only for the `review` state.
It does not revalidate `signed_xdr` after a reload.

The submit handler checks time bounds. It then posts the envelope without comparing its hash to `pending.hash`.

### Impact

The user cannot recheck the exact signed body before the separate submission action.
A damaged journal can show stale metadata for another valid envelope. This case requires valid altered browser storage.
The actual impact remains limited to Stellar testnet.

### Evidence

- The pre-sign review includes `describe(pending.xdr)` at `demo/site/app.ts:408`.
- The signed state omits that object at the same line.
- The live signing path compares the returned hash at `demo/site/app.ts:618-625`.
- That comparison does not run during restoration at `demo/site/app.ts:785-787`.
- Submission uses `pending.signed_xdr` at `demo/site/app.ts:704-720`.
- No assigned test covers a recovered signed-envelope mismatch.

### Counterevidence

The user gets a full review before Sign. The live result must keep the original transaction hash.
The live path also requires one valid signature from the selected wallet.

Normal journal writes are synchronous and coherent. The bridge accepts only one bounded testnet operation.
These controls reduce this concern to low severity.

### Minimum mitigation

Always show `describe(pending.xdr)` for every readable journal state. Revalidate it during every journal restoration.

For `signed`, decode `signed_xdr` before enabling Submit. Compare its hash with `pending.hash`.
Require one signature from `pending.address` over that hash.

Preserve the journal and block submission when validation fails.

### Verification plan

Use isolated mock keys only.
Reload a valid signed journal and confirm that all reviewed fields remain visible.
Replace `signed_xdr` with another valid signed envelope.

Confirm that reload preserves the journal and disables Submit.
Confirm that a valid recovered envelope submits the same verified bytes.

## Confirmed non-issues

- The demo saves `review` before any signing request. Sign remains an explicit action.
- The bridge rejects public-network XDR and unsupported operation shapes.
- The demo verifies the returned transaction hash and Ed25519 signature.
- The SDK retries only an identical request ID. It never retries the signer.
- The demo saves `submitting` before it sends the Horizon request.
- It treats transport, `5xx`, `504`, and `tx_bad_seq` outcomes as uncertain.
- It stores definitive Horizon `400` failures with their result code.
- Unknown recovery reads the latest ledger before the transaction hash.
- It requires ledger time after `maxTime` and an unconsumed sequence.
- The recovery path never automatically resubmits.
- Web Locks serialize journal mutations across tabs.
- The stale-record comparison protects an unknown submission from another tab.
- Malformed journals block transaction actions but still permit disconnection.
- Activity preserves state snapshots and collapses unchanged signing polls.
- Activity redacts connection credentials and never records request headers.
- The testnet USDC issuer matches current official Stellar documentation.

## Accepted limits

Quick Tunnel replacement changes the demo origin.
Browser storage stays with the old origin.
`docs/CONNECTION-LIFECYCLE.md:37-40` states this limit and gives recovery guidance.

The activity log and journal remain separate stores.
Activity failure cannot change a wallet request or transaction outcome.

The demo supports testnet only.
It is not a production wallet or mainnet submission path.

## Feature opportunities

- A stable named hostname would preserve browser storage across tunnel replacement.
- The documentation already lists named tunnels as future work.
- Automatic read-only hash polling could reduce manual recovery steps.
- It must retain the current no-resubmission rule.

Neither opportunity changes this audit finding count.

## Checks

The targeted demo suite finished with 39 passed and zero failed.
One listener test first failed because the socket sandbox blocked port `0`.
Its permitted rerun passed.

Three selected server tests passed.
They covered exact review fields, invalid signatures, and identical-request retry.
The relevant source hashes stayed unchanged after testing.

Detailed evidence: `checks/05-demo-daybreak/targeted-results.md`.
Central Go race, Go vet, TypeScript, 224 Bun tests, and three contract self-tests already passed.
The Rust summary recorded 30 passing tests. I did not repeat the complete central suites.

## Research

Stellar Raven MCP returned relevant official Stellar source text.
Parallel Search MCP returned one `sku_search` result set.
`parallel-cli` returned one browser-platform result set.
Perplexity returned a challenge pass with official Stellar sources.

Jev failed during routing and returned no source documents.
Jev recorded `$0.008729397` of visible spend.
Other provider charges remain unknown.

Detailed evidence: `research/05-demo-daybreak/research-summary.md`.

## Primary sources

- [Horizon error handling](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling), accessed 2026-09-26.
- [Transaction failure](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/transaction-failed), accessed 2026-09-26.
- [Transaction validity](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions), accessed 2026-09-26.
- [Transaction lifecycle](https://developers.stellar.org/docs/learn/fundamentals/transactions/transaction-lifecycle), accessed 2026-09-26.
- [Submit endpoint](https://developers.stellar.org/docs/data/apis/horizon/api-reference/submit-a-transaction), updated 2026-06-17.
- [Testnet USDC](https://developers.stellar.org/docs/build/agentic-payments/x402/quickstart-guide#step-3-expanded-establish-usdc-trustline), accessed 2026-09-26.
- [Web Locks API](https://w3c.github.io/web-locks/), Editor's Draft 2025-09-24.
- [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage), modified 2025-11-30.

## Limits

- Live signing: `not_run`.
- Live testnet submission: `not_run`.
- Public tunnel startup: `not_run`.
- 1Password key-field access: `not_run`.
- Jev evidence: `failed`.
- Source-review blocker: none.
