# C09: Restored signed envelope consistency

## Assignment

| Field | Value |
| --- | --- |
| Concern | `C09` |
| Model and effort | `gpt-daybreak-blue-latest`, `xhigh` |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Baseline | 199 frozen files; central checks passed |
| Scope | Restored journal parsing, signed-envelope submission, and the Activity verification label |
| Source | `demo/site/app.ts:251-281,618-628,704,719`; `demo/site/activity.ts:181-194` |

## Verdict

Verdict: **conditional**. Priority: **low**.
Confidence is **high** for behavior and **medium** for external storage damage.
The validation gap exists, and the existing test reaches it. No ordinary application path creates the tested mismatch.
The fault needs a coherent altered journal or an incorrect manual restoration.
Affected users are demo users who reload such a journal. The supplied envelope must remain valid for testnet submission.
The concern does not affect `walleterm sign`, the bridge signer, or mainnet.

## Reachable scenario and impact

1. The demo stores a verified signed transaction as one journal value.
2. Another cause replaces `signed_xdr` with a different valid envelope.
3. The stored `state`, `hash`, `xdr`, and metadata remain unchanged.
4. `readJournal()` accepts these fields at `app.ts:251-281`.
5. Reload does not repeat the fresh checks from `app.ts:618-625`.
6. Submission decodes the supplied envelope at `app.ts:704`.
7. Submission sends that envelope at `app.ts:719`.
8. A lost response leaves recovery tracking the old stored hash.

Activity selects `Signature verified` from state at `activity.ts:178-194`.
It decodes the envelope, but it does not verify the signature.
A valid altered envelope can reach the testnet Horizon endpoint. The journal can then track the wrong hash.
This result can hide the submission and keep recovery blocked.
The fault does not create a signature or expose a private key. An unsigned envelope fails transaction authorization.
A valid mismatch needs an existing signature, valid time bounds, and an acceptable sequence.

## Evidence and counterevidence

The existing reproduction passed against the frozen source.
It submitted payment B while the journal retained payment A's hash.
A second test sent unsigned XDR from a restored `signed` record.
The focused command passed five tests, with eight tests filtered.
See `checks/concerns/c09-daybreak/checks.md` for the command and source hashes.

The normal path verifies the transaction hash, signature count, and selected key.
The normal reload test submitted the exact verified envelope.
One `localStorage.setItem()` call saves the journal at `app.ts:246-249`.
The action lock rereads the complete journal at `app.ts:459-470`.

Unreadable JSON and undecodable review XDR block transaction actions.
A failed storage write before submission sends no bytes.
No reviewed source path mixes two valid envelopes.

Accidental browser corruption did not occur in any check. The fault must preserve valid JSON and valid XDR.
A same-origin script can alter the journal.
That script already has the website's intended testnet approval authority.
Journal checks do not form a security boundary against that compromise.

## Minimum mitigation

Validate unfinished restored records inside `readJournal()`.
Reuse one helper for `signed`, `submitting`, and `unknown` states.

Decode `xdr` and `signed_xdr` for `Networks.TESTNET`.
Recompute the transaction hash and compare it with `value.hash`.
Require exactly one signature from `value.address` over that hash.

On failure, use the existing invalid-journal path.
Preserve the stored journal, set `journalBlocked`, and permit Disconnect.

Submit-only validation prevents the wrong POST.
It does not correct the Activity claim or wrong-hash recovery.
An authenticated journal adds complexity but cannot stop same-origin code.

## Exact verification

1. Reload a valid signed journal and submit the same verified bytes.
2. Replace `signed_xdr` with another valid signed envelope.
3. Confirm that reload preserves storage and disables Submit.
4. Test unsigned XDR, an invalid signature, a wrong signer, and multiple signatures.
5. Confirm that each case blocks actions and sends no request.
6. Alter the stored hash and confirm the same blocked result.
7. Repeat the mismatch for `submitting` and `unknown` states.
8. Confirm that Disconnect remains available for every blocked record.

## Research, checks, and limits

No unresolved external fact required new research. New provider cost was `$0`, including `$0` for Jev.
No Parallel, Raven, or Perplexity call ran.

The review reused preserved SDK 17.1.0 evidence and executable tests.
The preserved index cites the [SDK transaction reference](https://stellar.github.io/js-stellar-sdk/reference/core-transactions/), accessed 2026-09-26.

Live signing, testnet submission, and public tunnel checks were `not_run`.
Browser database corruption and same-origin compromise were not simulated. The review changed no production file and added no test.
Concern count: one conditional concern.
