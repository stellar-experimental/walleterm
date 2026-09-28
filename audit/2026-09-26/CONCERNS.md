# Concern register

Status: complete after both independent overall reviews.

Severity describes the demonstrated impact. Priority also depends on the next intended use.
Conditional findings require the stated fault or trust failure. They are not demonstrated attacks.

| ID | Topic | Decision | Severity | Practical action |
|---|---|---|---|---|
| C01 | Output backpressure and the advertised signer deadline | confirmed | low | Clarify the signer interface; no runtime change is required. |
| C02 | Malformed request parsing in the demo HTTP service | confirmed | low | Add a local request parsing guard during demo maintenance. |
| C03 | Shared pairing limit and repeated invalid codes | accepted_limit | none | Keep the existing protection; no runtime fix is required. |
| C04 | Tunnel child survival after supervisor SIGKILL | accepted_limit | none | No runtime change for the accepted main-parent crash guarantee. |
| C05 | Delayed signature result after an observed remote wallet revision change | confirmed | medium | P2; fix before broader SDK integration. |
| C06 | Camera and pairing work after connection component destruction | confirmed | low | Fix before external SPA integration depends on destroy(). |
| C07 | Credential cleanup after a non-JSON 401 | optional_hardening | none | Do not treat this as a demonstrated defect in the shipped bridge path. |
| C08 | Malformed or mismatched Horizon confirmation data | conditional | low | Add a small response guard during demo recovery maintenance. |
| C09 | Restored signed envelope consistency and verification | conditional | low | Optional recovery hardening during demo maintenance; no security release block. |
| C10 | Decoded transaction details before submission | confirmed | low | Restore decoded details before demo submission. |
| C11 | Base harness RPC authorization tree validation | conditional | low | Validate recorded authorization trees before the next affected live harness run. |
| C12 | Dirty OpenZeppelin checkout build attribution | confirmed | low | Reject modified cached source before the next fixture rebuild. |
| C13 | CAP-85 X06 interrupted recovery | confirmed | low | Correct phase recovery before relying on resumed X06 evidence. |
| C14 | CLI acceptance submission bypasses durable recovery | confirmed | low | Fix before the next explicit CLI01 live run. |
| C15 | Connection guide omits shared build files | confirmed | low | Correct the two stale connection-guide instructions. |
| C16 | Parent directory sync and macOS power-loss guarantees | unsupported | none | No runtime change justified. |
| C17 | Checkpoint protocol and harness identity | confirmed | low | Clarify CAP-71 reused-check output before treating resumed rows as fresh acceptance. |
| C18 | Historical versus current live acceptance | accepted_limit | none | Keep historical acceptance limits explicit; no live rerun is required to complete this audit. |
| C19 | CAP-85 build removes tracked test snapshots | unsupported | none | Close the rejected snapshot claim; no source change is required. |
| C20 | macOS floor and Intel support wording | accepted_limit | none | Optionally state the tested platform; do not add an unsupported product floor. |

## C01: Output backpressure and the advertised signer deadline

**Decision:** confirmed. **Severity:** low.

Direct callers with blocked output pipes and no outer process timeout. The bridge drains both streams and has its own timeout.

Both models confirm that the full-operation deadline wording exceeds implemented output behavior. The reproduction blocks before signing and sends zero signing requests. Normal consumers that drain streams do not reproduce it.

Limit the documented deadline to supported input and agent I/O. State that callers drain both output streams and enforce an outer timeout when bounded completion is required. Missing output can follow signing; preserve the ban on automatic signing retries.

Confidence: high; preserved 122-second real-pipe reproduction and focused controls agree.

Independent reports: [Astra](reports/concerns/c01-signer-deadline-astra.md), [Daybreak](reports/concerns/c01-signer-deadline-daybreak.md).

## C02: Malformed request parsing in the demo HTTP service

**Decision:** confirmed. **Severity:** low.

The demo listener receives a malformed request target with an accepted Host value. Signing bridge processes are separate.

Both models reproduce Bun 1.4.2 process exit from uncaught URL parsing. The test uses real loopback handling, not a public tunnel. A same-user process already has authority to stop the demo.

Catch URL parsing errors and return HTTP 400. Verify the same process still answers /api/session. Keep the existing Host restriction. No restart manager or parsing framework is needed.

Confidence: high for loopback process exit; public reachability unverified.

Independent reports: [Astra](reports/concerns/c02-demo-url-astra.md), [Daybreak](reports/concerns/c02-demo-url-daybreak.md).

## C03: Shared pairing limit and repeated invalid codes

**Decision:** accepted_limit. **Severity:** none.

New pairings can pause when an actor knows the active bridge URL. Existing sessions remain usable.

Both focused reviewers classify the shared five-failure lock as a documented availability tradeoff. It caps guesses against one secret. Per-Origin limits cannot stop clients that forge or rotate Origin headers.

Retain the global guess ceiling, code rotation, and one-minute pause. An optional sentence can clarify the process-wide effect. Stronger availability would require a separate trusted admission design, not a per-Origin counter.

Confidence: high; distinct-Origin, repeated-lock, and session-continuity checks agree.

Independent reports: [Astra](reports/concerns/c03-pairing-limit-astra.md), [Daybreak](reports/concerns/c03-pairing-limit-daybreak.md).

## C04: Tunnel child survival after supervisor SIGKILL

**Decision:** accepted_limit. **Severity:** none.

An independently killed supervisor with a surviving grandchild. Current main-parent crash and normal termination controls pass.

Both focused reports retain a conditional, low-priority reliability observation. Neither finds a breach of the documented main-parent crash promise. The coordinator treats this as an accepted fault-model limit, not a confirmed production defect.

Optionally clarify that main-parent crash cleanup requires a live supervisor. Keep the existing regression. Add isolated process-group ownership only if supervisor-crash tolerance becomes a requirement; avoid unsafe PID-only cleanup.

Confidence: high for the mock ownership gap; real cloudflared persistence is unverified.

Independent reports: [Astra](reports/concerns/c04-supervisor-child-astra.md), [Daybreak](reports/concerns/c04-supervisor-child-daybreak.md).

## C05: Delayed signature result after an observed remote wallet revision change

**Decision:** confirmed. **Severity:** medium.

Shared available-wallet sessions with a delayed signed response after observed revision change.

Both focused models reproduce stale success. Grants and original transaction identity remain valid. No automatic SDK submission or unauthorized signing is shown.

Compare current and captured selection revisions in the existing final success guard. Preserve cancellation uncertainty. No new protocol or generation coupling is required.

Confidence: high for behavior; frequency unmeasured.

Independent reports: [Astra](reports/concerns/c05-remote-revision-astra.md), [Daybreak](reports/concerns/c05-remote-revision-daybreak.md).

## C06: Camera and pairing work after connection component destruction

**Decision:** confirmed. **Severity:** low.

External SPA teardown during an explicitly initiated scan or pairing. The static demo does not destroy the component.

Both models confirm active controllers and late pairing commits. Both reject Medium severity. No signing, submission, permission bypass, or frame upload occurs.

Abort owned pending controllers and guard late commits. Keep established shared clients usable.

Confidence: high.

Independent reports: [Astra](reports/concerns/c06-component-destroy-astra.md), [Daybreak](reports/concerns/c06-component-destroy-daybreak.md).

## C07: Credential cleanup after a non-JSON 401

**Decision:** optional_hardening. **Severity:** none.

An accessible HTTP 401 followed by JSON or body-read failure. The bridge generates JSON errors and configures no second authentication proxy.

Both focused models classify this as conditional resilience work. The component becomes expired, not connected; credentials and account data can remain locally. Server authorization still rejects the token. No applicable intermediary producer was demonstrated.

An optional small cleanup moves the existing matching-token 401 handling before JSON parsing. Preserve stale-response isolation, status diagnostics, and ordinary network-failure behavior. No proxy parser, new setting, or release block is justified.

Confidence: high for mocked branch behavior; standard-deployment trigger unproven.

Independent reports: [Astra](reports/concerns/c07-unreadable-401-astra.md), [Daybreak](reports/concerns/c07-unreadable-401-daybreak.md).

## C08: Malformed or mismatched Horizon confirmation data

**Decision:** conditional. **Severity:** low.

Malformed or mismatched HTTP success data from the fixed official testnet Horizon endpoint.

Both models confirm false terminal transitions and original-hash contract failure. Astra rates Low; Daybreak gives Medium correctness priority. Fixed HTTPS, testnet scope, and required user actions limit practical severity.

Validate matching hash, boolean successful, and positive safe-integer ledger before mutation. Preserve unresolved state on rejection. Use the same small guard for POST and GET. Keep optional offer-result decoding separate from the validated terminal result.

Confidence: high for behavior; provider fault occurrence unverified.

Independent reports: [Astra](reports/concerns/c08-confirmation-binding-astra.md), [Daybreak](reports/concerns/c08-confirmation-binding-daybreak.md).

## C09: Restored signed envelope consistency and verification

**Decision:** conditional. **Severity:** low.

Structurally valid but inconsistent restored demo records. Valid-envelope substitution requires an existing signature.

Both models find no ordinary writer that mixes envelopes. Injected storage can mislabel verification or track a different hash after POST. Same-origin code already has stronger authority; validation adds no independent security boundary.

Reuse fresh signature and hash checks in readJournal for signed, submitting, and unknown records. Bind both bodies to the saved hash and saved signer. Preserve invalid storage, block transaction actions, and keep Disconnect available. Do not invalidate old records solely because the current wallet changed.

Confidence: high for injected inconsistent records; ordinary occurrence not demonstrated.

Independent reports: [Astra](reports/concerns/c09-restored-journal-astra.md), [Daybreak](reports/concerns/c09-restored-journal-daybreak.md).

## C10: Decoded transaction details before submission

**Decision:** confirmed. **Severity:** low.

All four demo actions after signing. The initial pre-sign review and cryptographic checks remain present.

Both models confirm the missing second review without an attacker or fault. No changed bytes or unauthorized action is shown. They differ only on whether the existing unsigned body or signed body should supply the restored display.

Keep decoded details visible in signed state using the existing decoder. The smallest normal-path change retains the verified original body. Prefer the actual signed body when combining this work with C09 integrity validation; decoding alone is not signature verification.

Confidence: high; normal signing and reload paths reproduce it.

Independent reports: [Astra](reports/concerns/c10-signed-review-astra.md), [Daybreak](reports/concerns/c10-signed-review-daybreak.md).

## C11: Base harness RPC authorization tree validation

**Decision:** conditional. **Severity:** low.

Base and extended testnet fixture harnesses using dedicated keys and a fixed official RPC.

Both models confirm signing before tree validation. Enforcement rejection cannot revoke the disclosed signature. Astra rates Low; Daybreak gives Medium priority. No compromised provider or on-ledger misuse was observed. The RPC supplies the ledger used for expiration.

Validate every expected tree and credential before any signer callback. Use row-specific expected trees and preserve nested, delegated, replay, and intentional negative cases. No signer or general policy framework change is needed.

Confidence: high for signature disclosure under an altered mock response.

Independent reports: [Astra](reports/concerns/c11-rpc-authorization-astra.md), [Daybreak](reports/concerns/c11-rpc-authorization-daybreak.md).

## C12: Dirty OpenZeppelin checkout build attribution

**Decision:** confirmed. **Severity:** low.

Local OpenZeppelin fixture builds from a cache with unchanged HEAD and modified tracked files.

Both models confirm a misleading pinned-commit label. The reproduction uses real Git state and a compiler stub. Current artifacts match all recorded hashes; no current source substitution was established.

Reject staged and unstaged tracked changes before compilation and preserve developer files. A fresh isolated checkout is an alternative. Broader untracked-input checks can extend coverage but are not necessary to prove the demonstrated fix.

Confidence: high for attribution logic; historical clean-source provenance remains unproven.

Independent reports: [Astra](reports/concerns/c12-oz-provenance-astra.md), [Daybreak](reports/concerns/c12-oz-provenance-daybreak.md).

## C13: CAP-85 X06 interrupted recovery

**Decision:** confirmed. **Severity:** low.

CAP-85 X06 restart after the final executable change or a failed final read. Production signer and browser services are unaffected.

Both models reproduce a safe halt at an obsolete intermediate-state assertion. No repeated X06 operation or false row pass occurs. Final state is correct but the row cannot finish.

Persist the initial and validated intermediate observations in the existing checkpoint before advancing. Reuse them after confirmed final success, skip obsolete intermediate live assertions, and always validate current final state. Label missing old observations explicitly.

Confidence: high for saved-success and reconciled-success paths.

Independent reports: [Astra](reports/concerns/c13-x06-recovery-astra.md), [Daybreak](reports/concerns/c13-x06-recovery-daybreak.md).

## C14: CLI acceptance submission bypasses durable recovery

**Decision:** confirmed. **Severity:** low.

Dedicated testnet acceptance script; amount 100 stroops, 0.0000100 XLM. No meaningful financial loss claim.

Both focused reviewers confirm the recovery invariant failure. Astra reduced practical severity after the coordinator verified CLI units. Daybreak prioritizes the fix before CLI01 use.

Wrap actual CLI submission in the existing durable guard through a small adapter. Reconcile only the saved hash.

Confidence: high for the missing gate; occurrence not observed live.

Independent reports: [Astra](reports/concerns/c14-cli-submission-astra.md), [Daybreak](reports/concerns/c14-cli-submission-daybreak.md).

## C15: Connection guide omits shared build files

**Decision:** confirmed. **Severity:** low.

Website integrators who copy only dist/sdk according to docs/CONNECTION-UI.md. Installed demo and complete package layouts work.

Both models confirm missing shared module imports. Fresh builds and recursive asset checks support the same conclusion. README and the service skill already describe the correct complete distribution.

Serve the complete dist tree with its generated layout. Copy sdk/connect.css separately. Remove the obsolete separate jsqr.js requirement. Do not change bundling, package exports, or installation.

Confidence: high; incomplete and complete distribution controls agree.

Independent reports: [Astra](reports/concerns/c15-sdk-distribution-astra.md), [Daybreak](reports/concerns/c15-sdk-distribution-daybreak.md).

## C16: Parent directory sync and macOS power-loss guarantees

**Decision:** unsupported. **Severity:** none.

An unproven operating-system crash or power-loss limitation, outside the documented process-restart promise.

Both models reject the original APFS defect claim. API capability checks do not prove crash persistence. Restoring a deleted gate would fail closed.

Optionally clarify the process-restart boundary. Define and test a stronger fault model before adding persistence code.

Confidence: high for the documented process-restart scope.

Independent reports: [Astra](reports/concerns/c16-directory-durability-astra.md), [Daybreak](reports/concerns/c16-directory-durability-daybreak.md).

## C17: Checkpoint protocol and harness identity

**Decision:** confirmed. **Severity:** low.

An incomplete CAP-71 row resumes from cached checks under a later protocol. Completed rows correctly retain historical labels.

Both models and the coordinator reproduce a new passed wrapper with the current protocol, older nested checks, and no reuse marker. Retain this narrow evidence-label defect. Daybreak also challenges CAP-85 top-level status; its explicit reused_steps markers provide counterevidence. Missing general version identity remains an optional provenance improvement.

Add explicit reused-check metadata and separate the original protocol from the current environment. Existing completion status can remain when the metadata clearly labels historical checks. Preserve deployments and unresolved submissions. Add a full assertion-identity scheme only if exact revision-specific acceptance becomes a requirement.

Confidence: high for the CAP-71 labeling path; no live protocol incompatibility demonstrated.

Independent reports: [Astra](reports/concerns/c17-checkpoint-versions-astra.md), [Daybreak](reports/concerns/c17-checkpoint-versions-daybreak.md).

## C18: Historical versus current live acceptance

**Decision:** accepted_limit. **Severity:** none.

Historical live records precede the frozen revision. Current offline checks do not establish new live 1Password or testnet acceptance.

Both models found no exact false fresh-acceptance claim. README current tunnel wording is ambiguous alone, but linked dates, revisions, and migration notes disclose the limits.

Optionally date the README sentence during documentation maintenance. Preserve historical records. Record a small tested-revision manifest only during a separately authorized future live run. Keep signer metadata and signed envelopes local.

Confidence: high for source wording and historical provenance.

Independent reports: [Astra](reports/concerns/c18-historical-evidence-astra.md), [Daybreak](reports/concerns/c18-historical-evidence-daybreak.md).

## C19: CAP-85 build removes tracked test snapshots

**Decision:** unsupported. **Severity:** none.

CAP-85 native fixture builds delete ignored generated diagnostics after passing tests.

Both models confirm zero tracked snapshots among all 199 baseline files. SDK 28.0.0 and locked 27.0.6 write snapshots without comparing older files. Direct test assertions remain active. No weakened signer or contract check was demonstrated.

Retain the current build behavior. Committing snapshots would introduce a new differential-review policy, which this concern does not justify.

Confidence: high; both reviewers verified Git ownership and locked SDK implementations.

Independent reports: [Astra](reports/concerns/c19-fixture-snapshots-astra.md), [Daybreak](reports/concerns/c19-fixture-snapshots-daybreak.md).

## C20: macOS floor and Intel support wording

**Decision:** accepted_limit. **Severity:** none.

Readers using Intel or older macOS releases lack a tested-platform statement. Both Darwin architectures compile, but only arm64 ran.

Both reviewers reject a false compatibility promise or demonstrated supported-platform failure. The documentation targets macOS without promising every release or Intel execution. Version-specific Bun requirements do not establish a complete Walleterm support floor.

Optionally record macOS 26.7 arm64, Go 1.27.1, and Bun 1.4.2 as the tested environment. Label Intel compilation separately from runtime coverage. Add runtime evidence only before making a broader support promise.

Confidence: high for documented promises; Intel and older macOS execution remain unverified.

Independent reports: [Astra](reports/concerns/c20-platform-claims-astra.md), [Daybreak](reports/concerns/c20-platform-claims-daybreak.md).
