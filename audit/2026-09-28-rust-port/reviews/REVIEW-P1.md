# Phase 1 security review

Verdict: **CHANGES**.

Reviewed commit: `1660f97484f8558879c1613f6eb73867627363f6`.
Base: `52a7fc388e93e19482a9cc2a96408ac4328c526e`.
Scope: the committed pure Rust core, dependencies, frozen vectors, and recorded differences.

One numeric parsing defect needs correction before acceptance. I found no blocker-level digest or artifact-mutation defect.
The two notes below identify diagnostic and documentation differences.

Concurrent uncommitted work appeared during this review. I excluded it and repeated the checks against a frozen commit snapshot.
All cited source lines refer to `1660f97`, including the original parity README.
I wrote only inside `_migration/`. I did not change tracked files or run live signing.

## Should-fix

### S1. JSON parsing changes fractional rule IDs and ledger values into accepted integers

Locations: `Cargo.toml:16`; `src/authorization.rs:114`; `src/authorization.rs:151`; `src/authorization.rs:198`.

The selected `serde_json` features omit `float_roundtrip`.
The default decimal parser rounds some fractional inputs to integers before `json_u32` checks them.
`json_u32` then accepts a value that JavaScript's `Number.isInteger` rejects.
This changes admission behavior for both OpenZeppelin rule IDs and the supplied latest ledger.

Two complete reproductions use the existing frozen cases:

| Input change | TypeScript result | Rust result |
| --- | --- | --- |
| Start with `auth-openzeppelin`; replace `adapter.context_rule_ids` with `[0.9999999999999999,4]` | Reject with `invalid_input`: `Provide a verifier C-address and one uint32 rule ID per authorization context.` | Accept; parse the first rule ID as `1`; construct and sign that adapter digest. |
| Start with `auth-account`; set `latest_ledger` to `99.99999999999999` | Reject with `invalid_input`: `Use a positive uint32 ledger number.` | Accept; parse the ledger as `100`. |

The first Rust digest is `3967a5e6cc087c49115618c6f9d7fd3916e94099950ae11ab9503a4653ffe1b6`.
The second Rust digest is `54542062520b16c2e6acc3821621467ad9ded0f9d1fb1168596678973722aa70`.
These signatures use isolated fixture keys. This finding does not establish a live signing incident.

The defect occurs before `AuthEntryInput::from_json` copies the adapter.
Adding another `fract()` check cannot recover the original decimal value.

Minimum correction: enable `serde_json`'s `float_roundtrip` feature and add raw-JSON regression cases.
I tested that feature through a separate scratch consumer of the frozen library.
Both complete reproductions then returned the expected TypeScript errors.
All 81 frozen vector results remained unchanged.
A 14,823-string numeric sweep found 96 classification differences against Rust's correctly rounded string parser before this correction.
The same sweep found zero differences with the feature enabled.
Bun independently confirmed both complete request failures above.

The regression must deserialize the raw decimal text. A Rust `json!` value can bypass the failing parser path.
Preserve acceptance of integral decimal/exponent forms and rejection of fractions, strings, negative IDs, and values above `u32::MAX`.

Evidence: [request inputs](review-p1/adversarial-cases.jsonl), [TypeScript results](review-p1/adversarial-ts.jsonl), and [pinned Rust results](review-p1/pinned-adversarial-probe.jsonl).
The [corrected scratch results](review-p1/pinned-adversarial-probe-float.jsonl) demonstrate the proposed correction without changing tracked files.

## Notes

### N1. The lenient decoder changes Base64URL error messages

Locations: `src/stellar.rs:24`; `src/stellar.rs:44`.

Take `auth-account`, `preimage-account`, or `tx-v1` from the frozen vectors.
Replace `+` with `-` and `/` with `_` in its XDR string.
The TypeScript decoder reads each alias, then rejects it as noncanonical.
The Rust lenient decoder uses only the standard alphabet, so it classifies each alias as invalid XDR.

| Path | TypeScript message | Rust message |
| --- | --- | --- |
| Authorization entry | `Use canonical authorization XDR.` | `The authorization XDR is invalid.` |
| SEP-43 preimage | `Use canonical authorization preimage XDR.` | `Use Base64 HashIdPreimage XDR from buildAuthorizationEntryPreimage.` |
| Transaction | `Use canonical transaction XDR.` | `The transaction XDR is invalid.` |

Both implementations reject every example. The machine error code stays unchanged.
This does not bypass canonical decoding and does not block security acceptance independently.
For exact diagnostic parity, normalize the URL alphabet only in the rejection-classification path.
Otherwise, record this additional diagnostic difference explicitly.
Add these three exact alias cases; the current noncanonical vectors do not cover them.

Evidence: the `*-base64url` cases in the request and result files linked under S1.

### N2. The documented transaction exception broadens admission; it is not stricter rejection

Locations: `fixtures/parity/README.md:23`; `fixtures/parity/README.md:27`; `src/transaction.rs:104`.

I reproduced the documented exception with a concrete input.
Start with `tx-v1` and replace its payment asset with `credit_alphanum4`.
Use asset-code bytes `[33,0,0,0]` (`!`) and the fixture's valid G-key as issuer.
Keep the original source, network, and valid time bounds.

The TypeScript bridge rejects this envelope with `invalid_request`: `The transaction XDR is invalid.`
The Rust core accepts it and appends a verified signature.
The envelope has valid XDR structure; its asset code is not a valid Stellar asset code.

I accept this recorded exception under the selected protocol-v3 policy of structural admission without operation-content filtering.
It preserves the selected signer, network binding, exact body, and signature lifetime.
It does not establish ledger validity or successful execution.
The browser SDK still rejects this example during its independent pre-check.

Correct the README's claim that every difference is stricter rejection.
Add this exact case with separate Rust and TypeScript expectations to preserve the intentional boundary.
A shared expectation that forces both implementations to accept it would weaken the retained SDK check.

Evidence: [input](review-p1/structural-case.jsonl), [TypeScript rejection](review-p1/structural-ts.json), and [Rust result](review-p1/structural-rust.json).

## Security conclusions

| Area | Conclusion |
| --- | --- |
| Account and contract-ed25519 digests | The code hashes the address-bound preimage with the network hash, nonce, expiry, address, and complete invocation. |
| OpenZeppelin digest | The code hashes the payload digest followed by XDR `ScVal::Vec` rule IDs in their original order. |
| OpenZeppelin verifier | The verifier remains outside the digest, as the accepted pinned schema requires. It appears in the attached signer map. |
| SEP-43 preimage | Canonical re-encoding preserves the complete preimage bytes before hashing. Address, network, context, and expiry checks match the inspected source. |
| Transaction digest | V1 uses its tagged transaction body. Fee bump uses the outer tagged fee-bump body, including the inner envelope. |
| Authorization attachment | The code changes only the credential signature value after independent verification. Account, raw-contract, and OpenZeppelin schemas match the frozen outputs. |
| Transaction attachment | The code preserves the complete body and existing signatures. It appends one decorated signature to the outer envelope. |
| Loose JSON fields | Wrong-type string fields fail their corresponding checks. Adapter fields retain their types and reject unknown keys. S1 concerns numeric parsing before those checks. |
| Canonical parsing | Strict Base64, complete-buffer decoding, byte limits, and re-encode equality protect accepted inputs. The lenient path returns only rejection classifications. |
| Error parity | All 81 frozen cases match. The additional probes expose S1 and the diagnostic differences in N1. |

The attachment check independently decoded Rust-produced artifacts with JS SDK 17.1.0.
It checked 12 authorization artifacts, nine transaction artifacts, and three raw preimage signatures.
For authorization artifacts, restoring the original signature value restored the exact original XDR.
For transactions, body bytes and each existing signature stayed exact, with one added outer signature.

The depth limit of 500 is acceptable for this phase.
The [Soroban host v28 limit](https://github.com/stellar/rs-soroban-env/blob/v28.0.0/soroban-env-host/src/budget/limits.rs#L12) also uses 500.
The committed tests passed with a 2 MiB debug thread stack, including hostile nesting and deep valid arguments.
I did not independently reproduce the stated release stack measurement below 256 KiB.
Keep that measurement distinct from the passing bounded-stack tests.

Strict Dalek verification is an acceptable recorded difference.
The digest and attachment functions consistently use `verify_strict`.
Additional useful vectors are precise weak-key and noncanonical-scalar rejections.
For the weak-key case, use compressed identity `[1,0,...,0]` with identity `R` and zero `S`; require rejection.
For the scalar case, replace a valid signature's `S` with the Ed25519 group order; require rejection.
These missing tests do not demonstrate a defect in the selected verifier.

I accept the single Phase 1 commit because the pure paths share parsing and artifact logic.
I also accept capturing CLI/SSH transcripts before the Phase 2 signer and HTTP traces before Phase 3 implementation.
Keep their producer fixed at `52a7fc3`; do not derive expected baseline results from the Rust replacement.

## Validation and limits

| Check | Result |
| --- | --- |
| Pinned Rust unit tests | Eight passed. |
| Pinned Rust vector tests | Three passed, including all 81 frozen cases and the fixture hash. |
| Bun vector reader | 82 passed; 88 assertions. |
| Additional complete request cases | 39 compared; two false acceptances and three diagnostic differences identified. |
| Independent artifact checks | 24 returned artifacts/signatures passed their relevant checks. |
| Scratch float parsing correction | Both false acceptances disappeared; all 81 frozen outputs stayed unchanged. |
| Numeric sweep | 14,823 inputs; 96 classification differences before the correction, zero afterward. |
| Full repository suite and cargo-deny | Not rerun in this security review. |
| Live 1Password, testnet, or release operations | Not run. |

[pinned-cargo-tests.log](review-p1/pinned-cargo-tests.log) records the isolated Rust run.
[bun-vectors.log](review-p1/bun-vectors.log) records the SDK vector run.
[artifact-checks.json](review-p1/artifact-checks.json) records the independent attachment checks.
The frozen source snapshot and scratch consumers remain under [review-p1/](review-p1/).

Resolve S1 in a new commit, add the raw-JSON cases, and rerun the phase checks before Phase 1 acceptance.
