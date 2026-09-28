# Sequential audit remediation

Status: complete for the selected scope. All ten concerns received accepted corrections.
The saved pause checkpoint matched all 199 tracked source files before work resumed.
Final verification also required one test-mock type annotation. See DECISIONS.md and checks/README.md.

Use one Sol worker at a time. Check the current source before accepting an audit recommendation.
Implement only a small, clear correction with a useful outcome and a direct verification method.
Preserve the original audit as evidence for its frozen revision.

## Queue

| Order | Concern | Intended scope | Acceptance |
| --- | --- | --- | --- |
| 1 | C01 | Clarify the documented signer deadline and output responsibilities | Source and interface agree; no runtime change |
| 2 | C15 | Correct the SDK distribution instructions | Instructions preserve generated imports and stylesheet |
| 3 | C02 | Guard malformed demo request targets | HTTP 400, then a healthy response from the same server |
| 4 | C05 | Reject an old signed response after a newer observed selection | A→B and A→B→A regressions; independent signing review |
| 5 | C06 | Cancel component-owned pending work during destruction | Pending work stops; established shared clients remain usable |
| 6 | C10 | Preserve decoded details in the signed demo state | Normal signing and reload retain the existing review details |
| 7 | C12 | Reject dirty tracked OpenZeppelin fixture source before building | Clean control passes; staged and unstaged changes stop before compilation |
| 8 | C17 | Identify reused CAP-71 checks | Interrupted rows preserve original protocol and explicit reuse metadata |
| 9 | C08 | Assess a small shared confirmation guard, then implement if clear | Invalid provider results cannot create terminal journal state |
| 10 | C14 | Assess reuse of the durable guard around the actual CLI send | Unknown outcomes block another signing attempt; original-hash reconciliation |

Each worker returns its viability decision, changed paths, tests, and remaining limits.
The coordinator reviews each change before starting the next item.
Security-sensitive signing and submission changes receive a separate fresh Sol review.
The final verification covers the combined accepted changes.

## Deferred scope

C11 needs row-specific authorization expectations across several fixture cases.
C13 needs a checkpoint recovery design for missing historical observations.
These changes need more design work than this limited remediation pass permits.

C07 lacks a demonstrated shipped-path trigger. C09 lacks an ordinary writer of the inconsistent record.
Their optional hardening remains deferred.
C03, C04, C16, C18, C19, and C20 require no current defect correction.
Feature additions remain outside this pass.

## Boundaries

Keep existing user changes, generated Pagebook evidence, and the original audit unchanged.
Use offline mocks and temporary state. Do not access key fields or request live signatures.
Do not submit transactions, open public tunnels, install into the real prefix, commit, push, or deploy.
Research unresolved external facts through parallel-cli and Stellar Raven MCP.
Use primary evidence and the prior audit before adding research calls.
Keep new research bounded within the existing authorized budget.

The original checkout TypeScript failure involves ignored Pagebook captures.
Record that limitation separately if it remains present during final verification.
