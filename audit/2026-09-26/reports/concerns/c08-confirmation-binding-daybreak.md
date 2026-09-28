# C08 confirmation binding review

## Assignment

| Field | Value |
|---|---|
| Concern | C08: malformed or mismatched Horizon confirmation data |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Model and effort | `gpt-daybreak-blue-latest`, `xhigh` |
| Baseline | Central Go, Bun, TypeScript, vet, and contract checks passed |
| Source scope | `demo/site/app.ts:35-40,79,194-199,311-312,653-672,681-721,743-769` |

I reviewed only C08 and its named original evidence.
I did not read the paired C08 report or change runtime source.

## Verdict

Verdict: **Conditional, with a confirmed validation defect**.
Priority: **Medium correctness priority**.
Confidence: **High for code behavior and low for external occurrence**.
The demo trusts a successful HTTP response without binding it to the original transaction.
No evidence shows that the SDF Horizon service returned such a response.
Affected users are testnet demo users who receive a malformed or mismatched HTTP 2xx transaction response.
The defect does not show key theft, unauthorized signing, mainnet loss, or public exposure.

## Reachable scenario

`HORIZON` is fixed to `https://horizon-testnet.stellar.org` at `demo/site/app.ts:79`.
The generic `horizon<T>()` function trusts parsed JSON at `demo/site/app.ts:194-199`.
The user checks the original hash through `demo/site/app.ts:743-751`.
The direct submission path uses the same confirmation function at `demo/site/app.ts:716-721`.
`confirmed()` copies unchecked fields at `demo/site/app.ts:681-685`.
An empty object changes the state to `failed` because `successful` is undefined.
A successful response for another hash changes the original state to `submitted`.
Both states are terminal under `demo/site/app.ts:311-312`.
The next action can replace that record through `demo/site/app.ts:653-672`.
A user must still create, sign, and submit the replacement.
The original transaction can remain unresolved during those actions.
A later successful original can duplicate the user's intended testnet action.
This behavior violates the documented original-hash recovery contract.
See `docs/CONNECTION-LIFECYCLE.md:17-19` and `docs/DEMO-ACTIONS.md:12-17`.

## Evidence and counterevidence

The targeted mock check passed two reproductions and one valid-response control.
The empty object and mismatched-hash cases caused unsafe terminal transitions.
Exact commands appear in `../../checks/concerns/c08-daybreak/checks.md`.
The endpoint is fixed, uses HTTPS, and targets only Stellar testnet.
The test injected responses through an in-memory `fetch` mock.
It did not demonstrate an SDF Horizon fault or a network attack.
Malformed JSON throws before `confirmed()` runs.
Preserved tests keep HTTP 504 and `tx_bad_seq` results unresolved.
The journal lock cannot correct a falsely terminal confirmation.
No automatic replacement, signing, or submission occurs.

## Minimum mitigation

Add one small runtime validator before `confirmed()` changes `pending`.
Require a non-array object and an exact `result.hash === pending.hash` match.
Require `typeof result.successful === 'boolean'`.
Require `Number.isSafeInteger(result.ledger)` and `result.ledger > 0`.
Any core-field validation failure must occur before journal mutation or saving.
The submission path must then retain `unknown`.
The recovery path must retain its existing unresolved state.
For a successful offer, validate `result_xdr` before interpreting offer details.
Handle an offer-detail decoding failure separately from the confirmed final state.
Do not add a configurable endpoint, automatic retry, new journal state, or schema dependency.

## Exact verification steps

1. Return `{}` for the original-hash query; require `unknown` and disabled replacement.
2. Return another transaction's hash; require the same unresolved behavior.
3. Test missing, string, zero, negative, fractional, and unsafe `ledger` values; require unresolved states.
4. Test missing and non-boolean `successful` values; require unresolved states.
5. Test matching-hash success and failure objects; require their correct terminal states.
6. Repeat the mismatch through POST; require `unknown` without journal release.
7. Test invalid offer `result_xdr`; require safe detail failure without recovery corruption.

## Primary sources and costs

The Horizon transaction object defines `hash`, `successful`, `ledger`, and `result_xdr`.
Source: https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/transactions/object.
The preserved page reports a 2025-12-19 page date.
Horizon guidance requires polling the transaction hash after an uncertain submission.
It warns that changed replacement transactions can duplicate actions.
Source: https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling.
Access date for preserved evidence: 2026-09-26.
I made no new research calls because preserved primary evidence answered the question.
New research cost was `$0.00`, including `$0.00` for Jev.
Preserved evidence reports `$0.030209479` in prior visible Jev charges.
Other preserved provider charges remain unknown.

## Limits

Live Horizon behavior, live signing, funding, submission, and public services were `not_run`.
No evidence establishes the prevalence of malformed provider responses.
The check used isolated mock keys and made no network request.
Adjacent response schemas and other audit concerns were outside this review.
No implementation blocker remains; live provider-fault prevalence remains unverified.
