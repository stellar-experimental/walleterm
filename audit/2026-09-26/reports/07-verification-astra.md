# 07 — Verification audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.
> C14 is Low within the dedicated testnet harness. CLI01 transfers 100 stroops, equal to `0.0000100 XLM`.

## Scope and conclusion

| Item | Value |
| --- | --- |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Review date | 2026-09-26 |
| Model / effort | Astra / xhigh, as requested |
| Confirmed findings | One medium finding; no high or critical findings |
| Unresolved concerns | None beyond the stated verification limits |

The CLI acceptance pipeline bypasses the shared submission guard.
An unknown submission outcome therefore permits another signature.
The shared guard itself retained unknown outcomes in the focused tests.
No other area report informed this initial report.

## Code coverage

Paths below refer to the frozen source.
The [file manifest](../checks/07-verification-astra/evidence-check.json) verifies 59 selected files against the revision.
That manifest includes dependency files beyond the primary review scope.

| Files | Review coverage |
| --- | --- |
| `tests/submission.ts`, `tests/submission.test.ts` | Persistence order, deadlines, terminal results, original hashes, attempt identity, restart, and rejection recovery |
| `tests/live-utils.ts`, `tests/live.ts`, `tests/types.ts` | Signer gates, response verification, entrypoints, funding, result records, and context types |
| `tests/classic.ts` | G01–G10 assertions, ledger freshness, exact balances, fees, signer configuration, and restoration |
| `tests/cli-pipeline.ts`, `tests/1password-failure.ts` | CLI construction and submission; lifecycle observation and signature verification |
| `tests/simulations.ts`, `tests/checkpoint.test.ts` | Typed simulation fixtures and checkpoint identity assertions |
| `tests/site-bridge.test.ts` | Mock interception, signature verification, wrong keys, replay, origins, and unsupported requests |
| `main_test.go`, `service_test.go` | Mock SSH protocol, validation, signature checks, timeouts, output failures, and service dispatch |
| `bridge/*.test.ts`, `bridge/test/support.ts` | All 12 test files; browser mocks, lifecycle, HTTP, signer, vault, scanner, and tunnel assertions |
| `scripts/install.test.ts`, `scripts/syntax.test.ts` | Installation failure isolation and syntax module checks |
| `tests/contracts.ts`, `tests/extended-contracts.ts`, `tests/cap71.ts`, `tests/cap85.ts` | Direct checkpoint and recovery dependencies; contract policy review remains outside this area |
| `evidence/**`, test documentation | All tracked evidence summaries, browser report, test matrix, live instructions, and migration validation |

## CLI pipeline recovery gap — V07-01

**Medium severity; high confidence — CLI submission bypasses durable recovery.**

Primary location: [tests/cli-pipeline.ts:42](/private/tmp/walleterm-audit-40d6cca9db73/tests/cli-pipeline.ts:42).
Related locations: `tests/cli-pipeline.ts:7`, `:30`, `:34`, `:43`; `tests/live-utils.ts:53`, `:115`.

**Reachable scenario.** The operator runs the CLI acceptance pipeline with a clear shared gate.
The pipeline obtains a signature and starts `stellar tx send`.
The network can accept the transaction before the CLI response fails or exceeds the 60-second timeout.
The exception prevents the original-hash lookup at line 43.
The pipeline creates no pending gate and stores no durable signed envelope before submission.
Its unsigned evidence file preserves the digest, but the shared recovery command does not read that file.

A successful CLI return followed by `NOT_FOUND` reaches the same unsafe state through the assertion at line 44.
The next signer request sees a clear gate.
A later pipeline run can build another transaction before the operator reconciles the first outcome.

**Impact.** The dedicated testnet harness can authorize another payment while the first payment remains unresolved.
This breaks the documented original-hash recovery workflow in `docs/LIVE-TESTS.md:65`.
The finding concerns the acceptance harness, not the digest-only Go signer or mainnet funds.

**Evidence.** Two isolated probes executed the frozen pipeline body with injected command, signer, RPC, and file mocks.
Both probes reproduced an absent pending gate and a permitted second signature.
The timeout probe made zero lookups; the `NOT_FOUND` probe made one lookup.
See [offline-probes.json](../checks/07-verification-astra/offline-probes.json) and [offline-probes.ts](../checks/07-verification-astra/offline-probes.ts.txt).
The probes captured file targets without writing those files.
They did not launch Stellar CLI, access signer metadata, or contact a network.

**Counterevidence.** Lines 24 and 41 verify CLI and SDK digest agreement.
`signDigest` checks existing pending state and independently verifies the returned signature.
The successful path asserts `SUCCESS` and records the signed envelope.
These checks do not persist pending state for this submission path.

**Minimum mitigation.** Use the shared guard around the CLI send operation through a small submission adapter.
Preserve the CLI acceptance purpose and store the original hash, exact signed envelope, network, and attempt before launching it.
Retain the pending gate after any uncertain result.
Clear it only through the existing terminal-result rules.

**Verification plan.** Add offline cases for CLI timeout after acceptance and a subsequent `NOT_FOUND` lookup.
Restart the harness and assert zero additional signer calls while the original outcome remains unresolved.
Reconcile only the stored original hash, then assert that a terminal result permits signing without resubmission.

## Passed guard counterexamples

The shared guard persists the prepared envelope and exclusive pending gate before RPC submission (`tests/submission.ts:275`).
It records the send response before lookup and checks returned hashes (`:286`).
Timeouts, transport errors, malformed gates, and nonterminal results retain the gate.
Reconciliation queries the saved hash and rejects a network mismatch (`:320`).
The focused tests also check process restart, late responses, duplicate attempts, and stale rejection archives.

`live-utils.ts:53` and `:97` check the gate before signer calls.
Classic restoration checks the gate before restoration signatures (`tests/classic.ts:269`).
The restoration probe confirmed that an unknown configuration submission prevents those signatures.
A separate probe confirmed recovery after the result recorder throws on a terminal response.

## Other non-issues and assertion strength

Classic tests check exact balances, thresholds, signature combinations, protocol codes, and fee attribution.
They do more than inspect a success flag (`tests/classic.ts:69`, `:151`, `:182`, `:224`).
The site-bridge tests verify signatures and rejection behavior with isolated keys.
Simulation fixtures provide controlled responses; they do not prove remote RPC compatibility.

Checkpoint checks bind the network, ordered public keys, OpenZeppelin revision, and current WASM hashes (`tests/contracts.ts:558`).
They reject unbound prior deployments and contract entries without verified WASM.
These checks establish local checkpoint identity, not the current remote contract state.

`tests/1password-failure.ts:86` records signature verification instead of asserting a required lifecycle outcome.
Its zero exit status therefore does not establish denial, cancellation, or signature acceptance.
This matches its parent-operated observation role and matrix P04.
The installed binary at line 50 also lacks a recorded binary hash in this probe.

## Historical evidence limits

All 11 tracked JSON evidence files parsed without duplicate keys.
The protocol summary contains 38 distinct successful transaction hashes across its two suites.
Those checks establish summary consistency only; this audit did not query transaction status.

Five recorded `.mjs` source paths no longer exist in this revision.
Their `.ts` counterparts differ from the recorded hashes (`evidence/protocol-acceptance.json:531`).
The historical Node submission-test command also differs from the current Bun workflow.
These records establish historical acceptance claims, not current-source live acceptance.

`evidence/README.md:48` explicitly keeps raw signer records, RPC responses, and checkpoints local and ignored.
This audit did not open those files or validate claims that require them.
The index also distinguishes `prepared`, `passed_previous_run`, and `observed` from new passed tests.
The older mobile proof covers the removed combined `web` command.
Later tunnel records cover additional behavior, but they do not establish every current browser and phone path.
These limits do not establish another defect.

## Material untested cases

| Missing case or limit | Consequence and required evidence |
| --- | --- |
| Power loss and filesystem failures | Process-restart tests do not establish power-loss durability; test disk failures separately |
| Parent-directory persistence | `submission.ts:146` synchronizes file descriptors; this audit did not prove directory durability under Bun/macOS |
| Full local matrix coverage | Explicit fragmented-response and concurrent direct-signer cases remain absent from `main_test.go`; matrix entries are not test results |
| Physical browser lifecycle | VM browser mocks do not establish actual Web Locks, camera, or page-exit behavior |
| Current live acceptance | Migration notes mark live 1Password signing and testnet acceptance `not_run` (`docs/BUN-MIGRATION.md:47`) |

These rows describe verification limits, not additional confirmed defects.
The documented single-live-suite rule limits concurrent harness use (`docs/LIVE-TESTS.md:5`).

## Feature opportunities

Record the tested binary hash and source revision when the operator runs the lifecycle probe.
Add a read-only recovery diagnostic that displays the saved hash, network, and RPC retention range.
Keep the gate closed when the node cannot resolve the original hash.

## Checks

| Check | Outcome | Evidence |
| --- | --- | --- |
| Submission and checkpoint tests | **passed**: 38 tests, zero failures | `checks/07-verification-astra/focused-tests.stderr` |
| CLI timeout and `NOT_FOUND` probes | **passed reproduction**: two confirmed failures of the safety property | `checks/07-verification-astra/offline-probes.json` |
| Recorder failure and classic restoration probes | **passed**: original-hash recovery and zero restoration signatures | Same probe result |
| Frozen-file and evidence checks | **passed**: 59 matching files, 11 valid JSON summaries | `checks/07-verification-astra/evidence-check.json` |
| Central Go, vet, TypeScript, Bun, and Rust checks | **passed centrally**; not rerun here | `checks/baseline-permitted-results.json`, `checks/rust-summary.json` |
| Current live signing and testnet acceptance | **not_run**, as instructed | No live commands or public services |

The [command record](../checks/07-verification-astra/commands.md) includes commands, outcomes, mock boundaries, and artifact names.

## Sources and research usage

Research used all five requested tools and only public technical questions.
The [source record](../research/07-verification-astra/sources.md) records versions, access dates, excerpts, and applicability.
RPC submission queues work; clients must inspect the final outcome. [Stellar sendTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction)
RPC lookup history is bounded; `NOT_FOUND` cannot establish non-submission. [Stellar getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction)
File synchronization semantics depend on the operating system and device. [Node.js filesystem](https://nodejs.org/api/fs.html#fsfsyncsyncfd)

Jev reported **$0.026720113** across the failed transport attempt and the partial retry.
The retry selected 13 documents and reported one lost evidence report.
Parallel reported two search units across MCP and CLI.
Raven, Perplexity, Parallel dollar charges, and any separate source-provider charges were not exposed.
No deep-research processor ran, and no further allocation is needed.

## Limits and completion

No live signing, submissions, public services, ignored signer records, or raw live journals formed part of this audit.
All signing keys used by offline checks were isolated mocks.
No runtime source, dependencies, configuration, Git state, or other area report changed.
The bounded review is complete, with no completion blocker.
