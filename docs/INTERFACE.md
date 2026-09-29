# CLI interface

This interface freezes the first implementation contract.
The binary name is `walleterm`. A `stellar-walleterm` alias enables Stellar CLI plugin dispatch.

## Commands

```text
walleterm list [--human]
walleterm sign < request.json
walleterm tunnel [--port 8787]
walleterm demo [--port 8788]
walleterm --help
walleterm --version
```

`tunnel` starts the independent signing bridge and its Cloudflare Quick Tunnel.
It needs no recipient, demo, or website build.
It accepts supported unsigned testnet XDR and SEP-53 messages through the [bridge protocol](BRIDGE-PROTOCOL.md).
It returns signed XDR or a signature to the requesting website. It never builds or submits transactions.
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

Both commands run inside the one `walleterm` binary. It embeds the demo website files.
No JavaScript runtime starts. The tunnel reads only `OP_VAULT` from `.env` in the working directory.
The tunnel prints its wallet filter at startup. It warns about `OP_VAULT` in other `.env.*` files, which it ignores.
Public mode needs cloudflared. The signing bridge also needs macOS and the 1Password SSH agent.
Each public service owns a private temporary Cloudflare configuration and a supervised child process.
Startup waits up to 45 seconds for the public URL. A failure names the last check error.
Checks ask the `/etc/resolv.conf` nameservers directly for the tunnel name's IPv4 address.
They do not use the macOS resolver cache. That cache can keep a missing-name answer for a new tunnel.
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
Before it signs a message, it prints one line with the origin, key, byte count, digest, and escaped text:

```text
Message request from https://example.com for G... (43 bytes, digest <hex>, no network, site, or expiry binding): "example.com asks..."
```

The text uses the escapes of the `sign` notice. The line states that the signature binds no network, site, or expiry.
Earlier versions kept records in `~/Library/Application Support/walleterm/bridge`. The bridge no longer reads that directory.

`tunnel` and `demo` always print readable public links. They print QR codes when the terminal is wide enough.
In a narrow terminal, they show the required width and keep the URL and connection code available for manual entry.
The bridge prints its URL, connection code, and a QR code with both. The demo prints a QR code for its public website.
These interactive commands have no `--human` or `--public` flag.

The public URL and connection code can go to a website. The connected website can then request signatures.
A connected website can list available 1Password Ed25519 public keys, with their comments and fingerprints.
Set `OP_VAULT` to a vault name or ID to limit website wallets to that vault.
The tunnel reads `.env` from the command's working directory with Bun's `.env` syntax rules.
An exported shell variable overrides the file.
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
Bridge sessions remain in memory. The browser SDK saves its bridge URL and session token in `localStorage`.
All tabs of the website share that session. `storageKey: null` keeps it in memory only.
A reload or a new tab checks the session before enabling transaction actions. Expired sessions require a new code.
Disconnect clears the saved session. Recovery never repeats signing or submission.
The bridge signs each valid request without a terminal step. Ctrl+C stops the tunnel.
A 1Password prompt can still require the Mac. Cached 1Password approval can suppress a fresh desktop prompt.
Use only dedicated testnet keys. Any website that holds a valid session can request signatures.
A message signature is valid on every network. Never use a Walleterm key as an identity for another service.

The bridge filters no operations. It signs testnet V1 or fee-bump envelopes that need the selected key.
It refuses a nonzero `max_time` at or before now. No other time rule applies. See [the protocol](BRIDGE-PROTOCOL.md).
An integration adapter is required. An unchanged website does not automatically discover Walleterm.

`list` returns the Ed25519 public identities exposed by the explicit 1Password socket.
It does not prove vault membership. Comments are display metadata, never signer identifiers.
Skip unsupported key types. Reject duplicate Ed25519 identities.
A fingerprint is `SHA256:` followed by unpadded Base64 of SHA-256 over the SSH public key blob.

```json
{"ok":true,"signers":[{"public_key":"G...","fingerprint":"SHA256:...","comment":"display metadata"}]}
```

## Sign

`sign` reads one JSON object from standard input. It takes no flags. The fields select one of four shapes.

| Shape | Exact key set |
| --- | --- |
| Transaction | `public_key`, `network_passphrase`, `transaction_xdr` |
| Authorization preimage | `public_key`, `network_passphrase`, `preimage_xdr` |
| Authorization entry | `public_key`, `network_passphrase`, `auth_entry_xdr`, `address`, `adapter` |
| Message | `public_key`, `message` |

```json
{"public_key":"G...","network_passphrase":"Test SDF Network ; September 2015","transaction_xdr":"AAAAAgAAAA..."}
{"public_key":"G...","network_passphrase":"Test SDF Network ; September 2015","preimage_xdr":"AAAACs7gMC1Z..."}
{"public_key":"G...","network_passphrase":"Test SDF Network ; September 2015","auth_entry_xdr":"AAAAAg...","address":"C...","adapter":{"type":"contract-ed25519"}}
{"public_key":"G...","message":"example.com asks GABC... to prove key control. Nonce: 5f1c. Expires: 2026-09-28T19:00:00Z."}
```

The parser applies these rules in order:

1. Read at most 393216 bytes, then require EOF.
2. Require valid UTF-8. The parser never replaces invalid bytes.
3. Parse exactly one JSON object. Permit only whitespace after it.
4. Reject duplicate keys at every depth, including inside `adapter`.
5. Require exactly one artifact key: `transaction_xdr`, `preimage_xdr`, `auth_entry_xdr`, or `message`.
6. Require the exact key set of that shape. A missing, extra, or unknown key fails. `latest_ledger` is an unknown key.
7. Require JSON strings for text fields and a JSON object for `adapter`.
8. Reject empty strings.

`public_key` must be a canonical checksummed Ed25519 G-address.
`network_passphrase` must contain 1–256 UTF-16 units and more than whitespace.
The CLI accepts any network. It hashes the exact passphrase bytes. A message binds no network, so it has no passphrase.
Every rule failure returns `invalid_input` with exit code 2. It makes no agent connection.

| Shape | Rules | Signed digest |
| --- | --- | --- |
| Transaction | Canonical Base64 V1 or fee-bump envelope of 262144 characters or fewer. V0 fails. At most 19 existing signatures. The selected key has no valid signature yet. A nonzero `max_time` at or before now fails. A fee bump uses its inner bounds. | SHA-256 of XDR `TransactionSignaturePayload`. A fee bump uses the outer payload. |
| Preimage | Canonical `HashIdPreimage` of 32768 characters or fewer. Only `envelopeTypeSorobanAuthorizationWithAddress`. Its network ID equals SHA-256 of the passphrase. The bound address is any G- or C-address. | SHA-256 of the preimage bytes. |
| Entry | Canonical `SorobanAuthorizationEntry` of 32768 characters or fewer with `sorobanCredentialsAddressV2`. Its signature is `scvVoid`. `address` equals the credential address. | The adapter digest. |
| Message | UTF-8 text of 1–1024 bytes. No binary input, no precomputed hash, and no Unicode normalization. | SEP-53: SHA-256 of `"Stellar Signed Message:\n"` followed by the text bytes. |

Preimages and entries permit 256 invocation contexts and 32 levels.
No shape reads a ledger. The network refuses an expired authorization.
Expiration ledger 0 is the only expiry rule. Simulation leaves it at 0 when the caller never sets it.

The CLI checks no transaction signer role and no preimage bound address.
A multisig co-signer signs envelopes and entries for another account. The calling agent checks account signers and thresholds.
The bridge keeps both rules, because a connected website is less trusted than the local agent.

The entry shape rejects SourceAccount, delegated, and legacy V1 credentials.
V1 lacks address binding and permits signature reuse across addresses.
The SDK helpers can parse a V1 entry, because a transaction can carry signed V1 entries from other signers.
They never create, rebuild, or sign a V1 entry.

Adapters for the entry shape:

- `{"type":"account"}` signs for a native G-address. `address` must equal `public_key`.
- `{"type":"contract-ed25519"}` produces an `scvBytes` raw signature for a C-account.
- `{"type":"openzeppelin-ed25519","verifier":"C...","context_rule_ids":[0]}` uses the pinned external Ed25519 schema.

The OpenZeppelin adapter requires one uint32 rule ID per invocation context.
It signs the additional digest described in [OPENZEPPELIN.md](OPENZEPPELIN.md).
The caller selects the contract adapter and verifies the account's deployed policy and ownership.
A C-address and public key declaration cannot establish ownership.
The signer validates the requested binding and signature format without querying contract state.
Enforce-simulate before submission.

Walleterm sends the 32 digest bytes directly to the SSH agent with flags zero.
It does not hash them again. It does not use SSHSIG or `ssh-keygen -Y sign`.
It matches the full public key against agent identities before signing.
It verifies the signature strictly before it attaches or returns it. The command returns one signature per invocation.

Every success has `ok`, `public_key`, `digest`, `signature`, and `verified: true`.
`digest` is the 32 bytes that the key signed. `signature` is the raw 64-byte Ed25519 signature.
Both use lowercase hexadecimal.

| Shape | Added field |
| --- | --- |
| Transaction | `signed_transaction_xdr`: the input envelope with one appended signature. |
| Preimage | None. |
| Entry | `signed_auth_entry_xdr`: the input entry with only its signature value changed. |
| Message | None. |

```json
{"ok":true,"public_key":"G...","digest":"<64 hex>","signature":"<128 hex>","signed_transaction_xdr":"AAAAAgAAAA...","verified":true}
```

The entry shape returns `signature` too. A 2-of-3 OpenZeppelin account and a G-account multisig need several raw signatures in one credential.
Each call returns one signer, so the caller merges the raw signatures.

Verify a message signature with one of these checks:

- SDK: `Keypair.fromPublicKey(G).verifyMessage(message, Buffer.from(signature, 'hex'))`.
- Stellar CLI: `stellar message verify "<message>" --signature <Base64> --public-key G...`. Convert the hexadecimal signature to Base64.
  Pass the message as an argument. Standard input loses one trailing newline.
- Any Ed25519 library: verify the signature over the SEP-53 digest.

A SEP-53 signature is a permanent, portable proof that the key approved the text.
It binds no network, site, nonce, or expiry, unless the text contains them.
Never use a Walleterm key as an identity or a key-derivation source for another service.

| Limit | Value |
| --- | --- |
| Standard input | 393216 bytes |
| `transaction_xdr` | 262144 characters |
| `preimage_xdr`, `auth_entry_xdr` | 32768 characters |
| `message` | 1–1024 UTF-8 bytes |
| `network_passphrase` | 1–256 UTF-16 units |
| Invocation tree | 256 contexts and 32 levels |
| Deadline | One 120-second absolute deadline for input, agent connection, listing, and signing |

Before the agent request, the CLI writes one notice line to standard error:

```text
Sign transaction <digest> on testnet with G....
Sign authorization preimage <digest> for C... on testnet with G..., expiring at ledger 123500.
Sign authorization entry <digest> for C... (contract-ed25519) on testnet with G..., expiring at ledger 123500.
Sign SEP-53 message <digest> with G... (43 bytes, no network, site, or expiry binding): "example.com asks..."
```

The notice names `testnet`, `pubnet`, and `futurenet` for their exact passphrases. It quotes any other passphrase.
The message text uses Go `strconv.Quote` escapes. Control, format, bidirectional, separator, and private-use characters appear as escapes.

## Errors and output

Return one JSON object on standard output and exit nonzero on failure.

```json
{"ok":false,"error":{"code":"invalid_input","message":"Provide exactly one of transaction_xdr, preimage_xdr, auth_entry_xdr, or message."}}
```

Use stable codes: `invalid_input`, `unsupported_platform`, `agent_unavailable`, `agent_protocol`, `key_not_found`, `signing_refused`, `timeout`, `invalid_signature`, `output_error`.
Use exit code 2 for invalid input and exit code 1 for other failures.
Use exit code 0 for success, help, and version.
Help, version, tunnel, and demo use readable text. List and sign return JSON.
`list --human` prints one readable line for each signer. `sign` has no readable format.
If the notice fails, return `output_error` without requesting a signature.
If a result cannot be written, exit nonzero without retrying signing or output.
On SIGINT or SIGTERM, `sign` exits by the signal and prints no JSON line.
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

Walleterm computes the digest from the artifact. 1Password signs only those 32 bytes.
1Password does not display the network, amount, destination, or contract policy.
The caller must review the exact artifact before it requests a signature.
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

## Browser authorization API

The browser SDK is a [SEP-43](SEP-43.md) wallet. SEP-43 `signAuthEntry` signs an address-bound preimage:

```ts
const preimage = buildAuthorizationEntryPreimage(entry, expirationLedger, Networks.TESTNET);
const { signedAuthEntry, signerAddress, error } = await wallet.signAuthEntry(preimage.toXDR('base64'));
// signedAuthEntry: Base64 Ed25519 signature bytes over SHA-256 of the preimage.
```

The website attaches that signature in its account's format, for example with SDK `authorizeEntry`.
The preimage must be `envelopeTypeSorobanAuthorizationWithAddress`.
The bridge requires the selected G-address or a C-address as its bound address.

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
Omitting `adapter` selects `{ type: 'account' }`.
The SDK copies the adapter before asynchronous work.
It verifies the entire returned artifact before exposing it.
No check reads a ledger. The network enforces expiry. Expiration ledger 0 fails.

Portable exports from `sdk/walleterm.ts` and `sdk/authorization.ts`:

- `createAuthEntry({ address, invocation, nonce, expirationLedger })` returns Base64 XDR with AddressV2 credentials.
- `setAuthEntryExpiration(authEntryXdr, expirationLedger)` sets expiry on an unsigned AddressV2 entry.
- `parseAuthEntry(authEntryXdr)` returns the canonical, bounded XDR entry.
- `addressCredentials(entry)` returns explicit V1/V2 address credentials without conversion.
- `countAuthContexts(invocation)` counts the complete bounded invocation tree.
- `inspectAuthEntry(input, selectedPublicKey)` validates the request and computes the digest.
- `attachAuthSignature(input, publicKey, signatureHex)` verifies and attaches one signature.
- `verifyAuthEntrySignature(input, signedAuthEntryXdr)` returns `true` or throws.

`input` contains the five entry shape fields: `auth_entry_xdr`, `network_passphrase`, `public_key`, `address`, and `adapter`.
These helpers do not contact an RPC server or a signer.

Both SDK signing methods verify the returned artifact before exposing it.
Transaction verification binds the complete requested body, network hash, selected G-key, signature hint, and one valid envelope signature.
A failed verification after a signed response reports code `-1` with `requestState: "unknown"`.
The single-session `WalletermClient` throws the same outcome with `canceled: false`.
A missing signed artifact uses the same outcome metadata.
These failures do not prove that signing stopped or that no usable signature exists.
The SDK does not retry signing or claim successful cancellation after these failures.
