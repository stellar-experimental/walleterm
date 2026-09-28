# Remaining work assessment

Date: 2026-09-27. Assessed source: `2bd4fa7ee28ec7a8e38b564558a01e36b946c938`.

Claude Opus 5.5 completed this review through Herdr with `--effort xhigh`.
It considered the other open audit agent's findings and checked their supporting records.
The coordinator checked the conclusions and corrected several evidence qualifications.

**Recommendation: no urgent product correction is justified by the reviewed remaining findings.**
Two small tasks offer clear value now. The fixture corrections can wait until their next affected test runs.

| Priority | Work | Reason and acceptance |
| --- | --- | --- |
| 1 | Exclude saved evidence captures from TypeScript checking. | The maintained checkout reports 174 errors in seven ignored capture files. A temporary configuration with `evidence` excluded passed. Preserve the captures and check all tracked source. |
| 2 | Clarify the demo offer prerequisite. | Name the exact testnet USDC issuer and link the direct-signing trustline workflow. Keep the bridge's supported operations unchanged. |
| Before an affected harness run | C11: validate fixture authorization trees. | Check every expected entry before any signature. Preserve valid nesting, delegation, replay, and deliberate negative cases. Require independent signing review. |
| Before an affected CAP-85 run | C13: preserve X06 phase observations. | Reuse saved observations and check the final state. Mark missing history incomplete. Never repeat completed operations to recreate evidence. |
| Before claiming current live acceptance | Run scoped acceptance on the merged source. | Record the source revision, dedicated testnet identities, transaction hashes, ledgers, and results. Live approval remains a separate step. |

The coordinator tested the proposed typecheck scope without changing `tsconfig.json`.
No tracked TypeScript file currently exists under `evidence/`.
The [coordinator checks](COORDINATOR-CHECKS.json) record the successful proposal and its temporary setup corrections.

C09 is partly resolved. Current submission checks block both original wrong-envelope and unsigned-envelope reproductions.
The coordinator repeated both probes. Each sent zero requests.
A tampered classic record can still show the signed state before Submit verifies it.
That conditional display issue remains deferred. C07 still has no demonstrated shipped trigger.

The #10 demo already validates its expected authorization trees.
C11 concerns the older base and extended fixture harnesses.
The inspected local CAP-85 checkpoint has completed X06 and has no pending marker.
No current checkpoint needs recovery.

Defer the Wallets Kit adapter until a real target website needs it.
Upstream registration does not update an already deployed website bundle.
Defer release identification to a release decision, and journal export to a demonstrated recovery need.
Keep the existing limits on mainnet, passkeys, and general contract support.

The other agent's research findings remain useful, but its counts and draft status were historical.
The final original audit records 31 Jev attempts: 19 failed and 12 partial.
Its reported or reserved amount is `$0.430850701`. This amount does not establish actual billing.
The 62 skipped currentness assessments concern documents. They do not represent 62 unresolved audit claims.
Opus mapped the consequential claims to primary sources and found no reason to reverse accepted findings.

One new Jev request returned partial evidence without transport, scoring, or currentness failures.
It reported `$0.015045232`. Other research tools did not expose complete dollar costs.
The review did not use Perplexity because the primary sources resolved its questions.
The Jev error-reporting and network-check proposals need review in the Jev repository before implementation.

Reports and evidence:

- [Opus assessment](OPUS.md): dispositions, ranked tasks, acceptance checks, decisions, and limits.
- [Research sources](evidence/research.json): primary sources, versions, and current claim checks.
- [Jev analysis](evidence/jev-analysis.json): the other agent's findings, corrected counts, and failure details.
- [Local checks](evidence/local-checks.json) and [C09 probe](evidence/c09-probe.ts.txt): source review and focused observations.
- [Coordinator checks](COORDINATOR-CHECKS.json): remote source identity, CI, repeated C09 observations, and the typecheck proposal.
- [Original audit](../2026-09-26/INDEX.md), [remediation](../2026-09-27-remediation/REPORT.md), and [PR reviews](../2026-09-27-opus-review/README.md): prior evidence.

At assessment completion, local and remote `main` identified the assessed commit.
Its [main CI run](https://github.com/stellar-experimental/walleterm/actions/runs/36365415031) completed successfully.
This review did not repeat the full behavioral suite or perform live signing, submission, installation, or deployment.
All 568 original audit files remain unchanged.
Only this new audit directory changed. The reports were uncommitted at assessment completion.
Publication adds this directory without changing the assessed product source.
The review left the Opus agent available in Herdr and left the other agent untouched.
