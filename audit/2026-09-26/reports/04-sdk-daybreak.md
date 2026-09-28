# 04 SDK audit — Daybreak

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.
> Both C06 reviewers reduced component teardown to Low severity. The static demo does not destroy the component.
> C07 sets the component to expired, not connected. Both focused reviewers found no demonstrated shipped-path response producer.

## Verdict

The SDK has two confirmed defects. One has medium severity, and one has low severity.
I found no critical or high-severity issue. I found no confirmed accessibility defect.
The main retry, restoration, switching, scanning, and multi-tab controls otherwise fail safely.

## Audit identity

| Field | Value |
| --- | --- |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Model | `gpt-daybreak-blue-latest` |
| Effort | `xhigh` |
| Review date | 2026-09-26 |
| Report owner | `reports/04-sdk-daybreak.md` |

I did not read another audit report or delegate work.
I did not start public services, request signatures, or submit transactions.

## Coverage

I read all six `sdk/` files and the three assigned test files.
I traced direct paths through `bridge/server.ts`, `bridge/transaction.ts`, the protocol, and the demo.
The review covered retries, cancellation, restored sessions, wallet switching, scanning, multi-tab behavior, accessibility, and integration promises.

## SDK-01: `destroy()` leaves camera and pairing work active

| Field | Assessment |
| --- | --- |
| Severity | Medium |
| Confidence | High |
| Primary location | `sdk/connect.ts:207-214` |
| Related paths | `sdk/connect.ts:569-607`, `sdk/connect.ts:665-720` |
| Camera cleanup | `sdk/scan.ts:59-67`, `sdk/scan.ts:121-125` |

Reachable scenario:

1. A single-page application starts a camera scan or pairing request.
2. The application unmounts the component and calls `destroy()`.
3. `destroy()` removes timers and listeners only.
4. It does not abort `this.scanning` or `this.connection`.

Impact: The camera can stay active until settlement or the 120-second deadline.
A pairing request can also publish a callback or save a session after teardown.

Evidence: The focused regression expected an active controller to abort.
The controller stayed active. See `checks/04-sdk-daybreak/sdk-regressions.test.ts:35`.

Counterevidence: Close, `pagehide`, timeout, and late camera permission stop tracks correctly.
The static demo does not call `destroy()`.

Minimum mitigation: Abort and clear both controllers inside `destroy()`.
Block late connection commits when `this.destroyed` is true.

Verification: Test scanning, late permission, and pairing during teardown.
Confirm no callback, storage write, or live track remains.

## SDK-02: A non-JSON 401 retains stale credentials

| Field | Assessment |
| --- | --- |
| Severity | Low |
| Confidence | High |
| Primary location | `sdk/walleterm.ts:85-101` |
| Restoration path | `sdk/connect.ts:267-313` |
| Cleanup path | `sdk/connect.ts:345-355` |

Reachable scenario:

1. A proxy or malformed bridge returns HTTP 401 with a non-JSON body.
2. `request()` parses the body before it processes the status.
3. JSON parsing throws before the later 401 cleanup.
4. `sync()` keeps the client because its token remains set.

Impact: The SDK retains the bearer token and prior account.
The component can retain saved credentials and stale connected state.
This result contradicts `docs/CONNECTION-UI.md:56-61`.

Evidence: The focused regression returned an unreadable 401 response.
The token remained `session`, and the account remained `GSTALE`.
See `checks/04-sdk-daybreak/sdk-regressions.test.ts:41`.

Counterevidence: The bridge itself returns JSON errors.
The normal JSON 401 path passed. This issue needs an intermediary or malformed response.

Minimum mitigation: Apply matching-token 401 cleanup before JSON decoding.
Keep the unreadable-response error for diagnostics.

Verification: Test JSON and non-JSON 401 responses against old and current tokens.
Confirm restored storage clears and `onChange` publishes disconnection.

## Confirmed non-issues

- Retries preserve one random request ID and stop on client errors.
- The server returns the existing record for an identical request ID.
- Cancellation preserves uncertainty when the session becomes inaccessible.
- A cancellation 401 becomes `requestState: "unknown"`.
- Restoration reads the live account, scope, and revision before publication.
- Offline restoration does not replay signing or reuse a connection code.
- Wallet grants pin the displayed set and use revision compare-and-set.
- Switching withholds old results and rejects delayed A-to-B-to-A requests.
- A copied session can share a token, but stale revisions block signing.
- The demo uses Web Locks for its shared transaction journal.
- Scanning requires a secure context and an explicit user action.
- Scanning stops tracks after success, cancellation, timeout, and page exit.

The coordinator browser smoke check found zero automated accessibility violations.
It found one incomplete contrast rule, which does not establish a defect.
The smoke check did not use a physical camera.

## Interoperability opportunity

Walleterm matches important SEP-43 method and result shapes.
It exposes `getAddress()` and `signTransaction()` with `signedTxXdr`.
That similarity does not register Walleterm with Stellar Wallets Kit.

The repository states this limit at `docs/WEB-BRIDGE.md:126`.
It describes a future module at `docs/WEB-BRIDGE.md:173-179`.
An unchanged Wallets Kit site cannot select Walleterm today.

This gap is meaningful for adoption, but it is not a promise defect.
The minimum feature is a tested Kit module around `WalletermClient`.
The module must preserve current testnet and supported-operation limits.
No reviewed source showed automatic discovery from SEP-43 compatibility alone.

## Checks

| Command | Outcome |
| --- | --- |
| `bun test bridge/sdk.test.ts bridge/connect.test.ts bridge/scan.test.ts` | Passed: 36 tests |
| `bun run typecheck` | Passed |
| `bun test bridge/server.test.ts bridge/site.test.ts` | Sandbox socket run blocked |
| Permitted rerun of the same route tests | Passed: 68 tests |
| `bun test audit/2026-09-26/checks/04-sdk-daybreak/sdk-regressions.test.ts` | Failed: two confirmed regressions |

The restricted route run failed only because loopback listeners were unavailable.
The permitted rerun passed all tests. The focused failures match SDK-01 and SDK-02.
Detailed outcomes are in `checks/04-sdk-daybreak/results.json`.

## Research

Stellar Raven searched current official dapp documents first.
It found official examples using `getAddress` and `signTransaction`.
See `research/04-sdk-daybreak/stellar-raven.json`.

Jev made one scoped request with a `$1` allocation.
Its transport failed before retrieval and returned no documents.
It spent `$0.008729397`, and I did not retry it.
Its record remains under `research/04-sdk-daybreak/jev/`.

Parallel CLI used one search SKU.
Its result is `research/04-sdk-daybreak/parallel-wallet-interop.json`.
Parallel Search MCP used one search SKU. Perplexity performed one challenge search.
Stellar Raven and Perplexity did not expose charges. Other provider charges remain unknown.

Primary sources:

- [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md), commit `9cd703075d87a6ce293752b1532e7b68efe12ae1`.
- [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit), commit `7663331fd6e8d192653deb08ae93fd0c224b42a8`.
- [Current Kit interface](https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/src/sdk/kit.ts), same commit.
- [Official wallet tools](https://developers.stellar.org/docs/tools/developer-tools/wallets), accessed 2026-09-26.
- [Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams), published 2025-10-09.
- [WHATWG Web Storage](https://html.spec.whatwg.org/multipage/webstorage.html), observed 2026-09-21.

Version details are in `research/04-sdk-daybreak/source-versions.json`.
Research commands are in `research/04-sdk-daybreak/commands.json`.
The research summary is in `research/04-sdk-daybreak/README.md`.

## Limits

The frozen snapshot has no Git metadata. The brief supplied the revision identity.
No live 1Password, phone camera, testnet, or public tunnel check ran.
The browser smoke check used mock keys. Signing and submission remained `not_run`.
Jev evidence remained inconclusive because retrieval failed.

The bounded review is complete.
