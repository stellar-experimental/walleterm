# Website connection component

`WalletermConnect` is the connection interface of the SDK. The demo mounts it in its header.
The component owns the pairing dialog, camera scan, wallet picker, and connected wallet dropdown.
It is also the dialog that `Walleterm.getAddress()` opens when no session exists.
The dropdown lists wallets, marks the active wallet, copies its address, refreshes discovery, and disconnects.

The component does not build, inspect, approve, or submit transactions.
The website owns transaction construction, review, signing calls, submission, and recovery.
The bridge does not review transactions. A website preview is not trusted review.
See [the demo website](DEMO.md) for one example.

## Integration

Run `bun run build` in the source checkout. The build writes browser modules to `dist/`.
Serve `dist/sdk/` and the shared `dist/chunk-*.js` and `dist/jsQR-*.js` files in the same relative layout.
Do not copy all of `dist/`. It also holds the demo build and `routes.tsv`, which lists local build paths.
A bundler can import the package exports `walleterm`, `walleterm/connect`, and `walleterm/connect.css` instead.
Load `sdk/connect.css` once on each page that uses the component.

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
The optional `onBusyChange` callback reports when connection work starts or finishes.
`setBusy(true)` blocks connection changes while the website works.

After a pairing completes, the wallet owns the session. Destroying the component does not revoke it.
A pairing that has not finished stops when the component closes or is destroyed.
This includes the revocation of a replaced session. The wallet then keeps neither session.
A component mounted for a wallet that is already connected shows that connection at once.

## Pairing dialog

Opening the dialog focuses Scan tunnel QR code. The camera starts only when the user selects that button.
The manual form stays available. The dialog never selects an input automatically.
Manual inputs use at least 16-pixel text, so phones do not zoom. The page keeps browser pinch zoom.
Continue stays disabled until the tunnel origin and the eight-digit code are valid.
Camera denial leaves manual entry available.

While the dialog connects and finds wallets, the inputs, Scan, and Continue are disabled. Close cancels.
The wallet picker receives an empty list when discovery returns no keys. It can refresh or cancel.
Discovery and selection requests permit 135 seconds. Other requests permit 15 seconds.
The caller can cancel each request before its deadline.
`Walleterm.listWallets({ signal })` refreshes public wallet metadata without a change to the selected account.

## Browser sessions

The wallet saves the bridge URL and session token in `localStorage` under `walleterm:session`.
All tabs of the website share them. `new Walleterm({ storageKey: null })` keeps them in memory only.
Unavailable browser storage also leaves the connection in memory.
Every page of the website can read this token. Use Walleterm only on a trusted website.
The wallet never saves the one-use connection code or a private key.

The component follows a pairing, a wallet change, or a disconnection in another tab.
A new session from another tab can grant other wallets. The menu then loads the wallet list again.

A reload or a new tab checks `/v1/account` before it publishes the wallet or enables transaction actions.
The bridge supplies the current account, wallet scope, and selection revision.
Recovery does not request wallet discovery, sign a transaction, or submit a transaction.
The wallet menu loads the wallet list once when it first opens after recovery. Unlock 1Password if it asks.
If that lookup fails, use Refresh.

## Health checks

The component checks `/v1/account` every 15 seconds while the page is visible.
Focus, network recovery, and restored pages also start a check. Checks never overlap.
A failed network check shows an unavailable connection and keeps the saved session.
The demo disables new transaction creation and signing while the connection is unavailable.
A successful check restores the connection display.
A 401 response or Disconnect removes the saved session. A 401 response requires a new connection code.
Health checks never extend the one-hour session lifetime.

The health message uses normal document flow. Let the host container grow when a message appears.
The demo places the message below the header controls and above the page content.

The connection menu offers Reconnect when the old URL stays unavailable.
A new tunnel URL needs its new connection code. Open pages do not discover a new URL.
Manual replacement or disconnection can discard the previous connection locally.
The website then reports that remote revocation is unconfirmed.
Local discard cancels browser signing waits. It cannot prove that an earlier signature was never produced.
The old bridge session can stay active until it expires. Stop the old bridge to revoke all its sessions.

## Changing the active wallet

Without a `wallet` option, the component creates a wallet with the `available` scope.
With a `wallet` option, it uses the scope of that wallet.
The SDK default is the `selected` scope: one wallet for each connection. It is the least-privilege scope.
Use `new Walleterm({ walletScope: 'available' })` only with an interface that shows the broader permission.

With the `available` scope, the dialog explains before selection that the website can switch among the listed wallets.
The first selection fixes the granted wallet list. A new key requires a new connection.
Selecting a wallet in the dropdown uses the current session. It needs no new code or scan.
The selected row shows progress. Other wallet choices stay disabled until the bridge accepts the selection.
Wallet changes cancel unfinished signing requests and keep the session expiry.
The SDK suppresses late signing results after a wallet change.

A lost selection response starts account recovery before the SDK permits another signature.
Signing stays disabled until recovery confirms the requested wallet and an increased selection revision.
The component publishes the recovered account. Failed recovery disables transaction actions.

`wallet.onChange(listener)` reports each switch and disconnection.
A Stellar Wallets Kit website connects the guarded hook in [SEP-43](SEP-43.md#scopes-and-switching).
It acts only while Walleterm is the selected Kit wallet. It calls `fetchAddress()` for an address and `disconnect()` for none.
That hook never opens the pairing dialog after a disconnection or an expired session.

## Controls

The component blocks duplicate requests in the controls and in their handlers.
Refresh and Disconnect show progress on their buttons. Other connection changes wait until they finish.
The active wallet row is not selectable again.
Copy address keeps its label and size. It shows a status message after it completes.
Escape closes the menu or dialog and returns focus to the button that opened it.
The dropdown stays within the viewport on small screens and scrolls when needed.
