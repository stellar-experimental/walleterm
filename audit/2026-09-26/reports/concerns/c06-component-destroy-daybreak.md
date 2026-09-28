# C06 component destruction — Daybreak review

## Assignment

| Field | Value |
| --- | --- |
| Concern | `C06` |
| Model and effort | Daybreak, `xhigh` |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Assigned source | `sdk/connect.ts:207-214,569-607,665-720`; `sdk/scan.ts` |
| Baseline | Central checks passed, including 224 Bun tests; not rerun here |

I reviewed only C06 and its named evidence. I did not read the paired concern report.

## Verdict

| Field | Assessment |
| --- | --- |
| Verdict | Confirmed lifecycle defect with conditional external SPA exposure |
| Severity | Low; the Medium rating overstates the demonstrated impact |
| Priority | P2 before an external SPA relies on component teardown |
| Confidence | High |
| Affected users | SPA hosts that destroy the component during scanning or pairing |

The static demo does not reach this path because it never calls `destroy()`.
The defect does not steal keys, request signatures, or submit transactions.

## Reachable behavior and source

1. The user explicitly starts scanning or pairing.
2. The host unmounts the component and calls `destroy()` before settlement.
3. `destroy()` leaves both owned controllers active.
4. Camera capture can continue after the visible component disappears.
5. A delayed wallet selection can commit after destruction.
6. A delayed replacement can also disconnect the established client.

`destroy()` omits both aborts at `sdk/connect.ts:207-214`.
`scan()` stores its controller at `sdk/connect.ts:569-585`; abort stops tracks through `sdk/scan.ts:60-67,71-83,121-124`.
`connect()` stores its controller at `sdk/connect.ts:665-671`.
Its abort check at `sdk/connect.ts:686` cannot help without an abort.
It disconnects the old client at `sdk/connect.ts:687-697`, then publishes `next` at `sdk/connect.ts:698-706`.

## Evidence and counterevidence

The preserved camera probe observed an attached stream and zero stopped tracks after destruction.
See `checks/04-sdk-astra/destroy-scan.test.ts.txt` and `destroy-scan.log`.
The new probe paused the real client during `/v1/select`.
It destroyed the component before releasing the response.
The signal stayed active, and the late connection committed.
The probe recorded one storage write, callback, and old-client disconnection.
See `checks/concerns/c06-daybreak/pairing-after-destroy.test.ts.txt` and `RESULTS.md`.
The first harness run lacked a `dialog` mock and failed before evidence assertions.
The corrected run passed once with no failures.
Camera access requires an explicit scan action.
The scanner processes frames locally and sends none to the bridge.
Success, `pagehide`, or the 120-second deadline eventually stops the tracks.
Pairing already has a valid code and selected wallet in the demonstrated race.
The late commit adds no authority beyond that initiated pairing.

## Static demo and external SPA scope

The static demo creates one header component at `demo/site/app.ts:105-125`, and no demo path calls `destroy()`.
Therefore, C06 does not affect the current static demo lifecycle.
The SDK exports the component at `README.md:167-171`. The guide gives its client to host code at `docs/CONNECTION-UI.md:27-47`.
An external SPA can retain that client after removing the UI.

## Ownership and minimum mitigation

The component owns an unfinished scan and the unpublished `next` client.
`destroy()` must stop those pending operations.
The host owns a published client received through `onChange`.
`destroy()` must not revoke that established shared client.
Abort `this.scanning` and `this.connection` during idempotent destruction.
Guard `this.destroyed` before disconnecting the old client or committing `next`.
Keep catch cleanup for the unpublished `next` client.
Do not call `this.client.disconnect()` from `destroy()`.
An abort alone leaves a narrow future commit risk.
A commit guard alone leaves camera and network work active.

## Verification

- Require stopped tracks and `video.srcObject === null` after destruction.
- Repeat with pending permission and a late stream response.
- Require the pairing signal to abort before delayed `/v1/select` completion.
- Require zero storage writes, callbacks, and old-client disconnections.
- Confirm that an established client remains usable after UI destruction.
- Rerun the focused connection and scanner tests.

## Sources, research, and limits

The frozen source and controlled probes answer the disputed question.
No new research tool ran, and total follow-up cost was `$0`.
Jev usage was `$0`; Raven, Parallel, and Perplexity were not used.
The preserved W3C source defines `MediaStreamTrack.stop()` for track cleanup.
Source: https://www.w3.org/TR/mediacapture-streams, published 2025-10-09.
The original review accessed that source on 2026-09-26.
The probes use mock media and controlled bridge responses.
No physical camera, public tunnel, signing, or submission check ran.
No blocker remains for this bounded conclusion.
