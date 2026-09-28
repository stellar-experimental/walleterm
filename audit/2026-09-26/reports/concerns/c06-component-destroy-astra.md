# C06: Component destruction leaves owned work active

## Identity and verdict

| Field | Assessment |
| --- | --- |
| Reviewer | Requested `gpt-6-astra`, `xhigh`; runtime selection lacks independent attestation |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Assigned scope | `sdk/connect.ts:207–214,558–720`; `sdk/scan.ts`; directly related client and host paths |
| Verdict | Confirmed; one concern with camera and pairing consequences |
| Severity / priority | Low / P3 |
| Confidence | High for source behavior; physical-browser frequency remains unmeasured |
| Affected users | External SPA integrations that destroy the component during scanning or pairing |

I read both named original reports and their preserved probes.
I did not read the paired concern report or delegate work.
Thirteen inspected snapshot files match the baseline Git objects; see `checks/concerns/c06-astra/source-identity.json`.

## Reachable behavior

`destroy()` sets `destroyed` and removes health timers and listeners (`sdk/connect.ts:207–214`).
It does not abort `scanning` or `connection`.

**Camera:** A user starts scanning, then the host removes the component without leaving the page.
The scanner retains its stream because destruction never reaches its cancellation handler (`sdk/scan.ts:60–67`).
Pending permission can also produce a stream after destruction, before another cancellation condition occurs (`sdk/scan.ts:71–87`).
The scanner stops on settlement, cancellation, `pagehide`, or its `120000` ms timeout (`sdk/scan.ts:31–35,65,121–124`).
This timeout does not establish a measured wall-clock limit across browser suspension.
Frames stay in local canvas processing; the scanner has no upload path (`sdk/scan.ts:89–111`).
The preserved camera probe observed an active signal, an attached stream, and zero stopped tracks after destruction.
Its explicit abort then stopped the tracks and cleared the stream.

**Pairing:** A user selects a wallet, then the host destroys the component while a response remains pending.
`connect()` checks its signal after awaits, but destruction leaves that signal active (`sdk/connect.ts:676–698`).
The continuation assigns the client, saves credentials, and publishes `onChange` after destruction (`sdk/connect.ts:699–706`).
Storage exposure requires the optional `sessionStorageKey`; the callback does not (`sdk/connect.ts:221–233`).
If selection remains pending, the continuation can also start revoking the previous session after destruction (`sdk/connect.ts:690`).
If previous-session revocation already started, its delayed response still permits the same late commit.
The component's `300000` ms pairing timeout does not prevent successful responses before expiry (`sdk/connect.ts:671`).

## Evidence and counterevidence

| Check | Outcome | Evidence |
| --- | --- | --- |
| Preserved camera reproduction | Reused; passed its defect assertions | `checks/04-sdk-astra/destroy-scan.test.ts.txt`, `destroy-scan.log` |
| Preserved controller regression | Reused; failed its cleanup expectation | `checks/04-sdk-daybreak/sdk-regressions.test.ts:35`, `results.json` |
| Coordinator reproduction | Reused; confirms the camera result | `checks/coordinator-reproductions.txt` |
| New delayed pairing probe | Passed: two timing cases reproduce late commits | `checks/concerns/c06-astra/late-pairing.test.ts.txt`, `late-pairing.log` |
| Snapshot identity | Passed: 13 files match | `checks/concerns/c06-astra/source-identity.json` |

Command: `bun test audit/2026-09-26/checks/concerns/c06-astra/late-pairing.test.ts`.
Bun `1.4.2` ran two tests, with zero failures.
The probe imports the frozen component and client; it mocks browser IO and an already completed wallet choice.
Its in-memory fetch respects cancellation and delays selection or previous-session disconnection.
Both cases saved one session and published one connection callback after destruction; neither requested signing.
These passing assertions confirm defects, not correct cleanup or live-browser acceptance.
Exact commands and probe limits appear in `checks/concerns/c06-astra/COMMANDS.md`.

Dialog closure already aborts both operations (`sdk/connect.ts:558–562`).
The scanner already handles late permission after actual cancellation; preserved scanner checks cover this behavior.
Health checks already reject late component publication after destruction (`sdk/connect.ts:281–304`).
The static demo mounts one header component and never calls `destroy()` (`demo/site/app.ts:105–125`).
Thus, the reviewed demo has no demonstrated destruction trigger; external SPA use supplies that trigger.
No inspected pairing continuation signs or submits; the host owns those actions (`docs/CONNECTION-UI.md:11–15`).

## Severity and minimum mitigation

Low fits the demonstrated camera lifetime error and stale connection publication within the same website.
The evidence does not establish permission bypass, frame disclosure, unauthorized signing, submission, or cross-origin access.
A Medium claim needs additional host behavior or consequences; neither original report demonstrates them.

Set destruction first, then abort and clear the component's scanning and pairing controllers.
Reject new scan or pairing starts after destruction; suppress late storage writes, callbacks, and detached UI updates.
Keep the existing signal checks before previous-client disconnection and final connection assignment.
Guard error and final cleanup paths too; `connect()` currently updates UI and busy callbacks there (`sdk/connect.ts:707–719`).
Retain best-effort cleanup of the unpublished `next` client (`sdk/connect.ts:709`, `sdk/walleterm.ts:163–168`).
Do not make `destroy()` disconnect or forget an established shared client merely because its UI disappears.
The host receives that client independently (`docs/CONNECTION-UI.md:30–46`); explicit disconnection revokes its session (`bridge/server.ts:452–455`).
An earlier disconnection request can already reach the bridge; destruction cannot undo that revocation.
As an interim host workaround, close pending UI work before destruction; this does not replace commit guards.
Verify stopped tracks, late permission cleanup, absent late publication, and preservation of an established shared client.
Keep both delayed pairing cases; change their assertions to require cancellation and no new session commit.

## Sources, usage, and limits

Reused [Mozilla camera API excerpts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) establish secure-context and permission requirements.
The excerpts are unversioned, accessed `2026-09-26`, and retained in `research/04-sdk-astra/parallel-cli.json`.
They apply directly to `sdk/scan.ts:37,72`; frozen dependencies include `jsqr@1.4.0`.
Research reuse and tool discovery appear in `research/concerns/c06-astra/USAGE.md`.
New research usage: `$0` of `$1`; Jev: `$0` of `$0.25`. No new provider requests ran.
Physical camera, live 1Password, signing, submission, and public services remain `not_run`.
No runtime source changed. No blocker remains for this bounded conclusion.
