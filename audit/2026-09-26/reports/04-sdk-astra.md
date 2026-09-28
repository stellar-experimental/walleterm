# 04-sdk independent audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Scope and result

- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Requested model and effort: `gpt-6-astra`, `xhigh`. This report does not independently attest runtime selection.
- Date: 2026-09-26.
- Result: two confirmed defects; one Medium, one Low. No additional unresolved code concern remains within this scope.
- The review used no delegation and read no other area report.
- `checks/BROWSER.md` supplied coordinator evidence only.
- No runtime source, dependency, configuration, or Git state changed.

## Code coverage

All source locations below refer to the frozen snapshot.
`checks/04-sdk-astra/source-identity.json` verifies 23 inspected files against the stated Git revision.

| Area | Source traced | Assessment |
| --- | --- | --- |
| Client and errors | `sdk/walleterm.ts:25–411`, `sdk/types.ts:1–63`, `sdk/errors.ts:1–14` | Requests, credentials, retries, selection, cancellation, disconnection |
| Connection component | `sdk/connect.ts:35–752`, `sdk/connect.css:1–13` | Restoration, health checks, busy states, keyboard controls, teardown |
| Scanner | `sdk/scan.ts:5–126` | Payload checks, secure contexts, permission delays, track cleanup |
| Bridge dependencies | `bridge/server.ts:169–280,335–562`, `bridge/transaction.ts:1–98` | Origin scope, grants, revisions, deduplication, cancellation, operation limits |
| Existing checks | `bridge/{sdk,connect,scan,server}.test.ts`, `bridge/test/support.ts` | 80 tests executed |
| Integration boundaries | README, interface, plan, bridge guide, connection guide, package exports, build script | Testnet restrictions and adapter promises |
| Host counterevidence | `demo/site/app.ts:105–124,319,450–471,701–742` | Account updates, transaction locks, explicit submission |

## Confirmed defects

### SDK-01 — Observed remote wallet changes do not invalidate an outstanding signature

**Severity:** Medium. **Confidence:** High.
**Locations:** `sdk/walleterm.ts:237–262,301–302,356–385`; `sdk/connect.ts:279–296`.

Two same-origin tabs can restore the same session token from copied `sessionStorage`.
Browser storage permits this copying when the new page has an opener. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)
Tab A requests a signature at revision 1; its completed response remains delayed.
Tab B changes wallets, and tab A then reads the new account revision.
`readAccount()` updates the account and revision without aborting signing or changing `generation`.
The signing return path checks the token and generation, but ignores its captured revision.
The delayed signature therefore resolves successfully after the client observes the wallet change.
An A→B→A change also passes because the address returns to its original value.

**Impact:** An integration receives a successful signature for a request that wallet switching should cancel.
The bridge already marks that request `unknown` and removes its signed XDR.
This breaks cancellation behavior; it does not sign for an ungranted wallet or submit a transaction.

**Evidence:** `checks/04-sdk-astra/remote-switch.test.ts.txt` and `remote-switch.log`.
Both A→B and A→B→A reproduce against the real frozen bridge with isolated mock keys.
The client observes revision 2 or 3, then returns the old signature. Each case signs exactly once.

**Counterevidence:** Local `selectWallet()` changes generation and aborts outstanding calls at `sdk/walleterm.ts:191–193`.
The bridge rejects stale new requests and cancels stored results at `bridge/server.ts:413–434,476–492`.
Already delivered signatures cannot be revoked. This finding concerns a still-pending SDK promise after observed revision change.
The demo's transaction lock does not wrap the connection component's wallet switch.
The demo still requires a separate submission action.

**Minimum mitigation:** Reject a signing result when its captured selection revision differs from the current revision.
Abort outstanding signing when account recovery observes a newer revision, including an unchanged address after A→B→A.
Preserve uncertainty and the original transaction details.
**Verification:** Change both reproduction assertions to require rejection, then rerun the existing bridge tests.
Also check that an unchanged revision still permits the original result.

### SDK-02 — Component destruction leaves camera capture active

**Severity:** Low. **Confidence:** High.
**Locations:** `sdk/connect.ts:207–214,569–585`; `sdk/scan.ts:31–35,60–67,121–124`.

A host starts scanning, then calls `destroy()` while replacing or removing the component within the same page.
`destroy()` removes health listeners but does not abort `this.scanning`.
The scanner can continue capturing after the host removes its visible controls.
It stops when scanning finishes, its 120000-millisecond deadline expires, or the page emits `pagehide`.
This is a camera lifecycle defect, with limited privacy impact.
The scanner sends no camera frames to a server.

**Evidence:** `checks/04-sdk-astra/destroy-scan.test.ts.txt` and `destroy-scan.log`.
The test uses the real component and scanner methods with a mock camera and inert display nodes.
After destruction, the scan signal remains active, the video retains its stream, and zero tracks stop.
Explicit cancellation then stops the tracks and clears the stream.

**Counterevidence:** Dialog closure aborts scanning at `sdk/connect.ts:558–562`.
Scanner cancellation handles pending permission and video startup correctly; all seven existing scanner tests pass.
The current demo keeps its header component mounted, so this concerns other component integrations.

**Minimum mitigation:** Abort the active scan in `destroy()` and keep destruction idempotent.
**Verification:** Require stopped tracks and a cleared video after destruction.
Repeat with pending permission and a later permission grant; retain the existing close-and-reopen checks.

## Non-issues and accepted limits

| Topic | Evidence and conclusion |
| --- | --- |
| Token scope | Requests omit cookies and referrers. The bridge binds tokens to Origin and scopes records to sessions. See `walleterm.ts:72–83`, `server.ts:169–173,482,533`. |
| Retries | Network errors and 5xx responses reuse one ID and payload. The bridge checks duplicate payload equality. See `walleterm.ts:264–284,324–343`, `server.ts:485–492`. |
| Retry boundaries | Existing checks prove that 4xx responses and connection changes stop retries. No automatic Stellar submission exists in the SDK. |
| Cancellation | Cancellation uses a ten-second shared deadline and at most three attempts. A 401 preserves `requestState: 'unknown'`. See `walleterm.ts:359–379`. |
| Late creation | The bridge remembers cancellation IDs before request creation. See `server.ts:538–547`. |
| Lost selection response | `selectionUncertain` blocks signing until recovery confirms the requested wallet and a newer revision. See `walleterm.ts:216–257`. |
| Restoration | Saved data contains only URL, token, and version. `/v1/account` supplies account, scope, and revision before publication. See `connect.ts:221–265`. |
| Offline restoration | Network failure retains credentials; a confirmed 401 clears them. Recovery does not replay signing requests. |
| Local disconnection | Failed remote revocation produces a visible notice. The component does not claim remote revocation succeeded. See `connect.ts:728–741`. |
| Grants | First selection fixes the displayed eligible set. Revisions prevent stale request admission after A→B→A. See `server.ts:369–434,476–481`. |
| QR and camera | The parser requires protocol v2, an allowed origin, eight digits, and unexpired data. Manual entry remains available. |
| Key and network scope | Dedicated testnet keys and the supported classic operations remain accepted limits. No mainnet or general Soroban claim exists. |

Page exit cancellation remains best effort because browsers do not always emit `pagehide`.
`keepalive` helps an issued request survive unloading; it cannot guarantee that an event occurs. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)
No additional defect follows from that documented browser limit.

## Accessibility and interoperability

No material accessibility defect was established within this bounded review.
The component uses labeled inputs, native buttons, a modal dialog, status regions, focus restoration, and reduced-motion styling.
Source: `connect.ts:87–146,161–175,558–567,575,605,642`; `connect.css:3,13`.
The coordinator's browser smoke check reports zero confirmed automated violations and one incomplete contrast rule.
An incomplete rule does not establish a failure. No independent VoiceOver or physical-phone check ran here.
The assessment used WCAG 2.2 keyboard and focus requirements, not Perplexity's higher-ranked WCAG 3 draft. [W3C](https://www.w3.org/TR/WCAG22/)

The client matches SEP-43's basic transaction arguments and successful result names.
It does not implement the complete Draft 1.2.1 interface or its structured error returns. [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md)
Its errors reject promises; it lacks `getNetwork`, `signAuthEntry`, `signMessage`, and submission options.
These remain accepted limits because the documentation promises an explicit testnet adapter, not full SEP-43 compatibility.

**Useful opportunity:** Provide a small Wallets Kit adapter with explicit capability checks and error translation.
The upstream signature interface supports this direction, but method similarity does not prove integration compatibility. [Kit interface](https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/docs/files/how-to/sign-with-wallet.md)
Keep unsupported operations explicit. Do not expand signing authority merely to match the interface.
No framework, automatic discovery, or general smart-account expansion is necessary for this audit.

## Checks and research

Exact commands, tool arguments, outcomes, and evidence paths appear in `checks/04-sdk-astra/COMMANDS.md`.

| Check | Outcome | Evidence |
| --- | --- | --- |
| Frozen source identity | passed; 23 files match revision | `source-identity.json` |
| SDK, component, scanner tests | passed; 36 tests | `bun-targeted.log` |
| Bridge tests | passed; 44 tests after permitted loopback access | `bun-server-permitted.log` |
| Remote switch reproductions | passed; two defective outcomes confirmed | `remote-switch.log` |
| Destruction reproduction | passed; camera cleanup defect confirmed | `destroy-scan.log` |
| Initial bridge run | blocked by sandbox socket restrictions | `bun-server.log` |
| Initial reproduction | failed due to mock Uint8Array encoding; corrected in owned harness | `remote-switch-harness-error.log` |
| Live signatures, submission, physical camera, VoiceOver | not_run | Outside authorized offline checks |

All check filenames above reside under `checks/04-sdk-astra/`.
Bun 1.4.2 ran the checks; installed source dependencies match SDK 17.1.0, jsQR 1.4.0, and qrcode 1.5.4.
Caches stayed under `/private/tmp/04-sdk-astra-cache`.

Stellar Raven ran first and returned primary Freighter source text.
Jev's initial transport attempt failed; a permitted retry returned partial, adjacent evidence.
The Jev result did not establish SEP-43 requirements; direct primary-source retrieval closed that gap.
Known Jev usage totals **$0.029751121**, including **$0.008729397** reserved by the failed attempt.
Parallel CLI and Parallel Search MCP each report one `sku_search` unit. Their dollar charges remain unknown.
Stellar Raven and Perplexity did not expose dollar charges. No deep-research processor or credit purchase ran.

## Sources and limits

`research/04-sdk-astra/SOURCES.md` records primary URLs, versions, access dates, applicability, and retained provider files.
All cited browser sources were accessed on 2026-09-26.
The two custom reproductions prove source behavior with controlled timing; they do not establish failure frequency on physical devices.
The audit found no cross-origin token escape, repeated signing from retries, or automatic submission within this scope.
No further research allocation is needed for these conclusions. No blocker remains for this bounded review.
