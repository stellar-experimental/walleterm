# Parity fixtures

These files freeze the behavior of the accepted Go signer and TypeScript sidecar at
`52a7fc388e93e19482a9cc2a96408ac4328c526e`. The Rust host must reproduce every case exactly.

| File | Producer | Cases | SHA-256 |
| --- | --- | --- | --- |
| `vectors.json` | `sdk/authorization.ts`, `sdk/preimage.ts`, `bridge/authorization.ts`, `bridge/transaction.ts`; JS SDK 17.1.0 on Bun 1.4.2 | 87 | `2affc3c94359b228adc15f8b35ad29feb76a7c91160184d2108ee0761557b28c` |
| `cli.json` | `main.go` `run()` against scripted mock agents; Go 1.27.1 | 57 | `1c8bb6d80bf8158a5f88cb3ce9fc5f023037497cc41f1d30c131786ec67dd14a` |
| `sign-auth.json` | `bridge/auth-cli.ts` through `bridge/main.ts sign-auth`, with a fake `walleterm sign` | 26 | `6383b913b38d0a2035d03863e2dc8aa68987a0efacc90ea51bbe5ec163024ce7` |

All three were produced on 2026-09-28. Six `vectors.json` cases were added after the Phase 1 review:
near-integer decimals, the Base64URL alias for each artifact kind, and the invalid asset code. The first 81 cases are unchanged. `tests/vectors.rs` and `tests/cli.rs` read them; a hash check blocks silent regeneration.
`tests/vectors.test.ts` also checks `vectors.json` against the browser SDK modules.

- `vectors.json`: digests, signatures, signed artifacts, review details, and errors for AddressV2 entries,
  SEP-43 preimages, and bridge v3 transactions.
- `cli.json`: arguments, standard input, the mock agent's replies, the exit code, standard output and
  error bytes, and every raw request frame that reached the agent.
- `sign-auth.json`: standard input, the exit code, and standard output and error bytes. The fake signer
  signs with the mock seed or returns the Go signer's error JSON.

The mock keys come from fixed seeds (07 and 09 repeated; 08 for an unlisted key). Use them only offline.
Never import, fund, or use them for live signing.

Do not regenerate a file to make a failing port pass.
Change a case only for a reviewed behavior change, and record the reason in the commit.

## Recorded differences

The Rust host differs from the old code in these places. Only the first one accepts more.

- Structural admission accepts a valid envelope whose content the JS SDK refuses to model, such as an asset
  code that is not a valid Stellar code (`tx-invalid-asset-code`, marked `rust_accepts`). The TS bridge rejected it.
  This follows the v3 policy: the bridge filters no operation content, and review decides it.
  The signer, network, exact body, and signature lifetime stay bound. The browser SDK's pre-check still rejects it.
- Ed25519 checks use strict verification (`verify_strict`). A weak key or a noncanonical signature fails.
- XDR decoding stops at depth 500, the Soroban host limit. A deeper value cannot run on chain.
- `--human` output escapes control, format (Cf), separator, and private-use characters as Go does.
  Go also escapes unassigned code points; Rust prints an unassigned letter-like character. JSON output is byte-identical.
- `sign` input with an escaped lone surrogate (`\ud800`) fails as invalid JSON. Go decodes it to U+FFFD.
- `sign-auth` input that JavaScript parses but `serde_json` refuses (lone surrogates, numbers beyond f64) fails as
  `Send one JSON object.` Both reject the request.
- `sign-auth` has no sidecar, so `start_failed` no longer occurs. On SIGINT or SIGTERM it exits by the signal
  without a JSON line, as `sign` does.
- `tunnel` and `demo` accept only decimal `--port` values. Go's `flag` package also accepts hexadecimal and octal.
