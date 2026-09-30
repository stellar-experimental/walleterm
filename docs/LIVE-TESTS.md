# Live tests

Live tests request 1Password signatures and change Stellar testnet state. They run by hand only. CI never runs them.
A run on testnet, futurenet, or a local network needs no separate approval. A mainnet run needs the user's approval. See `AGENTS.md`.
Use dedicated test keys and confirm the intended test scope before you run them.
Run one live suite at a time.

Keep the evidence types separate: source review, offline tests, live signatures, and accepted testnet transactions.
A generated signature alone does not prove account authorization.
An accepted transaction alone does not prove the intended balance or policy change.

## Prepare

1. Install the Stellar CLI (`brew install stellar-cli`). The runners and step 5 use it.
2. Run `make build` and `bun install --frozen-lockfile --ignore-scripts`. The `tests/live.ts` runners and `tests/cli-pipeline.ts` sign through `bin/walleterm`.
3. Create three Ed25519 SSH keys inside the 1Password desktop app.
4. Enable only the intended test items in the 1Password SSH agent configuration.
5. Use `walleterm list` to identify each key by its full G-address.
   Decode each address with `stellar strkey decode G...` to get its 32-byte public key in hexadecimal.
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

The array order selects keys A, B, and C. The file contains public metadata only.
Never put a seed, private key, vault export, or account credential in this file.
Git ignores this file and all live journals.
The harness funds missing testnet accounts through Friendbot.

## Build fixtures

Contract builds need Rust, the `wasm32v1-none` target, and the Stellar CLI.

```sh
sh fixtures/build.sh
cargo build --locked --manifest-path fixtures/cap71/Cargo.toml --workspace --release --target wasm32v1-none
sh fixtures/cap85/build.sh
```

Build scripts can download source and dependencies. They do not request signatures.
Git tracks the pinned WASM artifacts in `fixtures/wasm/` and `fixtures/cap85/wasm/`.
CAP-71 loads its artifacts from the local Cargo build directory.

## Run the suites

```sh
bun tests/live.ts classic
bun tests/live.ts contracts
bun tests/live.ts extended
bun tests/live.ts cap71
bun tests/live.ts cap85
```

Run `contracts` before `extended` or `cap85`. They need its deployment checkpoint.
These runners construct, submit, and check the test transactions. They send each artifact to `walleterm sign`:
transactions with the transaction shape, host payloads with the preimage shape, and OpenZeppelin entries with the entry shape.
Walleterm computes every digest. The runners check each returned signature independently.
Read the relevant fixture README before you select individual rows.

## Other live runners

| Command | Purpose |
| --- | --- |
| `bun tests/cli-pipeline.ts` | Builds, signs, and submits one transaction through the Stellar CLI pipeline with the submission guard |
| `WALLETERM_BINARY=bin/walleterm bun --no-env-file tests/approve-live.ts --port 18787 --code <code> --key G...` | `walleterm approve` against a running `walleterm tunnel --approve` on testnet. It denies one request, approves one, and submits it. Then stop the tunnel and run it again with `--after` |
| `bun tests/1password-failure.ts <label> [delay-ms]` | Signs one SEP-53 message with key A through `~/.local/bin/walleterm`. It records the observed approval, denial, or interruption. It asserts no outcome |
| `WALLETERM_BINARY=<prefix>/bin/walleterm bun --no-env-file tests/openzeppelin-auth-live.ts <keys.json> [--vault Private]` | The OpenZeppelin adapter through the CLI and the SDK. See [OPENZEPPELIN.md](OPENZEPPELIN.md) |
| `WALLETERM_BINARY=<prefix>/bin/walleterm bun --no-env-file tests/contract-auth-demo-live.ts <keys.json> [--vault Private]` | The demo contract authorization flow. See [CONTRACT-AUTHORIZATION.md](CONTRACT-AUTHORIZATION.md) |

`<keys.json>` is the path to `public-test-keys.json`.
In the last two runners, the SDK half uses the Rust bridge on loopback. It runs the test host in production mode.
That mode uses the real 1Password signer and explicit vault discovery. Build the test host first:
`cargo build --locked --features test-host --bin walleterm-test-host`.
The OpenZeppelin runner reads its contract IDs from `live/contracts-state.json` beside that file.
The two runners write their journals beside that file, in `openzeppelin-auth-live/` and `contract-auth-live/`.

## Scenarios

Each row ID names a case in the live runners.

### Classic accounts (`classic`)

| ID | Scenario | Required result |
| --- | --- | --- |
| G01 | Simple native payment | Accepted transaction and exact recipient balance change |
| G02 | 2-of-3 signer configuration | One signature fails. Two distinct authorized signatures pass |
| G03 | Unequal signer weights and thresholds | Required weights pass. Insufficient weights fail |
| G04 | Master key weight zero | Authorized added signers pass. A master-only signature fails |
| G05 | Different transaction and operation sources | Missing source authorization fails. The complete set passes |
| G06 | Several operations with several sources | All required accounts authorize their operations |
| G07 | Fee-bump inner and outer signatures | Each envelope uses its own hash and authorized signers |
| G08 | Wrong network, altered body, stale sequence, expired bounds | Expected protocol rejection. Walleterm refuses the expired `max_time` before any 1Password request |
| G09 | Duplicate signature and unrelated signature | Insufficient duplicate weight returns `txBadAuth`. An unrelated extra signature returns `txBadAuthExtra` |
| G10 | Signer rotation | The old signer fails after removal. The replacement signer passes |

### Contract accounts and authorization (`contracts`)

| ID | Scenario | Required result |
| --- | --- | --- |
| C01 | G-account as Soroban address credentials | Correct auth signature and accepted invocation |
| C02 | Minimal C-account with one Ed25519 signer | Correct `__check_auth` payload and accepted state change |
| C03 | Pinned OpenZeppelin basic account | Its exact signature format passes |
| C04 | Pinned OpenZeppelin multisig example | Sufficient distinct signers pass. Insufficient signers fail |
| C05 | Custom weighted or context-limited policy | Correct weight or context passes. A wrong weight or context fails |
| C06 | Several C-accounts authorize one invocation | Each account receives its own correct authorization |
| C07 | G-account and C-account authorize one invocation | Both authorization formats pass together |
| C08 | Nested calls and nested authorization trees | The complete intended tree passes. An altered child call fails |
| C09 | Sponsor submits for independent account signers | The envelope source stays separate from the authorization signers |
| C10 | Wrong nonce, network, expiration, root arguments, or signer | Expected rejection without the intended state change |
| C11 | Reuse of consumed authorization | Replay fails |
| C12 | Duplicate signers and reordered signatures | Exact contract rules apply. Duplicates never increase authority |
| C13 | Contract signer rotation or context update | New rules apply. Old authorization fails where required |

### Extended contract cases (`extended`)

| ID | Scenario | Required result |
| --- | --- | --- |
| E01 | Native G-account multisig authorization | Two signatures pass. Insufficient weight, reversed order, and duplicates fail |
| E02 | OpenZeppelin delegated G signer | Single and nested calls pass. A wrong root, a wrong digest, and a missing delegate fail |
| E03 | Contract-specific rule and policy changes | The matching context passes. A threshold update and a rule removal enforce the new state |

E01 restores the original signers and thresholds of account B.
Each contract row declares its expected authorization entries: AddressV2 credentials, an address, and the full root invocation.
The `contracts` and `extended` runners check every recorded entry against that tree before any change or signing request.
They reject extra, missing, changed, signed, V1, and source-account entries. A mismatch stops the row before signing.
Deliberate negative changes apply only after the original tree passes this check.
E03 compares its RPC-read context rule with the known rule before the `execute` call carries it.
`tests/contracts.test.ts` tests this check offline.

The `cap71` and `cap85` suites use the row IDs in `fixtures/cap71/README.md` and `fixtures/cap85/README.md`.

### SEP-43 wallet

These steps use the tunnel, the demo, and the Kit fixture page. Each needs fresh approval and dedicated testnet keys.
Start the Kit page with `bun fixtures/kit/live/serve.mts` after the Kit fixture install (`make test-kit`).

1. Demo: pair, sign and submit a payment, switch wallets, and sign again.
2. Demo: increment the fixture counter through `signAuthEntry`, then `signTransaction`.
3. Kit page with a real 1Password key: `authModal`, `signTransaction`, `signAuthEntries`, switch, and `disconnect`.
4. Zero signature requests for PUBLIC, a V1 preimage, a message with a lone surrogate, and `submit: true`.
5. A `changeTrust` transaction. The bridge filters no operation types.
6. Kit page `signMessage` with the text `walleterm acceptance <date> <nonce>`.
   The tunnel prints the message line. Verify the Base64 signature with the SDK and the Stellar CLI. Nothing goes to the network.

## Record each run

- Record the network passphrase, RPC protocol, tool versions, and source commits.
- Record public signer keys, account addresses, weights, thresholds, and contract WASM hashes.
- Record the unsigned artifact and each payload digest before signing.
- Record signature verification and the final assembled XDR.
- Record the simulation outcome separately from the submission outcome.
- Record the transaction hash, ledger result, events, and relevant post-transaction state.
- Record actual negative-test errors. Do not count transport failures as authorization rejection.
- Mark contract-specific and host-protocol restrictions explicitly.

The runners write local records under `evidence/live/`, which Git ignores.
See [the evidence index](../evidence/README.md) for the tracked records.

## Recover an interrupted run

```sh
bun tests/live.ts reconcile
```

An unknown submission blocks further signing and submission across process restarts.
This command queries the saved transaction hash without submitting it again.
Only a terminal `SUCCESS` or `FAILED` result clears the shared gate.
`NOT_FOUND` does not prove that a transaction was never submitted.

Keep `evidence/live/pending-submission.json`, submission archives, and suite checkpoints until the outcome is known.
CAP-71 also requires an explicit review of its local `inflight` checkpoint after shared reconciliation.
CAP-85 reconciles both journals on startup and rechecks saved counter conditions.
See the fixture README for suite-specific recovery.
Do not run `git clean -X` in this checkout. Ignored files can contain unresolved submission evidence.

## Not covered

- A connection to the approval socket from another macOS user. The tunnel refuses it through `peer_cred`, but no test proves this.
  The test needs a second macOS account. It is skipped for now.
