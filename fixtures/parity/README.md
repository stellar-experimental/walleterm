# Parity fixtures

These files freeze the behavior of the accepted Go signer and TypeScript sidecar at
`52a7fc388e93e19482a9cc2a96408ac4328c526e`. The Rust host must reproduce every case exactly,
except the reviewed changes in [One sign command](#one-sign-command).

| File | Producer | Cases | SHA-256 |
| --- | --- | --- | --- |
| `vectors.json` | `sdk/authorization.ts`, `sdk/preimage.ts`, `bridge/authorization.ts`, `bridge/transaction.ts`; JS SDK 17.1.0 on Bun 1.4.2 | 99 | `5cacc734b910b20ea4f0e9822af7138260853c57df2700f096079bda247ca799` |
| `cli.json` | `main.go` `run()` against scripted mock agents; Go 1.27.1 | 58 | `1c8bb6d80bf8158a5f88cb3ce9fc5f023037497cc41f1d30c131786ec67dd14a` |

The retained fixtures were produced on 2026-09-28.
The former `dotenv.json` corpus held 2,106 cases for the removed Bun-compatible parser.
Its SHA-256 was `42ab2525d78d06f31cb4b10b048b1abcb29cff78b2848c1e9ace590c33addee8`.
The `--vault` CLI flag replaces `.env` and `OP_VAULT` configuration, so its corpus and producer were removed.
Git history preserves them. Service and discovery tests now cover the flag and its empty-value rejection.
Six `vectors.json` cases were added after the Phase 1 review:
near-integer decimals, the Base64URL alias for each artifact kind, and the invalid asset code. The first 81 cases are unchanged.
Twelve Soroban envelope cases (`tx-soroban-*`) were added in Phase 7 from the same `bridge/transaction.ts`,
before `bridge/soroban-transaction.test.ts` was removed. The first 87 cases are unchanged. `tests/vectors.rs` and `tests/cli.rs` read them; a hash check blocks silent regeneration.
`tests/vectors.test.ts` also checks `vectors.json` against the browser SDK modules.

- `vectors.json`: digests, signatures, signed artifacts, review details, and errors for AddressV2 entries,
  SEP-43 preimages, and bridge v3 transactions.
- `cli.json`: arguments, standard input, the mock agent's replies, the exit code, standard output and
  error bytes, and every raw request frame that reached the agent.

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
- `tunnel` and `demo` accept only decimal `--port` values. Go's `flag` package also accepts hexadecimal and octal.

## One sign command

The approved design in `audit/2026-09-28-sign-design/DESIGN.md` (PR A) changed these behaviors on 2026-09-28.
The frozen files stay unchanged. The tests record each change.

- `walleterm sign-auth` is gone, so `sign-auth.json` was removed. `tests/cli.rs` and `tests/vectors.rs` sign the same
  entries through `walleterm sign` and the shared core, and they reproduce the frozen JS results.
- `walleterm sign` no longer accepts a digest or `--human`. The `sign-*` and `input-*` cases in `cli.json` record the
  removed digest input. `tests/cli.rs` replays only the `list` cases byte for byte.
  It replays the recorded agent failure replies with the message shape. Each failure keeps its code and message.
- The help and usage text changed. The `help`, `help-short`, and `usage-*` cases record the old text.
- No request reads a ledger. The `latest_ledger` window and value checks are gone. Expiration ledger 0 fails.
- A transaction needs no time bounds. Only a nonzero `max_time` at or before now fails. A fee bump uses its inner bounds.
  The bridge request expiry is five minutes, or the transaction's `max_time` when that is sooner.
- The shared core accepts a preimage bound to any G- or C-address. The bridge still requires the selected G-address
  or a C-address.
- `tests/vectors.rs` lists each changed vector in `CHANGED`.
