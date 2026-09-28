# Local browser smoke check

Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Tool: agent-browser with an isolated Chromium session.
Fixture: `bridge/browser-fixture.ts` from the frozen snapshot.
Network allowlist: `127.0.0.1,localhost`.
The fixture uses two isolated mock keys. It does not use 1Password.

| Check | Result |
|---|---|
| Demo assets load under the existing content security policy | Passed |
| Transaction actions stay disabled before connection | Passed |
| Manual URL and code connection | Passed |
| Wallet list and initial selection | Passed |
| Wallet switch within the granted list | Passed |
| Reload recovers the selected wallet | Passed |
| Wallet controls at 390 × 844 | Passed visual inspection |
| Connection dialog automated accessibility | Zero violations; one incomplete contrast rule |
| Connected page automated accessibility | Zero violations; one incomplete contrast rule |
| Disconnect clears the session and disables transaction actions | Passed |
| Browser and fixture cleanup | Passed |
| Signing and submission | not_run |
| Physical phone camera and mobile browser | not_run |

The incomplete contrast rule concerns short symbols and requires manual assessment.
It does not establish a confirmed accessibility defect.
The mobile viewport check does not establish physical mobile acceptance.

## Evidence

- `browser-connect-desktop.png`
- `browser-connected-desktop.png`
- `browser-wallet-mobile.png`
- `browser-a11y-connection.json`
- `browser-a11y-connected.json`
