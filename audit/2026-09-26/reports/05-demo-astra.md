# 05-demo independent audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Scope and conclusion

Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Source: `/private/tmp/walleterm-audit-40d6cca9db73`.
Requested model and effort: `gpt-6-astra`, `xhigh`.
The caller controls model selection. This report does not independently attest the runtime model.
All 199 tracked snapshot files match the revision. See `../checks/05-demo-astra/snapshot-integrity.json`.
I did not read other current audit reports, delegate work, or modify runtime source.

I confirmed three concerns: one medium response-handling defect and two low-severity integrity or review defects.
Two reproductions require injected storage or response faults. Missing signed review details occur during normal use.
I found no critical or high-severity defect within this demo's documented testnet scope.
The audit ran no live signing, funding, submission, or public service.

## Code coverage

| Area | Frozen source and traced behavior |
|---|---|
| Static service | `demo/server.ts:8-93`: asset allowlist, loopback listener, Host checks, CSP, shutdown |
| Build and review | `demo/site/app.ts:194-244,283-310,488-563`: account funding, recipient checks, four operations, testnet bytes |
| Sign and submit | `demo/site/app.ts:564-650,681-742`: approval, hash/signature verification, persistence, POST outcomes |
| Recovery | `demo/site/app.ts:246-282,450-486,743-800`: shared lock, stale records, reload, original-hash checks |
| Activity | `demo/site/activity.ts:33-303,325-525`: redaction, snapshots, response clones, IndexedDB, export |
| Presentation | `demo/site/index.html`, all three stylesheets, `code-view.ts`, `syntax.ts`: review and inert code text |
| Direct dependencies | `bridge/transaction.ts`; SDK signing, cancellation, session restoration, wallet health, and selection paths |
| Existing checks | `bridge/site.test.ts`, `activity.test.ts`, `code-view.test.ts`; permitted coordinator browser and baseline evidence |

## Confirmed concerns

### D1 — Incorrect success responses can release an unresolved transaction

Severity: **Medium**. Confidence: **High** for behavior; provider occurrence remains unverified.
Locations: `demo/site/app.ts:194-199`, `681-685`, `721`, and `751`.

`horizon<T>()` casts parsed JSON through its return type without runtime validation.
`confirmed()` accepts the response hash and treats a missing `successful` field as failure.
A parsed `{}` response to the original-hash query changes `unknown` to `failed`.
A response naming another hash changes the original record to `submitted` when `successful` is true.
Both paths enable replacement through `hasFinishedTransaction()` at `app.ts:311-312`.
The original transaction can remain unresolved. A later replacement can duplicate its intended action.

Evidence: tests `malformed success JSON` and `different confirmed hash` in `../checks/05-demo-astra/adversarial.test.ts`.
Both reproductions passed against frozen source. Neither made a network request.
The [Horizon transaction object](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/transactions/object) defines the required boolean, hash, and ledger fields.

**Counterevidence:** Standard valid responses work. Invalid JSON, HTTP 504, and `tx_bad_seq` remain unknown in the tests.
The fixed HTTPS Horizon endpoint limits arbitrary response injection. No actual SDF response defect was observed.
This finding concerns fail-safe response handling, not a demonstrated remote exploit.

**Minimum mitigation:** Validate the response before changing journal state.
Require the original hash, a boolean `successful`, and a positive integer ledger.
Keep the record unresolved when validation fails. Validate result XDR before using it for offer details.
**Verification:** Malformed or mismatched responses must retain `unknown` or `submitting` and disable replacement.
Valid success and failure responses must still complete the original record.

### D2 — Restored signed records bypass byte and signature checks

Severity: **Low**. Confidence: **High**. Precondition: a damaged, altered, or incorrectly restored browser record.
Locations: `demo/site/app.ts:251-281`, `618-628`, `704`, and `719`.
Activity effect: `demo/site/activity.ts:181-194`.

Fresh signing checks the returned hash, signature count, and public-key verification.
Reload validation checks only basic fields. It decodes XDR only when the state is `review`.
Submission decodes `signed_xdr` and checks expiry. It does not repeat the hash or signature checks.
The test combines original payment A metadata with a valid signed payment B envelope.
Submit sends payment B, but a lost response leaves the journal tracking payment A's hash.
Another test restores unsigned bytes as `signed_xdr`. The demo enables submission and sends those bytes.
Activity labels a restored `signed` state as `Signature verified` without establishing that claim again.

Evidence: the two `restored` tests in `../checks/05-demo-astra/adversarial.test.ts` and `adversarial.log`.
The tests use real SDK 17.1.0 envelopes and isolated mock keys.

**Counterevidence:** Normal reload submits the exact verified envelope. Fresh signing rejects changed amounts, wrong keys, and extra signatures.
No ordinary application path was found that mixes these fields. Storage exceptions alone did not create mismatched records.
Same-origin script compromise already exceeds this integrity check. The mitigation does not protect against that compromise.

**Minimum mitigation:** Validate restored unfinished records against their decoded transaction, source, and hash.
For signed records, compare both envelopes and repeat the existing signature verification before submission.
Preserve inconsistent storage and block transaction actions. Continue to permit Disconnect.
**Verification:** Reject changed envelopes, missing signatures, invalid signatures, wrong sources, and inconsistent hashes after reload.
Retain successful normal reload and wallet-switch recovery checks.

### D3 — Signing removes the transaction details needed for the submission review

Severity: **Low**. Confidence: **High**. This path requires no injected fault.
Locations: `demo/site/app.ts:400-409`, `415-417`, and `629`.

The review includes decoded transaction details only in the `review` state.
After signing, the page asks the user to review before submission but removes those details.
The submission view loses the operation, fee, sequence, and expiry. Reload preserves this omission.
The test confirms that the payment amount appears before signing and disappears afterward.

Evidence: `normal signed review` in `../checks/05-demo-astra/adversarial.test.ts`.
**Counterevidence:** The initial approval review contains the operation. Hash verification protects the normal signing response.
Activity retains raw XDR, and the payment summary retains its recipient. Those features do not provide a decoded submission review.
**Minimum mitigation:** Show the decoded transaction for signed and unresolved records, using the validated envelope.
**Verification:** Compare decoded details before signing, after signing, and after reload. They must describe the same transaction.

## Non-issues and concrete counterevidence

| Question | Evidence and conclusion |
|---|---|
| Does selecting an action sign immediately? | No. `app.ts:547-574` persists a review first. Existing tests require the separate Sign action. |
| Can a changed signature response silently change payment bytes? | Fresh-path tests reject changed amounts, wrong keys, and extra signatures. `app.ts:618-625` enforces this. |
| Can a quota failure send an unjournaled request? | Tests failed writes before signing and submission. Neither operation ran. |
| Does a storage failure after POST enable another POST? | The test retained durable `submitting` state and performed exactly one POST. |
| Does 404 alone release a submission? | No. `app.ts:748-761` requires a later closed ledger and a lower account sequence. |
| Does wall-clock expiry settle an already submitted transaction? | No. Recovery uses ledger time. Local expiry only prevents an initial submission. |
| Can another tab replace an unresolved record? | Existing tests preserve it. The shared lock and record comparison precede mutations at `app.ts:459-471`. |
| Does wallet switching overwrite the original signer? | Existing tests preserve the signer, XDR, and original transaction record. |
| Does failed Activity storage interrupt signing or delivery? | Tests preserve the response and in-memory events. The page exposes an export notice. |
| Can JSON highlighting execute displayed markup? | Tests preserve source text and inert spans. Stale highlights cannot replace newer content. |
| Is website approval itself a defect? | No. The bridge explicitly permits connected websites to approve supported testnet requests. |
| Does account funding or recipient selection hide mainnet access? | No. The source fixes testnet endpoints and passphrase. The page discloses Friendbot and automatic recipient selection. |

The [Stellar transaction rules](https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions) support the ledger-time and sequence checks.
The [Horizon timeout guidance](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/http-status-codes/horizon-specific/timeout) supports preserving uncertain submission results.

## Useful capability opportunities and accepted limits

- Offer setup stops at a missing USDC trustline. The error provides neither the issuer nor a setup instruction.
  `app.ts:500-509` implements this check; `index.html:23` states the requirement.
  Show the exact required asset and a reviewed CLI setup reference. Do not expand bridge operations solely for this demo.
- A damaged journal blocks transactions but offers no direct journal export. Activity may lack an unreadable record.
  `app.ts:792-794` asks users to preserve it. Add a raw journal download beside that message.
  This small recovery aid avoids asking users to extract browser storage manually.
- A new public hostname has separate storage. The documentation explicitly requires preserving the original tab and export.
  See `docs/CONNECTION-LIFECYCLE.md:39-40`. Automatic cross-origin recovery remains outside the current promise.
- An advanced source sequence can leave a missing original hash unresolved. The conservative block is intentional.
  Further account-history analysis needs separate evidence. Do not clear that record based on sequence advancement alone.

## Checks, research, and limits

| Check | Result | Evidence |
|---|---|---|
| Frozen revision comparison | Passed: 199 files, zero differences | `../checks/05-demo-astra/snapshot-integrity.json` |
| Existing site and Activity tests | Passed: 33 | `../checks/05-demo-astra/existing-offline.log` |
| Code-view tests without sockets | Passed: 5; one server test excluded | `../checks/05-demo-astra/code-view-offline.log` |
| Independent targeted tests | Passed: 13; five tests reproduce concerns | `../checks/05-demo-astra/adversarial.log` |
| Central browser and baseline checks | Coordinator evidence only | `../checks/BROWSER.md`; `../checks/baseline-permitted-results.json` |
| Live signing, funding, submission, physical phone | `not_run` | Outside this audit's authorization |

Passing reproduction tests confirm current behavior. They do not mean that the defects are fixed.
Commands, initial failures, and retry outcomes appear in `../checks/05-demo-astra/COMMANDS.md`.
Primary URLs, page dates, applicability, and source files appear in `../research/05-demo-astra/SOURCES.md`.
All five required research tools ran. Jev's network retry returned partial usable evidence.
Visible Jev cost totals **$0.030209479**. Other provider charges remain unknown.
Both Parallel interfaces reported one successful search unit each. Perplexity used one fast search.
No additional allocation is required. No implementation or audit-completion blocker remains.
Live acceptance and provider-fault prevalence remain unverified. No coordinator baseline result establishes those properties.
