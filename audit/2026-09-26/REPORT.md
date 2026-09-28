# Walleterm repository audit

Status: complete on 2026-09-27. The current checkout TypeScript limitation appears below.

## Assessment

The reviewed design meets the stated goal of a small macOS signing companion.
The audit has not established a critical or high-severity defect.
The strongest confirmed concern affects delayed signature results after an observed wallet change.
Several smaller concerns affect cleanup, demo review, integration instructions, and test-harness recovery.

C05 returns a valid, previously authorized signature after the client observes a new wallet revision.
The affected SDK call should reject that stale result.
No changed transaction body or ungranted signing key was demonstrated.
The other confirmed concerns have Low severity and bounded effects.

The audit separates current defects, conditional failures, accepted limits, and optional features.
A simulated adverse response proves application behavior. It does not prove that an external provider produced that response.
The concern register records every rejected candidate and its counterevidence.

## Revision and scope

The baseline is `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
The audit froze all 199 tracked files before review.
The review ran on 2026-09-26 and 2026-09-27.
The [manifest](manifest.json) and [source archive record](checks/source-archive.json) preserve their exact identity.
All code references refer to that baseline unless explicitly marked as a concurrent change.

The checkout contains one concurrent documentation change outside the audit's edits.
Its exact hash and patch appear in [the change record](checks/concurrent-source-change.json).
Both overall reviewers accepted that exact documentation change.

The audit changed audit artifacts only.
It did not implement mitigations, commit changes, install into the real prefix, sign, or submit transactions.
It did not use mainnet funds, private-key fields, public tunnels, or live 1Password approval.

## Coverage by area

| Area | Assessment | Evidence |
| --- | --- | --- |
| Go signer and 1Password | Raw digest validation and independent signature checks passed. Output backpressure remains a bounded interface concern. | [Astra](reports/01-signer-astra.md), [Daybreak](reports/01-signer-daybreak.md) |
| Bridge and authorization | Grants, origin checks, wallet revisions, XDR validation, and cancellation have substantial direct test coverage. | [Astra](reports/02-bridge-astra.md), [Daybreak](reports/02-bridge-daybreak.md) |
| Runtime and tunnels | Recovery preserves signing boundaries. One malformed local demo request needs a parsing guard. | [Astra](reports/03-runtime-astra.md), [Daybreak](reports/03-runtime-daybreak.md) |
| Browser SDK and component | C05 confirms stale success after an observed revision change. C06 confirms pending work after component removal. | [Astra](reports/04-sdk-astra.md), [Daybreak](reports/04-sdk-daybreak.md) |
| Demo and recovery | Normal flows passed. Response validation, restored data, and signed-state review need scoped assessment. | [Astra](reports/05-demo-astra.md), [Daybreak](reports/05-demo-daybreak.md) |
| Contracts and fixtures | Native tests and artifact hashes passed. Harness authorization, build provenance, and X06 recovery need scoped corrections. | [Astra](reports/06-contracts-astra.md), [Daybreak](reports/06-contracts-daybreak.md) |
| Acceptance harness | The shared submission guard passed. CLI01 bypasses that guard and needs integration before another explicit run. | [Astra](reports/07-verification-astra.md), [Daybreak](reports/07-verification-daybreak.md) |
| Installation and product | Isolated installation checks passed. The connection guide omits required build files. No material feature gap emerged. | [Astra](reports/08-product-astra.md), [Daybreak](reports/08-product-daybreak.md) |

See [the architecture](ARCHITECTURE.md) for service responsibilities and trust boundaries.
The default testnet website approves requests by sending them.
A separate terminal approval is not part of the current design.
1Password can reuse cached approval. A valid signature does not prove ledger acceptance.
The audit assessed those documented choices without substituting a different product design.

## Concern decisions

The [concern register](CONCERNS.md) contains all 20 final coordinator decisions.
The [index](INDEX.md) links the individual Astra and Daybreak reports for each concern.
The initial area reports retain their original reasoning and later factual corrections.
The final coordinator decision takes precedence when the reports disagree.

The focused and overall reviews support ten confirmed concerns: one Medium and nine Low.
Three additional concerns require the stated external fault or inconsistent saved data.
Seven candidates are accepted limits, optional hardening, or unsupported claims.

Confirmed decisions:

| ID | Severity | Practical action |
| --- | --- | --- |
| C01 | Low | Clarify output limits and caller responsibilities in the signer interface. |
| C02 | Low | Return HTTP 400 for malformed demo request targets and keep the process alive. |
| C05 | Medium | Reject a delayed signing result when the current wallet revision differs from the captured revision. |
| C06 | Low | Abort pending scan and pairing work during component destruction. Guard late publication. |
| C10 | Low | Keep decoded transaction details visible before submission and after reload. |
| C12 | Low | Reject modified cached OpenZeppelin source before compiling fixture artifacts. |
| C13 | Low | Preserve X06 phase observations and validate the final state during restart recovery. |
| C14 | Low | Route CLI01 through the existing durable submission guard before another explicit acceptance run. |
| C15 | Low | Correct the guide to serve the complete distribution and separate stylesheet. |
| C17 | Low | Mark reused CAP-71 checks when an interrupted row completes. |

C08, C09, and C11 have confirmed validation gaps with conditional fault triggers.
All carry Low practical severity within their demonstrated testnet scope.
C08 trusts malformed Horizon success data. C11 signs a changed fixture authorization tree before checking its meaning.
C09 requires an inconsistent saved record; no ordinary writer creates the demonstrated mismatch.
No review demonstrates a compromised provider or accidental browser storage corruption.

C14 transfers 100 stroops, or `0.0000100 XLM`, between dedicated testnet accounts.
The audit does not claim meaningful financial loss from that test.
C16 does not establish a macOS durability defect within the documented process-restart promise.
C19's claimed deletion of tracked snapshots was factually wrong. The build removes ignored generated outputs.

## Mitigation approach

Prefer narrow changes in existing modules.
Preserve original-hash recovery and the distinction between cancellation and an unknown result.
Preserve the host application's ownership of an established SDK client.
Do not add automatic signing retries, a general authorization framework, or a new persistence subsystem.

A practical sequence keeps each change small:

| Change group | When to address it | Acceptance evidence |
| --- | --- | --- |
| SDK revision and teardown | Before broader website integration | Delayed old responses fail; destroyed components stop pending work. |
| Demo parsing and review | During the next demo maintenance pass | Malformed requests return 400; signed details remain visible. |
| Submission and authorization harness | Before the next affected live acceptance run | Unknown outcomes block new attempts; unexpected trees cause zero signer calls. |
| Fixture recovery and evidence | Before relying on resumed acceptance or new fixture builds | Saved operations do not repeat; reused checks remain explicit; modified source cannot receive a clean label. |
| Interface and integration instructions | During routine documentation maintenance | The documented deadline matches behavior; a copied complete distribution loads. |

C08 and C09 can use small validation helpers during demo maintenance.
C07 remains optional compatibility work. C03, C04, and C16 require no runtime change for current promises.

Each concern report contains a minimum mitigation, alternatives, and a verification plan.
Implement one concern at a time and test its demonstrated failure condition.
A fix requires a separate review and acceptance decision. This audit does not certify unimplemented changes.

## Product completeness

Both product reviewers found no significant missing capability against the stated companion scope.
The most useful optional addition is a small Stellar Wallets Kit adapter.
Accurate integration instructions and complete signed-transaction review should come first.
An installed release identifier could also improve diagnosis with little additional complexity.

Passkeys, mainnet website support, portfolio management, and universal contract adapters exceed the present scope.
The audit does not classify their absence as defects.
See [the feature assessment](FEATURES.md) for benefits, limits, and acceptance conditions.

## Verification

| Check | Result |
| --- | --- |
| Go race suite and Go vet | Passed |
| Strict TypeScript and formatting | Passed |
| Bun suite | 224 tests passed; zero failures |
| Contract harness self-tests | Three passed |
| Native Rust fixtures | 30 tests passed across four locked offline workspaces |
| WASM artifact hashes | 14 matched their manifests |
| Isolated installation | Failure preservation, complete release, repeated installation, and plugin dispatch passed |
| Local browser | Connection, wallet switching, restored session, and disconnection passed |
| Automated accessibility | Zero violations; one incomplete contrast check |
| Dependency checks | No applicable vulnerability was confirmed in the checked locked package graphs |

The [check index](checks/README.md) records commands, versions, logs, and reproduction limits.

After packaging, Go race tests, Go vet, formatting, and the complete Bun command passed again.
The current checkout TypeScript check failed on concurrent ignored Pagebook source captures.
All 174 diagnostics refer to `evidence/pagebook-2026-09-26/`, outside the audited source and audit package.
An [isolated copy of the exact baseline plus audit](checks/isolated-package-typescript.json) passed TypeScript.
The audit preserved the checkout failure and did not change those files or compiler configuration.
Some passing reproduction tests confirm a defect. They do not show a correction.
Repeated reviewer checks do not increase the unique baseline test count.
Initial sandbox socket failures passed after permitted reruns and do not establish product defects.

RustSec reported only an unmaintained `paste@1.0.15` dependency in fixture graphs.
The checked Axios and form-data versions fall outside their reviewed affected ranges.
A separate Go standard-library vulnerability scan did not run because `govulncheck` was unavailable.
See [the recorded limitation](checks/go-vulnerability-scan.json).
See the paired product reports for the exact dependency queries and primary advisory records.

## Assurance limits

This audit did not renew live 1Password or testnet acceptance for the current TypeScript harness.
Historical transaction records apply to their recorded source versions and dates.
Physical camera behavior, VoiceOver, Intel execution, and public tunnel fault paths remain untested here.
Native fixture tests and artifact hashes do not prove a fresh source-to-WASM rebuild.
Mock failures cannot establish their frequency in actual use.

## Research and review record

The user authorized up to `$250` for metered research, separate from model subscriptions.
The audit bounded each reviewer allocation and reused primary evidence when it answered a question.
Stellar Raven, Jev, Parallel Search MCP, parallel-cli, and Perplexity supported the area reviews.
Provider failures and partial Jev results remain recorded.

The [research record](RESEARCH.md) explains source quality and usage limits.
The [usage file](research/usage.json) reports `$0.430850701` of visible Jev charges and reservations.
These 31 runs returned 19 failures and 12 partial results; none establishes complete source coverage.
Other tools did not expose a complete dollar invoice. The audit does not invent one.
The [reviewer registry](checks/reviewer-sessions.json) records individual models, effort, sessions, and completion.

All 58 individual reviews are complete: 16 area reviews, 40 focused reviews, and two fresh overall reviews.
Each model completed 29 reviews at `xhigh` through Herdr.
The [overall reconciliation](checks/overall-reconciliation.json) records the final precision corrections.
The independent overall reports predate final packaging. Their pending packaging notes refer to that earlier review state, now resolved with the stated checkout limitation.
The [final integrity check](checks/audit-integrity.json) verifies archived probes, source identity, report links, and review completion.
The [final package results](checks/final-package-results.json) preserve all checkout check outcomes.
