# Audit publication record

The source changes and audit evidence use two PRs.
The source changes are in [PR #11](https://github.com/stellar-experimental/walleterm/pull/11).
The evidence branch, `docs/audit-evidence-2026-09-27`, starts from that PR's branch.
Review the evidence diff against `fix/audit-remediation-2026-09-27`.
Squash-merge #11 first. Then merge the updated `main` into the evidence branch without a force-push.
Change the evidence PR base to `main` if GitHub has not changed it.
Verify the audit-only diff and run CI on the final evidence head.

## Source identity

The original audit froze `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Its 568 files remain unchanged during publication.
The remediation records describe later, initially uncommitted changes to that source.
Their saved commands, paths, sessions, and pause instructions describe the historical audit environment.
Checks that assert the original HEAD apply to that historical state, before publication commits.
The [source link map](publication/snapshot-links.md) resolves historical local references to the frozen GitHub revision.

The source PR contains three commits:

- `7f2da1d`: SDK lifecycle and demo recovery corrections.
- `ba8d46b`: fixture evidence and durable CLI submission recovery.
- `608d383`: signer, distribution, and interception documentation.

`main` received these changes as squash commit `939f64ffd3e5d99fb0b8a999862f59a81bd8af17`.
Its tree equals the tree of `608d383`. PR #11 keeps the original commits reachable.

The source PR head is `608d38391f6381a3602d2723d053ca666b0fed91`.
All 201 source file hashes still match the [tested snapshot](2026-09-27-remediation/checks/final-source.json).
The separately pending interception guidance is included without changing its accepted bytes.
The evidence PR adds audit records and publication notes only.

## Evidence and limits

The [remediation report](2026-09-27-remediation/REPORT.md) records all ten accepted corrections.
The original review contains 58 individual Astra and Daybreak reports.
The remediation records contain 18 Sol implementation and review sessions, including a stopped checkpoint.
The [verification index](2026-09-27-remediation/checks/README.md) records 341 passing tests and the exact TypeScript limitation.
The local ignored Pagebook captures remain outside both PRs.
The audit ignore rule retains verification logs and archived coverage required by the reports.
The evidence diff retains 315 whitespace warnings in copied research, reports, logs, and patch records.
Those records preserve their exact bytes. The source PR passed its whitespace checks.

Gitleaks 8.30.1 scanned the publication payload and its archives, with output values redacted.
The scanner reported 148 matches. Review classified them as hashes, public identifiers, published encoding vectors, code symbols, and examples.
The JWT examples come from public SEP-45 documentation and contain an expired `exp` value.
No workspace credential was confirmed. The [classification record](publication/secret-scan.json) preserves each location without its matched value.
This scan does not prove the absence of all secrets.
An independent Opus review also checked checksum-valid Stellar Ed25519 seeds throughout the payload and extracted archives.
All 104 distinct matches came from public documentation examples. No workspace credential was found in that scan.
The [Opus review](2026-09-27-opus-review/review-11-12.md) records the source provenance and scan limits.

The initial publication step did not merge, deploy, install into a real prefix, or perform live signing.
The later Opus merge review remains separate from release and live acceptance.
Current live 1Password, testnet, camera, and installed-release acceptance remain unrun.

## Remaining work

The [deferred-work record](2026-09-27-remediation/DEFERRED.md) contains mitigation options and acceptance conditions.

- C11 needs complete expected authorization trees before the next affected live contract test.
- C13 needs recovery rules for checkpoints without original observations before relying on resumed X06 evidence.
- C07 and C09 remain optional hardening without demonstrated normal-path triggers.
- Live acceptance and release remain separate follow-up work.
- Optional integration and diagnosis improvements remain in the [feature assessment](2026-09-26/FEATURES.md).

Existing [PR #10](https://github.com/stellar-experimental/walleterm/pull/10) adds contract authorization from the same original base.
It overlaps SDK, demo, tests, and interface documentation.
Merge the updated `main` into a separate integration branch for #10. Do not rewrite history.
Test that branch so it retains these corrections.
Publication does not change #10 or claim the new authorization feature received this audit.
