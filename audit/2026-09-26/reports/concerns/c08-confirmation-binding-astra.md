# C08 — Horizon confirmation binding

## Assignment and scope

- Assigned model: `gpt-6-astra`; effort: `xhigh`. This report does not independently attest runtime selection.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Scope: `demo/site/app.ts:194-199,681-685,721,751`, including recovery and transaction replacement callers.
- Contract: `docs/PLAN.md:37-39`, `docs/WEB-BRIDGE.md:151-158`, and `docs/CONNECTION-LIFECYCLE.md:19`.
- Original evidence: `reports/05-demo-astra.md`, `checks/05-demo-astra/adversarial.test.ts.txt`, and `checks/coordinator-reproductions.txt`.
- I read no paired concern report. I made no production changes and delegated no work.

## Verdict

**Conditional concern; confirmed response-validation gap. Priority: P3. Severity: Low.**
Confidence is high for the code behavior. Provider-fault occurrence remains unverified.
Affected users are testnet demo users whose trusted Horizon endpoint returns malformed or mismatched successful HTTP responses.
The defect can misreport the original outcome and permit replacement before that outcome is known.
The existing reproductions prove this condition with injected responses. They do not demonstrate an SDF Horizon fault.
I reduce the original Medium severity because the trigger requires faulty trusted data and the application uses testnet.
No evidence establishes key theft, unauthorized signing, automatic resubmission, or mainnet loss.

## Reachable scenario and code coverage

1. A previous submission leaves the journal in `unknown` or `submitting`.
2. The user selects Check. `app.ts:748-751` reads the ledger, then queries the original transaction hash.
3. `horizon()` returns parsed successful HTTP data without runtime validation at `app.ts:194-199`.
4. `confirmed()` accepts that data, changes the state, and saves it at `app.ts:681-685`.
5. `{}` becomes `failed`. A different hash with `successful: true` becomes `submitted`.
6. Both states satisfy `hasFinishedTransaction()` at `app.ts:311-312`.
7. A connected user can start another action through `app.ts:321-329,652-673`.

The POST response reaches the same function at `app.ts:716-721`.
The original hash remains in `pending.hash`; a mismatched response can place another hash in `pending.result.hash`.
Replacement can remove the unresolved active record. A later, separately approved transaction can repeat its intended action.
This requires further user actions. The confirmation check itself neither signs nor submits a transaction.
The source fixes the endpoint to `https://horizon-testnet.stellar.org` at `app.ts:79`.
No normal website setting or bridge response selects another Horizon endpoint.
The macOS signer and 1Password cannot correct this browser confirmation decision after signing.

## Evidence and counterevidence

| Check | Result | Evidence under `checks/concerns/c08-astra/` |
|---|---|---|
| Frozen tree and manifest verification | Passed: 199 tracked files; zero differences | `integrity.json` |
| Existing C08 reproductions | Passed: malformed object and mismatched hash release the record | `reproductions.log` |
| Existing submission controls | Passed: invalid JSON, HTTP 504, and `tx_bad_seq` retain uncertainty | `reproductions.log` |
| Valid submission response | Passed: original envelope and hash complete normally | `reproductions.log` |
| Existing recovery controls | Passed: reload, another-tab protection, and ledger-based expiry | `recovery.log` |
| Live Horizon fault, browser, signing, or submission | `not_run` | No live operation was necessary or authorized |

The test totals are four selected reproduction/control tests and three selected recovery tests, with zero failures.
The first two passing tests demonstrate the defect. They do not establish a fix.
The tests execute frozen application code through the existing VM fixture and replace network requests with local functions.
The SDK uses isolated mock keys. Bun is `1.4.2`; the installed and pinned SDK is `17.1.0`.
The valid HTTPS endpoint is counterevidence against arbitrary remote response injection.
Ordinary timeouts and parse failures do not reproduce the defect. A malformed parsed HTTP success response does.
Existing tests supplied decisive evidence, so I added no test cases and repeated no full baseline suite.

## Minimum mitigation and verification

Validate `confirmed()` input before changing `pending.result`, `pending.state`, or storage.
Require an object that is neither null nor an array, plus these checks:

- `typeof result.hash === 'string'` and `result.hash === pending.hash`.
- `typeof result.successful === 'boolean'`; accept both `true` and `false`.
- `Number.isSafeInteger(result.ledger)` and `result.ledger > 0`.

Reject invalid input with an ordinary error. The POST catch then preserves `unknown`; the status check retains its unresolved state.
Preserve the original hash and XDR, keep Check available, and prevent transaction replacement.
Apply this one guard to both existing callers. No dependency, endpoint option, or new trust service is necessary.
Validate `result_xdr` when offer details use it. Full XDR validation is unnecessary for the confirmation decision itself.
An alternative validates each caller separately. It duplicates the same rule and offers no benefit here.
These checks detect incomplete or mismatched data. They do not prove consensus or defeat a provider that fabricates matching data.

Verification must cover both POST and original-hash GET responses.
Reject `{}`, null, arrays, mismatched hashes, nonboolean outcomes, and missing, noninteger, or nonpositive ledger numbers.
Each rejection must preserve unresolved storage and disable replacement, including after reload.
Matching responses with boolean success and failure must still complete the original transaction.
Retain the existing timeout, 404, ledger-time, and sequence controls. Fix verification remains `not_run`; no implementation was requested.

## Sources, costs, and limits

Preserved primary evidence answers the source questions. Its recorded access date is `2026-09-26`.
The [Horizon transaction object](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/transactions/object) defines the hash, boolean outcome, and inclusion ledger.
Evidence: `research/05-demo-astra/jev/1790472565-4261390e-e50c-47f5-8527-d01249a80789/search-documents/0102.txt`.
The [Horizon error guidance](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling) explains duplicate actions after changed replacement transactions.
Evidence: the same `search-documents/0019.txt`; source provenance appears in `research/05-demo-astra/SOURCES.md`.
These sources apply to the demo's synchronous classic Horizon calls. The deployed Horizon version remains unknown.
I discovered Raven, Parallel MCP, and Perplexity tools. No unresolved source question required new calls or CLI research.
New research cost: **$0 total; $0 Jev**. No new provider call failed or incurred an unknown charge.
Prior evidence records `$0.030209479` Jev usage and unknown other-provider charges; those are inherited costs.
Reproduce these checks with `python3 audit/2026-09-26/checks/concerns/c08-astra/run-checks.py` from the caller repository.
`checks/concerns/c08-astra/commands.json` records every executed test command, working directory, exit code, and log filename.
One concern remains conditional. No review blocker or additional research allocation remains.
