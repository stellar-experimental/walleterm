# C07 independent concern review — Daybreak

## Identity and scope

| Field | Value |
| --- | --- |
| Concern | `C07` |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Model | `gpt-daybreak-blue-latest` |
| Effort | `xhigh` |
| Baseline | Central Go race and Bun checks passed |
| Primary scope | `sdk/walleterm.ts:85-101`; `sdk/connect.ts:267-313,345-355` |

I reviewed only C07 and its named original report.
I did not read the paired report, edit production source, or delegate work.

## Verdict

| Field | Assessment |
| --- | --- |
| Verdict | Conditional resilience work |
| Priority | Low, P3 |
| Confidence | High |
| Confirmed defect in shipped path | No |
| Confirmed behavior under the mock | Yes |
| Actual affected users | None demonstrated with the shipped bridge and Quick Tunnel |

The SDK keeps credentials after a readable, non-JSON HTTP 401.
The current bridge does not generate that response shape.
No reviewed deployment path adds a second authentication proxy.
A custom fetch adapter or a future CORS-visible proxy could create the condition.

## Reachable conditional scenario

1. A response producer returns HTTP 401 with a non-JSON body.
2. The browser or custom fetch adapter exposes that response to the SDK.
3. Parsing throws before cleanup at `sdk/walleterm.ts:85-101`.
4. `checkHealth()` sets `expired`, but `sync()` keeps the token at `sdk/connect.ts:305-309,345-355`.

The component can retain its account and saved token without publishing disconnection.
The demo blocks `unreachable`, but not `expired`, at `demo/site/app.ts:317-329,421-428`.
A later action can therefore use stale local state and fail again.

This path cannot extend an expired bridge session.
The bridge still rejects the token before signing at `bridge/server.ts:169-173`.
The evidence does not show key theft, unauthorized signing, or transaction submission.

## Counterevidence

- `sendJson()` always serializes bridge responses as JSON at `bridge/server.ts:77-90`.
- The server catches route errors and calls `sendJson()` at `bridge/server.ts:571-581`.
- The actual bridge and SDK revocation check passed and cleared the old connection.
- The JSON restoration check removed the saved session and stale account.
- The Quick Tunnel uses an empty temporary configuration at `bridge/launch.ts:274-299`.
- No reviewed source configures Cloudflare Access or another authentication gateway.
- The failing reproduction replaces fetch with a synthetic HTML 401.

## Minimum mitigation

Move the matching-token 401 cleanup before `response.json()` in `WalletermClient.request()`.
Keep the existing guard, unreadable-response error, and status.

This change preserves the old-response guard and applies the documented cleanup rule.

The alternative is to document the condition and accept the mismatch at `docs/CONNECTION-UI.md:56-61`.

## Verification steps

1. Confirm that JSON and non-JSON 401 responses clear the current token and account.
2. Confirm that the non-JSON case still reports an unreadable response.
3. Confirm that an old-token 401 cannot clear a newer connection.
4. Confirm that network failures and non-401 unreadable responses retain credentials.

## Exact checks

| Command | Outcome |
| --- | --- |
| `bun test audit/2026-09-26/checks/04-sdk-daybreak/sdk-regressions.test.ts -t "an unreadable 401 clears the active connection"` | Failed as expected; token stayed `session` |
| `bun test bridge/server.test.ts -t "SDK uses the code and wallet picker, signs, and reconnects after revocation"` | Sandbox run blocked at loopback listen |
| Same bridge command with permitted loopback access | Passed: 1 test |
| `bun test bridge/connect.test.ts -t "reload removes a revoked or expired session and does not exchange the old connection code"` | Passed: 1 test |

Exact outcomes are in `checks/concerns/c07-daybreak/results.json`.
I reused the central baseline and did not repeat the full suite.

## Sources, costs, and limits

The frozen source and preserved reproduction supplied decisive primary evidence.
I ran no external research because no Stellar or protocol fact remained unresolved.

| Cost item | Usage |
| --- | --- |
| New paid research | `$0.00` |
| Jev | `$0.00` |
| Unknown provider charges | None; no provider calls ran |

Live 1Password, testnet, and public tunnel checks were `not_run`.
The current conclusion remains conditional for future proxy deployments.
