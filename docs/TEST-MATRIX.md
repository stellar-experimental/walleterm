# Acceptance tests

This document defines acceptance cases. See `../evidence/live/` for observed results.
G01-G10 and C01-C13 have passing testnet evidence from 2026-09-25.
C09 references sponsor coverage in C01-C04. The other contract rows executed directly.
The baseline contract suite used `sorobanCredentialsAddressV2`.
The independent installed-CLI test also passed one OpenZeppelin multisig call with legacy `address` credentials.
See `../evidence/acceptance-summary.json` for final outcomes. Historical failures remain in the event records.
Use dedicated testnet accounts and fresh 1Password keys named `walleterm-v2-test-a`, `walleterm-v2-test-b`, and `walleterm-v2-test-c`.
Use the CLI under test for all live signer signatures.

## Local protocol and CLI

| ID | Scenario | Required result |
| --- | --- | --- |
| L01 | List Ed25519 identities | Valid Stellar G-addresses and SSH fingerprints |
| L02 | RSA and unsupported identities | Excluded or explicitly rejected |
| L03 | Fragmented response headers and bodies | Correct bounded reconstruction |
| L04 | Oversized, truncated, empty, or trailing frames | Error without signing success |
| L05 | Unknown key and duplicate identities | Explicit deterministic handling |
| L06 | Invalid JSON, unknown fields, invalid G-address, invalid digest | Rejected before socket signing |
| L07 | Refused request, locked app, timeout, closed socket | Structured error and nonzero exit |
| L08 | Wrong response algorithm, wrong key, wrong signature length | Rejected |
| L09 | Valid signature and changed payload | Original verifies; changed payload fails |
| L10 | JSON output, human output, help, plugin alias | Stable output and working command examples |
| L11 | Apple SSH_AUTH_SOCK and missing 1Password socket | No fallback to another agent |
| L12 | Concurrent callers and repeated requests | Separate bounded requests; no key or payload mix-up |

## Live 1Password

| ID | Scenario | Required result |
| --- | --- | --- |
| P01 | Three desktop-generated Ed25519 keys | Public keys match the intended vault items |
| P02 | Raw 32-byte signing request | Independent verification of a 64-byte Ed25519 signature |
| P03 | User denies an approval | No signature and no automatic retry |
| P04 | Approval cache or locked app | Record actual behavior without changing security settings |

## Classic accounts

| ID | Scenario | Required result |
| --- | --- | --- |
| G01 | Simple native payment | Accepted transaction and exact recipient balance change |
| G02 | 2-of-3 signer configuration | One signature fails; two distinct authorized signatures pass |
| G03 | Unequal signer weights and thresholds | Required weights pass; insufficient weights fail |
| G04 | Master key weight zero | Authorized added signers pass; master-only signature fails |
| G05 | Different transaction and operation sources | Missing source authorization fails; complete set passes |
| G06 | Several operations with several sources | All required accounts authorize their operations |
| G07 | Fee-bump inner and outer signatures | Each envelope uses its own hash and authorized signers |
| G08 | Wrong network, altered body, stale sequence, expired bounds | Expected protocol rejection |
| G09 | Duplicate signature and unrelated signature | Insufficient duplicate weight returns `txBadAuth`; an unrelated extra signature returns `txBadAuthExtra` |
| G10 | Signer rotation | Old signer fails after removal; replacement signer passes |

## Contract accounts and authorization

| ID | Scenario | Required result |
| --- | --- | --- |
| C01 | G-account as Soroban address credentials | Correct auth signature and accepted invocation |
| C02 | Minimal C-account with one Ed25519 signer | Correct `__check_auth` payload and accepted state change |
| C03 | Pinned OpenZeppelin basic account | Its exact signature format passes |
| C04 | Pinned OpenZeppelin multisig example | Sufficient distinct signers pass; insufficient signers fail |
| C05 | Custom weighted or context-limited policy | Correct weight/context passes; wrong weight/context fails |
| C06 | Several C-accounts authorize one invocation | Each account receives its own correct authorization |
| C07 | G-account and C-account authorize one invocation | Both authorization formats pass together |
| C08 | Nested calls and nested authorization trees | Complete intended tree passes; altered child call fails |
| C09 | Sponsor submits for independent account signers | Envelope source remains separate from authorization signers |
| C10 | Wrong nonce, network, expiration, root arguments, or signer | Expected rejection without the intended state change |
| C11 | Reuse of consumed authorization | Replay fails |
| C12 | Duplicate signers and reordered signatures | Follow exact contract rules; duplicates never increase authority |
| C13 | Contract signer rotation or context update | New rules apply; old authorization fails where required |

## Evidence per live scenario

Extended testnet scenarios passed on 2026-09-25:

| ID | Scenario | Observed result |
| --- | --- | --- |
| E01 | Native G-account multisig authorization | Two signatures pass; insufficient weight, reversed order, and duplicates fail with specific diagnostics |
| E02 | OpenZeppelin delegated G signer | Single and nested calls pass; wrong root, wrong digest, and missing delegate fail |
| E03 | Contract-specific rule and policy changes | Matching context passes; threshold update and rule removal enforce the new state |

E01 restored account B's original signers and thresholds.
The extended runner preserves completed steps and labels reused evidence separately.

- Record network passphrase, RPC protocol, tool versions, and source commits.
- Record public signer keys, account addresses, weights, thresholds, and contract WASM hashes.
- Record the unsigned artifact and each payload digest before signing.
- Record signature verification and final assembled XDR.
- Record simulation outcome separately from submission outcome.
- Record transaction hash, ledger result, events, and relevant post-transaction state.
- Record actual negative-test errors. Do not count transport failures as authorization rejection.
- Mark contract-specific and host-protocol restrictions explicitly.

Passkeys remain outside these Ed25519 acceptance claims.

## Protocol compatibility extension

See `PROTOCOL-UPDATES.md` for native CAP-71 and CAP-85 acceptance requirements and final evidence.
Run the separate suites with `node tests/live.mjs cap71` and `node tests/live.mjs cap85`.
These commands use the same dedicated keys and persistent submission guard.
