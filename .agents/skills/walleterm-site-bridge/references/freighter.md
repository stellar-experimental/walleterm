# Freighter page transport

This worked example answers the page-message seam of the Freighter extension.
It applies to a website that uses `@stellar/freighter-api` directly or through the Stellar Wallets Kit Freighter module.
Confirm the loaded client first. Follow the general method in [website interception](interception.md).
Sources: [`@shared/constants/services.ts`](https://github.com/stellar/freighter/blob/master/%40shared/constants/services.ts)
and [`extensionMessaging.ts`](https://github.com/stellar/freighter/blob/master/%40shared/api/helpers/extensionMessaging.ts) in `stellar/freighter`.

## Protocol

Requests use `source: "FREIGHTER_EXTERNAL_MSG_REQUEST"` and `messageId`.
Responses use `source: "FREIGHTER_EXTERNAL_MSG_RESPONSE"` and `messagedId`. Keep that spelling.
If nothing answers `REQUEST_CONNECTION_STATUS` or `REQUEST_PUBLIC_KEY`, the client gives up after 2 seconds with an empty result.
`isConnected()` returns `window.freighter` when it is set. Otherwise it sends `REQUEST_CONNECTION_STATUS`.

The helper `scripts/freighter-page.ts` answers these requests at once:
`REQUEST_CONNECTION_STATUS`, `REQUEST_ACCESS`, `REQUEST_PUBLIC_KEY`, `REQUEST_ALLOWED_STATUS`, `SET_ALLOWED_STATUS`, `REQUEST_NETWORK`, and `REQUEST_NETWORK_DETAILS`.
It returns the selected key and testnet. It captures these signing requests without signing them:

| Request | Captured payload | Response after review |
| --- | --- | --- |
| `SUBMIT_TRANSACTION` | `transactionXdr`, supplied account and network fields | `signedTransaction` holds the signed V1 envelope |
| `SUBMIT_BLOB` | `blob`, supplied account and `apiVersion` | For API 4 or later, `signedBlob` holds the Base64 signature and `signerAddress` names the signer |
| `SUBMIT_AUTH_ENTRY` | `entryXdr` (a `HashIdPreimage`), supplied account and network fields | For API 4.2.0 or later, `signedAuthEntry` holds the Base64 signature over `SHA-256(entryXdr bytes)` |

The helper's `reply` command returns `SUBMIT_TRANSACTION` results. `reply-message` returns `SUBMIT_BLOB` results.
Review each `SUBMIT_BLOB` with [message signing](message-signing.md) first.
For `SUBMIT_AUTH_ENTRY`, decode the preimage and review its network, bound address, expiry, and invocation tree.
Then send it to `walleterm sign` with `preimage_xdr`. Walleterm refuses a V1 `soroban_authorization` preimage.
Other request types stay in `window.__walletermBridge.unsupported` with no answer.
The helper refuses to run when the page already has a Freighter provider. It supports testnet only.

## Capture

Run commands from this skill directory, or use its absolute path. Use one named browser session.
Set `WEBSITE_URL`, `WEBSITE_ORIGIN`, and `SELECTED_G_ADDRESS` from the reviewed task. The origin has no path or trailing slash.
Add `--window-flag` only when the loaded client checks `window.freighter` directly.

```sh
set -o pipefail
agent-browser open "$WEBSITE_URL"
bun scripts/freighter-page.ts inject \
  --public-key "$SELECTED_G_ADDRESS" \
  --origin "$WEBSITE_ORIGIN" | agent-browser eval --stdin
```

Use the website's wallet controls after injection.
The Stellar Wallets Kit picker renders in a shadow root, and a snapshot can omit it. Take a screenshot and click by coordinates.
If the page cached an absent-wallet state, change the route to render it again.
A full reload or a browser relaunch removes the helper. Check that `window.__walletermBridge` exists before each wallet action.

```sh
agent-browser wait --fn 'window.__walletermBridge.requests.some(r => !r.responded)'
agent-browser eval 'window.__walletermBridge.pending()'
agent-browser eval 'window.__walletermBridge.unsupported'
```

Choose the pending request index. For a transaction, set `REQUEST_INDEX` and save the unsigned envelope:

```sh
agent-browser eval "window.__walletermBridge.requests[$REQUEST_INDEX].transactionXdr" > request.json
bun -e 'const fs=require("node:fs");fs.writeFileSync("unsigned.xdr",JSON.parse(fs.readFileSync("request.json","utf8"))+"\n",{mode:0o600})'
stellar tx decode unsigned.xdr
stellar tx hash --network-passphrase 'Test SDF Network ; September 2015' unsigned.xdr
```

Use new files for each request. Keep the reviewed artifact fixed.

## Return one reviewed V1 envelope

Complete the review. Set `REVIEWED_HASH`. Write the transaction shape to `sign-request.json`, then sign:

```sh
walleterm sign < sign-request.json > result.json
```

Require `digest` in `result.json` to equal `REVIEWED_HASH`. Write its `signed_transaction_xdr` to `signed.xdr`.

```sh
bun scripts/freighter-page.ts reply \
  --index "$REQUEST_INDEX" \
  --public-key "$SELECTED_G_ADDRESS" \
  --unsigned-xdr unsigned.xdr \
  --signed-xdr signed.xdr \
  --expected-hash "$REVIEWED_HASH" | agent-browser eval --stdin
```

The `reply` command verifies the new Ed25519 signature, the transaction body, the digest, and earlier signatures.
The page code checks the original XDR against the pending request, then answers it once.
The helper does not sign, submit, or check ledger results. Check RPC or Horizon after each return.

## Return one reviewed message

Save the captured text as the JSON string that `agent-browser eval` prints. JSON keeps every byte exact.

```sh
agent-browser eval "window.__walletermBridge.requests[$REQUEST_INDEX].blob" > message.json
```

Complete the [message review](message-signing.md). Send `{"public_key":"G...","message":"<that text>"}` to `walleterm sign`, and save `result.json`.

```sh
bun scripts/freighter-page.ts reply-message \
  --index "$REQUEST_INDEX" \
  --public-key "$SELECTED_G_ADDRESS" \
  --message-json message.json \
  --result result.json | agent-browser eval --stdin
```

The `reply-message` command checks the SEP-53 digest of the text, the result key, and the Ed25519 signature.
It returns the signature as Base64 `signedBlob`.
The page code checks the original text against the pending request and requires Freighter API 4 or later. Then it answers once.
