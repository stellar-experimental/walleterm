# Key stores: research and options

Status: research and design only. Walleterm signs only through the 1Password SSH agent.
The research date is 2026-09-29. Check the [upstream watch list](#upstream-watch-list) before work starts.
[SECURE-ENCLAVE.md](SECURE-ENCLAVE.md) holds the design of the preferred Apple option.

## Summary

- The owner wants more key stores beside 1Password. The first candidate was the Apple Keychain.
- The hard requirement is that walleterm never has access to a private key. The store signs, and a human approves.
- The Apple Secure Enclave cannot hold an Ed25519 key. It holds only NIST P-256, ML-KEM, and ML-DSA keys.
- A Stellar G-address needs Ed25519. No Apple API signs Ed25519 for another process.
- The Keychain returns stored bytes to the caller. An Ed25519 seed in the Keychain enters walleterm's memory at each signature.
- Three designs meet the requirement. [Options](#options-that-meet-the-requirement) compares them.
- The owner leans to option B: the Secure Enclave signs with P-256 for an OpenZeppelin smart account.
- CAP-72, still a draft, would let a G-account use such a contract signer for Soroban authorization only.
  See [Stellar protocol context](#stellar-protocol-context).
- No store code exists yet. The owner asked for this record first.

## Requirements

1. Walleterm never reads, holds, or derives a private key. The store computes each signature.
2. A human approves signatures through a prompt that the store controls.
3. The store generates each key. Nothing imports or exports a key.
4. Walleterm computes the digest from a typed artifact, as it does today. It verifies each signature before it returns it.
5. The store works for a local agent on macOS. Other platforms come later.

## Decisions so far

The owner made these decisions on 2026-09-29.

| Topic | Decision |
| --- | --- |
| Secrets | Walleterm never has access to a secret. A design that unseals a seed inside walleterm fails this rule. |
| Approval | Touch ID or the Mac login password for each signature. The Apple flag is `.userPresence`. |
| Store selection | An explicit `--store` flag on `list`, `sign`, and `tunnel`. Walleterm does not merge the keys of several stores. |
| Deletion | No delete command. The docs describe manual removal after the signer leaves the Stellar account. |
| Direction | Leaning to option B. Record the research first. Start code in a later change. |

## How 1Password works today

Walleterm sends the 32-byte digest in an SSH agent sign request. 1Password signs inside its own app process.
See [the interface](INTERFACE.md) for the wire format.

| Topic | 1Password behavior |
| --- | --- |
| Key location | `SSH Key` items in 1Password vaults. Items sync, end-to-end encrypted. |
| Signing | Inside the 1Password app. "Your private keys never leave 1Password." |
| Generation | In the app, or `op item create --category ssh`. Ed25519 is the default. RSA 2048, 3072, and 4096 also work. |
| Export | The user can export a private key in OpenSSH or PKCS#8 format. The key is not bound to hardware. |
| Approval scope | Per application by default. Per terminal session and per request are options. |
| Approval lifetime | Until 1Password locks by default. Until quit, or 4, 12, or 24 hours, are options. |
| Prompt | The requesting process and the key. The key name appears only if a setting is on. It never shows the transaction. |
| Locked app | The agent keeps approvals, not keys. The app must unlock to sign. |
| Secure Enclave | Touch ID unlock keeps a secret on disk. A key in the Secure Enclave encrypts that secret. |

So the default scope lets an approved terminal sign again without a prompt until 1Password locks.

## Apple platform facts

The sources are the macOS 27.0 SDK in Xcode 27.0 (27A266a), macOS 26.7 (25G229), Apple documentation, and DTS posts.

### Key types

- The Secure Enclave "Works only with NIST P-256 elliptic curve keys" and "Can't encode preexisting keys" (Apple documentation).
- The macOS 27 SDK lists only these Secure Enclave types: `P256.Signing`, `P256.KeyAgreement`, `MLKEM768`, `MLKEM1024`, `MLDSA65`, and `MLDSA87`.
  ML-KEM and ML-DSA arrived in macOS 26 (WWDC25 session 314). No Curve25519 type exists.
- `SecKey` has Ed25519 only as private, software-only SPI: `kSecAttrKeyTypeEd25519`, `SPI_AVAILABLE(macos(14.0))`. Do not use it.
- CryptoKit `Curve25519.Signing` is a software key. Apple tells apps to store it as a generic password.
- macOS 26 native Secure Enclave SSH keys use `sc_auth create-ctk-identity` and `/usr/lib/ssh-keychain.dylib`. They are P-256 only.
- The Passwords app has no SSH keys. WWDC26 and the macOS 27 release notes add none.
- macOS ships no `ssh-askpass`, so `ssh-add -c` cannot ask before each use.
  `ssh-add --apple-use-keychain` stores key-file passphrases, not keys.

### Keychains and entitlements

- macOS has a file-based keychain and a data protection keychain (TN3137).
- The data protection keychain needs a keychain access group from `keychain-access-groups` or `com.apple.application-identifier`.
  A provisioning profile must authorize these entitlements. A bare command-line binary cannot hold a profile.
- A command-line tool needs an app-like bundle for the profile. Apple's guide is "Signing a daemon with a restricted entitlement".
- An unentitled program gets `errSecMissingEntitlement` (-34018).
- Biometric protection and keychain-stored Secure Enclave keys need the data protection keychain.
- The file-based keychain is "on the road to deprecation". Its access control uses the designated requirement. It has no biometry.
- An access group starts with the team ID. A move from team T4GBHCYB7P to team 4JWM8JNM37 makes every stored key unusable.
- The data protection keychain and the Secure Enclave need a user login session. A `launchd` daemon cannot use them.

### Secure Enclave keys outside the keychain

- CryptoKit `dataRepresentation` is an opaque blob. Only the Secure Enclave that made it can use the key inside.
- The blob is device-bound. A Secure Enclave reset or an erase destroys the key. No backup exists.
- CryptoKit Secure Enclave keys work from an unentitled command-line tool in practice. `age-plugin-se` ships this way in Homebrew.
- Apple DTS says Secure Enclave access follows the data protection keychain rules. So Apple does not support this use for tools.
- The blob is not bound to the program that made it. Any process of the same user can load it and ask for the key operation.
  The access control of the key still applies to each operation.
- The `SecKey` route can create such a key. It can restore the key only through the private `kSecAttrTokenOID` attribute.
  CryptoKit is the only public way to keep a Secure Enclave key outside the keychain. CryptoKit is Swift only.

### Access control and prompts

| Flag | Meaning |
| --- | --- |
| `.privateKeyUsage` | Required for signing and key agreement with a Secure Enclave key. |
| `.userPresence` | Touch ID or the login password. The key survives fingerprint changes. The owner chose this flag. |
| `.biometryAny` | Touch ID only. It fails when no sensor is available. |
| `.biometryCurrentSet` | Touch ID with the current fingers. A fingerprint change invalidates the key. |

- Set the prompt text with `LAContext.localizedReason`. Pass the context through `kSecUseAuthenticationContext` or the CryptoKit `authenticationContext:` parameter.
  `kSecUseOperationPrompt` is deprecated since macOS 11.
- An authenticated `LAContext` skips later prompts. Use a new context for each signature, then call `invalidate()`.
- `touchIDAuthenticationAllowableReuseDuration` reuses only a lock-screen unlock, for 5 minutes at most.
- `interactionNotAllowed` makes a call fail at once, with no prompt.
- A third-party report says macOS 27 shows the reason text as the bold headline and drops the app name row. Keep the reason short.

## Local probe results

These probes ran on 2026-09-29 on a Mac16,6 with macOS 26.7 (25G229), Xcode 27.0 (27A266a), and SDK 27.0.
Each probe was an ad hoc signed binary with no entitlements. Each key had only `.privateKeyUsage`, so no prompt appeared.

| Probe | Result |
| --- | --- |
| Create a CryptoKit `SecureEnclave.P256.KeyAgreement` key | Works. `dataRepresentation` is 324 bytes. |
| Restore the blob in a second process. Open an HPKE `P256_SHA256_AES_GCM_256` seal | Works. |
| Restore the blob in a different binary with a different cdhash | Works. The blob does not bind to the program. |
| `SecItemAdd` with `kSecUseDataProtectionKeychain` | Fails: -34018, "A required entitlement isn't present." |
| `SecKeyCreateRandomKey` for a permanent Secure Enclave key | Fails: -34018, "failed to add key to keychain". |
| Attributes of a non-permanent `SecKey` Secure Enclave key | `tkid` is `com.apple.setoken`. `toid` holds 324 bytes. |
| `SecKeyCopyExternalRepresentation` on that private key | Fails: -4, "export not implemented". |
| Public `SecKeyCreateWithData` with the blob and `kSecAttrTokenIDSecureEnclave` | Returns a new random key on each call. It ignores the blob. This failure is silent. |
| `SecKeyCreateWithData` with the private `toid` attribute | Restores the same key. It is private API. |
| `SecureEnclave.P256.Signing` over a caller-defined 32-byte `Digest` | Works. The key signs the digest without a second hash. The signature is 64 bytes `r‖s`. |
| High-S rate of those signatures | 17 of 32 were high-S. Stellar rejects high-S, so a signer must normalize. |
| Link a Swift static library into a Rust binary through `build.rs` | Works. Only system Swift libraries link. Two clean builds in different target folders had the same SHA-256. |

[SECURE-ENCLAVE.md](SECURE-ENCLAVE.md) keeps the code for the last three probes.

## Rejected designs

| Design | Why it fails |
| --- | --- |
| Ed25519 seed as a Keychain generic password | The seed enters the signing process. The previous walleterm and Stellar CLI `--secure-store` work this way. |
| Ed25519 seed sealed to the Secure Enclave and unsealed inside walleterm | The seed enters walleterm at each signature. Any process of the same user can copy the blob and show its own prompt. One approved prompt then gives away the whole seed. |
| File-based keychain | It is on the road to deprecation and has no biometry. |
| Private `SecKey` SPI (`kSecAttrTokenOID`, `kSecAttrKeyTypeEd25519`) | It is private API. Apple can change it without notice. |
| FIDO2 `sk-ssh-ed25519@openssh.com` | The authenticator signs a structure with the application hash, flags, and counter. It never signs the digest alone. |
| CryptoTokenKit token | `SecKeyAlgorithm` has no EdDSA constant. Token keys are also visible to all apps. |

### The previous walleterm

The earlier TypeScript walleterm is `kalepail/walleterm` (commit `9290543`). It stored `S...` seeds in the login keychain.

- `src/keychain-setup.ts` made seeds with `Keypair.random()` in Node. It stored them with `security add-generic-password ... -w <seed>`.
  The seed appeared in the process list. The code printed a warning about this.
- `src/secrets.ts` read a `keychain://<service>/<account>` reference with `security find-generic-password -w`. The seed returned to Node.
- `security` created each item, so the item trusted `security`. Any process could run the same command without a prompt.
  Its own `docs/credential-providers.md` says "Silent reads are expected."

Stellar CLI v28.1.0 is similar. `--secure-store` keeps a seed phrase in the Keychain through the `keyring` crate.
The `stellar` process reads the phrase, signs in its own memory, then zeroizes it.

## Options that meet the requirement

| | Does the walleterm CLI see a secret? | Does any software see it? | G-accounts | Size |
| --- | --- | --- | --- | --- |
| A. Separate signer app | No | Yes: the signer app, once for each approved signature | Yes | Large |
| B. Secure Enclave P-256 signer | No | No. The hardware signs. | No. C-accounts only. | Medium |
| C. Other products through the SSH agent protocol | No | The product. YubiKey and TKey keep keys in hardware. | Yes | Small |

### A. Separate signer app

A signed `Walleterm Signer.app` holds Ed25519 seeds sealed to its own Secure Enclave key.
It keeps them in its keychain access group, so only code from the same team can read them.
It unseals a seed after Touch ID, signs, erases the seed, and returns the signature over the SSH agent protocol.
The CLI keeps its SSH agent client and uses a new socket path.

- The helper can receive the full artifact in an `SSH_AGENTC_EXTENSION` message (RFC 9987). It parses the artifact and shows it in the prompt.
  A plain `SIGN_REQUEST` carries only the digest, so a prompt cannot describe it.
- The bundle needs a Developer ID provisioning profile with these entitlements:
  `com.apple.developer.team-identifier`, `com.apple.application-identifier`, and `keychain-access-groups`.
- Apple's pattern is `X.app/Contents/{Info.plist, MacOS/<exe>, embedded.provisionprofile}`. Sign from the inside out. Do not use `--deep`.
- A symlink to the bundle executable works in production. Teleport installs `tsh.app` this way.
- The Homebrew cask needs an `app` stanza. The walleterm CLI stays a bare `binary`, because it needs no entitlement.
- The helper runs as a LaunchAgent, a login item, or through launchd socket activation.
  The owner prefers visible services, so socket activation or an explicit start command fits best.
- Put the socket outside `~/Library/Containers` and `~/Library/Group Containers`. macOS "App Data" prompts fire for clients of those paths.
- Check the caller with `LOCAL_PEERTOKEN` and its code signature. An attacker can still run the real `walleterm`, so the prompt stays the main control.
- `tools/src/release.rs` requires a binary with no entitlements. The signer needs a change to that check.
- The research estimate is 3 to 6 engineer-weeks. CI runners are virtual machines without a Secure Enclave.
- Our own code still decrypts the seed. This design meets the requirement for the CLI, not for the product as a whole.

No existing project does this job. Secretive, sshenc, keyward, and touchid-agent hold P-256 keys only.
Study Secretive for packaging and the prompt flow. Study `godaddy/hardware-enclave` for a Rust-to-Swift bridge.

### B. Secure Enclave P-256 signer for a smart account

The Secure Enclave creates a P-256 key and signs inside the hardware. Walleterm sees only public data and signatures.
The key signs Soroban authorization for an OpenZeppelin smart account through the audited WebAuthn verifier.
It cannot sign for a G-account, a transaction envelope, or a SEP-53 message. Fees need a relayer or another key.
[SECURE-ENCLAVE.md](SECURE-ENCLAVE.md) has the full design.

### C. Other products through the SSH agent protocol

These products Ed25519-sign the raw data of an SSH agent sign request. Walleterm's client in `src/agent.rs` works unchanged.
Each needs a new fixed socket path and a live test.

| Product | Key | Approval | Socket on macOS | Notes |
| --- | --- | --- | --- | --- |
| YubiKey OpenPGP Ed25519 through gpg-agent `enable-ssh-support` | On the card. It cannot be exported. Firmware 5.2.3 or later. | Touch on the `aut` key: `ykman openpgp keys set-touch aut on`. An optional `confirm` flag in `~/.gnupg/sshcontrol` adds an Allow or Deny dialog. | `gpgconf --list-dirs agent-ssh-socket` | gpg-agent passes EdDSA data to the card without a hash (`agent/command-ssh.c`). GnuPG setup takes effort. |
| Tillitis TKey `tkey-ssh-agent` | On the device. It changes if the signer app binary changes. | Touch for each signature. | Set with `-a`. | BSD-2-Clause, v1.1.1. No PIN by default. |
| Bitwarden desktop | Software. The user can view and copy it. | A dialog for each signature. The user can remember it until the vault locks. | `~/.bitwarden-ssh-agent.sock`, or the App Store container path. | Desktop v2026.9.0 ships the new agent behind the `SSHAgentV2` flag. |
| YubiKey PIV Ed25519 through OpenSSH `ssh-agent` and ykcs11 | On the card. Firmware 5.7.4 or later. | Touch and PIN policy, fixed at generation. | The socket of the agent that loaded the module. | OpenSSH 10.1 added Ed25519 PKCS#11 keys. ykcs11 Ed25519 has open bugs. |

Not verified: Proton Pass `pass-cli ssh-agent` shows no approval step, and Strongbox needs a check for raw data.

### Threat model

| Property | A. Signer app | Rejected: unseal inside walleterm | B. Secure Enclave P-256 | 1Password |
| --- | --- | --- | --- | --- |
| Who can read the sealed key | Only team T4GBHCYB7P code with the profile | Any process of the same user | Nobody. The key never leaves the hardware. | Only 1Password |
| Who can ask for a prompt | Any client of the socket | Any process of the same user | Any process of the same user that reads the blob | Any client of the socket |
| An approved malicious prompt gives | One signature | The whole seed | One signature | Signatures until 1Password locks, with the default scope |
| Secret in walleterm memory | Never | Yes | Never | Never |

## Other stores

- Ledger with the Stellar app needs a new USB HID transport. The Rust `stellar-ledger` crate in Stellar CLI exists.
  `SIGN_HASH` (instruction `0x08`) signs any 32 bytes but needs the Blind signing setting.
  Readable mode needs the preimage, so walleterm must send artifacts, not digests. The OpenZeppelin digest has no readable mode.
  Version 6.1.0 adds `ENVELOPE_TYPE_SOROBAN_AUTHORIZATION_WITH_ADDRESS`. It was on `develop`, not `master`, on 2026-09-29.
- Trezor firmware 2.12.4 signs Soroban transactions and address-bound authorization. It has no raw hash and no SEP-53.
  It needs a new transport and conversion from XDR to Trezor protobuf messages.
- WalletConnect wallets such as LOBSTR and Freighter Mobile sign only full transaction XDR.
- Windows CNG and TPM providers document no Ed25519. A Windows store needs a native adapter.
- Linux `ssh-tpm-agent` supports ECDSA and RSA only.
- Google Password Manager has no signing API.

## Architecture notes

- One "SSH agent store" adapter can serve 1Password, Bitwarden, gpg-agent, and TKey. Only the socket path changes.
- Each socket keeps today's checks: socket type, owner, and restrictive mode. Each store has one fixed path or one reliable lookup.
  Walleterm still exposes no socket override and ignores `SSH_AUTH_SOCK`.
- A native store, such as the Secure Enclave or a future TPM, needs its own adapter.
- `--store` selects one store for each command. The bridge `Deps` closures in `src/bridge.rs` are the seam for `tunnel`.

## Stellar protocol context

These facts were checked on 2026-09-29 with Stellar Raven, the `stellar-raven-jev` CLI, and the CAP files on GitHub.

### Delegated signing between G- and C-addresses

| CAP | Direction | Status | What it permits |
| --- | --- | --- | --- |
| CAP-71 | A C-account delegates to any address | Final. Live since protocol 27. | A custom account calls `delegate_account_auth(address)` inside `__check_auth`. The delegate can be a G-account or a contract. `SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES` carries every delegate signature in one entry. CAP-71-02 adds address-bound V2 credentials. |
| CAP-72 | A G-account delegates to a contract | Draft. Protocol TBD. Last edit 2025-09-19 (`7699c72c`). | A new G-account signer type, `SIGNER_KEY_TYPE_SC_DELEGATED`. It authorizes only `SorobanAuthorizationEntry` values through `delegate_account_auth`. The CAP says these signers "can not be used to sign the transactions directly". Fees are a non-goal. |

- The Zipper upgrade guide calls CAP-71 delegation "explicitly foundational to CAP-0072".
- For option B, CAP-72 would let a G-account add the smart account as a delegated signer.
  The Secure Enclave could then approve Soroban calls for that G-account, such as SAC transfers of its balances.
  Envelopes, classic operations, and fees would still need Ed25519.
- The walleterm CLI signs only `address_v2` credentials. The skill reference `delegation.md` covers `address_with_delegates` entries.

### Recent protocol upgrades

| Protocol | Testnet | Mainnet | CAPs |
| --- | --- | --- | --- |
| 28 "Adapter" | 2026-08-27 | 2026-09-16 | CAP-83 (validators can vote to drop the transaction set), CAP-85 (externally managed contract executables), CAP-86 (sparse map host functions) |
| 27 "Zipper" | 2026-06-18 | 2026-07-08 | CAP-71, with CAP-71-01 (authentication delegation) and CAP-71-02 (address-bound credentials) |
| 26 "Yardstick" | 2026-04-16 | 2026-05-06 | CAP-73 (SAC creates G-account balances), CAP-77 (freeze ledger entries), CAP-78 (limited TTL extensions), CAP-79 (muxed strkey conversions), CAP-80 (ZK BN254), CAP-82 (checked 256-bit arithmetic) |
| 25 "X-Ray" | 2026-01-07 | 2026-01-22 | CAP-74 (BN254), CAP-75 (Poseidon and Poseidon2) |
| 24 | 2025-10-21 | 2025-10-22 | None. A stability upgrade after Whisk. |
| 23 "Whisk" | 2025-08-14 | 2025-09-03 | CAP-62 and CAP-66 (state archival), CAP-67 (unified events) |

- The next signature CAP is CAP-87, ML-DSA verification. It is "Awaiting Decision" with protocol TBD. It verifies full messages, not digests.
- The Stellar Raven docs index still said "Protocol 28 (Testnet, TBD)" on 2026-09-29. The live page gives the dates above.

### Legacy credentials after protocol 28

The sources disagree about the legacy `SOROBAN_CREDENTIALS_ADDRESS` (V1) credential.

- The Zipper upgrade guide says V1 "remains valid until the Protocol 28 upgrade".
- The js-stellar-sdk v17.0.0 notes say V2 is "mandatory in protocol 28".
- CAP-71-02 has a section "No deprecation of `SOROBAN_CREDENTIALS_ADDRESS`". It says protocol 28 or later "may" deprecate V1.
- The Protocol 28 upgrade guide lists only CAP-83, CAP-85, and CAP-86 as breaking changes.

Walleterm signs only V2, so the answer does not change it. A testnet submission with a V1 entry would settle the question.

## Open decisions

- The names for `--store`. Proposal: `1password`, `secure-enclave`, `bitwarden`, `gpg-agent`.
- The default when `--store` is absent. Proposal: `1password`, the current behavior.
- Whether `tunnel` serves one store for each run.
- The AGENTS.md rule changes for each new store. The current rules name 1Password and Ed25519 only.

## Upstream watch list

The values were current on 2026-09-29.

| Item | Value | Check |
| --- | --- | --- |
| Secure Enclave key types | P-256, ML-KEM, ML-DSA. No Curve25519. | CryptoKit `SecureEnclave` in the newest SDK |
| Passwords app SSH keys | None | macOS release notes |
| CAP-72 contract signers for G-accounts | Draft, no target protocol | [CAP index](https://github.com/stellar/stellar-protocol/tree/master/core) |
| CAP-87 ML-DSA verification | Awaiting Decision, protocol TBD | [CAP index](https://github.com/stellar/stellar-protocol/tree/master/core) |
| Newest protocol | 28, on mainnet since 2026-09-16 | [Software versions](https://developers.stellar.org/docs/networks/software-versions) |
| V1 address credentials after protocol 28 | Sources disagree | A testnet submission with a V1 entry |
| OpenZeppelin `stellar-contracts` | v0.7.2 audited. v0.8.0-rc.3 not audited. | [Releases](https://github.com/OpenZeppelin/stellar-contracts/releases) |
| Bitwarden new SSH agent | Behind `SSHAgentV2` in v2026.9.0 | Bitwarden desktop release notes |
| Ledger Stellar app | 6.0.3 on `master`. 6.1.0 on `develop`. | [LedgerHQ/app-stellar](https://github.com/LedgerHQ/app-stellar) |
| ykcs11 Ed25519 | Open issue | [yubico-piv-tool #507](https://github.com/Yubico/yubico-piv-tool/issues/507) |

## Sources

| Source | Version or date |
| --- | --- |
| [Protecting keys with the Secure Enclave](https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave) | Read 2026-09-29 |
| [TN3137: On Mac keychain APIs and implementations](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains) | Revised 2022-11-01 |
| [TN3125: Inside code signing: provisioning profiles](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles) | 2024-02-06 |
| [Signing a daemon with a restricted entitlement](https://developer.apple.com/documentation/xcode/signing-a-daemon-with-a-restricted-entitlement) | Read 2026-09-29 |
| [Storing CryptoKit keys in the keychain](https://developer.apple.com/documentation/cryptokit/storing-cryptokit-keys-in-the-keychain) | Read 2026-09-29 |
| [WWDC25 session 314](https://developer.apple.com/videos/play/wwdc2025/314) | 2025-06-09 |
| [Apple Platform Security: keychain data protection](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web) | 2024-12-19 |
| Apple DTS forum threads [786171](https://developer.apple.com/forums/thread/786171), [786223](https://developer.apple.com/forums/thread/786223), [799625](https://developer.apple.com/forums/thread/799625), [811186](https://developer.apple.com/forums/thread/811186), [701514](https://developer.apple.com/forums/thread/701514) | 2022 to 2026 |
| Apple open source [`Security`](https://github.com/apple-oss-distributions/Security) | `Security-61901.0.87.0.1` |
| Local `sc_auth(8)` and `ssh-keychain(8)` | macOS 26.7 |
| [1Password SSH agent](https://www.1password.dev/ssh/agent) and [its security model](https://www.1password.dev/ssh/agent/security) | Read 2026-09-29 |
| [1Password Touch ID security](https://support.1password.com/touch-id-apple-watch-security-mac/) | Read 2026-09-29 |
| [maxgoedjen/Secretive](https://github.com/maxgoedjen/secretive) | v4.0.0, 2026-09-21 |
| [remko/age-plugin-se](https://github.com/remko/age-plugin-se) | v0.2.1; `main` at `57ccea1` |
| [godaddy/hardware-enclave](https://github.com/godaddy/hardware-enclave) and [godaddy/sshenc](https://github.com/godaddy/sshenc) | 0.2.10; v0.6.101 |
| [Teleport RFD 0054](https://github.com/gravitational/teleport/blob/master/rfd/0054-passwordless-macos.md) | Read 2026-09-29 |
| [RFC 9987: SSH agent protocol](https://datatracker.ietf.org/doc/draft-ietf-sshm-ssh-agent/) | May 2026 |
| [gnupg `agent/command-ssh.c`](https://github.com/gpg/gnupg/blob/master/agent/command-ssh.c) and [GnuPG T5041](https://dev.gnupg.org/T5041) | gnupg-2.5.24 |
| [Bitwarden SSH agent](https://bitwarden.com/help/ssh-agent/) | Desktop v2026.9.0 |
| [tillitis/tkey-ssh-agent](https://github.com/tillitis/tkey-ssh-agent) | v1.1.1 |
| [OpenSSH release notes](https://www.openssh.org/releasenotes.html) | 10.1, 2025-10-06 |
| [LedgerHQ/app-stellar](https://github.com/LedgerHQ/app-stellar) | 6.0.3 and 6.1.0 |
| [trezor-firmware Stellar messages](https://github.com/trezor/trezor-firmware/blob/main/common/protob/messages-stellar.proto) | Core 2.12.4 and 2.12.5 |
| [stellar/stellar-cli](https://github.com/stellar/stellar-cli) | v28.1.0 |
| [kalepail/walleterm](https://github.com/kalepail/walleterm) | `9290543` |
| [Stellar software versions](https://developers.stellar.org/docs/networks/software-versions) | Page dated 2026-09-24 |
| [CAP index](https://github.com/stellar/stellar-protocol/blob/master/core/README.md), [CAP-71](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071.md), [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md), [CAP-72](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0072.md) | Read 2026-09-29. CAP-72 last changed in `7699c72c`. |
| [Zipper, Protocol 27 upgrade guide](https://stellar.org/blog/foundation-news/stellar-zipper-protocol-27-upgrade-guide) | Read 2026-09-29 |
| [Adapter, Protocol 28 upgrade guide](https://stellar.org/blog/developers/adapter-protocol-28-upgrade-guide) | Read 2026-09-29 |
| [js-stellar-sdk v17.0.0](https://github.com/stellar/js-stellar-sdk/releases/tag/v17.0.0) | 2026-08-20 |
| [Delegate auth example](https://developers.stellar.org/docs/build/smart-contracts/example-contracts/delegate-auth) | Read 2026-09-29 |
