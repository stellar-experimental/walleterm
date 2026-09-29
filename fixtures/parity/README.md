# Signing fixtures

These fixtures check signing artifacts and the agent protocol with isolated mock keys.
The tests compare exact bytes, digests, signatures, errors, and command output.

| File | Producer | Cases | SHA-256 |
| --- | --- | --- | --- |
| `vectors.json` | JavaScript SDK 17.1.0 on Bun 1.4.2 | 99 | `5cacc734b910b20ea4f0e9822af7138260853c57df2700f096079bda247ca799` |
| `cli.json` | Scripted mock agent transcripts | 28 | `3c4a7e9306657f2eeb9cb7df7af0c4cf3498b8d65fa4732d3caef8cc94a6940f` |

The `vectors.json` producer is in Git history at `ee3e06d`, path `audit/2026-09-28-rust-port/evidence/gen-vectors.ts.txt`.

## Coverage

- `vectors.json` contains AddressV2 entries, SEP-43 preimages, and classic and Soroban transaction envelopes.
  It records digests, signatures, signed artifacts, review details, and errors.
- `cli.json` contains 19 list transcripts, eight signing failure transcripts, and one signing request frame example.
  The list tests compare exact output and agent frames.
  The signing failure tests use the message shape and compare each error code and message.
  The request frame test checks its encoding and flags.

[`tests/vectors.rs`](../../tests/vectors.rs) checks the Rust signing core and both fixture hashes.
[`tests/vectors.test.ts`](../../tests/vectors.test.ts) checks the same vectors against the browser SDK.
[`tests/cli.rs`](../../tests/cli.rs) checks the command process and its agent requests.
The tests apply the current signing rules from [the interface](../../docs/INTERFACE.md).
`CHANGED` in the Rust tests and `NOW_SIGNS` in the SDK tests identify explicit expectation overrides.
The tests preserve the fixture bytes when a reviewed rule requires a different result.

## Interface differences

The Rust core accepts structurally valid envelopes that the JavaScript SDK cannot model.
`tx-invalid-asset-code` records this difference with `rust_accepts`.
The browser SDK rejects that envelope before sending it.
The bridge checks the signer, network, envelope, and expiry without filtering operation content.

The shared core accepts preimages bound to any G-address or C-address.
The bridge requires the selected G-address or a C-address.
Authorization expiration must be nonzero. Signing does not read a ledger.
A transaction needs no time bounds. The bridge rejects an expired nonzero `max_time`.
A fee bump uses the inner transaction bounds.
A bridge request expires after five minutes or at an earlier transaction `max_time`.

## Fixture rules

Never regenerate a file to make a failing test pass.
Change a case only for a reviewed behavior change. Record the reason in the commit.
Update the table hash after an approved fixture edit.

The mock keys use fixed seeds: 07 and 09 repeated, and 08 for an unlisted key.
Use them only offline. Never import, fund, or use them for live signing.
