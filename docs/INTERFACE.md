# CLI interface

This interface freezes the first implementation contract.
The binary name is `walleterm`. A `stellar-walleterm` alias enables Stellar CLI plugin dispatch.

## Commands

```text
walleterm list [--human]
walleterm sign [--human] < request.json
walleterm sign-auth < request.json
walleterm tunnel [--port 8787]
walleterm demo [--port 8788]
walleterm --help
walleterm --version
```

`tunnel` starts the independent signing bridge and its Cloudflare Quick Tunnel.
It needs no recipient, demo, or website build.
Authorization signing uses a fixed testnet RPC endpoint for current ledger evidence.
It accepts supported unsigned testnet XDR through the [bridge protocol](../bridge/PROTOCOL.md).
It returns signed XDR to the requesting website. It never builds or submits transactions.
A website connects with a single-use eight-digit code and selects a 1Password key.
The default connection stays fixed to that key.
An explicit `wallet_scope: "available"` grant permits changes among the initially displayed eligible wallets.
The first selection pins that list. Later keys require a new connection.
Scoped requests carry a selection revision. Wallet changes cancel unfinished requests and withhold old bridge results.
The website approves each request by sending it. The tunnel terminal needs no input.

`demo` starts an independent website and its own public Quick Tunnel for phone testing.
Its local listener binds `127.0.0.1` on port 8788 by default.
Stopping the demo does not stop the bridge. Stopping the bridge does not stop the demo.
The demo uses the same [browser client](../sdk/walleterm.ts) that another integrated website can use.
The demo pays the source account of a recent testnet operation. It checks that this account exists.
The review shows the selected payment recipient. Neither command accepts `--recipient`.

Both commands run in the installed `walleterm-bridge` binary beside `walleterm`.
That binary includes the Bun runtime and the website files.
It ignores `bunfig.toml` and `.env` in the working directory. The tunnel reads only `OP_VAULT` from `.env`.
Public mode needs cloudflared. The signing bridge also needs macOS and the 1Password SSH agent.
Each public service owns a private temporary Cloudflare configuration and a supervised child process.
Each service checks its public URL every 15 seconds. Healthy checks produce no log output.
An exit or six failed checks starts tunnel recovery. The local server stays running.
Recovery permits three replacement attempts per ten minutes, with delays of two, four, and eight seconds.
Each replacement prints its new URL and QR code. Recovery never repeats signing or submission.
Recovery pauses when another replacement exceeds this limit. Public checks continue, and the local server stays available.
Recovery resumes when the oldest attempt leaves the ten-minute window. See [connection recovery](CONNECTION-LIFECYCLE.md).
Only PATH, HOME, TMPDIR, and LANG enter the tunnel environment. Existing Cloudflare configuration remains unchanged.
Listeners and tunnel metrics bind loopback. Ctrl+C stops only that command's server and tunnel.
A parent pipe stops the tunnel after a parent crash. Shutdown uses bounded termination and cleanup.

The bridge keeps sessions and requests in memory. A restart ends them and never retries a request.
The tunnel terminal prints one line for each produced or withheld signature.
Earlier versions kept records in `~/Library/Application Support/walleterm/bridge`. The bridge no longer reads that directory.

`tunnel` and `demo` always print readable public links. They print QR codes when the terminal is wide enough.
In a narrow terminal, they show the required width and keep the URL and connection code available for manual entry.
The bridge prints its URL, connection code, and a QR code with both. The demo prints a QR code for its public website.
These interactive commands have no `--human` or `--public` flag.

The public URL and connection code can go to a website. The connected website can then request signatures.
A connected website can list available 1Password Ed25519 public keys, with their comments and fingerprints.
Set `OP_VAULT` to a vault name or ID to limit website wallets to that vault.
Bun loads `.env` from the command's working directory. An exported shell variable overrides the file.
Restart the tunnel after changing this setting. The installer does not copy `.env`.
Vault filtering requires the 1Password CLI. The bridge reads only item metadata and public key fields.
It matches full public keys against the agent list. Comments never establish vault membership.
Lookup failures stop discovery. An empty vault returns no wallets.
The bridge checks vault membership again before signing. An unset or empty `OP_VAULT` lists all Ed25519 agent keys.
`OP_VAULT` does not change the local `list` or `sign` commands.
Agent discovery permits ten seconds. Vault lookup then permits 120 seconds, including public key reads.
The SDK permits 135 seconds for discovery and selection. Caller cancellation still applies.
CLI child cleanup escalates from SIGTERM to SIGKILL after 1.5 seconds when needed.
Each code works once and expires after five minutes. Five incorrect codes replace the code and pause connection for one minute.
A website session lasts one hour after the first key selection. Wallet changes do not renew it. Restart the tunnel to revoke all sessions.
Bridge sessions remain in memory. The browser SDK saves its bridge URL and session token in `sessionStorage` for the current tab.
`sessionStorageKey: null` keeps them in memory only.
Reload checks the session before enabling transaction actions. Expired sessions require a new code.
Disconnect clears the saved session. Recovery never repeats signing or submission.
The bridge signs each valid request without a terminal step. Ctrl+C stops the tunnel.
A 1Password prompt can still require the Mac. Cached 1Password approval can suppress a fresh desktop prompt.
Use only dedicated testnet keys. Any website that holds a valid session can request signatures.

The bridge filters no operations. It signs testnet V1 or fee-bump envelopes that need the selected key.
Time bounds must be valid now and end within five minutes. See [the protocol](../bridge/PROTOCOL.md) for the structural rules.
An integration adapter is required. An unchanged website does not automatically discover Walleterm.

`list` returns the Ed25519 public identities exposed by the explicit 1Password socket.
It does not prove vault membership. Comments are display metadata, never signer identifiers.
Skip unsupported key types. Reject duplicate Ed25519 identities.
A fingerprint is `SHA256:` followed by unpadded Base64 of SHA-256 over the SSH public key blob.

```json
{"ok":true,"signers":[{"public_key":"G...","fingerprint":"SHA256:...","comment":"display metadata"}]}
```

`sign` accepts exactly one JSON object with two required string fields.

```json
{"public_key":"G...","digest":"64 lowercase hexadecimal characters"}
```

`public_key` must be a canonical checksummed Ed25519 G-address.
`digest` must contain exactly 64 lowercase hexadecimal characters.
Reject unknown fields, duplicate fields, trailing JSON, empty input, and input above 4096 bytes.
Decode the digest to 32 bytes. Send those bytes directly to the SSH agent with flags zero.
Do not hash the digest again. Do not use SSHSIG or `ssh-keygen -Y sign`.
Match the full public key against agent identities before signing.

```json
{"ok":true,"public_key":"G...","digest":"...","signature":"128 lowercase hexadecimal characters","verified":true}
```

The signature contains raw Ed25519 bytes after removal of the SSH response wrapper.
Verify the signature independently before returning it.
The command returns one signature per invocation.

## Errors and output

Return one JSON object on standard output and exit nonzero on failure.

```json
{"ok":false,"error":{"code":"invalid_input","message":"The digest must contain 64 lowercase hexadecimal characters."}}
```

Use stable codes: `invalid_input`, `unsupported_platform`, `agent_unavailable`, `agent_protocol`, `key_not_found`, `signing_refused`, `timeout`, `invalid_signature`, `output_error`.
Use exit code 2 for invalid input and exit code 1 for other failures.
Use exit code 0 for success, help, and version.
Help, version, tunnel, and demo use readable text. List and sign default to JSON.
`--human` applies to list and sign and changes formatting only. It does not change signing behavior or error status.
Print a concise key and digest notice to standard error before requesting a signature.
If that notice fails, return `output_error` without requesting a signature.
If a result cannot be written, exit nonzero without retrying signing or output.
Never claim that 1Password displays or approves Stellar transaction details.

## Runtime limits

- Use only `~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock` on macOS.
- Do not expose a runtime socket override or use `SSH_AUTH_SOCK`.
- Verify socket type, owner, and restrictive permissions before connecting.
- Bound each response frame to 1 MiB and each identity list to 1024 entries.
- Use one 120-second absolute deadline for pollable signing input and SSH-agent connection establishment.
  The same deadline covers identity listing and signing reads and writes.
  Signing input requires EOF. Regular input files finish normally; non-pollable streams may need a caller timeout.
- Standard output and standard error writes have no internal deadline. Callers must drain both streams concurrently while the command runs.
  For bounded process completion, callers must enforce an outer timeout, terminate the child, and wait for its exit.
  Blocked output can delay connection cleanup. Missing output can follow completed signing and does not authorize automatic signing retries.
- Reject invalid lengths, unsupported response types, invalid algorithms, and trailing data inside a response.
- Close connections on completion, failure, and timeout.
- Do not retry signing automatically.
- Inject a mock socket only through an internal test function.

## Deliberate limits

The command signs a digest. It cannot determine that digest's network, amount, destination, or contract policy.
The caller must inspect and approve the exact source artifact before computing the digest.
The signature proves possession of the selected key. It does not attest the key's creation or storage history.
The fixed socket and filesystem checks do not defeat a compromised local user account.

Manage key creation, naming, rotation, and archival in 1Password.
Generate live test keys inside the desktop app.
Use deterministic or temporary mock keys only for offline tests. Never fund or submit transactions with mock keys.

## SSH wire reference

An SSH string contains a big-endian 32-bit length followed by its bytes.
Each message starts with a big-endian 32-bit body length.
Listing uses request type 11 and response type 12.
Signing uses request type 13: key blob, digest string, and flags zero.
The Ed25519 key blob contains strings for `ssh-ed25519` and the 32-byte public key.
Response type 14 contains a signature blob with algorithm and 64-byte signature strings.
Response type 5 reports generic agent failure. It does not prove that the user selected Deny.
One signing connection handles listing and signing. It closes after the command.
See [RFC 9987](https://www.rfc-editor.org/rfc/rfc9987) and [RFC 8709](https://www.rfc-editor.org/rfc/rfc8709).

## Structured authorization signing

```text
walleterm sign-auth < request.json
```

`sign-auth` validates one explicit authorization entry through the installed `walleterm-bridge` sidecar.
The unchanged Go `sign` command handles the 1Password socket and raw digest signature.
The sidecar never builds, simulates, deploys, or submits transactions.
It does not load `.env` or `bunfig.toml` files.
A missing sidecar returns `start_failed`.

```json
{
  "auth_entry_xdr": "canonical Base64 SorobanAuthorizationEntry",
  "network_passphrase": "Test SDF Network ; September 2015",
  "public_key": "selected G-address",
  "address": "authorized G-address or C-address",
  "adapter": { "type": "contract-ed25519" },
  "latest_ledger": 12345
}
```

The entry contains its final nonce, invocation tree, and expiration ledger.
Its signature must be `scvVoid`.
Expiration must exceed `latest_ledger` by 1–60 ledgers.
The local caller supplies trusted, current ledger evidence.
The CLI cannot establish its freshness without network access.
The bridge obtains its own trusted ledger instead.

The new signing APIs require `sorobanCredentialsAddressV2`.
They reject SourceAccount, delegated credentials, and legacy V1 credentials.
V1 lacks address binding and permits signature reuse across addresses.
The helpers can parse a V1 entry, because a transaction can carry signed V1 entries from other signers.
They never create, rebuild, or sign a V1 entry.

Adapters:

- `{"type":"account"}` signs for the selected native G-address.
- `{"type":"contract-ed25519"}` produces an `scvBytes` raw signature for a C-account.
- `{"type":"openzeppelin-ed25519","verifier":"C...","context_rule_ids":[0]}` uses the pinned external Ed25519 schema.

The OpenZeppelin adapter requires one uint32 rule ID per invocation context.
It signs the additional digest described in [OPENZEPPELIN.md](OPENZEPPELIN.md).
The caller selects the contract adapter and verifies the account's deployed policy and ownership.
A C-address and public key declaration cannot establish ownership.
The signer validates the requested binding and signature format without querying contract state.
The website must enforce-simulate before submission.

The command returns:

```json
{
  "ok": true,
  "public_key": "G...",
  "digest": "64 lowercase hexadecimal characters",
  "signed_auth_entry_xdr": "canonical Base64 SorobanAuthorizationEntry",
  "verified": true
}
```

Only the signature field changes.
Independent verification checks the exact digest before output.
The input limit is 49152 bytes. The authorization XDR limit is 32768 Base64 characters.
Invocation trees permit 256 contexts and 32 levels.
Unknown fields, duplicate JSON fields, malformed XDR, noncanonical XDR, and existing signatures fail before signing.
The command permits 120 seconds, including input and signing.
Invalid input exits with code 2. Other failures exit with code 1.
The command never retries signing.

### Browser authorization API

The browser SDK is a [SEP-43](SEP-43.md) wallet. SEP-43 `signAuthEntry` signs an address-bound preimage:

```ts
const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, Networks.TESTNET);
const { signedAuthEntry, signerAddress, error } = await wallet.signAuthEntry(preimage.toXDR('base64'));
// signedAuthEntry: Base64 Ed25519 signature bytes over SHA-256 of the preimage.
```

The website attaches that signature in its account's format, for example with SDK `authorizeEntry`.
The preimage must be `envelopeTypeSorobanAuthorizationWithAddress`. Its expiry window is 120 ledgers.

For an adapter digest, the Walleterm extension signs a complete AddressV2 entry:

```ts
const result = await wallet.signAuthorization(authEntryXdr, {
  address: contractId,
  adapter: { type: 'contract-ed25519' },
  networkPassphrase: Networks.TESTNET,
  signal,
  onProgress,
});
// result: { signedAuthEntryXdr, signerAddress }, or empty fields with error.
```

`address` identifies the authorization address. `signerAddress` identifies the selected G-key.
Omitting `adapter` selects `{ type: 'account' }`. Its expiry window is 60 ledgers.
The SDK copies the adapter before asynchronous work.
It verifies the entire returned artifact before exposing it.
The bridge supplies ledger freshness. SDK verification does not independently query the network.

Portable exports from `sdk/walleterm.ts` and `sdk/authorization.ts`:

- `createAuthEntry({ address, invocation, nonce, expirationLedger })` returns Base64 XDR with AddressV2 credentials.
- `setAuthEntryExpiration(authEntryXdr, expirationLedger)` sets expiry on an unsigned AddressV2 entry.
- `parseAuthEntry(authEntryXdr)` returns the canonical, bounded XDR entry.
- `addressCredentials(entry)` returns explicit V1/V2 address credentials without conversion.
- `countAuthContexts(invocation)` counts the complete bounded invocation tree.
- `inspectAuthEntry(input, selectedPublicKey, latestLedger)` validates the request and computes the digest.
- `attachAuthSignature(input, publicKey, latestLedger, signatureHex)` verifies and attaches one signature.
- `verifyAuthEntrySignature(input, signedAuthEntryXdr, latestLedger)` returns `true` or throws.

`input` contains the six CLI fields except `latest_ledger`.
These helpers do not contact an RPC server or a signer.

Both SDK signing methods verify the returned artifact before exposing it.
Transaction verification binds the complete requested body, network hash, selected G-key, signature hint, and one valid envelope signature.
A failed verification after a signed response reports code `-1` with `requestState: "unknown"`.
The single-session `WalletermClient` throws the same outcome with `canceled: false`.
A missing signed artifact uses the same outcome metadata.
These failures do not prove that signing stopped or that no usable signature exists.
The SDK does not retry signing or claim successful cancellation after these failures.
