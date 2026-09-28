# Legacy Freighter message transport

Use this reference only when the loaded client uses the exact `window.postMessage` protocol below.
Confirm the deployed API version and response consumer before injecting the helper.
This transport uses direct signing. It does not use `walleterm tunnel` or its transaction limits.

## Protocol and helper limits

Requests use `source: "FREIGHTER_EXTERNAL_MSG_REQUEST"` and `messageId`.
Responses use `source: "FREIGHTER_EXTERNAL_MSG_RESPONSE"` and `messagedId`. Keep that spelling.
The helper handles connection status, public-key access, and testnet network queries.
It captures signing requests without signing them.

| Request | Captured payload | Response after review |
| --- | --- | --- |
| `SUBMIT_TRANSACTION` | `transactionXdr`, supplied account and network fields | `signedTransaction` contains the signed V1 envelope |
| `SUBMIT_BLOB` | `blob`, supplied account and API version | For confirmed API v4, `signedBlob` contains base64 signature bytes; `signerAddress` identifies the signer |
| `SUBMIT_AUTH_ENTRY` | `entryXdr`: a `HashIdPreimage`, supplied account and network fields | For confirmed API 4.2.0 or later, `signedAuthEntry` contains Base64 signature bytes over `SHA-256(entryXdr bytes)` |

The helper's `reply` command supports `SUBMIT_TRANSACTION` only.
Use [message signing](message-signing.md) for `SUBMIT_BLOB`.
For `SUBMIT_AUTH_ENTRY`, decode the preimage and review its network, bound address, expiry, and invocation tree.
Sign the SHA-256 digest of its bytes with `walleterm sign` only after that review. Refuse a V1 preimage.
Inspect the helper's unsupported-request list when the client needs another method.
Choose another adapter when the confirmed transport differs.

Some clients check `window.freighter` synchronously.
Use `--legacy-flag` only when the loaded client needs that check.
The helper refuses to replace an existing Freighter provider.
Missing account or network fields do not establish identity or network permission.
Use the [transaction review](interception.md#return-one-reviewed-transaction) to resolve them before signing.

## Capture

Run commands from this skill directory, or use its absolute path.
Load `agent-browser skills get core` first. Use one named browser session.
Set `WEBSITE_URL`, `WEBSITE_ORIGIN`, and `SELECTED_G_ADDRESS` from the reviewed task context.
Use the exact origin, without a path or trailing slash.

```sh
set -o pipefail
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix walleterm-site)"
agent-browser open "$WEBSITE_URL"
agent-browser snapshot -i
bun scripts/legacy-freighter.ts inject \
  --public-key "$SELECTED_G_ADDRESS" \
  --origin "$WEBSITE_ORIGIN" | agent-browser eval --stdin
```

Use the website's wallet controls after injection.
If the page cached an absent-wallet state, use a route change to rerender it.
A full reload clears the injected bridge.
Wait for the signing request before capturing its payload.

```sh
agent-browser wait --fn 'window.__walletermBridge.requests.some(r => !r.responded)'
agent-browser eval 'window.__walletermBridge.pending()'
agent-browser eval 'window.__walletermBridge.unsupported'
```

Choose the pending numeric request index from that result. Use its matching payload field from the protocol table.
For a transaction, set `REQUEST_INDEX` to that index and save the unsigned envelope:

```sh
agent-browser eval "window.__walletermBridge.requests[$REQUEST_INDEX].transactionXdr" > request.json
bun -e 'const fs=require("node:fs");fs.writeFileSync("unsigned.xdr",JSON.parse(fs.readFileSync("request.json","utf8"))+"\n",{mode:0o600})'
stellar tx decode unsigned.xdr
stellar tx hash --network-passphrase 'Test SDF Network ; September 2015' unsigned.xdr
```

Save the request's identity and supplied account and network fields alongside its payload.
Keep the reviewed artifact fixed. Use new files for each request.

## Return one reviewed V1 envelope

Complete the transaction review before requesting a signature.
Put the selected G-address and reviewed digest in `sign-request.json`. Set `REVIEWED_HASH` to that digest.
The attach helper supports V1 envelopes, including Soroban bodies. It does not review contract effects or authorization.

```sh
walleterm sign < sign-request.json > signature.json
bun scripts/classic-attach.ts \
  --unsigned unsigned.xdr \
  --signature signature.json \
  --expected-public-key "$SELECTED_G_ADDRESS" \
  --network-passphrase 'Test SDF Network ; September 2015' \
  --expected-hash "$REVIEWED_HASH" \
  --output signed.xdr
bun scripts/legacy-freighter.ts reply \
  --index "$REQUEST_INDEX" \
  --public-key "$SELECTED_G_ADDRESS" \
  --unsigned-xdr unsigned.xdr \
  --signed-xdr signed.xdr \
  --expected-hash "$REVIEWED_HASH" | agent-browser eval --stdin
```

Require a successful exit from each command before continuing.
The attach and reply helpers verify the new Ed25519 signature, transaction body, digest, and earlier signatures.
The page bridge checks the original XDR against the pending request.
The website can submit immediately after the reply. Reconcile the original hash before retrying an uncertain result.

The helper supports testnet only. It does not sign, submit, or verify ledger success.
Check RPC or Horizon after each return. Record the ledger result and the resulting state separately.
