# Legacy Freighter message transport

Use this reference only after you confirm the site's loaded code uses these exact messages.
[StellarTerm testnet build 2409](https://stellarterm.com/testnet) used them on 2026-09-25.
The source project recorded five accepted transactions in `evidence/stellarterm-testnet-2026-09-25.json`.
That historical record is not bundled with this skill. The test used Stellar CLI 27.1.0 and Stellar SDK 17.1.0.
This transport does not use `walleterm tunnel` or its transaction limits.

The tested client sent `window.postMessage` requests with `source: "FREIGHTER_EXTERNAL_MSG_REQUEST"`. It used `REQUEST_CONNECTION_STATUS`, `REQUEST_ACCESS`, and `SUBMIT_TRANSACTION`. It accepted responses with `source: "FREIGHTER_EXTERNAL_MSG_RESPONSE"` and the field `messagedId`. Keep that spelling. The request contained `transactionXdr`, `network`, `networkPassphrase`, and `accountToSign`. Some fields were empty, so the site banner and endpoint supplied independent network evidence.

The site also checked `window.freighter` synchronously. The helper's `--legacy-flag` sets it only when the site needs that check. Modern Freighter clients may use different objects, promises, and response shapes. Inspect the actual site before using this helper.

The helper also captures `SUBMIT_BLOB` and `SUBMIT_AUTH_ENTRY` from clients that use this transport. It does not return signatures for those requests. Inspect the exact payload and its use before choosing another signer path. A signed message that becomes a browser-stored private key conflicts with projects that keep private keys inside 1Password. The OpenZeppelin confidential-token demo had this behavior on 2026-09-25.

## Capture

Run commands from this skill directory, or use its absolute path. Load `agent-browser skills get core` first. Use one named browser session.

```sh
export AGENT_BROWSER_SESSION="$(agent-browser session id --scope worktree --prefix walleterm-site)"
agent-browser open https://stellarterm.com/testnet
agent-browser snapshot -i
bun scripts/legacy-freighter.ts inject --public-key G... --origin https://stellarterm.com --legacy-flag | agent-browser eval --stdin
```

After injection, use a site route change to rerender a page that already displayed an absent-wallet state. A full reload clears the bridge. Log in through the site's wallet button. Read pending requests before touching Walleterm.

```sh
agent-browser eval 'window.__walletermBridge.pending()'
agent-browser eval 'window.__walletermBridge.requests[0].transactionXdr' > request.json
bun -e 'const fs=require("node:fs");fs.writeFileSync("unsigned.xdr",JSON.parse(fs.readFileSync("request.json","utf8"))+"\n",{mode:0o600})'
stellar tx decode unsigned.xdr
stellar tx hash --network-passphrase 'Test SDF Network ; September 2015' unsigned.xdr
```

The pending list shows the request index and site network fields. The request file contains public XDR. Keep it fixed after review. Compare the decoded operation with the user's grant. Use a new file for each request.

For a `SUBMIT_BLOB` request, inspect `window.__walletermBridge.requests[index].blob` and the site's use of its signature. For `SUBMIT_AUTH_ENTRY`, inspect `entryXdr`, account, and network passphrase. The `reply` command accepts only `SUBMIT_TRANSACTION`. It leaves other requests pending without signing.

## Return one reviewed V1 envelope

Put the selected full G-address and reviewed digest in `sign-request.json`. Send one signing request. The helper accepts only a V1 transaction envelope. Read the core `walleterm` skill for other signature formats.

```sh
walleterm sign < sign-request.json > signature.json
python3 scripts/classic-attach.py \
  --unsigned unsigned.xdr \
  --signature signature.json \
  --expected-public-key SELECTED_G_ADDRESS \
  --network-passphrase 'Test SDF Network ; September 2015' \
  --expected-hash REVIEWED_HASH \
  --output signed.xdr
bun scripts/legacy-freighter.ts reply \
  --index 0 \
  --public-key SELECTED_G_ADDRESS \
  --unsigned-xdr unsigned.xdr \
  --signed-xdr signed.xdr \
  --expected-hash REVIEWED_HASH | agent-browser eval --stdin
```

The attach and reply helpers verify the new Ed25519 signature for the selected key and reviewed hash.
The reply helper also checks both hashes, the V1 body, and the earlier signatures. The page bridge checks the original XDR against the pending request. The site can submit after the reply. Query the original hash before any retry if the result becomes uncertain.

The helper supports testnet only. It does not sign, submit, or verify ledger success. The agent must check Horizon or RPC after each return. Record final balances, trustlines, offers, and contract state as applicable.
