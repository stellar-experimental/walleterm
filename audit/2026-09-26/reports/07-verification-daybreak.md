# 07 Verification Audit — Daybreak

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.
> C14 is Low within the dedicated testnet harness. CLI01 transfers 100 stroops, equal to `0.0000100 XLM`.
> Both C16 reviewers rejected V-07-02 as a confirmed macOS defect. The documented promise covers process restarts.

## Conclusion

I found three defects and one unresolved evidence concern. The CLI pipeline can create an unknown outcome without a durable reconciliation gate.
The shared gate does not sync directory changes. CAP-71 and CAP-85 checkpoints can reuse results across protocol or harness changes.
Tracked summaries cannot independently prove the current source passed live acceptance.

The focused offline suites passed 39 tests. No blocker prevented the audit. I did not use live signing or ignored live state.

## Audit identity

- Area: `07-verification`.
- Source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Model: Daybreak.
- Effort: xhigh.
- Access date: 2026-09-26.
- Initial allocation: $10.
- Jev limit: $1.

## Scope and coverage

I inspected every tracked non-contract test and harness in the frozen source. I excluded Rust contract fixtures from this area.

| Area | Files | Review |
| --- | --- | --- |
| Go command tests | `main_test.go`, `service_test.go` | Full source review |
| Bridge tests | All 11 `bridge/*.test.ts` files | Full source review |
| Script tests | `scripts/install.test.ts`, `scripts/syntax.test.ts` | Full source review |
| Submission | `tests/submission.ts`, `tests/submission.test.ts`, `tests/checkpoint.test.ts` | Full source review and focused run |
| Live harnesses | `tests/live-utils.ts`, `tests/live.ts`, `tests/classic.ts` | Full source review |
| CLI pipeline | `tests/cli-pipeline.ts` | Full source review |
| Failure probe | `tests/1password-failure.ts` | Static review only |
| Bridge harness | `tests/site-bridge.test.ts` | Full source review and focused run |
| Support | `tests/simulations.ts`, `tests/types.ts`, `tsconfig.json` | Full source review |
| Test commands and documents | `package.json`, `Makefile`, workflow, test documents | Full review |
| Tracked evidence | All tracked JSON and Markdown evidence | Structure and claim review |

I also inspected relevant CAP-71 and CAP-85 checkpoint code. I inspected these files only for checkpoint identity and result reuse.

## Confirmed defects

### V-07-01 — Medium — The CLI pipeline bypasses the submission guard

- Confidence: High.
- Location: `tests/cli-pipeline.ts:34-44`.
- Related guard: `tests/live-utils.ts:52-54` and `tests/submission.ts:264-309`.
- Documentation: `docs/LIVE-TESTS.md:45-63`.

The pipeline checks an existing shared gate before signing. It then calls `stellar tx send` directly.
It never creates a gate for that submission. It queries the digest only after the CLI returns.
Reachable scenario: `stellar tx send` submits the transaction, but its process returns no usable result.
The harness exits before `getTransaction`. A later run sees no pending gate and can sign a different transaction.
Impact: The harness does not enforce original-hash reconciliation before another signature. The gap can duplicate testnet effects.

Counterevidence: The pipeline verifies the digest before submission. It also checks `SUCCESS` when all calls return.
Those checks do not protect an unknown send outcome.
Minimum mitigation: Put the CLI send behind a durable pending record. Reconcile the saved digest before later signing.
Use `stellar tx fetch result --hash` or the shared RPC guard.

Verification plan: Simulate a successful send followed by lost CLI output. Restart and confirm that signing stays blocked.
Then reconcile only the saved digest. Clear the gate after a terminal result.
### V-07-02 — Medium — Gate directory changes are not crash-durable

- Confidence: High.
- Location: `tests/submission.ts:146-153`, `tests/submission.ts:230-234`, and `tests/submission.ts:275-277`.

The guard syncs each new gate file. It does not sync the parent directory after creation or deletion.
Reachable scenario: The host loses power after submission, before the directory entry becomes durable. A restart can miss the gate.
Impact: The next run can sign while the original transaction outcome remains unknown. This state violates the central invariant.

Counterevidence: Existing tests preserve the gate across normal process restarts. The gate uses mode `0600` and syncs its contents.
The risk requires a filesystem or host crash.
Minimum mitigation: Sync the parent directory after gate creation and deletion. Confirm the operation on supported macOS filesystems.

Verification plan: Add a storage adapter with ordered sync assertions. Document the residual storage guarantees for macOS.
### V-07-03 — Low — Checkpoint identity omits execution versions

- Confidence: High.
- CAP-71 location: `tests/cap71.ts:49-60`, `tests/cap71.ts:420-435`, and `tests/cap71.ts:885-887`.
- CAP-85 location: `tests/cap85.ts:607-619` and `tests/cap85.ts:1308-1337`.

Both bindings include the network, keys, and contract artifacts. Neither binding includes the protocol version or harness source revision.
Both suites can skip completed rows and report `passed_previous_run`.
Reachable scenario: The protocol or an assertion changes while the binding fields stay equal. The suite reuses the completed row.

Impact: The current harness can display a historical result without running its current assertion. This behavior weakens revision-specific acceptance.
Counterevidence: The status explicitly says `passed_previous_run`. The bindings already reject changes to important deployment inputs.
These controls reduce the severity.

Minimum mitigation: Separate deployment caches from assertion completion. Bind assertions to the protocol, SDK version, and relevant source hashes.
Verification plan: Change one bound version at a time. Confirm that deployment state remains reusable while affected assertions run again.
## Unresolved evidence concern

### U-07-01 — Low — Tracked summaries do not bind current live acceptance

- Confidence: High for the evidence limit.
- Location: `evidence/README.md:44-50`.
- Related records: `evidence/acceptance-summary.json:202-220`.
- Protocol record: `evidence/protocol-acceptance.json:524-536`.
- Migration limit: `docs/BUN-MIGRATION.md:35-49`.

The tracked index states that a fresh clone lacks raw evidence. The summaries reference nine absent local evidence paths.
The protocol summary hashes five removed `.mjs` paths. The acceptance summary contains the old `node tests/live.mjs reconcile` command.
The migration document states that current TypeScript code did not receive fresh live acceptance. Older live revisions differ across many relevant files.

Impact: A reviewer cannot reproduce each live claim from this frozen source alone. The current source cannot prove those outcomes.
Counterevidence: The index clearly labels raw evidence as ignored. The migration document discloses the missing live rerun.
Historical source hashes still help identify older tested files.

Minimum mitigation: Track a redacted evidence manifest for each live run. Include the commit, commands, versions, and relevant hashes.
Use dated revision-specific wording until the current source passes live acceptance.
Verification plan: Reconstruct one run from a clean clone. Confirm all hashes without exposing signer metadata or signed envelopes.
## Assertion strength and non-issues

- `tests/submission.test.ts` covers lost responses, deadlines, restarts, malformed gates, concurrency, wrong hashes, and unknown statuses.
- `tests/classic.ts` uses `ctx.send`. Its restoration path calls `assertClear` before signing.
- `tests/live-utils.ts` checks the shared gate before each signer invocation.
- `tests/live.ts` checks the gate before each selected non-CAP-85 suite.
- CAP-85 reconciles shared and local journals before funding or signing.
- `tests/site-bridge.test.ts` uses mock keys. It verifies the hash, signer, signature, origin, and request binding.
- Bridge tests preserve unknown results. They avoid a second signer call after lost responses.
- Go tests cover strict input, mock signing, protocol failures, timeouts, and output failures.
- `tests/simulations.ts` provides typed mock RPC results. `tests/types.ts` contains shared test types.
- Strict TypeScript checking includes both support files.
- I found no `.skip`, `.todo`, or `.only` markers. All tracked JSON parsed successfully.
- I found no seed-shaped secret in tracked evidence.

## Feature opportunities

- Add an offline CLI transport test for lost `stellar tx send` output.
- Add ordered filesystem fault injection around gate creation and removal.
- Add a redacted, revision-bound evidence manifest.
- Add restart guidance for an interrupted classic signer-restoration sequence.

## Checks performed

| Check | Result |
| --- | --- |
| `bun test tests/submission.test.ts tests/checkpoint.test.ts tests/site-bridge.test.ts` | 39 passed; 0 failed |
| Focused check script | Passed |
| Tracked JSON parsing | Passed |
| Tracked seed-pattern scan | No match |
| Installed `stellar` version | `28.0.0` |
| `stellar tx send --help` | Inspected |
| `stellar tx fetch result --help` | Inspected |

The focused tests used Bun 1.4.2. They used temporary state, mock keys, and no network submission.
Central suites already passed, so I did not repeat them.
## Research and sources

Stellar Raven found official original-hash polling guidance first. Official documentation states that `sendTransaction` only enqueues a transaction.
The client must query the original hash for the final result.

Parallel Search found POSIX and Linux `fsync` documentation. Those sources separate file durability from directory entry durability.

Perplexity found the official Stellar CLI and RPC pages. The local CLI matches the documented version 28 command family.

Jev attempted one scoped query and returned no documents. Its transport failed after three requests.
Visible Jev cost was `$0.008729397`.

`parallel-cli` attempted one search and failed with `APIConnectionError`. It showed two retries and created no result file.

See `research/07-verification-daybreak/SOURCES.md` for URLs, versions, and applicability. Research JSON files record tool status and provider metadata.

## Cost and limits

- Visible cost: `$0.008729397` from Jev.
- Jev usage: three requests and zero source documents.
- Parallel Search usage: one `sku_search`.
- Stellar Raven charge: Unknown.
- Parallel Search charge: Unknown.
- Perplexity charge: Unknown.
- `parallel-cli` charge: Unknown.
- Total known cost remained below the initial allocation.

I did not read ignored live journals or signer metadata. I did not access credentials or key fields.
I did not perform live signing or submission. I did not access public services through the product.
I did not change the frozen source. I did not read another area report before this conclusion.
