# C10 — Decoded transaction details before submission

## Assignment and scope

- Reviewer: `gpt-6-astra`; effort: `xhigh`, as assigned.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Assigned source: `demo/site/app.ts:400-417,629`.
- Ownership: this report and `checks/concerns/c10-astra/` only.
- Original reports read: `reports/05-demo-astra.md` and `reports/05-demo-daybreak.md`.
- I did not read the paired concern report, delegate, or change production files.

## Verdict

**Confirmed. Priority P3; severity Low; confidence High. Concern count: 1.**
The demo removes decoded details after signing, while its status requests another transaction review.
Normal reopening and reload preserve this omission. No damaged storage or hostile response is necessary.
Affected users are demo users who inspect a signed testnet transaction before selecting Submit.
The shared rendering condition affects all four demo actions. The executable reproduction uses a native payment.
This limits the promised submission review. C10 does not establish unauthorized signing, changed transaction bytes, or mainnet loss.

## Reachable behavior and coverage

| Frozen reference | Evidence |
|---|---|
| `demo/site/app.ts:283-309,538-562` | Construction saves an unsigned review. `describe()` includes the operation, fee, sequence, memo, and time bounds. |
| `demo/site/app.ts:400-417` | Only `review` includes `transaction`. The `signed` state exposes Submit without those details. |
| `demo/site/app.ts:564-629` | Sign is explicit. Successful verification saves `signed` and asks the user to review before submission. |
| `demo/site/app.ts:155-163,251-281,785-800` | Reopening and reload use the same renderer. An unfinished saved transaction opens automatically. |
| `demo/site/app.ts:701-720` | Submit uses `pending.signed_xdr` after checking expiry. |
| `demo/site/code-view.ts:70-103` | Expanding details renders the latest JSON. Expansion cannot recover omitted fields. |
| `docs/DEMO-ACTIONS.md:3-10,19-20` | The modal promises retained details and reload access. It belongs to the demo website. |

The user first sees decoded details and selects Sign.
The normal result passes verification and changes the state to `signed`.
The next render removes `transaction`; reopening the modal does not restore it.
A reload reads the unchanged signed journal and produces the same reduced JSON.
The signed envelope still contains the omitted fields. The defect concerns their display.

## Evidence and counterevidence

I inspected the preserved reproduction and `checks/coordinator-reproductions.txt` before adding a reload check.
The new check uses the preserved fixture and frozen app, with real SDK envelopes and isolated mock keys.
It removes `signed_xdr` from the initial review, then obtains it through the mocked normal signing response.
It confirms identical decoded bodies before signing, after signing, and after reload.
It also confirms missing displayed details, an enabled Submit button, unchanged stored bytes, and zero network calls.
The fixture mocks the DOM, storage, connection, and Web Locks. It does not establish physical-browser acceptance.

- The initial review contains the transaction details. Sign remains a separate approval action.
- Fresh signing verifies the original hash, exactly one signature, and the selected public key at `app.ts:618-625`.
- Preserved tests reject changed bytes, a wrong signing key, and extra signatures.
- The normal reload submission test sends the exact verified envelope and retains its original hash.
- Fixed payment and offer titles retain their headline amounts at `app.ts:136-140,368-369`.
- Network, wallet, payment recipient, and hash remain available at `app.ts:388-408`.
- Activity retains raw XDR at `activity.ts:191-194,409-416`; `app.ts:82-90` decodes only its hash and signatures.
- The website approval boundary is explicit in `docs/INTERFACE.md:17-26`. This display is not an independent authorization boundary.

These controls support Low severity. They do not restore the missing decoded submission review.
Damaged-journal validation is outside C10. This report makes no additional finding about that behavior.

## Minimum mitigation and verification

Keep the existing decoded field list visible when the state is `signed`.
Use `describe(pending.signed_xdr)` for that state, because Submit sends that envelope.
Keep `describe(pending.xdr)` for the unsigned review. Reuse the existing JSON view and decoder.
Handle decode failure visibly, preserve the journal, and disable Submit until the signed envelope can be displayed.
Decoding restored bytes must not imply a fresh signature verification.

Showing the same details during unresolved states is a useful optional extension.
Changing the status text alone is smaller, but removes the promised second review instead of providing it.
A new approval step, persisted duplicate summary, or new dependency is unnecessary for C10.

After mitigation, compare displayed fields before signing, after signing, after reopening, and after reload.
Cover each supported action and confirm that the displayed signed body describes the submitted envelope.
Keep the existing changed-byte rejection and exact-envelope submission checks.
Check malformed signed XDR for a visible error, preserved storage, and disabled Submit.
These mitigation checks are `not_run`; this review implements no fix.

## Exact checks and artifacts

| Check | Result | Evidence under `checks/concerns/c10-astra/` |
|---|---|---|
| Manifest integrity before and after tests | Passed: 199 files; zero mismatches | `results.json` |
| Existing selected reproductions | Passed: 3; failed: 0; filtered: 10 | `existing-reproductions.log` |
| Added normal signing, reopening, and reload check | Passed: 1; failed: 0 | `signed-review.test.ts`, `signed-review.log` |
| Preserved SDK source hashes | Passed: both installed files match | `results.json` |
| Browser, live 1Password, testnet submission, public tunnel | `not_run` | Outside these offline checks |

Exact commands, working directories, and outcomes appear in `checks/concerns/c10-astra/COMMANDS.md` and `results.json`.
Passing reproductions confirm the defect; they do not establish a fix.
I did not repeat the full baseline suite. No review blocker remains.

## Primary evidence, costs, and limits

The frozen source and executable checks decide C10. No unresolved external fact requires another search.
I reused `research/05-demo-astra/sdk-source.json` and its source inventory, `research/05-demo-astra/SOURCES.md`.
The [official SDK transaction reference](https://stellar.github.io/js-stellar-sdk/reference/core-transactions/) supports separate transaction hashes and envelope signatures.
Preserved access date: 2026-09-26. Installed SDK: `17.1.0`; Bun: `1.4.2`.
The preserved implementation excerpts match installed source hashes. They support the normal-path verification counterevidence.
Raven, Parallel, and Perplexity MCP tools were discoverable. No new research tool or CLI research call ran.
New research cost: **$0 total; $0 Jev**, within the **$1 total; $0.25 Jev** caps.
Historical provider charges outside Jev remain unknown. Reusing saved evidence adds no provider charge.
Live signing, live submission, and physical-browser behavior remain untested in this concern review.
