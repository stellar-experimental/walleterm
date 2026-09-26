# CLI interface

This interface freezes the first implementation contract.
The binary name is `walleterm`. A `stellar-walleterm` alias enables Stellar CLI plugin dispatch.

## Commands

```text
walleterm list [--human]
walleterm sign [--human] < request.json
walleterm tunnel [--port 8787]
walleterm demo [--port 8788]
walleterm --help
walleterm --version
```

`tunnel` starts the independent signing bridge and its Cloudflare Quick Tunnel.
It needs no recipient, demo, website build, or network connection to Stellar.
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

Both commands need Bun 1.4.2 or later and the installed assets.
`make install` builds the browser JavaScript and installs the TypeScript service files.
Public mode needs cloudflared. The signing bridge also needs macOS and the 1Password SSH agent.
Each public service owns a private temporary Cloudflare configuration and a supervised child process.
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
Website sessions and SDK credentials remain in memory. A website reload requires a new code.
The bridge signs each valid request without a terminal step. Ctrl+C stops the tunnel.
A 1Password prompt can still require the Mac. Cached 1Password approval can suppress a fresh desktop prompt.
Use only dedicated testnet keys. Any website that holds a valid session can request signatures.

The bridge supports one classic testnet operation per transaction. See [the protocol](../bridge/PROTOCOL.md) for limits.
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
- Use a 120-second absolute deadline for the full list-and-sign operation and pollable standard input.
  Signing input requires EOF. Regular input files finish normally; non-pollable streams may need a caller timeout.
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
