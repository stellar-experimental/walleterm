# C05 remote revision concern review — Daybreak

## Identity and decision

| Field | Value |
| --- | --- |
| Concern | `C05` |
| Model | Daybreak |
| Effort | `xhigh` |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Scope | Delayed signed response after observed A-B and A-B-A revisions |
| Verdict | Confirmed, conditional race |
| Priority | Medium, P2 before broader SDK use |
| Confidence | High |

The SDK can return old signed XDR after it observes a newer remote wallet revision.
Both cases reach this result. The defect violates the documented result-withholding behavior.
It does not expand signing authority or submit a transaction.

Affected users have two `wallet_scope: "available"` clients that share one token.
They also need a delayed signed HTTP response. Fixed-wallet sessions are not affected.
The current demo exposure is narrow, but it is not absent.

## Reachable scenario

1. Client one selects A at revision 1 and requests a valid signature.
2. The bridge signs for A, and the browser receives the response.
3. The SDK promise remains delayed while client two selects B with the same token.
4. The A-B-A case then selects A again.
5. Client one calls `getAddress()` and observes revision 2 or 3.
6. `readAccount()` updates `revision` without changing `generation`.
7. The signing path checks only the token and generation, then returns the old A signature.

The component checks health every 15 seconds at `sdk/connect.ts:201-205`.
That path calls `getAddress()` at `sdk/connect.ts:267-296`. Copied `sessionStorage` can restore the second client.

## Exact source trace

- `sdk/walleterm.ts:237-262,301-302` updates and captures the remote revision without changing `generation`.
- `sdk/walleterm.ts:356-385` checks only token and generation before returning signed XDR.
- `sdk/walleterm.ts:181-193` aborts signings only during a local `selectWallet()` call.
- `bridge/server.ts:175-184,413-434` marks delivery, then marks old results `unknown` after a change.
- `bridge/server.ts:476-492` rejects stale new requests and changed identical retries.
- `demo/site/app.ts:594-629,701-720` stores returned signatures but submits only after a separate action.

## Impact boundaries

The bridge admitted the request while A and revision 1 were current.
The signer produced one valid A signature. The check found no ungranted wallet or unauthorized signing operation.

The switch marks the bridge record `unknown` and deletes its stored `signed_xdr`.
That state cannot revoke response bytes. The successful SDK promise sends no `/cancel` request.

Neither the bridge nor the SDK submits transactions. The demo requires another explicit Submit action.
The demo can store the old signature after showing the new wallet. A later action can submit it.

Practical frequency is likely low because the signed-response window is short.
No physical browser check measured it. The signature stays valid until expiry or sequence consumption.

## Evidence and counterevidence

The preserved `checks/04-sdk-astra/remote-switch.test.ts.txt` confirms both cases with one signer call each.

The focused check is `checks/concerns/c05-daybreak/remote-revision-boundary.test.ts.txt`.
Its permitted run passed three tests. `checks/concerns/c05-daybreak/RESULTS.md` records all outcomes.

Both cases returned a valid old A signature after observing the newer revision.
Both bridge records withheld signed XDR. No test transport reached an external origin.

The pre-delivery case provides counterevidence. The switch aborted the signer signal before completion.
The late mock signature remained withheld. The SDK rejected with `requestState: "unknown"`.

The server revision comparison blocks stale admission, but it does not guard received responses.
The second client already has the session capability. This race adds stale delivery, not new authority.

## Minimum mitigation

Compare the current revision with the captured revision at `sdk/walleterm.ts:357-358`.
Reject when `this.revision !== revision`, including after A-B-A. The catch path preserves `unknown` state.

Do not add a protocol or state. The server already increments revisions and withholds its result.

An alternative aborts signings when `readAccount()` observes a newer revision.
It rejects earlier but adds lifecycle coupling. The minimum fix does not need it.

## Verification

1. Change both delayed-response assertions to require rejection.
2. Require `requestState: "unknown"` for the already-delivered bridge result.
3. Keep the pre-delivery withholding case passing.
4. Add an unchanged-revision case that still returns the valid signature.
5. Rerun the focused test and the existing SDK and bridge tests.

## Research and limits

No new research ran. `research/concerns/c05-daybreak/README.md` records zero follow-up cost.
The preserved WHATWG source covers copied browser session storage.
The check used Bun and loopback HTTP, not a physical browser.
Live signing, 1Password, public services, and submission were `not_run`. No blocker remains.
