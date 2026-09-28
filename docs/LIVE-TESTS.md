# Live test setup

Live tests request 1Password signatures and change Stellar testnet state.
Use dedicated test keys and confirm the intended test scope before running them.
Run one live suite at a time.

## Prepare

1. Run `make build` and `bun install --frozen-lockfile --ignore-scripts`.
   The runners sign through `bin/walleterm`.
2. Create three Ed25519 SSH keys inside the 1Password desktop app.
3. Enable only the intended test items in the 1Password SSH agent configuration.
4. Use `walleterm list` to identify each key by its full G-address.
5. Decode each address with `stellar strkey decode G...` to obtain its 32-byte public key in hexadecimal.
6. Create `evidence/public-test-keys.json` with the following structure. Replace each placeholder with the matching public key.

```json
{
  "keys": [
    {"name": "test-a", "raw_public_key_hex": "<64 hexadecimal characters>"},
    {"name": "test-b", "raw_public_key_hex": "<64 hexadecimal characters>"},
    {"name": "test-c", "raw_public_key_hex": "<64 hexadecimal characters>"}
  ]
}
```

The array order selects A, B, and C. The file contains public metadata only.
Never put a seed, private key, vault export, or account credential in this file.
The repository ignores it and all live journals.
The harness funds missing testnet accounts through Friendbot.

## Build fixtures

Contract builds require Rust, the `wasm32v1-none` target, and Stellar CLI.

```sh
sh fixtures/build.sh
cargo build --locked --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none
sh fixtures/cap85/build.sh
```

Build scripts can download source and dependencies. They do not request signatures.
Pinned WASM artifacts under `fixtures/wasm/` and `fixtures/cap85/wasm/` remain tracked for verification and host tests.
CAP-71 loads its artifacts from the local Cargo build directory.

## Run

```sh
bun tests/live.ts classic
bun tests/live.ts contracts
bun tests/live.ts extended
bun tests/live.ts cap71
bun tests/live.ts cap85
```

Run `contracts` before `extended` or `cap85`; they need its deployment checkpoint.
The `contracts` and `extended` runners check each recorded authorization entry against the expected tree of its row.
A mismatch stops the row before any signing request.
Review [the test matrix](TEST-MATRIX.md) and the relevant fixture README before selecting individual rows.
These runners construct, submit, and check the test transactions. They send each artifact to `walleterm sign`:
transactions with the transaction shape, host payloads with the preimage shape, and OpenZeppelin entries with the entry shape.
Walleterm computes every digest. The runners check each returned signature independently.

## Recover an interrupted run

```sh
bun tests/live.ts reconcile
```

This command queries the saved transaction hash without submitting it again.
Only a terminal `SUCCESS` or `FAILED` result clears the shared gate.
`NOT_FOUND` does not prove that a transaction was never submitted.

Keep `evidence/live/pending-submission.json`, submission archives, and suite checkpoints until the outcome is known.
CAP-71 also requires explicit review of its local `inflight` checkpoint after shared reconciliation.
CAP-85 reconciles both journals on startup and rechecks saved counter conditions.
See the fixture README for suite-specific recovery.
Do not run `git clean -X` against this checkout; ignored files can contain unresolved submission evidence.
