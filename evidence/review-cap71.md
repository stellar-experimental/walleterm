# Independent CAP-71 review

Reviewer: wt-opus (Herdr pane w44:p4), Opus 5.5, effort high. Date: 2026-09-25, snapshot 18:14:44Z.
Scope: `fixtures/cap71/**` source (not `target/` internals), `tests/cap71.mjs`, `tests/cap71.test.mjs`, and their use of `tests/live-utils.mjs`, `tests/live.mjs`, `tests/submission.mjs`, and `tests/contracts.mjs`.
Requirements: `docs/PROTOCOL-UPDATES.md` (CAP-71 section).
Method: read-only source review and offline tests only. There was no network, signing, vault, or submission activity.

## Verdict

No blocker found. After the delta below, N1, N6, and the missing-signature part of N7 are resolved. The review supports the live run.

## Reviewed source hashes (SHA-256)

These hashes did not change from the start to the end of the final offline test run.

```text
227f23c2fa46c979364bbb28c8e3e6ed521d10f43b96b5adc0003c4cde756004  fixtures/cap71/Cargo.toml
49af94eb27138c7783adb50cc5c7dc33c4ec9dcafc53c87540bf282998e6ade9  fixtures/cap71/Cargo.lock
f1fc10c6fdcefe001b5c8fb7a077ddb453108636f668500b32c67c72aea8824e  fixtures/cap71/delegate/Cargo.toml
bbe5e0c2b9416b08f191865f8b82fbd82e7964888501e5b244006a53a8ed3d1e  fixtures/cap71/protected/Cargo.toml
b4a001d6e8c4925d0da7c2f69c963ca7e3f72279e965199f1efa1602d87bdd8c  fixtures/cap71/raw-account/Cargo.toml
49a107cc73efb47ad96dea983edb6dc5ac784c18c9c1d5962b957b331e8bb4af  fixtures/cap71/delegate/src/lib.rs
68248f7daa96a7f43bb215d2b97080e28d2eeb3dbbc926725e4f18cc7c6114c4  fixtures/cap71/delegate/src/test.rs
a5f9d89dde6e5a3b41d63032e7bad62998ef82cd576fd75d9818d6751b97116f  fixtures/cap71/protected/src/lib.rs
932b05873139a2a1e33c48f72dfd76f66a44b42666afa61123326c4e619b2ffb  fixtures/cap71/raw-account/src/lib.rs
7ab96b2b9431ad5d47384dc1c623990a284c5824740e535f690746d27c2be2c6  tests/cap71.mjs
e11d5766a9a894a9cec9b5689a5c111b95bf1bd18155c0fd56295e12d2aefc4b  tests/cap71.test.mjs
ca212e1877f88b25cc287554d9c9efb646fe895f9cf880cbcb335b97355c1a8f  tests/live-utils.mjs
beae3d4aacc3273ae595ee79972f46fe21207aae943b21ee7abeb2a041562a19  tests/live.mjs
28ac2b2eb967e3ae106e725cdd783ba13a82e2bff90d0070955bc663a3090e75  tests/submission.mjs
f72039404f9ee1df8fa3f51e14ff5e11c23b453d22a689f00f0bf4526cb2da65  tests/contracts.mjs
ff2086577443ae9031f2b116c02851a9d0d1230ec64201275e7abf1122d0f685  fixtures/cap71/target/wasm32v1-none/release/cap71_delegate.wasm
d5c1366046edf2f992d4836cddcd27d6d3e49cc9564fb46ee3cf7851091dfcbd  fixtures/cap71/target/wasm32v1-none/release/cap71_raw_account.wasm
0a6ecabe7aa4b1699d8f95bc8f95cc6dd0715769ac3a2c26db4eadca54483a6c  fixtures/cap71/target/wasm32v1-none/release/cap71_target.wasm
```

## Offline checks run

| Check | Command | Result |
| --- | --- | --- |
| Rust fixture tests | `CARGO_TARGET_DIR=<temp> cargo test --offline --locked` in `fixtures/cap71` | 8 passed, 0 failed |
| JS adapter tests | `node --test tests/cap71.test.mjs` | 10 passed, 0 failed |
| Reproducible WASM | `CARGO_TARGET_DIR=<temp> cargo build --offline --locked --release --target wasm32v1-none` | All three WASM files are byte-identical to `fixtures/cap71/target/wasm32v1-none/release/` |
| Mock key isolation | Compare seeds 71, 72, 73 with `evidence/public-test-keys.json` | No overlap |

Tools: rustc 1.93.0, cargo 1.93.0, node v24.13.0, `@stellar/stellar-sdk` 17.1.0, `soroban-sdk` =27.0.2.
The builds used a temporary target folder. No file in the checkout changed except this review.

## Confirmed properties

- Root-address binding: `signTree` requires `envelopeTypeSorobanAuthorizationWithAddress`.
  It checks `SHA-256(preimage) == payload` and records the preimage before each `signDigest` (`tests/cap71.mjs:81-89`).
  Rust `address_v2_rejects_same_key_cross_account_replay` and live rows CAP71-11/12 test account substitution.
- Nested delegation: `DelegateAccount` authenticates every supplied delegate through `delegate_auth` after the weight check (`delegate/src/lib.rs:78-94`).
  Rust tests cover C->C->raw and G / C->C->G nesting with real Ed25519 verification. Row CAP71-04 covers a nested positive, an empty inner set (7101), and an underweight inner set (7103).
- Policy membership and threshold: an unknown member fails with 7102 before any delegate verification. Weight is summed with overflow checks.
  All supplied members are verified, including extras beyond the threshold (Rust `threshold_and_all_supplied_signatures_are_enforced`). Rows 01-06 cover 1-of-2, 2-of-2, weighted, unknown, unknown-extra, and empty.
- Rejection oracles: each negative needs an enforce-simulation error, the expected code, and an allowed top-level error.
  The host-level negatives also need the exact diagnostic text: duplicate, unordered, expired, and consumed nonce.
- Replay freshness: auth expires at `latestLedger + 120`. The expired case uses `latestLedger - 1`.
  The replay case resubmits the exact accepted entry and requires `nonce already exists for address`.
- Checkpoint: the binding covers the network, the three public keys, and the local WASM hashes. The write is atomic (temp file, fsync, rename, then a directory fsync).
  Salts are saved before deploy. `inflight` is saved before `send` and blocks a restart with `UnknownSubmission`.
  The mocked restart test shows that confirmed steps do not sign or send again.
- Guard before signatures: `assertClear` runs before each auth signature (`signTree`, and the raw path inside the callback). The envelope path runs it through `ctx.sign`.
  `ctx.signDigest` and `ctx.send` check again. An offline test shows that a pending gate produces no prompt or record.
- Keys and network: `runCap71` asserts `Networks.TESTNET`. `live-utils.mjs` fixes the testnet RPC. Signing keys come only from `evidence/public-test-keys.json`. Offline tests use isolated mock seeds.
- Scope: native CAP-71 fixtures stay separate from the OpenZeppelin `require_auth_for_args` delegation. The SDK helpers `buildWithDelegatesEntry` and `authorizeEntry(forAddress)` build the tree.

## Findings

### N1 (recommended before live): the root invocation is not checked before auth signatures

`call()` checks only that record simulation returned one entry for `who` (`tests/cap71.mjs:227-229`).
It then signs the RPC-supplied `rootInvocation` through `signTree` or the raw path.
If simulation returns a different invocation, walleterm signs it first. Enforce simulation detects the mismatch only after the signatures exist.
Repro (offline, run): `/tmp/walleterm-usability-snYwFv/n1/repro.mjs` mocks RPC. Its record entry names `drain(999)` on an unrelated contract.
Result: `N1: signDigest reached`, and the preimage given to `signDigest` contains `drain`. No enforce simulation ran before that request.
Suggested fix: before signing, require the entry's `rootInvocation` XDR to equal `contractFn(c.target, 'ping', [u32 1])` with no sub-invocations.
The risk is limited to dedicated testnet keys. The same pattern exists in `tests/contracts.mjs` `invoke`.

### N2 (note): the rejection oracle matches substrings

`assertRejection` accepts the expected code anywhere in `simulation.error` or in the stringified event data.
Repro (offline): an event whose data is the string `"Error(Contract, #7103)"` passes `{ code: 'Error(Contract, #7103)' }`.
The fixed contract codes and host diagnostics make a false pass unlikely.
The crypto rows (CAP71-11/12) prove the error class, not which node failed. Their construction supplies that link.

### N3 (note): a resumed replay or substitution row can fail after expiration

Rows CAP71-10/11/12 reuse `state.checks['...-source']` from the checkpoint.
After a restart more than 120 ledgers later, the presigned entry has expired. The negative then fails with `signature has expired`, not the intended reason.
This fails closed, but it needs a manual checkpoint edit. Consider re-running the source step when its expiration has passed.

### N4 (note): `inflight` also blocks a known terminal failure

A non-SUCCESS terminal result makes `ctx.send` throw a normal error, and `state.inflight` stays saved (`tests/cap71.mjs:168-175`).
The next run then throws `UnknownSubmission`, even though the guard archive holds the final result. There is no documented procedure to clear it.
This fails closed.

### N5 (note): the envelope time bound covers human approval

`txFor` uses `setTimeout(120)`. A slow 1Password approval of the envelope can cause `txTooLate`, which leads to the N4 state.

### N6 (note): row selection accepts unknown IDs

`WALLETERM_ROWS=CAP71-1` records every row as `not_run`, and the run completes. `tests/contracts.mjs:467` rejects unknown row IDs; `cap71.mjs` does not.

### N7 (coverage): two gaps for the "missing signatures" requirement

- No case lists a G member node with a `void` or empty signature. That is the `buildWithDelegatesEntry` placeholder default.
  CAP71-02 omits the member node instead.
- No negative has a nested leaf sign a payload bound to the inner account instead of the root.
The host is expected to reject both. Add them if the acceptance text is meant to cover them.

### N8 (fixture note)

`DelegateAccount` ignores `_contexts` and keeps its policy in instance storage with no TTL extension.
That fits immutable test fixtures, but it is not a production account pattern.

## Delta recheck (frozen delta, 2026-09-25 ~18:20Z)

Only `fixtures/cap71/delegate/src/test.rs`, `tests/cap71.mjs`, and `tests/cap71.test.mjs` changed semantically.
The contract sources changed by rustfmt only.
The two WASM hash changes (`cap71_raw_account`, `cap71_target`) come from that reformat. They were already in the snapshot above, and a fresh offline build is byte-identical to them.
I did not rebuild the WASM again for this delta.

Delta hashes (SHA-256):

```text
227f23c2fa46c979364bbb28c8e3e6ed521d10f43b96b5adc0003c4cde756004  fixtures/cap71/Cargo.toml
49af94eb27138c7783adb50cc5c7dc33c4ec9dcafc53c87540bf282998e6ade9  fixtures/cap71/Cargo.lock
f1fc10c6fdcefe001b5c8fb7a077ddb453108636f668500b32c67c72aea8824e  fixtures/cap71/delegate/Cargo.toml
bbe5e0c2b9416b08f191865f8b82fbd82e7964888501e5b244006a53a8ed3d1e  fixtures/cap71/protected/Cargo.toml
b4a001d6e8c4925d0da7c2f69c963ca7e3f72279e965199f1efa1602d87bdd8c  fixtures/cap71/raw-account/Cargo.toml
49a107cc73efb47ad96dea983edb6dc5ac784c18c9c1d5962b957b331e8bb4af  fixtures/cap71/delegate/src/lib.rs
20e7fd4d30ae0c947835aa1d443a2b8a0fb78f1fa5015f54d3a432044d234ee8  fixtures/cap71/delegate/src/test.rs
a5f9d89dde6e5a3b41d63032e7bad62998ef82cd576fd75d9818d6751b97116f  fixtures/cap71/protected/src/lib.rs
932b05873139a2a1e33c48f72dfd76f66a44b42666afa61123326c4e619b2ffb  fixtures/cap71/raw-account/src/lib.rs
541366fa58f4301807118661fb9a8458cccd231c84e4cddefc43784927516445  tests/cap71.mjs
cc0c835cfdb3039d33b1471cafe27f637e45b8c2fe30b47f2e023114a7474656  tests/cap71.test.mjs
ca212e1877f88b25cc287554d9c9efb646fe895f9cf880cbcb335b97355c1a8f  tests/live-utils.mjs
beae3d4aacc3273ae595ee79972f46fe21207aae943b21ee7abeb2a041562a19  tests/live.mjs
28ac2b2eb967e3ae106e725cdd783ba13a82e2bff90d0070955bc663a3090e75  tests/submission.mjs
f72039404f9ee1df8fa3f51e14ff5e11c23b453d22a689f00f0bf4526cb2da65  tests/contracts.mjs
ff2086577443ae9031f2b116c02851a9d0d1230ec64201275e7abf1122d0f685  fixtures/cap71/target/wasm32v1-none/release/cap71_delegate.wasm
d5c1366046edf2f992d4836cddcd27d6d3e49cc9564fb46ee3cf7851091dfcbd  fixtures/cap71/target/wasm32v1-none/release/cap71_raw_account.wasm
0a6ecabe7aa4b1699d8f95bc8f95cc6dd0715769ac3a2c26db4eadca54483a6c  fixtures/cap71/target/wasm32v1-none/release/cap71_target.wasm
```

Targeted checks:

| Item | Evidence | Status |
| --- | --- | --- |
| N1: expected invocation gate | `tests/cap71.mjs:247-252` compares the recorded `rootInvocation` XDR with `ping(c.target, [u32 1])` and no sub-invocations. The check runs before the raw branch, before `signTree`, and before any `signDigest`. The offline test mutates contract, method, amount, extra argument, and sub-invocation for CAP71-01 (native) and CAP71-12 (raw), and requires 0 `signDigest`, 0 envelope signatures, and no new sends. My repro `/tmp/walleterm-usability-snYwFv/n1/repro.mjs` now stops at `unexpected recorded authorization tree` before any signature. | Fixed |
| N6: early row validation | `tests/cap71.mjs:147-148` rejects an unknown row ID as the first action of `runCap71`, before RPC, checkpoint, or signing. There is an offline test for it. | Fixed |
| N7: missing G signature | CAP71-06 `CAP71-missing-g-signature` keeps the registered G node, replaces its signature with an empty `Vec`, and requires `Error(Contract, #5)` plus `no account signatures found`. `removeGLeafSignature` keeps the credentials, root, and digest unchanged (offline test). The Rust test covers the direct and nested G nodes, the positive control, and address substitution. | Covered |
| JS suite | `node --test tests/cap71.test.mjs` | 13 passed, 0 failed |
| Rust delta test | `cargo test --offline --locked -p cap71-delegate native_g_and_c_to_c_to_g` (temp target) | 1 passed |

Hashes were identical before and after these runs.

### N9 (note): `Void` differs from an empty `Vec`

The live case uses an empty `Vec`. The earlier request and the SDK placeholder default use `ScVal::Void`.
In an offline temporary copy of the Rust test (not in the checkout), a `Void` G-node signature was also rejected, and the counter stayed at 0.
The reason differs: `Error(Value, UnexpectedType)` under `Error(Auth, InvalidAction)`, not `#5` / `no account signatures found`.
The acceptance text should name the empty-`Vec` form. It must not claim a `#5` rejection for `Void`.

## Final readiness

From this independent offline review, the frozen CAP-71 implementation is ready for the parent's serialized live run.
Notes N2-N5, N8, and N9 remain. None of them weakens a rejection or allows signing after an unknown outcome.
No live simulation, signature, or submission was part of this review.
