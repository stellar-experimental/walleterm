# Design: one `walleterm sign` and SEP-43 `signMessage`

Author: Claude Opus 5.5 (`claude-opus-5-5`), sign-design worker for the coordinator in Herdr pane `w44:p10`.
Date: 2026-09-28. Research base: `main` at `31aac1833654ec46be7e46f1d3dd7c97b419f2bd`.
Recorded on `main` at `ad684c8d8a8925635bed5ed21c9704866eb90e7d`. Changes #29 and #31 do not affect this design.
Rust port read: the `feat/rust-everywhere` worktree and its plan `ASTRA-PLAN-v2.md`, both on 2026-09-28.
The user approved the decisions in [section 6](#6-decisions) on 2026-09-28.

Status: design only. Implementation waits for the Rust port to merge to `main`.
No live signature, 1Password request, or testnet submission supports this record.

## 1. Summary

- One `walleterm sign` replaces `sign` and `sign-auth`. The input fields select one of four shapes: transaction, authorization preimage, authorization entry, and message.
- The raw digest shape goes away. After the port, every real caller maps to a structured shape. The formats that lose support are refused or unsupported already.
- SEP-53 message signing is added for the CLI and for SEP-43 `signMessage`. Walleterm hashes the text itself. It never accepts a precomputed hash.
- A bridge message request uses the approval model of the other kinds: the connected website approves it by sending it.
  The tunnel prints the escaped text, the byte count, and the digest. The optional `review` hook applies, as for every kind.
- No authorization expiry window remains. The CLI loses `latest_ledger`. The bridge loses its trusted ledger and the fixed testnet RPC. The network enforces expiry.
- The four CLI shapes and the four bridge kinds share one Rust core: inspect, sign 32 bytes, finish. The bridge adds only website rules.

## 2. Sources

All sources were read on 2026-09-28. [The evidence file](evidence/sign-design.json) repeats these identities and the probe results.

| Source | Version and evidence |
| --- | --- |
| [SEP-53](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0053.md) | v1.0.0, Final, updated 2026-06-18. File commit `b1933843`. Repository head `9cd70307` (2026-09-22). |
| [SEP-43](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0043.md) | v1.2.1, Draft. File commit `d4d17e6c`. |
| [Stellar Wallets Kit](https://github.com/Creit-Tech/Stellar-Wallets-Kit/tree/4bdda7124b3a3c84ecfa92af425e61e4985c0ab5) | v2.7.0, commit `4bdda712` (2026-09-23). `src/types/mod.ts`, `src/sdk/kit.ts`, and 11 wallet modules. |
| [Freighter](https://github.com/stellar/freighter/tree/a9409f4d3426122cd2984503ce48c791677800ff) | Extension 5.48.0, commit `a9409f4d` (2026-09-03). `@stellar/freighter-api` 6.0.1. Files are listed in section 4.1. |
| `@stellar/stellar-sdk` | 17.1.0 from `bun.lock`. `Keypair.signMessage` and `Keypair.verifyMessage` in `lib/esm/base/keypair.js`. |
| Stellar CLI | 28.0.0 (`300aaf69`), the CI version. `stellar message sign` and `verify` shipped in v25.0.0 (PR #2346, merge `d2cb31dc`). |
| Rust crates | `ed25519-dalek` 2.2.0, `serde_json` 1.0.151, `sha2` 0.10.9, and `base64` 0.22.1, as the port's `Cargo.lock` pins them. |
| [ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) | Final. It binds the message domain to the requesting origin. It is prior art only. |

Research used the GitHub API for pinned files and Stellar Raven (`scout.searchResearch`, `stellarDocs.*`).
Raven found the Stellar CLI `message` command and its v25.0.0 release note.
`parallel-cli` 0.9.3 ran one search request for ERC-4361. The metered cost was far below the $2 limit.
The balance command needs Account API credentials, so the exact charge is not recorded.

## 3. One `walleterm sign`

### 3.1 Current callers

| Caller | Current use | After this design |
| --- | --- | --- |
| `bridge/signer.ts` | Calls `walleterm sign` with a digest for every bridge signature. | The port removes it. The Rust bridge signs in process with `agent::nonblocking::sign`. |
| `bridge/auth-cli.ts`, `auth_command.go`, `main.go` | The `sign-auth` sidecar calls Go `sign`. | The port removes them. Its `src/cli.rs` `sign_auth` becomes the entry shape. |
| `walleterm` skill, "Sign one digest" | The main agent workflow: compute a digest, sign it, then attach it. | Send the reviewed artifact. Walleterm computes the digest and attaches the signature. |
| `references/classic-native.md` | Transaction hash. V1 and V2 auth payloads. | Transaction shape. Preimage shape (V2 only). |
| `references/fee-bump.md` | The outer payload is built by hand. | Transaction shape on the fee-bump envelope. |
| `references/openzeppelin.md` | `auth_digest` by hand. `sign-auth` for nested entries. | Entry shape with `openzeppelin-ed25519`. The `signature` field serves multi-signer merges. |
| `references/delegation.md` | CAP-71 payload `P`. | Preimage shape bound to the top-level address. |
| `references/structured-auth.md` | `sign-auth`. | Entry shape. |
| Site-bridge `references/message-signing.md` | Computes the SEP-53 hash, then signs the digest. | Message shape. |
| Site-bridge `references/interception.md`, `scripts/classic-attach.py`, `scripts/verify-signature.ts` | Transaction hash as a digest, then attachment. | The transaction shape returns signed XDR. Delete the helper. |
| `tests/live-utils.ts` `signDigest` and `sign` | Every live suite: classic, contracts, extended, CAP-71, and CAP-85. | Preimage, transaction, and entry shapes. The `authorizeEntry` callbacks already receive the preimage. |
| `tests/cli-pipeline.ts` (CLI01) | `stellar tx hash`, then a digest, then `stellar tx encode`. | One transaction shape call. |
| `tests/1password-failure.ts` | SHA-256 of a label as a digest. | Message shape. |
| `tests/openzeppelin-auth-live.ts`, `tests/contract-auth-demo-live.ts` | `sign-auth`. | Entry shape. |
| `scripts/package.test.ts`, `scripts/release.ts` | `sign-auth` smoke checks. | `sign` smoke checks, if the port keeps these files. |
| Docs | `INTERFACE.md`, `CONTRACT-AUTHORIZATION.md`, `OPENZEPPELIN.md`, `AGENTIC-PAYMENTS.md`, `STELLAR-CLI.md`, `PLAN.md`, `LIVE-TESTS.md`, `TEST-MATRIX.md`, and `README.md` describe digest signing or `sign-auth`. | Rewrite. See section 5.3. |
| `site/index.html` | Steps 01–02, the example output, and "The signer sees a digest". | Change the Paper design first, then `site/`. |
| `stellar-walleterm` alias (`Makefile`, `Casks/walleterm.rb`, `scripts/install.ts`) | Forwards arguments and standard input. | No change. `stellar walleterm sign < request.json` works. |

### 3.2 The raw digest shape goes away

- The signer cannot know what a digest approves. It can be a transaction hash on any network or an auth payload for any address.
  It can also be a V1 payload, a CAP-40 signed payload, or a SEP-53 hash.
- A digest input also defeats message safety. Section 4.3 shows the case.
- Each real caller in section 3.1 maps to a structured shape.
- These formats lose support:
  - V1 `sorobanCredentialsAddress` payloads. The project refuses them already (CAP-71-02 cross-address replay).
  - CAP-40 signed-payload signatures over arbitrary bytes. No accepted use case exists.
  - MPP push (about 90 bytes) and MPP Session commitments (192 bytes). They are not 32-byte digests, so the signer never supported them.
  - Future derived-digest account schemes. Each needs a new adapter. The skill already states this rule for C-accounts.
- The live harness negative cases still work:
  - The "naive" OpenZeppelin case signs the host payload. That is the preimage shape.
  - Duplicate-signature cases sign once and copy the signature in the harness.
  - The wrong-network case signs with the other passphrase.
  - The expired case changes. Walleterm now refuses an expired `max_time`, so the test asserts that refusal.
- The historical live evidence stays valid as history. A new live run needs the harness changes in section 5.1.

### 3.3 Input shapes

`walleterm sign < request.json` takes no flags. `--human` goes away for `sign`, because agents read JSON. `list --human` stays.

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

1. Read at most 393216 bytes, then require EOF. This equals the bridge body limit.
2. Require valid UTF-8. Do not use a lossy conversion.
   The port's `parse_sign_input` uses `String::from_utf8_lossy` for Go parity. A probe showed that it turns invalid bytes into U+FFFD.
   That would change message bytes without an error.
3. Parse exactly one JSON object. Permit only whitespace after it.
4. Reject duplicate keys at every depth, including inside `adapter`.
5. Count the artifact keys `transaction_xdr`, `preimage_xdr`, `auth_entry_xdr`, and `message`. Require exactly one.
6. Require the exact key set of that shape. A missing, extra, or unknown key fails. `latest_ledger` is an unknown key.
7. Require JSON strings for text fields and a JSON object for `adapter`.
8. Reject empty strings.

Every failure returns `invalid_input` with exit code 2 and makes no agent connection.
The old `{"public_key","digest"}` input fails at rule 5. `walleterm sign-auth` becomes an unknown command.

### 3.4 Rules per shape

The core applies the shared rules for the CLI and the bridge. The bridge applies its own rules at admission.

| Shape | Shared rules | Bridge rules |
| --- | --- | --- |
| Transaction | Canonical Base64 V1 or fee-bump envelope of 262144 characters or fewer. V0 fails. At most 19 existing signatures. The selected key has no valid signature yet. A nonzero `max_time` at or before now fails; a fee bump uses its inner bounds. Digest: SHA-256 of XDR `TransactionSignaturePayload`, the outer payload for a fee bump. | Testnet only. `address` equals the selected key. The selected key is the transaction source, an operation source, or the fee-bump fee source. |
| Preimage | Canonical `HashIdPreimage` of 32768 characters or fewer. Only `envelopeTypeSorobanAuthorizationWithAddress`. The network ID equals SHA-256 of the passphrase. At most 256 contexts and 32 levels. Expiration ledger 0 fails. Any G- or C-address as the bound address. Digest: SHA-256 of the preimage bytes. | Testnet only. The bound address is the selected G-address or a C-address. |
| Entry | Today's `sign-auth` rules without the ledger window. AddressV2 only. Signature `scvVoid`. `address` equals the credential address. Expiration ledger 0 fails. Adapters `account` (address equals `public_key`), `contract-ed25519`, and `openzeppelin-ed25519` (a verifier and one rule ID per context). Digest per adapter. | Testnet only. The same rules through `auth_address`. |
| Message | UTF-8 text of 1–1024 bytes. Digest: SHA-256 of `"Stellar Signed Message:\n"` followed by the text bytes. No network. | Testnet passphrase in the request, as for every kind. A line in the tunnel output (section 4.8). |

No shape reads a ledger. Neither the CLI nor the bridge checks an authorization expiry window. The network refuses an expired entry.
Expiration ledger 0 is the only expiry rule. It needs no ledger, because ledger 0 is always in the past.
It catches an entry whose expiration was never set, which simulation leaves at 0. It matches the rule for an expired `max_time`.

The CLI does not check the transaction signer role or the preimage bound address.
A multisig co-signer must sign envelopes and entries for another account. Live cases G02–G04, G10, and E01 did this.
The calling agent checks account signers and thresholds. The skill already requires that check.
The bridge keeps both rules, because a connected website is less trusted than the local agent.

### 3.5 Output per shape

Every success has `ok`, `public_key`, `digest`, `signature`, and `verified: true`.
`digest` is the 32 bytes that the key signed. `signature` is the raw 64-byte Ed25519 signature in lowercase hexadecimal.

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

### 3.6 Errors, exit codes, limits, and the notice

- Stable codes: `invalid_input`, `unsupported_platform`, `agent_unavailable`, `agent_protocol`, `key_not_found`, `signing_refused`, `timeout`, `invalid_signature`, and `output_error`.
  The `sign-auth` codes `signing_failed` and `start_failed` go away.
- Exit codes: 0 for success, 2 for `invalid_input`, and 1 for every other failure.
- The core reports reasons such as `invalid_request`, `network_unsupported`, `address_mismatch`, and `unsupported`.
  The CLI maps each reason to `invalid_input` with its specific message. The bridge maps each reason to its SEP-43 code, as `bridge.rs` `sep43()` does now.

| Limit | Value |
| --- | --- |
| Standard input | 393216 bytes |
| `transaction_xdr` | 262144 characters |
| `preimage_xdr`, `auth_entry_xdr` | 32768 characters |
| `message` | 1–1024 UTF-8 bytes |
| `network_passphrase` | 1–256 characters (the existing JavaScript-unit rule) |
| Invocation tree | 256 contexts and 32 levels |
| Deadline | One 120-second absolute deadline for input, agent connection, listing, and signing |

Before the agent request, the CLI writes one notice line to standard error:

```text
Sign transaction <digest> on testnet with G...
Sign authorization preimage <digest> for C... on testnet with G..., expiring at ledger 123500.
Sign authorization entry <digest> for C... (contract-ed25519) on testnet with G..., expiring at ledger 123500.
Sign SEP-53 message <digest> with G... (43 bytes, no network, site, or expiry binding): "example.com asks..."
```

The message text uses the existing `go_quote` escapes. Control, format, bidirectional, and private-use characters appear as escapes.
If the notice write fails, the CLI returns `output_error` and requests no signature. The command never retries signing.

### 3.7 Network passphrase

- CLI: `network_passphrase` is required for the transaction, preimage, and entry shapes. It is forbidden for the message shape.
  The CLI accepts any network. It hashes the exact passphrase bytes.
- The notice names `testnet`, `pubnet`, and `futurenet` for their exact passphrases. It quotes any other passphrase.
- The preimage shape also requires the network ID inside the preimage to match the passphrase.
- Bridge: every request carries `network_passphrase`, and it must be testnet.
  For `message`, this is a session check only. The signature does not bind a network.

### 3.8 One internal path in Rust

The artifact logic moves out of `bridge.rs` and `cli.rs` into one module. Sketch:

```rust
// src/artifact.rs (new)
pub enum Artifact {
    Transaction(String),
    Preimage(String),
    Authorization { entry_xdr: String, address: String, adapter: Value },
    Message(String),
}

pub struct Scope<'a> {
    pub key: &'a str,                // The selected G-address.
    pub passphrase: Option<&'a str>, // None only for Message.
    pub now_ms: u64,                 // For an expired max_time.
}

pub struct Checked { pub key: [u8; 32], pub digest: [u8; 32], pub details: Value }

pub enum Signed { Raw, Transaction(String), AuthEntry(String) }

/// Parse, apply the shared rules, and compute the digest.
pub fn inspect(artifact: &Artifact, scope: &Scope) -> Result<Checked>;
/// Inspect again, verify strictly, then attach. No other byte changes.
pub fn finish(artifact: &Artifact, scope: &Scope, signature: &[u8; 64]) -> Result<Signed>;
```

- `transaction.rs`, `preimage.rs`, and `authorization.rs` keep their parsers and rules. A new `message.rs` holds the message rules.
- The entry adapter path computes its host payload with the preimage digest function.
- The signer-role check moves out of `inspect_transaction_request` into `transaction::signer_role`.
  The bound-address rule moves out of `inspect_auth_preimage`. The bridge calls both at admission.
- The ledger windows, `MAX_AUTH_LEDGER_WINDOW`, `MAX_PREIMAGE_LEDGER_WINDOW`, and every `latest_ledger` parameter go away.
- `bridge.rs` loses its private `inspect` and `attach` bodies. Its `Artifact` enum moves to `artifact.rs` and gains `Message`.
  It also loses `Deps.latest_ledger`, `LedgerFn`, `trusted_ledger`, and the `ledger_unavailable` reason.
  It keeps testnet, `address`, signer role, bound address, the optional review hook, result names, and Base64 encoding.
- `ledger.rs` loses `latest_ledger`, `parse_health`, and `read_health`, and `tests/ledger.rs` goes away.
  The tunnel's public URL checks still use `https_client` and `capped`. Move those two functions to `http.rs`.
  `bridge::production` no longer takes an HTTPS client.
- `cli.rs` keeps the strict parser, the notice, the blocking agent call, and JSON output.
  `SignInput`, `parse_sign_input`, `parse_auth_input`, `sign_auth`, `sign_digest`, and the `sign-auth` dispatch go away.

| Concern | CLI | Bridge |
| --- | --- | --- |
| Network | The caller's passphrase | Testnet only |
| Ledger | None | None |
| Current time | Local clock, for `max_time` | Local clock, for `max_time` and request expiry |
| Signer role and bound address | Not checked | Checked |
| Approval | The calling agent | The website sends the request. The optional review hook applies to every kind. |
| Signature encoding | Lowercase hexadecimal | Base64 for `auth_entry` and `message` |
| Agent call | Blocking `Agent` | `agent::nonblocking::sign` |

## 4. SEP-53 message signing

### 4.1 What the sources require

- SEP-53 v1.0.0 defines the payload as the UTF-8 prefix `"Stellar Signed Message:\n"` followed by the message bytes.
  A string becomes UTF-8. Binary data stays unchanged. The signer signs one SHA-256 of that payload with Ed25519.
- SEP-53 says: "Wallets and libraries MUST clearly display or otherwise confirm the content being signed."
  It sets no length limit and no signature encoding. It has three test cases with a public test seed.
- SEP-43 v1.2.1 defines `signMessage(message: string, opts?: { networkPassphrase?, address? })`.
  It returns `{ signedMessage, signerAddress }`. Its prose says "HEX-encoded".
- Kit 2.7.0 has the same method with an extra `path` option. The Kit core adds the selected network to `opts`.
  The Freighter module returns Base64 and converts a returned Buffer to Base64. Other modules pass the wallet's value through.
  Albedo, Ledger, and Rabet return `-3`.
- Freighter 5.48.0 signs SHA-256 of the prefix and the UTF-8 message.
  The code is `encodeSep53Message` in `extension/src/helpers/stellar.ts` and `handlers/signBlob.ts`.
  `freighterApiMessageListener.ts` returns Base64 for API 4.0.0 or later. Older clients receive a Buffer.
- The Freighter popup shows the site domain, the prefix, the message, the wallet, the network, and a Blockaid site scan.
  The code is `views/SignMessage/index.tsx` and `components/signMessage/index.tsx`. The popup pretty-prints JSON messages.
  It refuses to sign when the requested passphrase differs from its active network. The signature itself binds no network.
  I found no length limit in the files that I read.
- SDK 17.1.0 `Keypair.signMessage(string | Uint8Array)` and `verifyMessage(message, signature)` implement SEP-53.
  `verifyMessage` accepts raw bytes or `xdr.Signature` only. It rejects a Base64 string with `TypeError`.
- Stellar CLI 28.0.0 `stellar message verify` takes a Base64 signature. `--base64` marks a binary message.
  From standard input, it removes one trailing newline. Pass the message as an argument instead.

SEP-43 prose says hexadecimal. Freighter, the Kit Freighter module, and Stellar CLI use Base64.
Walleterm follows Freighter, as it does for `signAuthEntry`. The SEP-43 deviations table must record this.

### 4.2 Domain separation at the byte level

Every Walleterm signature is Ed25519 over a 32-byte SHA-256 output.
A signature for digest D is valid in another scheme only if that scheme's digest is also D.
Two different inputs with one SHA-256 output are a collision. So separation needs different input bytes.

| Scheme | Bytes before SHA-256 | First bytes (probe) |
| --- | --- | --- |
| SEP-53 message | `"Stellar Signed Message:\n"`, then the message | Always `5374656c6c617220` ("Stellar "), then 16 more fixed bytes |
| Transaction | Network ID, `00000002`, transaction | Testnet `cee0302d…`, pubnet `7ac33997…` |
| Fee bump | Network ID, `00000005`, fee-bump transaction | The network ID |
| Auth preimage V2 | `0000000a`, network ID, nonce, expiry, address, invocation | `0000000a` |
| Auth preimage V1 | `00000009`, network ID, nonce, expiry, invocation | `00000009` |
| OpenZeppelin digest | 32-byte host payload hash, then XDR `Vec<U32>` | A hash output. For `[0]`, the tail is `0000001000000001000000010000000300000000`. |

- An auth preimage starts with byte `00`. A SEP-53 payload starts with byte `53`. They never match.
- A transaction payload starts with the network ID. A match needs SHA-256 of a passphrase to start with the 24 prefix bytes.
  That is a 192-bit chosen-prefix preimage search, which is infeasible. The testnet and pubnet IDs start with `ce` and `7a`.
- An OpenZeppelin input starts with a host payload hash. A match needs that hash to start with the 24 prefix bytes. That search is also infeasible.
- Without equal inputs, a cross-scheme signature needs a SHA-256 collision.

So no message can give a signature that is valid for a transaction, an auth preimage, or an OpenZeppelin digest. The reverse is also true.
A CAP-40 signed-payload signer accepts a signature over its raw payload.
A SEP-53 signature satisfies only a signer whose payload is a SEP-53 hash. Only the account owner can add that signer.
The raw digest shape could satisfy any such payload. Its removal closes that path.

### 4.3 The signer computes the hash

- The message shape and the bridge `message` kind accept text only. No path accepts a precomputed message hash.
- A precomputed-hash path is the attack. A site sends a transaction hash as the "message hash" and receives a valid envelope signature.
  A probe signed a testnet transaction hash, and the envelope signature verified.
- When Walleterm hashes the text itself, the same attempt signs SHA-256 of the prefix and the hash text.
  The digest is `e5215117…683d`, which differs from the transaction hash.
  Correction, 2026-09-28: the probe recorded `3a1b824a…b246`, and that value does not reproduce.
  SHA-256 of the 24-byte prefix and the 64 lowercase hexadecimal characters of `e7380455…b4df` is
  `e52151175cbac29a9dc6406729c2a173369ace8c532b361a1ced3f95b843683d`. `shasum`, Python `hashlib`, and SDK 17.1.0 agree.
- This is the second reason to remove the raw digest shape.

### 4.4 Encoding, limits, and display

- Text only. The JSON string becomes UTF-8 bytes. No binary input exists, because a reviewer cannot read binary.
  SEP-43 and the Kit pass strings, so this loses no interoperability.
- Well-formed text only. `serde_json` rejects lone surrogate escapes.
  JavaScript `TextEncoder` and SDK `signMessage` turn a lone surrogate into U+FFFD.
  So the SDK checks `message.isWellFormed()` and returns `-3` before it sends a request.
- No Unicode normalization. The signer signs the exact code points.
- Length: 1–1024 UTF-8 bytes. The limit counts bytes, not characters. An empty message fails, because its signature is one fixed global value.
- No content filter. NUL, control, format, and bidirectional characters are accepted. Every display escapes them.
- Every display shows these items: the key, "SEP-53 message", the byte count, the escaped text, the digest,
  and "no network, site, or expiry binding". The tunnel line also shows the website origin.

### 4.5 Phishing and replay

A SEP-53 signature is a permanent, portable proof that the key approved the text.
It binds no network, origin, nonce, or expiry, unless the text contains them.
The 1Password prompt shows no text. Cached 1Password approval can skip the prompt.

A connected website, or a compromised script on it, can try these attacks:

1. Login relay. It requests another service's login challenge, then signs in to that service as the user.
2. Key derivation. It requests a fixed text that another application hashes into a private key.
3. Claims. It requests a social-proof or agreement text of its own choice.
4. Replay. It reuses a signature at a consumer that checks no nonce or expiry.
5. Reach. The key is the same on every network. The testnet rule protects transactions, not messages.

The bridge can do these things:

- Bind each request to the session origin and the selected key.
- Print the exact escaped text, the origin, the byte count, and the digest in the tunnel output.
- Apply the optional review hook, when it is set.

The bridge cannot do these things:

- Know which service will consume a signature.
- Make a consumer check its nonce, expiry, or domain.
- Stop the reuse of a signature after delivery.
- Bind a network into the signature.
- Make 1Password show the text.

An origin-line rule in the style of ERC-4361 could stop a strict login relay. It cannot stop claims or consumers with loose checks.
It would also break plain SEP-43 callers, so this design does not add it.

Accepted risk (section 6, D1): the bridge signs each valid message that a connected website sends, as it does for transactions.
So the connection code is the only gate, and the testnet rule does not limit a message signature.
The controls are dedicated keys, the tunnel line, and the optional review hook.
A Walleterm key must never serve as an identity or a key-derivation source for another service.

### 4.6 Output format and verification

- Bridge result `signed_message`: Base64 of the raw 64-byte signature. SDK `signedMessage` has the same value.
  `signerAddress` is the selected G-address.
- CLI: `signature` in lowercase hexadecimal, and `digest` equal to the SEP-53 hash.
- A verifier uses one of these checks:
  - SDK: `Keypair.fromPublicKey(G).verifyMessage(message, Buffer.from(signedMessage, 'base64'))`.
  - Stellar CLI: `stellar message verify "<message>" --signature <Base64> --public-key G...`.
  - Any Ed25519 library: verify the signature over SHA-256 of the prefix and the message bytes.
- The SDK verifies the signature before it returns it, as it does for the other kinds.

### 4.7 Verdict

Add message signing with these conditions:

1. The signer hashes the text. No path accepts a precomputed hash. The raw digest shape goes away.
2. Input is well-formed UTF-8 text of 1–1024 bytes. No lossy decoding. No binary.
3. The CLI signs after its calling agent reviews the text.
4. The bridge signs when the connected website sends a valid request. The optional review hook applies, as for every kind.
5. The CLI notice and the tunnel line escape the text and state that no network, site, or expiry binding exists.
6. The bridge result is Base64 for SEP-43. The SDK verifies it before it returns it.
7. Only dedicated testnet keys connect to the bridge. The docs already require them.

With these conditions, message signing adds no path to a transaction or authorization signature (section 4.2).
The remaining risk is the accepted risk in section 4.5.

### 4.8 The bridge `message` kind

- Request: `{ id, kind: "message", network_passphrase, address, message, selection_revision? }`.
- `hash`: the SEP-53 digest. Signed result: `signed_message`.
- Admission: the text rules in section 4.4, the testnet passphrase, and `address` equal to the selected key.
- Approval: the website approves by sending the request. The optional review hook applies, when it is set.
- Errors: `-3 walleterm:invalid_request` for bad text. `-4 walleterm:rejected` for a review denial or a cancellation.
- Tunnel output: one line for each message request, before signing. For example:
  `Message request from https://example.com for G... (43 bytes, digest <hex>, no network, site, or expiry binding): "example.com asks..."`
- The usual result line follows for each produced or withheld signature.

## 5. Plan

### 5.1 PR order after the Rust port merges

PR A: one `walleterm sign` and no authorization expiry window.
It includes the CLI message shape, because the message and lifecycle callers lose the digest.

1. Rust core: `src/message.rs` (new), `src/artifact.rs` (new), and `src/lib.rs` (modules).
2. `src/transaction.rs`: split `signer_role`. Keep the expired `max_time` rule inside the shared inspect.
3. `src/preimage.rs`: accept any G- or C-address in the shared rule. Move the selected-address rule to the bridge.
   Remove the window and the `latest_ledger` parameter. Refuse expiration ledger 0.
4. `src/authorization.rs`: remove the window and the `latest_ledger` parameter. Refuse expiration ledger 0.
   `finish` supplies the raw signature for attachment.
5. `src/bridge.rs`: call `artifact::inspect` and `artifact::finish`, then the website rules.
   Remove the trusted ledger, `Deps.latest_ledger`, and `ledger_unavailable`.
6. `src/ledger.rs`: remove the ledger functions. Move `https_client` and `capped` to `src/http.rs`. Update `src/service.rs` and `src/tunnel.rs`.
7. `src/cli.rs`: one strict parser and one `sign` path. Remove `sign-auth` and `--human` for `sign`. Update `HELP`.
8. Rust tests: `tests/cli.rs`, `tests/vectors.rs`, and `tests/bridge.rs`. Remove `tests/ledger.rs`. JS parity: `tests/vectors.test.ts`.
9. SDK: `sdk/authorization.ts` and `sdk/preimage.ts` lose their windows and `latestLedger` parameters.
   `sdk/errors.ts` loses `ledger_unavailable`. SDK tests and the Kit fixtures (`fixtures/kit/check.mts`, `live/check.mts`, `tabs.mts`) lose `latestLedger`.
10. Live harness: `tests/live-utils.ts`, `tests/types.ts`, `tests/contracts.ts`, `tests/extended-contracts.ts`, `tests/cap71.ts`, `tests/cap85.ts`, `tests/cli-pipeline.ts`, and their `.test.ts` mocks.
    Also `tests/1password-failure.ts`, `tests/openzeppelin-auth-live.ts`, and `tests/contract-auth-demo-live.ts`.
11. Packaging checks: `scripts/package.test.ts` and `scripts/release.ts`, if the port keeps their `sign-auth` smoke checks.
12. Delete `.agents/skills/walleterm-site-bridge/scripts/classic-attach.py` and `verify-signature.ts`, or the port's `classic-attach.ts`. Update `tests/site-bridge.test.ts`.
13. Docs and skills in section 5.3, in the same PR. Change the Paper design first, then `site/index.html`.

The port plan's phase 6 merges `classic-attach.py` into a new `classic-attach.ts`. This design deletes that helper.
The coordinator can skip that port step if it has not started.

PR B: SEP-43 `signMessage`.

1. `src/bridge.rs`: the `message` kind, `signed_message`, request identity, and the tunnel line.
2. `tests/bridge.rs`: signing without a review hook, a review hook denial, cancellation, bad text, request identity, and the tunnel line.
3. `sdk/walleterm.ts`: `Walleterm.signMessage` and `WalletermClient.signMessage`.
   They check the type, `isWellFormed()`, the byte length, the network, and the address.
   They send the request, verify with `Keypair.verifyMessage`, and return `{ signedMessage, signerAddress }`.
4. `sdk/types.ts`: the request kind and the result field. `sdk/kit.ts` needs no change, because it passes the call through.
5. SDK tests: now `bridge/sep43.test.ts`, `bridge/kit.test.ts`, and `bridge/sdk.test.ts`, or their location after the port.
6. `fixtures/kit/check.mts`: replace the message refusal check with a signing check. `fixtures/kit/live/`: add a `signMessage` step to `window.acceptance`.
7. Docs: `bridge/PROTOCOL.md`, `docs/SEP-43.md`, the tunnel part of `docs/INTERFACE.md`, and the site-bridge skill.
   Site: the "Websites stay on testnet" boundary text. Change the Paper design first, then `site/`.

### 5.2 Tests

Offline vectors use mock keys only. The SEP-53 public test seed is a mock key. Never fund it or use it live.

| Vector | Input | Expected |
| --- | --- | --- |
| SEP-53 case 1 | Key `GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L`, message `Hello, World!` | Digest `d52eb59c06bb510d065997ff93077068eed0a486c20215b5e02e1ab0d2ebea5f`. Signature `7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04`. |
| SEP-53 case 2 | The same key, `こんにちは、世界！` (27 bytes) | Digest `7bde4f792e336ed43df42ad66a92b44cb1bc60708e8bee63494c289dee161682`. Signature `083536eb95ecf32dce59b07fe7a1fd8cf814b2ce46f40d2a16e4ea1f6cecd980e04e6fbef9d21f98011c785a81edb85f3776a6e7d942b435eb0adc07da4d4604`. |
| SEP-53 case 3 | Binary, Base64 `2zZDP1sa1BVBfLP7TeeMk3sUbaxAkUhBhDiNdrksaFo=` | Core digest function only: `460008feac2bccee41de48c2717db5d2e81591f71205dd612c4e8ce7125dea2f`. The CLI has no binary input. |
| Hash as text | The hexadecimal text of a transaction hash | A digest that differs from that transaction hash. |

Ed25519 signatures are deterministic. So a mock agent with the spec seed must return the spec signatures exactly.

Shape and strictness tests. Each refusal must send zero SSH signing messages. The port's mock socket counter can prove this.

- Artifact key counts 0, 2, 3, and 4. Each shape with one key missing and with one extra key.
- The old digest input, `latest_ledger` in any shape, and `walleterm sign-auth`.
- Duplicate keys at the top level and inside `adapter`. Trailing JSON. Invalid UTF-8. A lone surrogate escape.
- Messages: empty, 1024 bytes, 1025 bytes, and a multibyte string at the limit. `network_passphrase` with a message. NUL and U+202E, accepted and shown escaped.
- Transaction: V1 and fee bump, 19 and 20 existing signatures, a key that already signed, and an expired `max_time`.
  A non-source key passes in the CLI and fails in the bridge.
- Preimage: the V1 type, another network, and another G bound address (the CLI passes, the bridge fails).
  Expiration ledger 0 fails. Expiration `u32::MAX` passes.
- Entry: the existing `sign-auth` vectors, without `latest_ledger`, plus the new `signature` field. Expiration 0 fails. Expiration `u32::MAX` passes.
- Bridge: no request reads a ledger, and the bridge dependencies contain no ledger function.

JS parity (`tests/vectors.test.ts`) stays independent of Rust and Dalek:

- Transaction: `signed_transaction_xdr` equals SDK `tx.sign(mockKeypair)` output for V1 and fee-bump envelopes.
- Preimage: the signature equals SDK `Keypair.sign(sha256(preimage))`.
- Message: SDK `Keypair.verifyMessage` and `node:crypto` verify each vector.
  `stellar message verify` also runs, because CI installs Stellar CLI 28.0.0.

Live acceptance belongs to the coordinator. It needs fresh approval, dedicated testnet keys, and no mainnet.
Record hashes, ledgers, fees, and account states. Keep local, live 1Password, and testnet results separate.

1. Transaction shape: `stellar tx new payment --build-only`, then `walleterm sign`, then `stellar tx send`. This replaces CLI01.
2. Fee bump: sign the inner envelope, wrap it, sign the outer envelope, and submit.
3. Multisig co-signer: key A signs a transaction from account B, as in G02.
4. Preimage shape: a G-account V2 entry through the SDK `authorizeEntry` callback, then an enforce-simulated contract call.
5. Entry shape with `openzeppelin-ed25519`: run `tests/openzeppelin-auth-live.ts`.
6. An authorization with an expiration more than 120 ledgers ahead signs through the CLI and the bridge, and it applies.
7. Message shape: sign `walleterm acceptance <date> <nonce>`. Verify with Stellar CLI and the SDK. Nothing goes to the network.
8. 1Password lifecycle with the message shape: Deny, SIGINT, and locked-agent cases, as in `tests/1password-failure.ts`.
9. Zero 1Password requests for the old digest input, `sign-auth`, mixed shapes, and an expired transaction.
10. PR B: the Kit live page calls `signMessage`. The tunnel prints the message line. Verify the returned signature.

### 5.3 Docs and skills to update

- `docs/INTERFACE.md`: the command list, the `sign` section (shapes, outputs, limits, and notice), and the removal of "Structured authorization signing".
  Remove "Authorization signing uses a fixed testnet RPC endpoint". Remove the ledger parameters from the SDK helper list. Add the message line to the tunnel text in PR B.
- `bridge/PROTOCOL.md`: remove "Trusted ledger", the ledger windows, and `ledger_unavailable` in PR A.
  Add the `message` kind and `signed_message` in PR B.
  Replace "The bridge exposes no arbitrary digest route and no message signing route" with the message rules.
- `docs/SEP-43.md`: remove the ledger windows, `ledger_unavailable`, and decision Q2 in PR A.
  In PR B, update the `signMessage` row, the error table, the Kit fixture steps, the deviations, decision Q1, and "Future work".
  Add two deviations: Base64 in place of hexadecimal, and confirmation by sending in place of a wallet display.
- `docs/AGENTIC-PAYMENTS.md`: "which `walleterm sign` accepts" becomes the preimage shape.
  Remove "Raw `walleterm sign` can sign a V1 digest". `createWalletermSigner` sends the preimage. Its ledger check step goes away.
- `docs/CONTRACT-AUTHORIZATION.md`, `docs/OPENZEPPELIN.md` (lines 516 and 564), `docs/STELLAR-CLI.md`, `docs/PLAN.md`, `docs/LIVE-TESTS.md`, `docs/TEST-MATRIX.md` (L06), and `README.md` (lines 24 and 134).
- `fixtures/README.md`, `fixtures/cap71/README.md`, and `fixtures/cap85/README.md`: rename `ctx.signDigest`.
- `walleterm` skill: `SKILL.md` becomes "Sign one artifact".
  Rewrite `classic-native.md`, `fee-bump.md`, `openzeppelin.md`, and `delegation.md` around the shapes.
  Fold `structured-auth.md` into `SKILL.md`, and remove its ledger steps. Add a note to `acceptance.md` that its commands are historical.
- `walleterm-site-bridge` skill: `SKILL.md` and `references/message-signing.md` use the message shape.
  PR B adds bridge `signMessage` and the dedicated-key warning. `references/interception.md` returns the signed envelope directly.
  `references/service.md` needs a check. `scripts/legacy-freighter.ts` needs no change.
- Site: `site/index.html` steps 01–02, the example output, and two boundary items. Change the Paper design first.

## 6. Decisions

The user decided these points on 2026-09-28. The coordinator relayed them.

| Item | Decision |
| --- | --- |
| D1: bridge message approval | Option C. A message request uses the approval model of the other kinds: the website approves by sending it. No terminal confirmation and no required review gate. The tunnel prints one line with the escaped text, the byte count, and the digest. It states that the signature has no network, site, or expiry binding. The optional review hook applies to messages as to every kind. The SEP-43 deviations record that the connected website confirms by sending, and that dedicated testnet keys are required. |
| D2: authorization expiry | Option B. No expiry window for the preimage and entry shapes. The CLI drops `latest_ledger`. The bridge drops its trusted ledger and the fixed testnet RPC for authorization. The network enforces expiry. |
| Raw digest shape | Removed. |
| CLI signer-role checks | None. The bridge keeps its rules. |
| `signedMessage` encoding | Base64. |
| Message input | Text only, 1–1024 UTF-8 bytes. |
| `--human` on `sign` | Removed. |
| `classic-attach` helper | Deleted. |

The first design draft recommended a terminal confirmation for D1 and a 120-ledger window for D2.
The user chose the options above. This record applies them throughout.
One small rule remains after D2: expiration ledger 0 fails, as section 3.4 explains. The coordinator can remove it during implementation.

## 7. Evidence and limits

All probes ran offline on 2026-09-28 with mock keys. They made no 1Password request and no network submission.
[The evidence file](evidence/sign-design.json) records the vectors, commands, and results.

| Probe | Result |
| --- | --- |
| SDK 17.1.0 with Bun 1.4.2 | `signMessage` reproduced all three spec signatures. `verifyMessage` and `node:crypto` verified them. |
| Stellar CLI 28.0.0 `stellar message verify` | Exit 0 for all three cases. Exit 1 for a changed message. |
| Stellar CLI standard input | `Hello, World!` with one newline verified. Two newlines failed. The CLI removes one trailing newline. |
| Payload heads | The values in section 4.2. |
| Precomputed hash | A signature over a transaction hash verified as the envelope signature. The SEP-53 digest of its hexadecimal text differed. |
| Lone surrogate in JavaScript | `isWellFormed()` returned false. `TextEncoder` produced `61efbfbd62`. SDK signatures for `a\ud800b` and `a\ufffdb` were equal. |
| Rust, with the port's crate versions (`cargo run --offline`) | `verify_strict` accepted all three spec vectors with the same digests. |
| `serde_json` 1.0.151 | It rejected `\ud800` and `\udc00` escapes. It accepted `\u0000`. |
| `String::from_utf8_lossy` | It changed byte `ff` inside a message to U+FFFD. |

Limits:

- This record changes no product file. Implementation waits for the Rust port merge.
- I read the Rust port without building or testing it.
- I read the Freighter facts from source at `a9409f4d`. I did not run Freighter in a browser.
- I checked signature encodings only in the Freighter, WalletConnect, xBull, Lobstr, Hana, Albedo, Ledger, Ghostsig, and Rabet Kit modules.
