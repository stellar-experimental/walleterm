# Website connection component

The demo mounts `WalletermConnect` in its header.
The component owns the pairing dialog, camera scan, wallet picker, and connected wallet dropdown.
It is also the dialog that `Walleterm.getAddress()` opens when no session exists.
The dropdown lists wallets, marks the active wallet, copies its address, refreshes discovery, and disconnects.
Opening the connection dialog focuses Scan tunnel QR code. The camera starts only when the user selects that button.
The manual form stays available when the dialog opens.
The dialog never selects an input automatically. Manual inputs use at least 16-pixel text to prevent phone input zoom.
The page preserves browser pinch zoom.

The demo owns transaction construction, preview, signing calls, submission, and recovery records.
Its [transaction modal](DEMO-ACTIONS.md) opens when an action starts.
The connection component does not build, inspect, approve, or submit transactions.
Website previews do not establish trusted transaction review.
This change does not add trusted review to the bridge or change its existing signing policy.

## Integration

Run `bun run build` in the source checkout.
Copy the complete contents of `dist/` into the website's static root.
Preserve all generated directories and shared JavaScript files.
Copy `sdk/connect.css` separately into the website's `sdk/` directory. Load the stylesheet once.
The build includes the scanner dependency in its shared JavaScript files.

```html
<link rel="stylesheet" href="/sdk/connect.css">
<header><div id="wallet-connection"></div></header>
```

```js
import { Walleterm } from '/sdk/walleterm.js';
import { WalletermConnect } from '/sdk/connect.js';

const wallet = new Walleterm({ walletScope: 'available' });
const connection = new WalletermConnect(document.getElementById('wallet-connection'), {
  wallet, // Optional. Share one wallet with a Stellar Wallets Kit module.
  onChange({ wallet: connected, account }) {
    renderAccount(account); // { address, networkPassphrase }, or null after disconnection.
  },
});

// Keep the selected wallet fixed during a transaction action.
connection.setBusy(true);
try {
  const { signedTxXdr, error } = await wallet.signTransaction(unsignedXdr);
  // The website handles the result or the SEP-43 error.
} finally {
  connection.setBusy(false);
  connection.sync(); // Clear a connection invalidated by an expired session.
}
```

The component registers itself as the wallet's pairing interface.
`wallet.getAddress()` then opens its dialog and resolves after the user selects a key.
Closing the dialog resolves `getAddress()` with error `-4`.
Without a mounted component, `getAddress()` loads a dialog-only component. Load `connect.css` on that page too.
The component also follows changes made through the wallet, such as `wallet.disconnect()` or session expiry.

The wallet saves the bridge URL and session token in `sessionStorage` for the current tab.
The key is `walleterm:session`. `new Walleterm({ sessionStorageKey: null })` keeps credentials in memory only.
It never saves the one-use connection code or a private key.
The website's scripts can read this token. Use Walleterm only on a trusted website.
Reload checks `/v1/account` before publishing the wallet or enabling transaction actions.
The bridge supplies the current account, wallet scope, and selection revision.
Recovery does not request wallet discovery, sign a transaction, or submit a transaction.
Use Refresh in the wallet menu to load the wallet list after recovery.
A network failure retains the saved session and permits later health checks.
A 401 response or Disconnect removes the saved session.
Unavailable browser storage leaves the connection in memory.
The demo keeps its transaction recovery record separately in `localStorage`.

After a pairing completes, the wallet owns the session. Destroying the component does not revoke it.
A pairing that has not finished stops when the component closes or is destroyed.

The connection health message uses normal document flow.
Let the host container grow when a message appears.
The demo places the message below the header controls and above the page content.

`Walleterm.listWallets({ signal })` refreshes public wallet metadata without changing the selected account.
The wallet picker receives an empty list when discovery returns no keys. It can refresh or cancel.
Discovery and selection requests allow 135 seconds. Other requests allow 15 seconds.
The caller can cancel each request before its deadline.

## Changing the active wallet

The component requests `wallet_scope: "available"` when it pairs.
Before selection, it explains that the website can switch among the displayed wallets and request signatures.
The first selection fixes the granted wallet list. A new key requires a new connection.
Selecting a wallet in the dropdown selects it through the wallet's current session.
It keeps the current session and needs no new code or scan.
Wallet changes cancel unfinished signing requests and preserve the session expiry.
A lost selection response triggers account recovery before the SDK permits another signature.
An unchanged account cannot confirm a selection that still waits for discovery.
Signing stays disabled until recovery confirms the requested wallet and an increased selection revision.
The component publishes the recovered account. Failed recovery disables transaction actions.

The SDK defaults to the `selected` scope: one wallet for each connection. It is the least-privilege scope.
Use `new Walleterm({ walletScope: 'available' })` only with an interface that displays the broader permission.
`wallet.onChange(listener)` reports each switch. A Stellar Wallets Kit website can call `StellarWalletsKit.fetchAddress()` there.

Changing wallets preserves a saved demo transaction and its original signer.
The demo enables Sign only when the connected wallet matches that signer.
The demo permits wallet changes during signature waiting. Construction and submission keep wallet changes disabled.
The SDK suppresses late signing results after a wallet change.
An unknown signing outcome uses `signing_unknown`; an unknown submission keeps its original recovery protections.
A completed local signature remains available for submission with its original transaction.
A wallet change never triggers submission.

## Design evidence

Checked through the Mobbin MCP on 2026-09-26.
The search covered 15 screen results and three flows across four queries.
Some screen results repeated across searches.

| Reference | Visible pattern | Application |
| --- | --- | --- |
| [Uniswap connection flow](https://mobbin.com/flows/db583e47-5485-4791-b1b9-09210381662d) | A header connection button becomes a short address. | Keep the demo workspace separate from connection controls. |
| [Coinbase dialog](https://mobbin.com/screens/0028e86d-943f-4bfd-8be6-ce4f873921ce) | A centered dialog presents clearly separated wallet rows and a close button. | Use one focused dialog with explicit wallet selection. |
| [OpenSea wallet flow](https://mobbin.com/flows/2a1a2566-20ea-4ddf-96bc-6356fc6b7081) | Wallet selection stays above the application; linked wallets appear together. | Keep discovery and selection inside the connection component. |
| [YouTube account menu](https://mobbin.com/screens/44a3f09f-bb36-451a-a724-42ea6838e8b0) | Identity appears above account actions in a header dropdown. | Put the active wallet above wallet rows and Disconnect. |
| [Family wallet actions](https://mobbin.com/screens/0d16504e-cac4-4855-8290-415f3c1f110e) | Wallet rows separate identity from actions such as Copy Address and Set as Default. | Show the active state and expose address copying separately. |

The palette uses white `#ffffff`, page `#f7f8fc`, text `#202637`, secondary text `#626b80`, blue `#3855d9`, and borders `#dfe3ec`.
Avenir Next, Avenir, and system fonts provide the text. Connection codes use the system monospace font.
The layout uses a header dropdown, a centered dialog, and a separate transaction workspace.
The design review removed the permanent connection form and replaced the native select with readable wallet rows.
The component uses scoped CSS and native dialog focus control. Small screens keep the dropdown within the viewport.

## Recovery UI review on 2026-09-26

The current design supports the recovery changes.
The header owns connection controls and connection messages.
The transaction dialog owns signing progress, the countdown, and cancellation.
The saved transaction record remains available after an unknown result.
This review found three display issues and fixed them.

| Issue | Change |
| --- | --- |
| The mobile health message covered the network label. | The header now reserves a separate row for the message. |
| The countdown changed a screen reader status every second. | State changes use a status. The countdown uses a timer with `aria-live="off"`. |
| An old signing instruction remained visible during a retry. | Active progress replaces the old instruction. The result message returns when progress stops. |

The desktop menu stays aligned with the connection button.
The mobile menu stays within the screen and permits scrolling.
The dialog keeps Cancel visible at 320 × 568.
The dialog body scrolls when the transaction details exceed its available height.
Escape restores focus to the transaction button or connection button.
A replaced public URL still requires the current URL and code.

### Checks

The browser used a local bridge and an isolated mock wallet.
The mock signing function returned no signature.
The browser permitted network traffic only to `127.0.0.1`.
The account response used local mock data.
No check used a 1Password item, Friendbot, or a live Stellar account.

| Check | Result |
| --- | --- |
| 320 × 568, 390 × 844, 768 × 1024, 1440 × 1000 | The checked states showed no horizontal overflow. |
| Connection loss and recovery | The failure message appeared. The same session recovered after the network block ended. |
| Expired session | The connection cleared and the current-code instruction appeared. |
| Unconfirmed disconnection | The notice stayed visible without covering page content. |
| Signing wait and network retry | The countdown and Cancel stayed visible on a small screen. |
| Failed cancellation | The unknown result remained in the transaction record. |
| Keyboard | Escape restored focus. Native dialogs kept their focus controls. |
| Automated accessibility | The checked menu, signing, and expiry states had zero confirmed WCAG 2 A/AA violations. |
| Accessibility limits | The page checks left decorative symbol contrast unresolved. The signing dialog had no incomplete checks. |
| Local tests | 41 connection and demo tests passed. Type checks, formatting, and whitespace checks passed. |
| Installation | The installed HTML, CSS, and application source matched the checked source. |

Local screenshots remain in the ignored `evidence/ui-lifecycle-2026-09-26/` directory.
Git does not include these screenshots.
The files cover the original overlap, signing, retries, menus, unconfirmed disconnection, and session expiry.

Reference checks used five Mobbin recovery screens.
[Zoom](https://mobbin.com/screens/d49906e1-327c-4fa7-8159-cdbb1a573ce7) places a timeout explanation beside Retry and Leave.
[Dropbox Dash](https://mobbin.com/screens/f10e8de9-fc45-47d7-8ada-238f1ea8d062) places the connection error above Try again and Close window.
These references support keeping recovery instructions near their controls.
They do not establish the safety of signing or submission.

This review did not test a physical iPhone, VoiceOver, hardware sleep, or a live 1Password prompt.
The display changes did not change signing, cancellation, submission, or transaction recovery rules.
Existing service processes require a restart to load the installed UI changes.

## Earlier connection UI verification on 2026-09-26

Before same-session switching, the complete `npm test` run passed 144 tests and three contract self-tests.
A later targeted run passed the additional empty-wallet refresh test and the updated installer checks.
The browser fixture used two isolated mock wallets. It accessed no 1Password keys or live accounts.

Browser checks passed at 1440 × 1000 and 390 × 844:

- Open the dialog from the header and select a wallet.
- Refresh the wallet list and mark the active wallet.
- Keep the current wallet after an incorrect replacement code.
- Select another wallet with a fresh code.
- Copy the active address and disconnect.
- Disable demo actions after disconnection.
- Close with Escape and restore focus to the header button.
- Cycle keyboard focus inside the dialog.
- Show manual entry after camera permission denial.
- Keep the mobile dropdown within the screen width.

The browser checks found and fixed a dropdown focus race and an incomplete dialog focus cycle.
The final dialog and dropdown accessibility checks reported no confirmed WCAG A or AA violations.
The checker left color-contrast results for manual inspection. The screenshots show readable text and visible focus outlines.
These checks do not establish a complete accessibility certification or live camera decoding.

`make install` completed after the final UI fixes.
The installed demo served the new component, stylesheet, and client successfully.
Installed UI files matched the workspace by SHA-256.
The separate OP_VAULT task owns the live 1Password wallet-picker check.
No live signature or transaction was requested for this UI work.

The phone focus update passed 25 targeted connection, scanner, and demo tests.
The earlier 390 × 844 browser check confirmed no automatic input focus.
The updated connection test confirms that opening the dialog does not request camera access.
The rendered URL field used 16-pixel text, and the connection code used 18-pixel text.
The camera check used a mock permission request. Native iPhone zoom was not tested on a physical device.

See [wallet switching validation](WALLET-SWITCH-VALIDATION.md) for the current behavior and checks.
