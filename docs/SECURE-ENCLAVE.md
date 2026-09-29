# Secure Enclave signer: design notes

Status: design only. No code exists. The owner leans to this option and asked for this record first.
[KEY-STORES.md](KEY-STORES.md) explains the requirement, the Apple facts, and the other options.
The research date is 2026-09-29.

## Summary

- The Secure Enclave creates a P-256 key and signs inside the hardware. Walleterm sees only public data and signatures.
- A Stellar G-account cannot use a P-256 signer. The key signs Soroban authorization for a C-account.
- The C-account is an OpenZeppelin smart account. It uses the audited OpenZeppelin WebAuthn verifier, so no new contract is needed.
- Walleterm builds a WebAuthn-shaped assertion around the authorization digest. The Secure Enclave signs it.
- Touch ID or the Mac login password approves each signature (`.userPresence`). The prompt shows walleterm's summary text.
- Limits: no classic operations, no envelope signatures, and no SEP-53 messages. Fees need a relayer or another key.

## Account model

- The smart account holds the funds as SAC or token contract balances.
- Signer 1 is the Secure Enclave key: `External(<WebAuthn verifier>, <65-byte SEC-1 public key>)`.
- Signer 2 is a recovery signer, for example a 1Password Ed25519 key through the Ed25519 verifier.
  The Secure Enclave key is bound to one Mac and has no backup, so the recovery signer is mandatory.
- A G-account still pays fees and signs the transaction envelope. Two choices keep Ed25519 keys off the Mac or in 1Password:
  - OpenZeppelin Stellar Channels: `submitSorobanTransaction({ func, auth })`. The service pays fees, subject to a fair use policy.
    Only an API key stays on the Mac. That key is a bearer token, not a signing key.
  - A 1Password G-account as the source. 1Password signs the envelope, and the Secure Enclave signs the authorization entry.
- SDF discontinued Launchtube. CAP-72 is a draft, and it would not cover envelopes or fees.

| Works from the smart account | Does not work |
| --- | --- |
| SAC `transfer` of XLM and of classic assets such as USDC | Any classic operation: payment, path payment, offers, trustlines, set options |
| XLM of at least 1 XLM to a new G-address. The transfer creates the account (CAP-73). | Any action for an existing G-account |
| Soroban calls that use `require_auth` on the account, including signer changes | Transaction envelope signatures |
| x402 payments with a custom client. The facilitator pays the fee. | SEP-53 messages |

[AGENTIC-PAYMENTS.md](AGENTIC-PAYMENTS.md) says the stock x402 client calls `Keypair.fromPublicKey` on the payer. A C-account payer needs a custom client.

## Stellar facts

### secp256r1 verification (CAP-51)

- CAP-51 is final. It shipped in protocol 21: testnet on 2024-04-12 and mainnet on 2024-06-18.
- The host function is `verify_sig_ecdsa_secp256r1(public_key, msg_digest, signature)`.
  - `public_key` is 65 bytes, SEC-1 uncompressed: `0x04 ‖ X ‖ Y`.
  - `msg_digest` is exactly 32 bytes. The host does not hash it again (`verify_prehash`).
  - `signature` is 64 bytes, `r ‖ s` big-endian, not DER.
- The host rejects a high-S signature. The CAP text does not say this, but the code does:
  "ECDSA signature 's' part is not normalized to low form" (`rs-soroban-env` `169890d5`).
- One verification costs 3,000,906 CPU instructions in the default calibration. One Ed25519 verification costs about 377,551.
- The SDK method `Crypto::secp256r1_verify` takes a `Hash<32>`, which a contract gets only from an SDK hash function.
  Raw 32 bytes need `CryptoHazmat::secp256r1_verify` and the `hazmat-crypto` feature.

### OpenZeppelin WebAuthn verifier

Source: `packages/accounts/src/verifiers/webauthn.rs` and `examples/multisig-smart-account/webauthn-verifier` at `b40c5eaefe6a29f0030f00bd2d730b7a91cce330`.

- `key_data` is `Bytes`: the 65-byte SEC-1 public key, then an optional credential ID. `canonicalize_key` keeps the first 65 bytes.
- `sig_data` is `Bytes`: the XDR of this `#[contracttype]` struct. The verifier calls `WebAuthnSigData::from_xdr`.

```rust
pub struct WebAuthnSigData {
    pub signature: BytesN<64>,
    pub authenticator_data: Bytes,
    pub client_data: Bytes,
}
```

- The account passes `auth_digest` as the `hash` argument. [OPENZEPPELIN.md](OPENZEPPELIN.md) section 2.3 defines `auth_digest`.
- The verifier runs these checks in order:
  1. `client_data` is at most 1024 bytes. `serde_json_core` parses `challenge` and `type`.
  2. `type` equals `webauthn.get`.
  3. `challenge` equals the unpadded base64url form (43 characters) of the first 32 bytes of `hash`.
  4. `authenticator_data` is at least 37 bytes.
  5. The flags byte (offset 32) sets User Present (`0x01`) and User Verified (`0x04`). BE clear with BS set fails.
  6. `secp256r1_verify(pub_key, sha256(authenticator_data ‖ sha256(client_data)), signature)`.
- The verifier does not check the origin, `rpIdHash`, the signature counter, extensions, or attestation. The doc comment says so.
- OpenZeppelin v0.7.2 (2026-06-09) is the latest stable release. The audit PDFs go up to v0.7.0. v0.8.0-rc.3 is not audited.
- The testnet example WebAuthn verifier is `CBEO6Q7UXBIQIHQR42RXETMYDKW7GABRX2O4UVW6O6YQOHROYWZJCOXZ`. It has no mainnet address.
- OpenZeppelin has no raw secp256r1 account verifier. A raw verifier would be a new, unaudited contract.

### Synthetic assertion

The verifier accepts any key holder's assertion, so the Secure Enclave key does not need a browser or a passkey.

1. `authenticator_data` = a fixed 32-byte `rpIdHash` ‖ flags `0x05` (UP and UV) ‖ a 4-byte counter of zero. Total: 37 bytes.
2. `client_data` = `{"type":"webauthn.get","challenge":"<base64url of auth_digest>"}`, as exact UTF-8 bytes.
3. The Secure Enclave signs `authenticator_data ‖ sha256(client_data)` with CryptoKit `signature(for: Data)`. CryptoKit applies SHA-256.
   This equals the verifier's digest, so no prehash workaround is needed.
4. Walleterm takes `rawRepresentation` (64 bytes), normalizes it to low-S, and verifies it as the verifier does.
5. Walleterm encodes `WebAuthnSigData` as `ScVal` XDR. That value goes into the `AuthPayload` signer map.

Walleterm sets the UV flag itself. The real user check is the `.userPresence` access control on the key.
passkey-kit (`stellar/passkey-kit` v0.18.3) accepts the same assertion shape. Its wallet is not audited, so it is the weaker choice.

## Apple implementation notes

### Swift bridge

CryptoKit is Swift only, and it is the only public API that restores a Secure Enclave key without the keychain.
So the store needs one small Swift file. This is an exception to the rule "Keep new runtime code in Rust."
A local probe proved this `build.rs` pattern. Two clean release builds in different target folders had the same SHA-256.

```rust
// The probe's build.rs. The real one runs only for macOS targets and names the file under src/.
let status = Command::new("xcrun")
    .args(["swiftc", "-O", "-parse-as-library", "-emit-library", "-static", "-module-name", "Enclave"])
    .args(["-target", "arm64-apple-macos13.0"])
    .arg(root.join("enclave.swift"))
    .arg("-o")
    .arg(out.join("libenclave.a"))
    .status()
    .unwrap();
assert!(status.success());
println!("cargo:rustc-link-search=native={}", out.display());
println!("cargo:rustc-link-lib=static=enclave");
println!("cargo:rustc-link-search=native=/usr/lib/swift");
// Swift compatibility libraries live beside the toolchain's swiftc.
let swiftc = Command::new("xcrun").args(["--find", "swiftc"]).output().unwrap().stdout;
let swiftc = String::from_utf8(swiftc).unwrap();
let lib = Path::new(swiftc.trim()).parent().unwrap().parent().unwrap().join("lib/swift/macosx");
println!("cargo:rustc-link-search=native={}", lib.display());
println!("cargo:rustc-link-lib=framework=CryptoKit");
```

Expose C functions with `@_cdecl`. The Rust side declares them in one `unsafe extern "C"` block.
The CI job `macos-15` has Xcode, so it can build the bridge. GitHub macOS runners are virtual machines and likely have no Secure Enclave.

### Key creation

```swift
let access = SecAccessControlCreateWithFlags(
    nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, [.privateKeyUsage, .userPresence], nil)!
let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
// Store key.dataRepresentation and key.publicKey.x963Representation. Creation shows no prompt.
```

- Check `SecureEnclave.isAvailable` first. Without a Secure Enclave, fail with `unsupported_platform`.
- The blob is not a secret. It is useless on another Mac. Any process of the same user can still load it and ask for a signature.
- Proposal: one JSON file for each key, mode `0600`, in a `0700` folder under `~/Library/Application Support/walleterm/`.
  Resolve the home folder from the account database, as `src/platform.rs` does for the 1Password socket.
  Check the file type, owner, and mode before use, as `src/agent.rs` does for the socket.

### Signing

1. Make a new `LAContext`. Set `localizedReason` to a short summary, for example "sign authorization 1a2b…9f0e for CABC… on testnet".
2. Restore the key with `SecureEnclave.P256.Signing.PrivateKey(dataRepresentation:authenticationContext:)`.
3. Sign. The Secure Enclave evaluates `.userPresence` and shows the prompt.
4. Call `invalidate()` on the context.

- For the 120-second deadline, call `invalidate()` from a timer. The pending prompt closes and the call fails. Map it to `timeout`.
- A user cancel maps to `signing_refused`.
- Check what the prompt does from an SSH session. Use `interactionNotAllowed` to fail fast without a GUI.

To sign an exact 32-byte digest instead, pass a caller-defined `Digest`. A local probe confirmed that CryptoKit accepts this type.
The WebAuthn path does not need it. A raw verifier with `CryptoHazmat` would.

```swift
struct RawDigest: Digest {
    static let byteCount = 32
    let bytes: [UInt8]
    func withUnsafeBytes<R>(_ body: (UnsafeRawBufferPointer) throws -> R) rethrows -> R {
        try bytes.withUnsafeBytes(body)
    }
    func makeIterator() -> Array<UInt8>.Iterator { bytes.makeIterator() }
}
```

### Low-S normalization

About half of the Secure Enclave signatures are high-S. 17 of 32 were high-S in the local probe. Normalize each one:

```text
n = FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
if s > n / 2 { s = n - s }
```

Then verify the result locally before it leaves walleterm. A P-256 verifier in Rust needs a new dependency such as `p256`.
CryptoKit `P256.Signing.PublicKey.isValidSignature` in the Swift bridge is the other choice.

### Tests

- The CI runners likely lack a Secure Enclave. A software CryptoKit `P256.Signing.PrivateKey` can stand in for it in tests.
  Then the tests run the same Swift bridge, assertion, normalization, and encoding code.
- Offline vectors need a Soroban test environment that runs the pinned WebAuthn verifier against walleterm's output.
  Keep that harness in `fixtures/`.
- Live tests need a Mac with Touch ID and the owner present. Ask before each run that shows a prompt.

## Interface proposal

This section is a proposal. [INTERFACE.md](INTERFACE.md) is the contract, and it does not change until the code does.

```text
walleterm create --store secure-enclave [--label <text>]
walleterm list [--human] [--store 1password|secure-enclave]
walleterm sign [--store 1password|secure-enclave] < request.json
walleterm tunnel [--port 8787] [--vault <name-or-id>] [--store 1password|secure-enclave]
```

- `--store` defaults to `1password`, the current behavior. `create` needs `--store secure-enclave`, because 1Password creates its keys in its app.
- `list` returns `store` and the public key as 130 lowercase hexadecimal characters of the SEC-1 key.
- `sign` with the Secure Enclave store accepts only the entry shape with a new adapter:

```json
{"public_key":"04...","network_passphrase":"Test SDF Network ; September 2015","auth_entry_xdr":"AAAA...","address":"C...","adapter":{"type":"openzeppelin-webauthn","verifier":"C...","context_rule_ids":[0]}}
```

- The transaction, preimage, and message shapes fail with `invalid_input` for this store. They need Ed25519.
- The result keeps `digest` (the `auth_digest`), `signature` (64-byte low-S `r ‖ s`), `signed_auth_entry_xdr`, and `verified`.
  It adds the `WebAuthnSigData` XDR, so a caller can merge several signers.
- The notice line keeps its current form, with `openzeppelin-webauthn` as the adapter name.
- `tunnel --store secure-enclave` comes after the CLI. The browser SDK needs a C-account address model first.

## Security notes

- A process of the same user can read the key file and show its own prompt text. One approved prompt gives it one signature, not the key.
  An app bundle with a keychain access group, as in option A, would close this gap later.
- Walleterm writes the prompt text. The system prompt is not a trusted display of the transaction.
- Walleterm sets the UV flag itself. The `.userPresence` access control is the real user check.
- The key is bound to one Mac. The account must keep a recovery signer, and a live test must use it once.
- Walleterm must normalize to low-S and verify each signature before it returns it.
- Each P-256 check costs about 8 times an Ed25519 check. WebAuthn adds about 150 bytes and extra hashing for each signature.

## Rule changes before code

AGENTS.md needs these changes. The owner must approve them.

- "Keep private keys inside 1Password" becomes "Keep private keys inside their store: 1Password or the Secure Enclave."
- "Generate production signer keys inside 1Password" gains the Secure Enclave. `walleterm create` asks the Secure Enclave to generate the key.
- "Use Ed25519. Passkeys and CAP-72 contract signers are out of scope" becomes:
  "Use Ed25519 for G-accounts. Use Secure Enclave P-256 keys only for OpenZeppelin smart accounts through the WebAuthn verifier."
- "Permit human approval through 1Password" becomes "Permit human approval through the key store."
- "Keep new runtime code in Rust" gains one exception: the CryptoKit bridge in Swift.
- The code layout names the new store files. [NETWORKS.md](NETWORKS.md) lists any new hard-coded limit.

## Work plan

Each step ends when its check passes.

1. Rule change. Check: the owner approves the AGENTS.md text above.
2. Swift bridge and `build.rs`. Check: `make test` and `make test-package` pass on `macos-15`, and the package stays reproducible.
3. Key files and the `create` and `list` commands. Check: offline tests with a software P-256 key cover file checks and output.
4. The `openzeppelin-webauthn` adapter. Check: the pinned WebAuthn verifier accepts walleterm's `AuthPayload` in a fixture test,
   and it rejects a high-S signature, a wrong challenge, and a wrong rule ID.
5. `sign --store secure-enclave`. Check: a live run on this Mac shows the prompt text. Cancel, timeout, and Ctrl+C each fail cleanly.
6. Testnet acceptance. Deploy an OpenZeppelin smart account with the Secure Enclave signer and a 1Password recovery signer.
   Sign one SAC transfer with the Secure Enclave and submit it with a 1Password fee payer. Run an enforcing simulation first.
   Check: record the hash, ledger, balances, and contract versions in `evidence/`.
7. Later: `tunnel --store secure-enclave`, a Channels submission, and an x402 client.

## Open items

- Re-pin OpenZeppelin. [OPENZEPPELIN.md](OPENZEPPELIN.md) pins `a5bd8cbd`. This research read `b40c5eae`.
  Confirm that the testnet WebAuthn verifier runs the pinned code.
- The key file format, the fingerprint rule, and the fixed `rpIdHash` value.
- Rust P-256 verification: the `p256` crate or CryptoKit.
- Prompt behavior from an SSH session and on a Mac without Touch ID.
- `SecureEnclave.isAvailable` on the GitHub `macos-15` runner.
- Whether Channels accepts this flow, how it handles memos, and its fee limit for each API key.

## Sources

| Source | Version or date |
| --- | --- |
| [CAP-51](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0051.md), [CAP-72](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0072.md), [CAP-73](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0073.md) | `stellar-protocol` `9cd70307`, 2026-09-22 |
| [rs-soroban-env](https://github.com/stellar/rs-soroban-env/tree/169890d50e27ef948bef66401147aba814d9b04e) `host.rs`, `crypto/mod.rs`, `budget.rs` | `169890d5`, 2026-09-25 |
| [rs-soroban-sdk `crypto.rs`](https://github.com/stellar/rs-soroban-sdk/blob/1bf2e5fa414d905a3f4586cbab758c718ac41223/soroban-sdk/src/crypto.rs) | `1bf2e5fa` |
| [Stellar software versions](https://developers.stellar.org/docs/networks/software-versions) | Read 2026-09-29. Protocol 28 on mainnet since 2026-09-16. |
| [OpenZeppelin WebAuthn verifier](https://github.com/OpenZeppelin/stellar-contracts/blob/b40c5eaefe6a29f0030f00bd2d730b7a91cce330/packages/accounts/src/verifiers/webauthn.rs) and [example contract](https://github.com/OpenZeppelin/stellar-contracts/blob/b40c5eaefe6a29f0030f00bd2d730b7a91cce330/examples/multisig-smart-account/webauthn-verifier/src/contract.rs) | `b40c5eae`; v0.7.2 and v0.8.0-rc.3 |
| [OpenZeppelin Relayer on Stellar](https://developers.stellar.org/docs/tools/openzeppelin-relayer) and [relayer-plugin-channels](https://github.com/OpenZeppelin/relayer-plugin-channels) | Read 2026-09-29 |
| [stellar/passkey-kit](https://github.com/stellar/passkey-kit) | v0.18.3, 2026-09-09 |
| [CryptoKit `SecureEnclave.P256`](https://developer.apple.com/documentation/cryptokit/secureenclave/p256) | Read 2026-09-29 |
| [LocalAuthentication `LAContext`](https://developer.apple.com/documentation/localauthentication/lacontext) | Read 2026-09-29 |
| [Apple forum thread 742251: CryptoKit P-256 and low-S](https://developer.apple.com/forums/thread/742251) | November 2023 |
| Local probes | 2026-09-29. See [KEY-STORES.md](KEY-STORES.md#local-probe-results). |
