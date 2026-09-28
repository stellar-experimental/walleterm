# C10: Decoded transaction details before submission

## Assignment

- Concern: `C10`.
- Model and effort: Daybreak, `xhigh`, as assigned.
- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Baseline: central permitted checks passed.
- Source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Scope: `demo/site/app.ts:400-417,629` and its normal reload path.

I did not read the paired C10 report, change production source, or delegate work.

## Verdict

Verdict: **confirmed**.
Priority: **low**.
Confidence: **high**.

All successful demo signing flows reach the affected state.
The same display gap returns after a normal reload.
Direct CLI users, third-party sites, mainnet users, and bridge signing rules are unaffected.

C10 affects review clarity before testnet submission.
It does not show changed bytes, unauthorized signing, or unauthorized submission.

## Reachable scenario

1. The demo builds a transaction and shows its decoded fields.
2. The user reviews those fields and selects `Sign`.
3. The demo verifies the result, changes to `signed`, and requests another review.
4. The decoded transaction disappears while `Submit to testnet` appears.
5. A reload restores `signed` and repeats the same display.

This scenario needs no storage fault, provider fault, or attacker.

## Exact source evidence

- `demo/site/app.ts:290-309` defines the decoded transaction view.
- `demo/site/app.ts:400-414` includes it only when the state equals `review`.
- `demo/site/app.ts:415-417` shows and enables submission for `signed`.
- `demo/site/app.ts:618-628` verifies the fresh signing result and stores `signed`.
- `demo/site/app.ts:629` asks for another review before submission.
- `demo/site/app.ts:785-799` renders and opens an unfinished restored journal.

`README.md:105-107` promises pre-sign review, while `app.ts:629` promises post-sign review.

## Checks and evidence

The frozen source hashes match `audit/2026-09-26/manifest.json`.
The filtered Bun run passed two relevant tests with zero failures.
The signing test confirms the normal display gap.
The reload test confirms submission uses the exact stored signed envelope.
Static tracing confirms that `signed` still omits decoded details after reload.

See `checks/concerns/c10-daybreak/RESULTS.md` for commands and outcomes.

## Counterevidence

The user sees all decoded fields before selecting `Sign`.
Fresh signing verifies the returned transaction hash and one selected-wallet signature.
The summary still shows the network, wallet, recipient, state, and hash.

Therefore, C10 is not a transaction-integrity failure.
The impact is a missing second review at a consequential action boundary.

## Minimum mitigation

At line 408, include `signed` with `review`.
Continue to render `describe(pending.xdr)` for these two states.
This change restores the promised review without changing signing or submission trust.
It needs no new decoder, dependency, setting, confirmation, or workflow step.

Do not only change the status text.
That change removes a useful review instead of restoring it.
Displaying `signed_xdr` is broader and needs separate restored-journal validation.

## Verification steps

1. Capture the decoded review object for each supported demo action.
2. Sign with an isolated mock key and compare the displayed object.
3. Reload a valid `signed` journal and compare the displayed object again.
4. Confirm that submission stays visible and transaction bytes remain unchanged.

## Primary sources and research usage

The frozen source, product documents, manifest, and reproductions decide C10.
No external protocol fact remains unresolved.
I made no Raven, Jev, Parallel, `parallel-cli`, or Perplexity call.

New visible research and Jev costs: **$0**.
Unknown provider charges: **$0**, because no provider call occurred.

## Limits

- Live 1Password signing: `not_run`.
- Live testnet submission: `not_run`.
- Public tunnel and phone checks: `not_run`.
- New test creation: unnecessary because existing evidence was decisive.
- Review blocker: none.
