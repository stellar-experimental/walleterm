# Walleterm overall audit — Daybreak

## Conclusion

The frozen revision has no confirmed Critical or High defect. I found one confirmed Medium defect and nine confirmed Low defects. Three additional Low concerns require abnormal state injection or a compromised provider response.

The Medium defect can return a valid signature from an older wallet revision. It cannot change bytes or submit a transaction. The minimum fix compares the captured wallet revision with the current revision before returning success.

The C11 mock signs an unexpected authorization tree. No evidence shows live provider misuse or live unintended signing. No evidence shows private-key exposure or automatic submission.

This substantive review is complete.

The coordinator's final packaging check remains pending.

## Review identity

- Assigned model label: Daybreak
- Effort: xhigh
- Runtime model attestation: unavailable
- Frozen revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`
- Review date: 2026-09-27

I did not read a paired overall report before this conclusion. I did not delegate any work.

I did not change production source. I did not sign, submit, publish, open a tunnel, or install a package.

## Scope and coverage

I read both briefs, all 16 area reports, and all 40 focused reports. I read `REPORT.md`, `CONCERNS.md`, `reconciliation.json`, `FEATURES.md`, and the central evidence.

The coverage map contains all 199 frozen source files. Every file has at least one area assignment.

The assignment counts are 4, 8, 11, 11, 17, 66, 27, and 67 for areas `01` through `08`.

## Final classification

| Class | Count | Concerns |
|---|---:|---|
| Critical | 0 | None |
| High | 0 | None |
| Medium, confirmed | 1 | C05 |
| Low, confirmed | 9 | C01, C02, C06, C10, C12, C13, C14, C15, C17 |
| Low, conditional | 3 | C08, C09, C11 |
| Accepted limit | 4 | C03, C04, C18, C20 |
| Optional hardening | 1 | C07 |
| Unsupported | 2 | C16, C19 |

## Confirmed Medium finding

### C05 — stale remote wallet revision

`sdk/walleterm.ts:290-385` captures `selection_revision` when signing starts. The final guard checks the token and local generation.

It does not compare the captured revision with the current revision. The SDK can observe a newer remote selection.

A delayed valid response can then return for the older wallet revision. The bridge still uses reviewed bytes and a granted key.

Minimum mitigation: compare the captured and current revisions. Preserve an unknown result when proof is unavailable.

An address comparison is optional defense-in-depth. The monotonic revision must already identify each accepted selection change.

## Confirmed Low findings

**C01 — signer deadline wording.** Blocked child output can extend observed completion beyond the documented deadline. Correct the deadline wording.

**C02 — malformed demo request target.** A malformed target can crash the local Bun demo. Public Quick Tunnel reachability remains unverified. Catch URL parsing errors and return HTTP 400.

**C06 — external component teardown.** `destroy()` can leave camera or pairing work active after SPA teardown. The shipped static demo does not use this path. Abort owned controllers and ignore late commits. Do not disconnect an established client during ordinary teardown.

**C10 — signed-state review details.** The signed demo state hides decoded details before submission. Retain these details through submission review.

**C12 — dirty OpenZeppelin cache provenance.** A dirty cached checkout can receive a clean commit label. Current artifacts show no contaminated build. Reject staged and unstaged changes before builds. Preserve developer files.

**C13 — X06 recovery evidence.** X06 safely stops after a final executable change. The X06 path does not repeat its signing or submission operations. Startup funding helpers can still run. Persist each recovery observation and always record the final state.

**C14 — CLI01 durable gate bypass.** `tests/cli-pipeline.ts:1-52` calls `stellar tx send` directly. The payment is 100 stroops, or 0.0000100 XLM. No review showed an unknown live outcome. Use the durable guard before another CLI01 run. Reconcile only the saved hash.

**C15 — incomplete SDK distribution instructions.** The documentation copies only `dist/sdk`. The SDK can miss required shared chunks. Document the complete build output copy.

**C17 — checkpoint version labels.** An interrupted CAP-71 row can reuse cached checks under a new protocol label. CAP-85 already records `reused_steps`. Add this marker to interrupted CAP-71 rows. Do not require broad assertion identities without a revision-specific promise.

## Conditional Low concerns

**C08 — Horizon confirmation binding.** The path accepts some malformed or mismatched successful responses. The reproductions use mock responses. No review showed an actual Horizon incident. Validate the hash, success flag, and positive safe ledger number.

**C09 — restored journal mismatch.** Injected journal state can pair one pending record with another valid envelope. No normal writer creates this mismatch. Repeat hash and signature checks during recovery. This is optional recovery hardening.

**C11 — RPC-selected authorization tree.** `tests/contracts.ts:430-474` signs RPC-recorded entries before full tree validation. The focused mock signed an unexpected tree. No review showed provider compromise or live misuse.

The signed entry can move between transactions before expiration. A failed enforcing simulation does not revoke it. Validate every tree field before any signer callback. Keep enforcing simulation before submission.

## Rejected or limited concerns

C03 is an accepted brute-force and availability tradeoff. Per-Origin counters do not solve forged Origin headers. C04 lacks proof of a real orphan after supervisor `SIGKILL`. The documented parent-process behavior passed.

C07 includes a non-JSON 401 or body-read failure after an accessible 401. No shipped-path producer was demonstrated. This remains optional compatibility hardening. C16 does not prove a promised APFS power-loss durability failure.

C18 correctly dates historical live acceptance. C19 concerns ignored generated snapshots. C20 does not identify a false platform support promise. A tested-platform statement would improve clarity.

## Classification challenges

The assessment lowers C06 from Medium to Low. Normal shipped behavior does not use the affected teardown path. It lowers C08 and C11 to conditional Low. Both require altered official-provider responses.

The assessment lowers C14 to Low because its tiny testnet scope limits impact. It rejects C16 and C19. It accepts C03, C04, C18, and C20 as limits. C01 and C15 require documentation changes only.

## Mitigation priorities

1. Fix C05 before broader SDK integration.
2. Fix C11 and C14 before the next affected live harness run.
3. Fix C02, C06, C08, C09, and C10 during SDK and demo maintenance.
4. Fix C12, C13, and C17 before fixture rebuilds or resumed acceptance.
5. Correct C01 and C15 documentation.

## Existing check evidence

I did not repeat the passed broad suites. The Go race suite, `go vet`, strict TypeScript, and formatting checks passed. The Bun suite reported 224 passed tests. Three contract harness self-tests passed.

Rust reported 30 passed tests across four workspaces. All 14 WASM artifacts matched their manifests. The mock-key browser smoke passed connect, switch, reload, and disconnect. It did not sign or submit.

CAP-71 pins Soroban SDK 27.0.2. The base and CAP-85 legacy fixtures pin 27.0.6. CAP-85 current pins 28.0.0.

The accessibility scan found zero violations and one incomplete check. Historical live acceptance applies only to its recorded versions. Artifact hashes do not prove an exact source rebuild.

## Mock and provider boundaries

The C08 and C11 reproductions use mocked provider behavior. They do not establish a Horizon or RPC incident. Initial socket failures came from sandbox restrictions. Permitted reruns passed.

Mock-key browser success does not prove live 1Password behavior.

## Research result

I used Stellar Raven first. I also used Jev, `parallel-cli`, Parallel Search MCP, and Perplexity.

Primary sources bind auth entries to the network, nonce, expiration, and exact invocation tree. They exclude the complete transaction and fee payer. Simulation discards state changes. These facts support conditional Low for C11.

Jev returned no documents after three lost evidence reports. It recorded `$0.008729397` of usage. The audit did not retry it. Other tools did not expose complete billing. The research summary records all results.

## Concurrent skill-reference delta

The file is `.agents/skills/walleterm-site-bridge/references/interception.md`.

- Baseline SHA-256: `81843e887c4b75f7a63d16980028f28a897e30a1938894206389f53ec63d4e24`
- Current SHA-256: `0c417445aa7661064f49d975a235ea29e420f1222ab2398067ab1602c3b412b2`
- Patch SHA-256: `001dc3724361e3dbf615f8496a3a971ce925045ea78d31a4f88cd15da9042d06`

The recorded patch exactly matches the current Git diff. The delta adds in-page signer guidance and nested Soroban authorization review.

It keeps private-key controls outside the adapter. It requires a durable attempt before signing. It states that later cancellation cannot undo a signature.

I found no material defect in this delta. The delta remains outside frozen-source conclusions.

## Product opportunities

A small Wallets Kit adapter remains useful after the SDK corrections. An installed release identifier, raw journal export, and setup checks would improve support.

These opportunities do not identify missing core signing capability.

## Limits and pending work

Current live 1Password acceptance, testnet submission, physical camera use, and VoiceOver remain `not_run`. Current public tunnel exposure also remains `not_run`.

The coordinator will archive probe extensions and raw provider responses. The coordinator will then rerun normal repository checks.

That final packaging check remains pending. It does not block this substantive assessment.
