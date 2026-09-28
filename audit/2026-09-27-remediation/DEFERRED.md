# Deferred work

The user requested clear corrections and deferred work that needs more design or a human decision.
These items remain outside this remediation pass.

## C11: fixture authorization expectations

The fixtures need complete expected authorization trees before signing returned entries.
Nested calls, delegation, deliberate negative mutations, and replay cases need different expectations.
One generic empty-subtree check would reject valid fixture behavior.
Choose between complete local expectations and explicit acceptance of provider trust for these testnet fixtures.
If implementing validation, check every entry before any signing call.
Retain valid nesting, delegation, mutation, and replay controls.
The original mock reproduction does not establish live provider misuse.
See the [C11 review](../2026-09-26/reports/concerns/c11-rpc-authorization-astra.md).

## C13: X06 checkpoint recovery

Recovery needs the original phase observations and a fresh check of the final executable state.
Old checkpoints can lack the historical observations. Define their handling before changing recovery.
Persist observations before each relevant state change. Preserve transaction hashes and reconciliation evidence.
Report missing history as incomplete evidence. Do not invent observations or repeat completed operations to recreate them.
Test interruption points, saved success, unknown results, missing history, and mismatched final state.
See the [C13 review](../2026-09-26/reports/concerns/c13-x06-recovery-astra.md).

## Optional or conditional hardening

- C07: no shipped-path producer of the unreadable HTTP 401 response was demonstrated.
- C09: no ordinary journal writer creates the demonstrated mixed transaction record.

C07 needs evidence of practical compatibility impact before expanding response handling.
C09 can repeat hash and signature checks during recovery if that hardening becomes worthwhile.
Neither item justifies a larger storage or transport framework.
See the [original concern index](../2026-09-26/INDEX.md) for evidence and limits.

## No current defect correction

C03, C04, C18, and C20 remain accepted limits.
C16 and C19 remain unsupported claims under the audited requirements.
The original audit found no significant missing core capability within the accepted product scope.
This pass adds no new product features.
