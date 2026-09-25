# CLI interface

This interface freezes the first implementation contract.
The binary name is `walleterm`. A `stellar-walleterm` alias enables Stellar CLI plugin dispatch.

## Commands

```text
walleterm list [--human]
walleterm sign [--human] < request.json
walleterm web --signer G... --recipient G... [--port 8787] [--state-dir PATH] [--human]
walleterm --help
walleterm --version
```

`web` is an optional testnet companion. It leaves the `list` and `sign` signing contract unchanged.
It starts the local web server and a Cloudflare Quick Tunnel as child work of one long-running command.
It stops both when the command receives SIGINT or SIGTERM, or when the tunnel exits.
It requires local `node`, `cloudflared`, and the installed web assets. It never accepts a private key.
The signer and recipient must be explicit canonical G-addresses. The server binds `127.0.0.1`.
The default port is 8787. The default journal is `~/Library/Application Support/walleterm/web`.
Keep the journal after an uncertain submission. A restart creates a new pairing link but preserves the journal.

After both the tunnel and site respond, JSON mode prints one ready event:

```json
{"ok":true,"event":"web_ready","url":"https://...trycloudflare.com","pair_url":"https://...trycloudflare.com/pair#code=...","expires_at":"...","state_dir":"..."}
```

`--human` prints a QR code, the same copyable link, its expiry, and a stop instruction.
The QR code and link contain one 256-bit pairing code. They expire after five minutes and work once.
The browser clears the URL fragment before sending the code through HTTPS. The server issues one session cookie.
Keep the pairing link private. A different browser needs a new command run after the first browser pairs.
No short-link service or six-digit code is part of this interface.

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
Help and version use plain text. All other output defaults to JSON.
`--human` changes formatting only. It does not change signing behavior or error status.
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
