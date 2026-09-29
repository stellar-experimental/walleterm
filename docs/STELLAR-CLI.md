# Stellar CLI integration

This file shows how `walleterm` works with the official Stellar CLI.
See [INTERFACE.md](INTERFACE.md) for the exact input, output, and error contract of `walleterm sign`.
`sign` accepts one artifact and computes its digest: a transaction envelope, an authorization preimage or entry, or a SEP-53 message.
It returns a signed envelope or entry where one exists. It never builds, simulates, or submits transactions.
The Stellar CLI does those steps. Contract formats outside the three entry adapters stay in scripts or an SDK.

## Pinned sources

All source statements in this file refer to these exact revisions.

| Source | Revision | Evidence |
|---|---|---|
| Stellar CLI | tag `v28.1.0`, commit [`c0f4d0d`](https://github.com/stellar/stellar-cli/tree/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd) | The version that CI installs |
| Stellar XDR definitions | commit [`9c9c145`](https://github.com/stellar/stellar-xdr/blob/9c9c145953e80990d6ff1ae3a6a973a0ce6d0694/Stellar-transaction.x) | Reported as `xdr` by `stellar --version` |
| Rust `stellar-xdr` crate | `28.0.0` | Reported by `stellar --version` |
| Stellar protocol CAPs | commit [`9cd7030`](https://github.com/stellar/stellar-protocol/tree/9cd703075d87a6ce293752b1532e7b68efe12ae1/core) | CAP-71 text |
| Soroban examples | commit [`b46f4e0`](https://github.com/stellar/soroban-examples/tree/b46f4e0c9dccc9e51980b559915f52d8b94e9236/multisig_1_of_n_account) | The `multisig_1_of_n_account` example |

Base URL for CLI source links below:
`https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/`

## Installed commands used

All commands below exist in `stellar 28.1.0`.

| Command | Use |
|---|---|
| `stellar tx new <op> --build-only --source-account G...` | Builds an unsigned V1 envelope. Fetches the sequence number from RPC |
| `stellar contract invoke --build-only --source-account G... --id C... -- <fn> ...` | Builds an unsigned host-function envelope |
| `stellar tx simulate --source-account G... [--auth-mode enforce\|root\|non-root]` | Records auth entries and resources, or enforces signed auth entries |
| `stellar tx decode` / `stellar tx encode` | Converts `TransactionEnvelope` between base64 XDR and JSON |
| `stellar xdr encode --type <T>` / `stellar xdr decode --type <T>` | Converts any XDR type, for example `TransactionSignaturePayload` and `HashIdPreimage` |
| `stellar xdr generate default --type <T> --output json` | Prints a JSON template for an XDR type |
| `stellar tx hash --network-passphrase ...` | Prints the V1 envelope signature digest. Fails for fee-bump envelopes |
| `stellar strkey decode <G...\|C...>` | Prints the raw 32-byte key or contract ID as hex |
| `stellar ledger latest` | Reads the latest ledger for `signature_expiration_ledger` |
| `stellar tx send` | Submits a signed envelope |
| `stellar tx fetch {result\|meta\|fee\|events}` | Reads evidence for a submitted transaction |

The CLI has no command to add an external signature or to sign one auth entry by itself.
`contract invoke` can wrap its own transaction in a fee bump. No command builds a fee bump for a given envelope.

## Built-in CLI signing and why `walleterm` does not use it

- `tx sign` accepts only `--sign-with-key`, `--sign-with-lab`, `--sign-with-ledger`, and `--auto-sign` ([`config/sign_with.rs#L39-L76`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/config/sign_with.rs#L39-L76)).
- The signer set is a closed enum: `Local`, `Ledger`, `Lab`, `SecureStore` ([`signer/mod.rs#L324-L329`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/signer/mod.rs#L324-L329)). There is no external or plugin signer.
- `tx sign` signs only the envelope digest. It supports V1 and fee-bump envelopes ([`signer/mod.rs#L345-L379`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/signer/mod.rs#L345-L379)).
- The CLI signs auth entries only inside `contract invoke`, before it signs the envelope ([`tx.rs#L73-L80`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/tx.rs#L73-L80)).
- CLI auth signing refuses C-address credentials ([`signer/mod.rs#L137-L146`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/signer/mod.rs#L137-L146)).
- CLI auth signing leaves `address_with_delegates` entries unsigned, with a warning ([`signer/mod.rs#L101-L107`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/signer/mod.rs#L101-L107)).
- `tx hash` calls `unwrap_envelope_v1`, which rejects fee-bump envelopes ([`commands/tx/hash.rs#L30-L31`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/commands/tx/hash.rs#L30-L31), [`commands/tx/xdr.rs#L79-L82`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/commands/tx/xdr.rs#L79-L82)).
- Unknown subcommands dispatch to a `stellar-<name>` binary on `PATH`, with inherited stdio ([`commands/mod.rs#L95-L100`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/commands/mod.rs#L95-L100), [`commands/plugin/default.rs#L19-L31`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/commands/plugin/default.rs#L19-L31)). The `stellar-walleterm` alias makes `stellar walleterm list` work.

The official auth-plugin pattern is `--build-only | tx simulate | <auth signer> | tx simulate | tx sign | tx send` ([soroban-examples README](https://github.com/stellar/soroban-examples/blob/b46f4e0c9dccc9e51980b559915f52d8b94e9236/multisig_1_of_n_account/README.md)).
`walleterm` follows the same pipeline. `walleterm sign` replaces the auth signer and `tx sign` stages.

## Digests

The Ed25519 envelope and native account signatures covered here sign a SHA-256 digest of an XDR preimage.
`walleterm sign` computes these digests itself. The commands below reproduce them for an independent check.
`network_id` is `SHA-256(network passphrase)`. For testnet it is `cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472`.

| Target | Preimage | XDR source |
|---|---|---|
| V1 envelope | `TransactionSignaturePayload` with `tagged_transaction.tx` | [`Stellar-transaction.x#L1012`](https://github.com/stellar/stellar-xdr/blob/9c9c145953e80990d6ff1ae3a6a973a0ce6d0694/Stellar-transaction.x#L1012) |
| Fee-bump envelope | `TransactionSignaturePayload` with `tagged_transaction.tx_fee_bump` | [`#L993`](https://github.com/stellar/stellar-xdr/blob/9c9c145953e80990d6ff1ae3a6a973a0ce6d0694/Stellar-transaction.x#L993), [`#L1012`](https://github.com/stellar/stellar-xdr/blob/9c9c145953e80990d6ff1ae3a6a973a0ce6d0694/Stellar-transaction.x#L1012) |
| Auth, `address` credentials | `HashIdPreimage.soroban_authorization` | [`#L721-L762`](https://github.com/stellar/stellar-xdr/blob/9c9c145953e80990d6ff1ae3a6a973a0ce6d0694/Stellar-transaction.x#L721-L762) |
| Auth, `address_v2` credentials | `HashIdPreimage.soroban_authorization_with_address` | [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-02.md) |
| Auth, `address_with_delegates` credentials | `HashIdPreimage.soroban_authorization_with_address`, using the top-level address | [CAP-71-01](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-01.md) |

The auth preimage fields are `network_id`, `nonce`, `signature_expiration_ledger`, and `invocation`.
The `_with_address` variant also has `address`.
Copy `nonce` and `invocation` exactly from the simulated entry. Use the signer's chosen `signature_expiration_ledger`.
The same value must go into the preimage and into the credentials.

Reproduce the digest with the CLI:

```sh
# V1 envelope
stellar tx hash --network-passphrase "$PASSPHRASE" unsigned.xdr

# Any preimage, including fee bump and auth
stellar xdr encode --type TransactionSignaturePayload payload.json | base64 -d | shasum -a 256
stellar xdr encode --type HashIdPreimage preimage.json | base64 -d | shasum -a 256
```

## JSON assembly

The JSON shapes below match the output of `stellar xdr generate default --output json`.
For a V1 envelope, `stellar tx hash` and SHA-256 of the encoded `TransactionSignaturePayload` give the same digest.

### Envelope signature

```json
{"tx":{"tx":{...},"signatures":[{"hint":"<8 hex>","signature":"<128 hex>"}]}}
```

For a fee bump, the top-level key is `tx_fee_bump`, and outer signatures go in `tx_fee_bump.signatures`.
`hint` is the last 4 bytes of the raw public key. Get the raw key with `stellar strkey decode G...`.
Signatures do not change the digest, so every multisig signer signs the same digest.
Append one `DecoratedSignature` for each signer. An envelope holds at most 20 signatures ([`#L967-L973`](https://github.com/stellar/stellar-xdr/blob/9c9c145953e80990d6ff1ae3a6a973a0ce6d0694/Stellar-transaction.x#L967-L973)).

### Fee-bump envelope

```json
{"tx_fee_bump":{"tx":{"fee_source":"G...","fee":"<i64 string>","inner_tx":{"tx":<signed V1 envelope body>},"ext":"v0"},"signatures":[]}}
```

Payload for the outer digest:

```json
{"network_id":"<hex>","tagged_transaction":{"tx_fee_bump":<tx_fee_bump.tx>}}
```

Sign the inner envelope first. Changing inner signatures changes the fee-bump digest.

### G-account auth credentials

The built-in account check expects a vector of maps. The CLI uses the same format ([`signer/mod.rs#L292-L313`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/signer/mod.rs#L292-L313)):

```json
{"credentials":{"address":{"address":"G...","nonce":"<i64 string>","signature_expiration_ledger":<u32>,
  "signature":{"vec":[{"map":[
    {"key":{"symbol":"public_key"},"val":{"bytes":"<64 hex>"}},
    {"key":{"symbol":"signature"},"val":{"bytes":"<128 hex>"}}]}]}}},
 "root_invocation":{...}}
```

Use `address_v2` in place of `address` when the simulated entry uses it. Keep the credential variant that the entry already has.
For G-account multisig auth, add one map for each signer, in strictly increasing `public_key` order.
The host rejects other orders with "public keys are not ordered" (`soroban-env-host` `27.0.0`, `src/builtin_contracts/account_contract.rs` lines 203-243).
Match the CLI's safety rules:
- Reject an entry whose address is the transaction source ([`signer/mod.rs#L149-L155`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/signer/mod.rs#L149-L155)).
- Ask for approval of non-strict entries. `--auto-sign` skips the prompt and logs the entry ([`signer/mod.rs#L116-L127`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/signer/mod.rs#L116-L127)).

### C-account auth credentials

The C-account digest is the same as for G-accounts. Use the C address in `_with_address` preimages.
The contract's `__check_auth` receives that digest as `signature_payload` and the credential `signature` value.
The `signature` value format is defined by the contract. A test helper or example must build it for each account type.

| Account type | `signature` format | Source |
|---|---|---|
| Soroban example `multisig_1_of_n_account` | One map: `{public_key: bytes32, signature: bytes64}`. Not a vector | [`contract/src/lib.rs`](https://github.com/stellar/soroban-examples/blob/b46f4e0c9dccc9e51980b559915f52d8b94e9236/multisig_1_of_n_account/contract/src/lib.rs), [plugin `main.rs`](https://github.com/stellar/soroban-examples/blob/b46f4e0c9dccc9e51980b559915f52d8b94e9236/multisig_1_of_n_account/stellar-cli-sign-auth-ed25519/src/main.rs) |
| OpenZeppelin smart account | `AuthPayload` map and rule-bound digest | See [OPENZEPPELIN.md](OPENZEPPELIN.md) for the pinned schema |

Simulation in record mode does not call `__check_auth` ([CAP-71-01, Motivation](https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/core/cap-0071-01.md#motivation)). It returns entries with a void signature.
After assembly, run `stellar tx simulate --auth-mode enforce` so that simulation runs `__check_auth` and updates resources.
Then compute the envelope digest from the re-simulated envelope.

## Pipeline

```text
build --build-only
  -> tx simulate                     (record auth entries and resources)
  -> [each auth entry] walleterm sign (preimage or entry shape) -> insert signature or signed entry
  -> tx simulate --auth-mode enforce (only if auth entries changed)
  -> [each envelope signer] walleterm sign (transaction shape) -> signed_transaction_xdr
  -> [optional] fee-bump envelope -> walleterm sign (transaction shape) -> signed outer envelope
  -> tx send -> tx fetch result/meta
```

The first `tx simulate` uses the RPC default. It records only entries rooted at the transaction's call.
`--auth-mode non-root` also records other entries. A signature on such an entry works in any transaction that makes the same authorized call.
The CLI asks before it signs such an entry ([`signer/validation.rs`](https://github.com/stellar/stellar-cli/blob/300aaf69ab100536678bdb641428b06f06b318ea/cmd/soroban-cli/src/signer/validation.rs)).
Walleterm cannot see the transaction for an entry, so the caller makes this check.

Before each `walleterm sign` call, the script must show or record:
- the network passphrase
- the unsigned XDR and its decoded JSON
- the signer G address
- the expected digest, computed by an independent command. Compare it with the `digest` that walleterm returns.

After each call, record the signature and the final envelope.
After submission, record the transaction hash, the ledger, the result, and the account or contract state.

## Limitations

- The 1Password prompt shows the process and the key. It does not show the digest or transaction. The human must approve the plan before the prompt.
- `walleterm` generates no keys. Generate test keys in the 1Password desktop app. `walleterm` makes no changes to 1Password settings or agent configuration.
- The CLI has no external signature injection. `walleterm sign` appends envelope signatures itself.
  Other authorization formats need JSON edits and re-encoding.
- `stellar tx hash` rejects fee-bump envelopes. Scripts use `TransactionSignaturePayload` for fee-bump digests.
- `stellar tx sign` cannot use `walleterm`. Do not use `tx sign` in the `walleterm` pipeline.
- Muxed (M), claimable-balance, and liquidity-pool auth addresses are not supported. The CLI has `todo!` panics for these ([`signer/mod.rs#L133-L135`](https://github.com/stellar/stellar-cli/blob/c0f4d0da891bbf214c08b8c5035ae6db80e9a3bd/cmd/soroban-cli/src/signer/mod.rs#L133-L135)).
- See [the evidence index](../evidence/README.md) for live testnet records and their limits.

## Coverage limits

Each item below needs its own test before anyone claims support.

| Item | Current state |
|---|---|
| `address_with_delegates` credentials (CAP-71-01) | The CLI leaves them unsigned. The `walleterm sign` entry shape rejects them. The preimage shape signs the top-level `_with_address` digest. `tests/cap71.ts` assembles delegate trees, nested ones included, for the CAP-71 fixtures |
| Delegation through `require_auth` inside `__check_auth` | Covered only for the OpenZeppelin delegated signer. See [OPENZEPPELIN.md](OPENZEPPELIN.md) |
| Contract signers on G-accounts (CAP-72) | Out of scope |
| OpenZeppelin smart account signature format | The pinned version only. Other versions need separate checks |
| `stellar-walleterm` plugin dispatch | The alias forwards arguments and standard input to the same binary |
