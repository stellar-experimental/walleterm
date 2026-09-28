# Overall audit and summary review — Astra

## Assessment

The substantive review is complete. No additional defect changes the coordinator's assessment.
Retain ten confirmed findings: one Medium and nine Low.
Retain three conditional Low findings and seven excluded candidates.
The evidence does not establish a Critical or High defect.
The implementation meets the stated purpose of a small macOS signing companion, with the corrections below.
This conclusion does not renew live 1Password or testnet acceptance.
Final packaging remains pending. The coordinator will archive probe extensions and rerun normal repository checks after both reports.
That pending work does not block this substantive assessment.

## Scope and independence

Reviewer configuration: `gpt-6-astra`, `xhigh`, as recorded in [the launch record](../checks/overall-launches.json).
Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
Source references below identify that frozen source unless explicitly marked as concurrent.
I read all 16 area reports and all 40 focused reports, including their counterevidence and later corrections.
I read `REPORT.md`, `CONCERNS.md`, `reconciliation.json`, `FEATURES.md`, coverage, architecture, baseline checks, browser limits, and research evidence.
The specific overall brief authorizes this cross-review. I did not read the paired overall report.
I independently traced signer, bridge, runtime, SDK, demo, fixture, and submission boundaries.
No production edit, delegation, signing, submission, private-key access, public tunnel, publishing, or real-prefix installation occurred.

## Classification decisions

The [input inventory](../checks/09-overall-astra/integrity.json) hashes all 56 prior reports and the coordinator documents.
The [concern register](../CONCERNS.md) links both focused reviews for each candidate.
Confidence is high for demonstrated code behavior. External occurrence remains unverified where explicitly required.

| ID | Final classification | Trigger, consequence, or exclusion |
| --- | --- | --- |
| C01 | Confirmed Low | An unread output pipe defeats the documented completion bound. Documentation correction suffices. |
| C02 | Confirmed Low | A malformed request target can terminate the independent demo server. |
| C03 | Accepted limit | Global pairing lockout bounds guessing. Replacing the global ceiling with per-Origin counters would weaken that protection. |
| C04 | Accepted limit | Supervisor death exceeds the established parent-crash cleanup model. Real cloudflared persistence remains unverified. |
| C05 | Confirmed Medium | An observed remote wallet revision can precede delivery of an old successful signing response. |
| C06 | Confirmed Low | Component destruction leaves an initiated scan or pairing operation active. |
| C07 | Optional hardening | A synthetic unreadable `401` proves parser ordering, without establishing a shipped-deployment response producer. |
| C08 | Conditional Low | Malformed Horizon success data can produce a false terminal result. Provider failure is required. |
| C09 | Conditional Low | An inconsistent restored record can mix unsigned and signed transaction identities. |
| C10 | Confirmed Low | The normal signed state hides decoded terms before submission, including after reload. |
| C11 | Conditional Low | Changed simulation authorization can reach a fixture signer before intent validation. An external fault is required. |
| C12 | Confirmed Low | Modified cached OpenZeppelin source can receive the pinned commit's provenance label. |
| C13 | Confirmed Low | X06 can fail recovery after final success because it rechecks an obsolete intermediate state. |
| C14 | Confirmed Low | CLI01 lacks the durable guard that prevents another attempt after an unknown submission. |
| C15 | Confirmed Low | The connection guide omits generated dependencies and separate stylesheet copying. |
| C16 | Unsupported | No macOS power-loss durability defect was established within the process-restart promise. |
| C17 | Confirmed Low | An interrupted CAP-71 row can report current completion without explicit reused-check metadata. |
| C18 | Accepted limit | Historical acceptance remains historical. It does not prove current-source live acceptance. |
| C19 | Unsupported | Removed test snapshots are ignored generated files, not tracked source. |
| C20 | Accepted limit | Intel compilation does not establish Intel runtime acceptance. The product targets macOS first. |

## Boundary review and severity challenges

The Go signer sends raw digest bytes through SSH-agent signing and independently verifies the Ed25519 response.
See `main.go:137`, `main.go:176`, and `main.go:475`.
Digest-only signing cannot inspect transaction terms. That documented boundary is not a finding.
`bridge/signer.ts:65` drains child output. Its separate deadline limits the website path's exposure to C01.
Public vault discovery reads metadata and `public key` references in bounded groups at `bridge/signer.ts:124`.
Cancellation waits for child cleanup. No reviewed path requires reading a private-key field.

The bridge pins eligible keys, validates supported testnet transactions, and checks current selection before signing.
See `bridge/server.ts:230`, `bridge/server.ts:376`, and `bridge/transaction.ts`.
The connected website intentionally requests its own supported signatures. A separate terminal approval would change the accepted design.
The bridge does not submit transactions. The independent demo owns its submission and recovery records.
Fresh signer checks and signature verification remain necessary even when the client displays cached wallet data.

C05 affects result freshness at the SDK boundary, not the bridge's initial signing authority.
`sdk/walleterm.ts:259` updates the observed revision. The final guard at `sdk/walleterm.ts:357` checks only token and generation.
The preserved A→B and A→B→A reproductions each produce one valid signature for the originally authorized transaction.
The bridge marks its record unknown after switching. It cannot retract a response already in transit.
No changed body, ungranted key, automatic SDK submission, or duplicate signing was demonstrated.
Medium remains reasonable because callers can receive success after the client observes a changed selection.
The evidence does not support High severity or a new protocol requirement.
Evidence: [Astra results](../checks/concerns/c05-astra/remote-switch-permitted.log) and [Daybreak controls](../checks/concerns/c05-daybreak/RESULTS.md).

C06 requires an external integration to destroy the component during an initiated operation.
`sdk/connect.ts:197` omits pending controller cancellation. Late pairing can save a session and disconnect the previous client.
The static demo does not destroy this component. The scanner neither uploads frames nor bypasses camera permission.
`sdk/scan.ts:62` already stops tracks after abort, including tracks received after a late permission grant.
Abort owned work and prevent late publication. Preserve the host's established shared client.
Evidence: [late pairing](../checks/concerns/c06-astra/late-pairing.log) and [independent checks](../checks/concerns/c06-daybreak/RESULTS.md).

C08 and C09 remain conditional despite their real validation gaps.
`demo/site/app.ts:681` trusts returned transaction data before changing the journal.
`demo/site/app.ts:249` validates restored record shape without binding both transaction bodies and their signature.
C08 requires bad success data from the fixed HTTPS testnet endpoint. No actual provider incident was demonstrated.
C09 requires inconsistent saved data. No ordinary journal writer was shown to produce the demonstrated mismatch.
A changed current wallet must not invalidate a valid old record that belongs to its saved signer.
C10 remains separate: normal valid records lose decoded review details at `demo/site/app.ts:407`.

C11 concerns the fixture helper at `tests/contracts.ts:431`, not a new requirement for the raw digest signer.
The mock proves a changed-tree signature remains valid after enforcing simulation rejects the intended transaction.
It proves no live protocol acceptance, real RPC compromise, or mainnet signature validity.
The whole authorization tree is signed. Later envelope failure does not revoke that detached signature.
Inspect every expected tree and credential before the first signer callback, including all nested invocations.
Preserve legitimate nested calls, delegated E02 cases, intentional negative mutations, and replay checks.
CAP-71 validates its expected root at `tests/cap71.ts:630`. CAP-85 validates roots before signing at `tests/cap85.ts:457`.
Their empty-subtree expectations cannot serve as a universal replacement for ordinary nested fixture cases.
Evidence: [signature disclosure check](../checks/concerns/c11-astra/signature-disclosure.log) and [primary-source assessment](../research/09-overall-astra/SOURCES.md).

## Checkpoint and provenance challenges

C17 is limited to interrupted CAP-71 rows.
`tests/cap71.ts:620` can reuse a saved check before `tests/cap71.ts:891` emits a newly completed row.
The coordinator reproduced a synthetic current protocol `29` row containing protocol `28` checks without an explicit reuse marker.
Those protocol values are test inputs. They do not establish a deployed protocol change.
Completed CAP-71 rows already report `passed_previous_run` and `reused_evidence`.
CAP-85's stepper emits historical status and appends `reused_steps` at `tests/cap85.ts:798`.
Those markers provide the missing distinction. A top-level completion status alone does not erase their counterevidence.
Do not extend C17 to CAP-85 solely because the containing row reports `passed`.
Explicit CAP-71 reused-check metadata and separate original/current protocol fields are sufficient.
A new assertion-identity system or mandatory status enumeration lacks an established acceptance requirement.
Preserve unresolved submissions and deployments. Never rerun transactions merely to obtain a current evidence label.
Evidence: [coordinator checkpoint controls](../checks/coordinator-checkpoint-versions.json).

C13 is a recovery failure, not demonstrated duplicate execution.
Both focused reproductions preserve final success and perform zero repeated X06 operations during the failing restarts.
Startup funding helpers can still run.
`tests/cap85.ts:1208` reads an intermediate state that final `adopt_wasm` success already replaced.
Persist initial and validated intermediate observations before advancing. Recover final success by its original hash.
Skip obsolete intermediate live assertions after confirmed final success, then validate the current final state.
Label missing historical observations explicitly. Do not reconstruct them as if they were observed.
Evidence: [Astra recovery cases](../checks/concerns/c13-astra/recovery-result-2.json) and [Daybreak controls](../checks/concerns/c13-daybreak/x06-inflight-result.json).

C12 survives artifact hash checks because `fixtures/build.sh:23` checks commit identity rather than tracked working-tree contents.
The reproduction establishes false provenance labeling. It does not establish that a real compromised WASM was built.
Reject staged and unstaged tracked changes before compilation. Preserve developer files without resets or deletion.
Checking additional untracked inputs is broader protection, not a prerequisite for this demonstrated correction.
The 14 matching artifact hashes establish byte identity, not reproducible source-to-WASM provenance.

C14 needs correction before another explicit CLI01 live run.
The actual CLI submission at `tests/cli-pipeline.ts:42` must pass through the existing durable guard using a small adapter.
Keep the CLI submission itself. Replacing it with SDK submission would stop testing the intended integration.
The amount is `100` stroops, or `0.0000100 XLM`, between dedicated testnet accounts.
Unknown-result recovery is the concern. The evidence does not support meaningful financial loss or Medium practical severity.

## Minimum corrections and verification

| Priority | Minimum correction | Acceptance check |
| --- | --- | --- |
| Before broader SDK integration | C05: compare captured and current revisions in the existing final success guard. | Delayed A→B and A→B→A successes reject through existing cancellation handling. |
| Before component teardown integration | C06: abort owned controllers and guard late commits. | Destroy during scan, permission wait, selection, and prior-client disconnect. Keep established clients usable. |
| Next demo maintenance | C02: catch URL parsing at `demo/server.ts:47`. C10: retain decoded signed-state terms. | Malformed targets return `400`; the same process stays available. Reload preserves review details. |
| Next demo recovery maintenance | C08: validate hash, boolean success, and positive safe-integer ledger before mutation. C09: bind restored bodies and signature. | Reject mismatched POST/GET responses and mixed records. Preserve storage and Disconnect. |
| Before affected live fixture runs | C11: validate all expected authorization before any signing. C14: use the durable guard. | Unexpected trees cause zero signer calls. Unknown CLI outcomes block new attempts. |
| Before resumed fixture acceptance | C13: preserve phase observations and validate final state. C17: mark reused CAP-71 checks. | Saved and reconciled successes avoid repeated X06 operations. Historical checks remain explicit. |
| Before fixture rebuilding | C12: reject modified tracked cache inputs. | Staged and unstaged modifications stop before the compiler runs. |
| Routine documentation maintenance | C01: clarify output draining, outer timeout, and unknown-signing limits. C15: document complete `dist` and separate CSS. | The interface matches behavior. A copied distribution loads with generated layout and `sdk/connect.css`. |

C01 and C15 require documentation changes only. C15 should remove the obsolete separate `jsqr.js` requirement.
C10 can retain the already verified original body. Prefer the signed body when implementing C09 validation together.
For C08, optional offer-result decoding must not undo an otherwise validated terminal transaction result.

## Exact concurrent skill-reference delta

File: `.agents/skills/walleterm-site-bridge/references/interception.md`.
Frozen SHA-256: `81843e887c4b75f7a63d16980028f28a897e30a1938894206389f53ec63d4e24`.
Current SHA-256: `0c417445aa7661064f49d975a235ea29e420f1222ab2398067ab1602c3b412b2`.
Exact patch SHA-256: `001dc3724361e3dbf615f8496a3a971ce925045ea78d31a4f88cd15da9042d06`.
The independently generated baseline diff exactly matches [the preserved patch](../checks/concurrent-source-change.patch).
I accept this documentation delta within the existing manual testnet workflow.
It clarifies in-page interception, complete authorization review, durable attempt identity, and cancellation limits.
The surrounding skill preserves public-only identity, 1Password custody, origin binding, exact signing formats, and the user's grant.
The temporary adapter does not authorize key import, private-key access, automatic signing, or broader public bridge formats.
Do not identify this manual review queue as the automatic tunnel service.
No authorship is attributed. No concurrent content was changed.

## Coverage, checks, and limits

| Evidence | Result and limit |
| --- | --- |
| Independent identity check | Passed: all 199 files match manifest and Git blobs; coverage assigns all files to eight areas. |
| Independent archive check | Passed: all 199 archived file hashes match. Archive SHA-256 matches its preserved record. |
| Independent fixture check | Passed: all 14 artifact hashes match their manifests and coordinator evidence. |
| Prior report inventory | Passed: 16 area reports and 40 focused reports exist and have content. The paired overall report remained unread. |
| Central permitted checks | Passed previously: Go race tests, Go vet, TypeScript, 224 Bun tests, and three contract self-tests. Not repeated. |
| Central Rust checks | Passed previously: 30 tests across four locked offline fixture workspaces. Not live protocol acceptance. |
| Locked Soroban SDK versions | Verified: CAP-71 `27.0.2`; base fixtures and CAP-85 legacy `27.0.6`; CAP-85 current `28.0.0`. |
| Browser evidence | Chromium mock connection, selection, reload, and disconnect passed. A viewport check does not prove physical mobile acceptance. |
| Artifact pattern scan | No matches in 1617 scanned files. The defined patterns do not establish universal secret absence. |
| Live checks | `not_run`: actual 1Password signing, ledger submission, physical camera, and new public tunnel behavior. |
| Final packaging | `pending`: coordinator probe archival and normal repository checks after both overall reports. |

Command details and failures appear in [COMMANDS.md](../checks/09-overall-astra/COMMANDS.md).
Fresh checks ran `python3 audit/2026-09-26/checks/09-overall-astra/verify.py`; exit `0`.
The [version record](../checks/locked-soroban-versions.json) matches all four actual Cargo locks. This precision correction changes no classification.
C19 concerns only the two CAP-85 workspaces. Its version analysis remains applicable.
The reviewed broad-suite evidence predates final probe packaging. Do not report the pending packaging checks as passed.

## Research, summary corrections, and features

All requested surfaces ran: Raven, Jev, Parallel Search MCP, parallel-cli, and Perplexity MCP.
Primary evidence supports complete authorization review, explicit camera cleanup, and tracked-source checks.
The bounded C07 challenge found no demonstrated shipped-deployment producer. Occurrence remains inconclusive.
See [SOURCES.md](../research/09-overall-astra/SOURCES.md) for URLs, versions, applicability, discarded results, and transport failures.
Jev reported `$0.023675790` across the failed attempt and partial retry. No further research allocation is needed.
Parallel returned two successful search units across CLI and MCP. Other provider dollar charges remain unknown.
The research allocation cap is `$10` total, including at most `$1` for Jev.
The actual research total remains unknown because providers did not report all dollar charges.
[usage.json](../research/09-overall-astra/usage.json) preserves visible usage without treating unknown charges as zero.

No classification change or new concern is required in the coordinator summary.
The coordinator corrected `FEATURES.md` to separate C05 stale delivery from uncertain-outcome recovery.
C17 reconciliation now permits the existing completion status with clear reuse metadata and original/current protocol fields.
Those summary corrections are sufficient. CAP-85's existing markers remain counterevidence against extending C17.
No significant missing capability emerged against the accepted small companion scope.
A small Wallets Kit adapter remains optional after correctness fixes and accurate integration instructions.
Passkeys, mainnet website authority, portfolio functions, and a general contract policy framework require separate accepted use cases.
No substantive blocker remains. Final packaging and any future live acceptance remain separate, pending activities.
