# Opus first-phase review: PR #11 and PR #12

Reviewer: Claude Opus 5.5, independent session. Date: 2026-09-27.
Scope: read-only review. The repository stayed unchanged: branch `docs/audit-evidence-2026-09-27`, HEAD `38f16c8`, clean status.
I did not read Sol worker or reviewer transcripts before these conclusions.

## Verdicts

| PR | Reviewed head | Base | Verdict |
| --- | --- | --- | --- |
| #11 | `608d38391f6381a3602d2723d053ca666b0fed91` | `main` `40d6cca9db732a0db16d154c80d4a153bf33c6b7` | **accept** |
| #12 | `38f16c8a30f4defa4f0b9493588d0bbaba6492a6` | `fix/audit-remediation-2026-09-27` at `608d383` | **changes_required**: wording in `audit/PUBLICATION.md` only |

Remote refs matched these heads at review time. CI `offline` passed on each exact head.
The #11 run was 36362256768, and the #12 run was 36362559086.
The #11 log shows 341 passing tests and 0 failures across 21 files.
The run includes `fixtures/build.test.ts`, `tests/cli-pipeline.test.ts`, and `tests/cap71.test.ts`.

## PR #11: accept

No consequential and reachable defect was found.

Independent checks:

- SDK C05: `signTransaction` now rejects delayed success after an observed revision change (`sdk/walleterm.ts:357`).
  The bridge increments `selection_revision` only when the key changes (`bridge/server.ts:413-434`).
  In that case, the bridge also withholds the result. So the SDK rule mirrors the bridge rule.
  A same-key reselection does not change the revision. It cannot trigger a false rejection.
- SDK C06: `destroy()` aborts the owned scan and pairing. Late callbacks stop at `destroyed` guards.
  `connect()` disconnects an unfinished pairing client after destruction. An established shared client stays available.
- Demo C02: a malformed request target returns HTTP 400. Before this change, `new URL` threw inside the handler.
- Demo C08: `confirmed()` requires the original hash, a boolean `successful`, and a positive safe-integer ledger.
  On submission, an invalid response becomes `unknown`. On check, the state stays unchanged. No path signs again.
  Offer-result decoding errors no longer hide a confirmed success.
- Demo C10: signed transactions keep their decoded details. The fields match the approved review fields.
- Fixture C12: the guard rejects staged and unstaged tracked changes before fetch or build.
  I probed Git 2.54.0 on an unborn repository. Both `git diff --quiet` checks return 0, so a first build still works.
- CAP-71 C17: reused rows now label reused checks, original protocols, and the current protocol.
- CLI01 C14: `runCliPipeline` uses the shared guard and directory `evidence/live/`.
  Therefore one unresolved gate blocks CLI01 and the other live runners.
  The gate and the prepared envelope persist before `stellar tx send`. Success needs an original-hash lookup.
- `docs/INTERFACE.md`: the deadline text matches `main.go:113-137`.
  The deadline covers input, dial, listing, and signing. It does not cover stdout or stderr writes.
- `docs/CONNECTION-UI.md`: `scripts/build.ts` emits `dist/sdk/*.js` and shared chunks. The chunks bundle jsQR.
  `connect.css` is not in `dist/`, so the separate copy step is correct.

Reviewed and not counted as findings:

- CLI01 treats any nonzero `stellar tx send` exit as unknown. This includes a definite failure.
  Original-hash reconciliation resolves the result. This behavior is conservative and matches the accepted boundary.
- `bounded()` cannot interrupt the synchronous `execFileSync` call.
  The child timeout is 60 s and the guard deadline is 120 s. A check after the call enforces the deadline.
- `render()` now decodes the signed record. Only external storage tampering could make that decode fail.

## PR #12: changes_required (publication wording only)

The evidence content passed my checks. Only the repository publication wording needs correction.

Independent checks:

- The #12 diff has 678 files, all under `audit/`. There are 5 binary files. No file outside `audit/` changes.
- The 568 files in `audit/2026-09-26` are byte-identical to `checks/original-audit-sha256.json`.
  There are 0 missing, 0 extra, and 0 mismatched files. All modes are `100644`.
- A second, independent check: the committed total is 12357844 bytes.
  This matches `audit_bytes` in the frozen `2026-09-26/checks/audit-integrity.json`.
- All 568 working-tree mtimes fall between 00:48 and 04:34 UTC on 2026-09-27.
  Remediation started at 12:05 UTC. The working tree matches HEAD. No `.gitattributes` or autocrlf filter applies.
- `checks/final-source.json` has 201 hashes. All 201 match the tracked files at `608d383`.
  That tree has exactly 201 files. The tree at `38f16c8`, without `audit/`, is identical.
- No file under `audit/` is ignored or missing from the commit.

Extra secret scan (this closes a scanner gap):

- Gitleaks 8.30.1 has no Stellar seed rule. None of its 148 classifications covers Stellar secret seeds.
- I scanned the full payload and all extracted archives with `StrKey.isValidEd25519SecretSeed`.
- Result: 104 distinct checksum-valid seeds. All of them are in retrieved research captures only.
- Provenance: I matched each seed locally against public source text. No seed value left this machine.
  - 102 seeds appear in `stellar/stellar-protocol` SEP-0005, SEP-0052, SEP-0053, SEP-0007, SEP-0010, or SEP-0045.
  - 1 seed appears in `stellar/stellar-docs` `docs/build/guides/basics/automate-reset-data.mdx`.
    The page marks it as an example key.
    The only tracked-tree copies are two `bundle.md` files, under `research/03-runtime-astra/jev/` and `research/03-runtime-daybreak/`.
  - 1 seed appears in the developers.stellar.org SDP guide "Making Your Wallet SDP-Ready".
    It is a published SEP-10 example key. It is in the research archive only.
- No workspace credential was found. The frozen research captures stayed unchanged.
- Other matches: `op://` hits are code templates or `op` help examples.
  Emails are public contacts or `example` addresses. The user email does not occur.
- One 1Password vault ID appears in the archived source baseline. It is an identifier, not a credential.
  `main` already tracks it in `docs/WALLET-SWITCH-VALIDATION.md`, so #12 adds no new exposure.
- Scan limit: the scan covered Ed25519 seed strkeys only. It did not look for BIP-39 mnemonics or other secret formats.
- Handling note: one of my tool outputs printed a partial prefix of the published SDP example key.
  A redaction pattern missed a truncated match. The key is public documentation, not a credential.
  The value is not in this report.

### Required wording correction

`main` accepts only squash merges and requires linear history. Three passages in `audit/PUBLICATION.md` do not match this.
Proposed replacements:

1. Line 7. Replace "Merge #11 first. Then change the evidence PR base to `main` if GitHub has not changed it." with:
   > Squash-merge #11 first. Then merge the updated `main` into `docs/audit-evidence-2026-09-27` without a force-push.
   > Change the evidence PR base to `main` if GitHub has not changed it. Run CI on the final evidence head.
2. Lines 18-22. Keep the three commits as history, and add after the list:
   > `main` receives these commits as one squash commit. Its tree must equal the tree of `608d383`.
   > PR #11 keeps the original commits reachable.
3. Line 61. Replace "Rebase and test that branch after #11 merges so it retains these corrections." with:
   > Merge the updated `main` into a separate integration branch for #10. Do not rewrite history.
   > Test that branch so it retains these corrections.

Optional: add one sentence about the Stellar seed scan to `PUBLICATION.md`. It could name the scope (Ed25519 seeds) and the result (104 published examples).
These edits do not touch the 568 frozen files, and they leave the 201 source hashes the same.

### Checks after the squash integration

1. Record the squash commit of #11 as `S`. `git diff 608d383 S` must be empty.
2. After you merge `main` into #12, `git diff origin/main HEAD -- ':!audit'` must be empty.
3. Repeat the 568-file and 201-file hash checks on the final #12 head. Then confirm CI on that head.

## Deferred items

None of these items blocks #11 or #12.

- C11 and C13 affect only the testnet fixture harness and X06 checkpoint recovery. Neither PR changes that code.
  `DEFERRED.md` records acceptance conditions. The rule to keep unresolved journals stays in place.
- C07 and C09 have no demonstrated ordinary producer. They remain optional hardening.
- Note for phase 2: #10 adds runtime Soroban authorization signing. C11 becomes relevant to product code there.
  Check that #10 shows or checks each full authorization invocation tree before it signs.

## Limits

- I did not rerun local suites. CI passed on the unchanged exact heads, and no concern stayed unresolved.
- There was no live 1Password access, signing, testnet submission, tunnel, installation, or deployment.
- The byte-identity check uses a hash record inside #12. Two independent signals support it: the frozen byte total and the file mtimes.
  No other original copy exists outside the repository.
- Gitleaks and the seed scan do not prove that no secrets exist.
- I read `REPORT.md` and `DEFERRED.md` only after my own conclusions. I did not read session transcripts.
- Scratch copies of the audit tree and its archives remain in this session's scratchpad.
  The scratchpad is outside the repository. These copies were made before the write restriction.
  They can be deleted on request.
