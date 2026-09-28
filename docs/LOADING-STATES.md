# Loading states and control readiness

The demo and connection UI use small rotating arc indicators with visible status text.
The indicators stop when the request finishes, fails, or stops.
They do not imply that an unknown transaction result is still being checked.

## Design review

The review covered 13 Mobbin screens and previews from two payment flows.
It also covered the loading.dev Arc and Ring examples, Carbon guidance, and W3C status-message guidance.

The interface keeps its existing type, spacing, and colors.
The arc uses the text color and an 800ms rotation.
Reduced-motion mode stops the rotation and keeps the status text visible.
The implementation uses local CSS. It does not add React or a package dependency.

## Connection controls

| State | Feedback | Available controls |
| --- | --- | --- |
| Connection UI starts | Header loading indicator | Demo actions stay disabled until the wallet is ready. |
| Missing or invalid details | Form instructions | Continue stays disabled until the origin and eight-digit code are valid. |
| Camera access or scanning | Status indicator and camera instructions | Close and manual entry remain available. |
| Connecting and finding wallets | Continue indicator and 1Password instructions | Inputs, Scan, and Continue stay disabled. Close cancels. |
| Choosing a wallet | Wallet list and scope description | Wallet choices stay enabled. No loading indicator runs while awaiting the user's choice. |
| Accepting a wallet selection | Indicator on the selected row | All wallet choices stay disabled until acceptance. Close remains available. |
| Retrying empty discovery | Refresh wallets indicator | Retry stays disabled until discovery finishes. |
| Refreshing connected wallets | Refresh indicator | Duplicate refresh and wallet selection stay disabled. |
| Changing the active wallet | Indicator on the selected row | Transaction actions stay disabled until the accepted account is published. |
| Disconnecting | Disconnect indicator | Connection changes and transaction actions stay disabled until completion. |
| Copying the address | Confirmation after completion | The button keeps its label, size, and appearance. An internal guard prevents duplicate copies. |

The UI blocks duplicate requests in both the controls and their handlers.
It updates form readiness after typing, scanning, opening, and request completion.
The active wallet row is not selectable again.
Escape closes the wallet menu after a refresh replaces its focused row.
A background refresh after wallet switching preserves the selection result or error message.

The optional `onBusyChange` callback lets the demo update its controls when connection work starts or finishes.
`setBusy` still controls whether the host permits connection changes.
The existing wallet-switch cancellation behavior during signing remains unchanged.

## Transaction and activity controls

| State | Feedback | Available controls |
| --- | --- | --- |
| Loading the account | Transaction progress panel | Duplicate transaction actions stay disabled. |
| Funding a missing account | Funding progress and Friendbot status | Transaction actions stay disabled. |
| Checking the funded account | Account-check progress | Transaction actions stay disabled. |
| Finding a recipient or loading offers | Specific preparation progress | Transaction actions stay disabled. |
| Waiting for a signature | Signature progress and disabled Sign button | Cancel remains available while the request is active. |
| Canceling a signature request | Cancellation progress | Cancel stays disabled while cancellation settles. |
| Submitting | Submission progress and disabled Submit button | Check and Clear remain unavailable during submission. |
| Checking the original result | Check progress and disabled Check button | Duplicate checks stay disabled. |
| Stopped or unknown result | Existing result and recovery instructions | No spinner suggests an active request. Existing recovery restrictions remain. |
| Loading saved activity | Status text without a spinner | Export stays disabled until saved history arrives. |
| Copying event data | Confirmation after completion | The button keeps its label, size, and appearance. An internal guard prevents duplicate copies. |

Closing transaction details remains available during a request.
The compact transaction record shows progress when the modal is closed.
A missing wallet, active connection change, pending transaction, or blocked journal disables new transaction actions.
Missing signed XDR disables Submit.
Empty activity events remain plain rows without expansion controls.
Search, filtering, and export use local data and do not show artificial waiting states.

## Validation — 2026-09-26

- `npm test`: 186 Node tests and three contract self-tests passed.
- Seven new tests cover form readiness, duplicate connection requests, selection locking, refresh locking, retry recovery, and demo controls.
- Activity tests also verify that the history-loading state ends after restoration.
- Browser checks used isolated mock keys and mocked Horizon and Friendbot responses.
- Delayed responses covered discovery, wallet acceptance, switching, funding, signing, submission, checks, and disconnect.
- Browser checks covered invalid connection codes, camera denial, manual fallback, signing cancellation, and clipboard completion feedback.
- Desktop and mobile checks covered 1440px and 390px viewports.
- Reduced-motion checks confirmed that the active wallet indicator stops rotating.
- The activity accessibility check reported zero violations and zero incomplete checks.
- The connection dialog reported zero violations and four contrast checks requiring manual review.
- Visual review confirmed readable text on the white dialog surface.
- `requestSignature` matches the released version. `sdk/walleterm.js` (now `sdk/walleterm.ts`) is unchanged.

These checks requested no live signatures, account funding, or network submissions.
Mock signing and mocked confirmation do not establish 1Password or testnet acceptance.

## Sources

- [loading.dev Arc](https://loading.dev/spinners/arc): rotating arc, current text color, and duration controls.
- [loading.dev Ring](https://loading.dev/spinners/ring): comparison with a circular track.
- [loading.dev library notes](https://loading.dev/llms.txt): React requirements and reduced-motion support.
- [Carbon inline loading](https://carbondesignsystem.com/components/inline-loading/usage/): local progress, descriptive labels, and disabled related controls.
- [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): announce progress without moving focus.
- [Gamma wallet approval](https://mobbin.com/screens/03166a5c-7195-416f-bde1-89c06317e268): loading indicator and approval instructions beside transaction details.
- [Family transaction sending](https://mobbin.com/screens/a6e508d5-d599-42c7-9c01-2dc0213840bb): transaction progress with the wallet and amount still visible.
- [Wise incomplete form](https://mobbin.com/screens/68c1c22c-b501-49f8-8d54-2be9e867d285): disabled Continue before a required choice.
- [Reddit incomplete form](https://mobbin.com/screens/8289b332-c9ab-4684-aad9-2709399d5ef1): disabled Submit while choices remain empty.
- [Assembly submission](https://mobbin.com/screens/1b2791e8-8b91-435d-a0e2-6855b4aec9f7): loading feedback inside the action button.
- [Square import](https://mobbin.com/screens/27d69da6-6f16-47b3-9efb-89b0a36030f5): progress feedback with neighboring actions disabled.
- [Airwallex payment flow](https://mobbin.com/flows/fb9aa8d3-5096-4486-810a-9dc9d256916b): visible processing state after payment confirmation.

Search evidence: `/tmp/walleterm-loading-research.json`.

## Installation

`make install` installed release `001ecf4f29fa20313c7243a9`.
The demo service restarted with this release.
The wallet tunnel and its vault selection remained unchanged.
Six public UI asset hashes matched the checked source files.
The public mobile check confirmed disabled Continue, Scan focus, no camera access, and no page overflow.
The public page reported no browser errors.

## Changed files

This list names the files of 2026-09-26. Later work replaced the `.js` and `.mjs` files.
Parentheses name the current file.

- `sdk/connect.js` (now `sdk/connect.ts`)
- `sdk/connect.css`
- `demo/site/app.js` (now `demo/site/app.ts`)
- `demo/site/index.html`
- `demo/site/style.css`
- `demo/site/activity.js` (now `demo/site/activity.ts`)
- `demo/site/activity.css`
- `bridge/connect.test.mjs` (now `tests/browser/connect.test.ts`)
- `bridge/site.test.mjs` (now `tests/browser/site.test.ts`)
- `bridge/activity.test.mjs` (now `tests/browser/activity.test.ts`)
- `docs/LOADING-STATES.md`

## Instant action feedback

Copy actions use internal duplicate-request guards without changing button appearance.
They show a status message after success or failure.
Saved activity restoration uses status text without a spinner.

The follow-up checks passed 38 connection, activity, and demo tests.
Browser checks held clipboard promises open and confirmed stable labels, widths, and enabled appearance.
Repeated clicks made one clipboard request. Success and failure messages remained available.
