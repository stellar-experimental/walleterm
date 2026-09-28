# Parity vectors

`vectors.json` freezes the outputs of the accepted TypeScript signing code.
The Rust host must reproduce every case exactly. The browser SDK must agree with every case.

- Producer: `sdk/authorization.ts`, `sdk/preimage.ts`, `bridge/authorization.ts`, and `bridge/transaction.ts` at `52a7fc388e93e19482a9cc2a96408ac4328c526e`.
- Library: `@stellar/stellar-sdk` 17.1.0 on Bun 1.4.2. Produced on 2026-09-28.
- File SHA-256: `4e04a8e8b12b5b7332fb1ef12d8eb9a401c79753262b82124c63459672145e7e`.
- Readers: `tests/vectors.rs` (Rust host) and `tests/vectors.test.ts` (browser SDK modules).

Each case has an `id`, a `kind`, its inputs, and `expect`.
`expect` holds the digest, signature, signed artifact, and review details, or an `error` with `code` and `message`.
The `auth_entry` kind covers `walleterm sign-auth` and the bridge adapter extension.
The `preimage` kind covers SEP-43 `signAuthEntry`. The `transaction` kind covers bridge v3 admission and attachment.

The mock keys come from fixed seeds (`mock_seed_hex`, `other_seed_hex`). Use them only offline.
Never import, fund, or use them for live signing.

Do not regenerate this file to make a failing port pass.
Change a case only for a reviewed behavior change, and record the reason in the commit.

## Recorded differences

The Rust host rejects every case that the TypeScript code rejects. It is stricter in these places:

- Ed25519 checks use strict verification (`verify_strict`). A weak key or a noncanonical signature fails.
- XDR decoding stops at depth 500, the Soroban host limit. A deeper value cannot run on chain.
- A structurally valid envelope that the JS SDK refuses to model still passes structural admission.
  Review decides its content, as for every v3 transaction.
