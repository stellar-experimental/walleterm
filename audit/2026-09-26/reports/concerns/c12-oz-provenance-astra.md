# C12: Dirty OpenZeppelin build provenance

## Verdict and scope

**Confirmed defect. Priority: P3. Severity: Low. Confidence: High. Concern count: 1.**
The build can attribute modified source to an unchanged commit.
The evidence does not establish that the current artifacts contain modified source.

- Reviewer assignment: `astra`, `gpt-6-astra`, `xhigh`.
- Review date: 2026-09-26 EDT; checks completed on 2026-09-27 UTC.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Assigned scope: `fixtures/build.sh:19-27` and `fixtures/manifest.ts:15-21`.
- Affected users: developers who rebuild fixtures from a modified cache, and reviewers who rely on that build's attribution.

I read the required briefs, snapshot instructions, README, PLAN, INTERFACE, and both original contract reports.
I inspected both assigned files, fixture documentation, artifact records, and the relevant checkpoint checks.
I inspected the existing reproduction before adding the bounded guard check.
I did not read the paired concern report, delegate, change production files, or inspect other concern reports.
All evidence paths below start at `audit/2026-09-26/`.

## Reachable scenario

1. A developer changes a tracked file inside `fixtures/.oz-src` without changing its HEAD.
2. The developer runs the documented `sh fixtures/build.sh` command (`fixtures/README.md:55-58`).
3. `fixtures/build.sh:19-23` checks only HEAD, so the script accepts the modified checkout.
4. `fixtures/build.sh:25-27` starts four package builds from that checkout.
5. `fixtures/build.sh:31` passes the pinned commit to the manifest writer.
6. `fixtures/manifest.ts:15-21` records that commit beside hashes of the resulting files.

A successful build can therefore record the wrong source attribution.
The affected boundary is local fixture construction and testnet evidence.
This path does not demonstrate key access, unauthorized signing, submission, or public exposure.
The macOS reproduction uses Bun 1.4.2; it needs no browser or 1Password interaction.

## Evidence and counterevidence

The preserved reproduction uses a real Git repository and a real tracked-file modification.
It replaces the pinned commit with the temporary repository's commit.
It replaces `stellar contract build` with a stub that copies source bytes into artifact files.
It retains the frozen build logic and the original Bun manifest writer.
The rerun returned zero and attributed all four modified artifact stand-ins to the unchanged commit.
The result exactly matches `checks/06-contracts-astra/provenance-result.json`.

The stub proves checkout acceptance and manifest attribution, not executable WASM behavior.
It does not compile OpenZeppelin, reproduce deployed behavior, or establish historical artifact contamination.
All four frozen OpenZeppelin artifacts match both their manifest hashes and the audit baseline hashes.
These matches establish artifact identity, not source-equivalent compilation.
`fixtures/README.md:32-35` already records a difference from an upstream account binary; that difference does not identify its cause.

`tests/contracts.ts:559-564` checks artifact hashes and rejects changes against an existing checkpoint.
`tests/extended-contracts.ts:336-345` also checks saved artifact identities.
These checks constrain replacement after checkpoint creation.
They cannot detect wrong source attribution when a fresh build supplies matching artifacts and a regenerated manifest.
`tests/contracts.ts:1180-1186` checks the declared commit but does not independently establish its source correspondence.

## Minimum mitigation and verification

Reject staged and unstaged tracked changes after the HEAD check and before the first compiler call.
Require both `git diff --quiet --` and `git diff --cached --quiet --` within `$SRC`.
Treat any nonzero result as a build failure and explain that the checkout must be clean.
Preserve developer files and the Git index; do not reset, clean, delete, or automatically stash them.
This rejection is sufficient for C12's existing tracked-file modification scenario.
A fresh isolated checkout is an alternative, with additional creation and cleanup work.
The rejection does not establish reproducible compilation or protect against concurrent source changes.
Untracked build inputs remain outside this bounded concern.

The isolated guard passed a clean checkout and rejected separate staged and unstaged changes.
All three cases preserved the file bytes, index bytes, and HEAD.
After implementation, rerun the build wrapper with a clean control and each modified checkout.
For each rejection, require zero compiler calls and unchanged existing artifacts and manifest.
No additional runtime feature is necessary to resolve C12.

## Exact checks

Command: `python3 audit/2026-09-26/checks/concerns/c12-astra/check.py`.
Outcome: **passed**, exit `0`, on macOS 26.7 arm64, Git 2.54.0, Bun 1.4.2, and Python 3.9.6.

| Check | Outcome | Evidence |
| --- | --- | --- |
| Ten frozen inputs against baseline; unchanged afterward | passed | `checks/concerns/c12-astra/check-result.json` |
| Four OpenZeppelin artifact hashes and sizes | passed | Same result file |
| Existing reproduction, executed without edits | passed; defect reproduced | `checks/concerns/c12-astra/provenance-rerun.json` |
| Clean, unstaged, and staged guard cases | passed; exits `0`, `1`, `1` | `checks/concerns/c12-astra/check-result.json` |
| Preserved primary-source hash | passed | Same result file |
| Real WASM rebuild; live signing; testnet acceptance | not_run | Outside this review's authorization |

`checks/concerns/c12-astra/commands.json` records exact subprocess arguments, temporary directories, and exit codes.
`checks/concerns/c12-astra/check.py` records the assertions and mock boundaries.
`checks/concerns/c12-astra/provenance-rerun.stderr.txt` is empty.

## Primary sources, costs, and limits

The frozen build script and manifest writer provide the decisive primary evidence.
I reused the [pinned OpenZeppelin account source](https://github.com/OpenZeppelin/stellar-contracts/blob/a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640/examples/multisig-smart-account/account/src/contract.rs).
Its version is `a5bd8cbd3d0bb8efbd5cf5e2edf9734f87e47640`, matching the build pin.
The preserved fetch timestamp is `2026-09-27T01:42:39.611283+00:00`; I reread and verified the saved text during this review.
Evidence: `research/06-contracts-astra/oz-account.rs` and `research/06-contracts-astra/primary-source-index.json`.
That source identifies the pinned example; it does not prove artifact provenance.

I discovered Raven, Parallel Search, and Perplexity MCP tools, but made no new provider requests.
Jev and parallel-cli were `not_run`; preserved evidence resolved the concern.
New research cost: **$0** against **$1**. New Jev cost: **$0** against **$0.25**.
Unknown new provider charges: none. Earlier provider charges belong to the original reviews; some remain unknown.
I made no network build, changed no cached source, and repeated no baseline suite.
There are no blockers and no request for additional research allocation.
