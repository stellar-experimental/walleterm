# Opus next-step assessment

Reviewer: Claude Opus 5.5 (`claude-opus-5-5`), Herdr pane `w44:p10`. Date: 2026-09-27 (2026-09-28 UTC).
Source: clean `main` at `2bd4fa7ee28ec7a8e38b564558a01e36b946c938`, after #11, #12, and #10.
Scope: assessment only. I changed no source, configuration, branch, or old audit file.
I did not control or contact the other Herdr agent. I read its captured handoff and the coordinator summary.

## Short recommendation

No urgent product correction is justified by the reviewed remaining findings. C09 retains a conditional display issue.

1. Optionally fix one repository tooling fault now: `make test` fails in this checkout on ignored capture files.
2. Run a fresh live acceptance only before a release, a wider share, or a claim of current live acceptance.
   That run needs fresh user approval.
3. Keep C11 and C13 deferred until someone requests their live harness runs. Their designs are now clear.
4. C09 is partly resolved. #10 blocks the demonstrated wrong-envelope submission.
   The conditional restored-status issue remains and stays deferred. No urgent product correction is justified.
   Keep C07 as optional hardening with no work.
5. Defer the Wallets Kit adapter until a real target website exists. It also needs a product decision.
6. Treat the research failures as Jev tooling issues. They do not reduce confidence in accepted code or findings.

## Status matrix

| Item | Earlier status | Current status at `2bd4fa7` | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| C11: fixture authorization trees | Deferred; needs a design choice | Open in `tests/contracts.ts` and `tests/extended-contracts.ts`. Both are unchanged since the audit baseline. The #10 product path is not affected. | [local checks](evidence/local-checks.json) `c11_current_paths` | Defer. Fix before the next base or extended live harness run. |
| C13: X06 checkpoint recovery | Deferred; needs a design | Open in `tests/cap85.ts` (unchanged). No saved checkpoint needs recovery: `done.X06` exists and no marker is pending. | `c13_local_checkpoint` | Defer. Fix before the next CAP-85 live run. Legacy handling is defined below. |
| C07: non-JSON 401 cleanup | Optional hardening | Unchanged (`sdk/walleterm.ts:99-115`). Cloudflare documents no Quick Tunnel 401. | [research](evidence/research.json) R6 | No work. |
| C09: restored signed envelope | Conditional hardening | Partly resolved by #10. Submit now verifies every signed record, and the original reproductions send zero requests. Classic records still restore as `signed` without verification. | [C09 probe](evidence/c09-probe.ts.txt), `c09_probe` | Submission failure resolved. The restored-status issue stays conditional and deferred. No urgent correction. |
| C01, C02, C05, C06, C08, C10, C12, C14, C15, C17 | Accepted in #11 | Present at `main`. The #10 review confirmed each correction after integration. | [review-10](../2026-09-27-opus-review/review-10.md) | No work. |
| C03, C04, C18, C20 | Accepted limits | Unchanged. C18 now also covers the integrated source. | [concerns](../2026-09-26/CONCERNS.md) | Keep limits. See the live acceptance item. |
| C16, C19 | Unsupported claims | Unchanged. | [concerns](../2026-09-26/CONCERNS.md) | No work. |
| Wallets Kit adapter | Optional opportunity | Not built. Kit v2.7.0 modules come from each website's `init` call. | R2, R3 | Defer. Needs a real target website and a product decision. |
| Review details through submission | Optional opportunity (C10) | Resolved by #11 C10. #10 extends it to contract records. | [review-10](../2026-09-27-opus-review/review-10.md) | Done. |
| Release identifier | Optional opportunity | Open. `--version` prints a fixed `0.1.0`. #10 added `sign-auth` without a change. | `release_identification` | Defer to a release decision. |
| Journal evidence export | Optional opportunity | Open. A blocked journal tells users to preserve it, but the page has no export. | `journal_export` | No work without a real recovery case. |
| Demo offer prerequisite | Optional opportunity | Open. Docs name USDC but not the issuer or the setup path. The issuer is correct. | `demo_offer_prerequisite`, R5 | Optional small docs change. |
| Integrated live acceptance | Not repeated after integration | Offline only for `2bd4fa7`. Testnet is still protocol 28, and SDK 17.1.0 is current. | R4, [contract doc](../../docs/CONTRACT-AUTHORIZATION.md) | Run only with fresh approval, before release or wider sharing. |
| OpenZeppelin adapter | Offline validation only | The upstream digest and payload map are unchanged since the pin. | R1 | Live check only if the user wants a live support claim. |
| Fresh desktop approval prompt | Unverified | Unverified. Cached authorization can suppress the prompt. | [research](evidence/research.json) | Part of the live acceptance item. |
| Checkout typecheck | Known limit in remediation | `bun run typecheck` exits 1 with 174 errors, all in 7 ignored capture files. CI passes. | `checkout_typecheck` | Small tooling fix. It can proceed now. |

## 1. Prior items and feature opportunities

### C11 and the #10 demo checks

The #10 demo builds its expected authorization root from the operation that it built locally.
It requires exactly one entry, the exact root XDR, no sub-invocations, and the expected authorizer.
It replaces a SourceAccount entry with a fresh AddressV2 entry for review.
See `demo/site/contracts.ts:150-163` and `:221-260`. Restore validation rebuilds the same root at `:345-372`.
The #10 live runner calls `validateContractReview` before each signing call (`tests/contract-auth-demo-live.ts:107`).
Its negative controls reuse signed entries and request zero signatures (`:175-205`).

C11 concerns a different path. The base harness signs the RPC-recorded tree after an address match only.
See `tests/contracts.ts:431-464`. The extended harness uses the same `invoke`.
The demo rule does not transfer directly. Base row C08 needs a nested tree, and E02 needs a delegate entry.
C11 therefore stays open, but only for the fixture harnesses. It needs no product change.

### C09 after #10

`demo/site/app.ts:861` now calls `verifySignedRecord` before every submission.
That check binds the saved hash, one signature, the saved source, and the saved signer.
Contract records also pass full verification on restore (`:298-303`).
I ran the original C09 reproduction against current source in an offline scratch copy.
Both original finding tests now fail. Each sends zero requests where it formerly sent one.
Both controls still pass. The page shows "The signed transaction differs from the reviewed transaction."

The original concern had two parts. #10 resolved the submission part. The restored-status part remains conditional.
A tampered classic record still restores as `signed` without verification. Activity can label it "Signature verified".
The page does not block the record until Submit. Submit then refuses it and sends nothing.
This case needs injected storage. No urgent product correction is justified. Keep this residual deferred.
A later fix can verify classic `signed`, `submitting`, and `unknown` records in `readJournal()`, as the C09 reports proposed.

### C13 and legacy checkpoints

The local checkpoint `evidence/live/cap85-state.json` has `done.X06` and no pending marker.
Its X06 observations come from one uninterrupted run on 2026-09-25 between 18:35:43Z and 18:35:53Z.
No current checkpoint needs migration. C13 matters only for a future CAP-85 run.

Code reading adds one window to C13. `tests/cap85.ts:1196-1199` reads `before` from live state on each entry.
A restart after `adopt-ref` and before `adopt-wasm` would record the external reference as `before`.
That row could still pass. I did not reproduce this. The C13 mitigation already covers it.

The smallest safe design follows:

1. Save `before` inside the X06 checkpoint before `adopt-ref`.
2. Save the validated `after_adopt_ref` observation before `adopt-wasm`.
3. After saved or reconciled `adopt-wasm` success, reuse both observations. Skip the obsolete live reference assertion.
4. Always re-read the final executable and version. Keep the existing rejection at `tests/cap85.ts:1226-1227`.
5. Legacy handling: a checkpoint with `adopt-wasm` success and no saved observations gets `incomplete_evidence`.
   Validate the current final state, preserve both transaction hashes, and do not write `done.X06`.
   Stop for manual review. Never repeat an X06 operation to recreate history.

### C07

The shipped bridge returns JSON errors. The SDK path is unchanged.
Cloudflare documents a 429 response for the Quick Tunnel request limit, plus 502, 1033, and 530 tunnel errors.
It documents no Quick Tunnel 401. An absent document does not prove that none can occur.
The consequence stays small: the component shows an expired state, and the server still rejects the token.

### Feature opportunities

- **Wallets Kit adapter.** Kit v2.7.0 websites pass their modules to `StellarWalletsKit.init`.
  Upstream registration and deployed-website support are separate steps.
  Upstream registration adds a module to a future Kit release, for example through `defaultModules()`.
  A deployed website keeps the bundle that it shipped with.
  It gains the module only after it imports the module or updates its Kit dependency, then rebuilds and redeploys.
  So each target website needs a code or dependency change in both paths.
  The module interface also requires `signAuthEntry` and `signMessage`.
  SEP-43 and Freighter sign a preimage there. Walleterm signs a complete AddressV2 entry through an adapter.
  A module could therefore support only address, network, and transaction signing.
  A website that changes code can already import `WalletermClient`.
  The adapter has no accepted use case now. Reconsider it only for a real target website that uses the Kit.
- **Release identifier.** `walleterm --version` prints `walleterm 0.1.0` for every install.
  The release directory uses a content digest, and the manifest has no source revision.
  The skill tells agents to read `walleterm --help`, which shows whether `sign-auth` exists.
  This limits the practical harm. Act on it with the first release decision.
- **Journal export.** No real recovery case has required it. Keep the existing block and Disconnect path.
- **Demo offer prerequisite.** The demo issuer matches the documented testnet USDC issuer.
  The bridge cannot sign `changeTrust`, so a user must create the trustline through direct signing.
  The docs do not say this. A small docs change can close the gap.

## 2. Research gaps

No decision-relevant claim lacks direct source evidence. The table maps each time-sensitive claim.

| Claim | Used by | Version in source | Current direct source | Status |
| --- | --- | --- | --- | --- |
| AddressV2 signatures bind tree, network, nonce, expiry, and address. Enforcing simulation cannot revoke them. | C11, #10 | SDK `17.1.0`; CAP-71 | CAP-46-11, CAP-71-01/02, and SDK code preserved in the C11 reports; SDK v17.0.0 notes | Closed |
| OpenZeppelin digest `sha256(payload \|\| XDR(Vec<U32>))` and the signer map | OZ adapter | Pin `a5bd8cb` | GitHub compare to `main` `b40c5ea` (2026-09-26): one commit, no digest or payload change | Closed today |
| Kit modules come from website `init`; upstream adds defaults to a Kit release by review | Adapter | Kit `v2.7.0` | Kit README, `utils.ts`, and module guide at `v2.7.0` | Closed today |
| SEP-43 `signAuthEntry` signs a preimage | Adapter | SEP-43 `1.2.1` Draft | `sep-0043.md`; Freighter guide | Closed today |
| Testnet protocol and SDK currency | Live readiness | Protocol 28; SDK `17.1.0` | Testnet RPC `getVersionInfo`: protocol 28; SDK latest release `v17.1.0`. I did not assess network continuity. | Closed today |
| Testnet USDC issuer | Demo docs | `demo/site/app.ts:93` | developers.stellar.org x402 quickstart | Closed today |
| Quick Tunnel error responses | C07 | Current tunnel code | Cloudflare Quick Tunnel and tunnel error docs | Closed for this decision |
| CAP-85 permits switching in both directions | C13 | Protocol 28 fixtures | Preserved `cap-0085.md` lines 238-242 | Closed |

The 62 currentness entries and 6 scoring entries all come from one run: the central Jev retry.
In that run, five document scores failed during transport. Jev then stopped further paid assessment.
All 62 currentness messages read "Jev stopped after unresolved paid-attempt usage".
They mark unassessed documents across 13 source families. They are not 62 claims.
The other 11 partial runs recorded zero currentness and zero scoring failures.
The seven lanes without a partial Jev run still cite primary sources directly.
The coordinator read the central sources directly, as `RESEARCH.md` records.
See [Jev analysis](evidence/jev-analysis.json).

## 3. The other agent's discoveries

| Claim | Check | Effect |
| --- | --- | --- |
| Restricted network access caused CLI failures | Consistent with the records. All 19 failed runs say only "Jev transport failed". Eleven lanes succeeded on a later attempt. My network-checked run had no transport failure. The records do not prove the cause. | No effect on code confidence. |
| Partial Jev output was useful | Confirmed. The partial runs saved source text that reviewers cited. Partial is also the ordinary host outcome: 1882 of 1949 sessions in 7 days. | None. |
| Six scoring failures and 62 currentness failures | Confirmed for the central run only. They are a stop cascade after five transport failures. | None. Direct sources close the claims. |
| 28 attempts: 17 failed, 11 partial; `$0.398445514` | Stale. `usage.json` records 31 attempts: 19 failed and 12 partial; `$0.430850701`. The difference is the two `09-overall` lanes. | None. |
| No recorded rate limit | Confirmed: `rate_limited_requests` is 0. This does not prove that limits cannot occur. | None. |
| The audit remains a draft | Stale. `audit/2026-09-26/REPORT.md` says "Status: complete on 2026-09-27". | None. |

The code findings rest on source reading, local reproductions, and preserved primary text.
The C11 and C13 reports each record `$0` new research and direct protocol text.
Research transport failures do not touch those proofs. My C09 probe confirms the submission fix directly.
The agent's three recommendations belong to Jev and to future research briefs, not to Walleterm code.

## 4. Ranked next work

### Walleterm work

**W1. Make the checkout typecheck match CI.** Rank 1. It can proceed now.

- Trigger: `bun run typecheck` exits 1 here with 174 errors. All come from 7 ignored files in `evidence/pagebook-2026-09-26/`.
- Benefit: `make test`, the required offline gate, works in the maintained checkout. Agents stop using isolated copies.
- Smallest scope: add `"evidence"` to `exclude` in `tsconfig.json`. No tracked TypeScript exists under `evidence/`.
- Acceptance: `bun run typecheck` exits 0 here with the captures present. CI `offline` passes. `git ls-files evidence` still lists no `.ts` file.
- Dependencies: none.
- Human decision: none. The remediation pass left this configuration unchanged by scope. The coordinator should confirm no other reason.

**W2. Fresh live acceptance of the integrated source.** Rank 2. It needs fresh live approval.

- Trigger: before a release, a wider share, or any claim that `2bd4fa7` passed live acceptance.
- Benefit: it replaces offline-only status for the #10 and #11 integration. It exercises the SDK lifecycle and demo recovery against the real bridge.
- Smallest scope: install into a temporary prefix. Run `tests/contract-auth-demo-live.ts` once with the dedicated testnet keys.
  Then do one visible Chrome demo pass: one classic payment and one counter increment.
  The user starts `walleterm tunnel` and `walleterm demo` in their own terminals and stops them afterward.
  Optionally lock 1Password first to observe one fresh desktop prompt.
- Acceptance: one new dated record names the source revision, transaction hashes, ledgers, counter values, and public keys only.
  Negative controls show zero signature requests. The submission guard is clear at the end.
  `docs/CONTRACT-AUTHORIZATION.md` then names the new run and keeps the historical run separate.
- Dependencies: funded dedicated testnet accounts; no unresolved journal; testnet protocol 28 (verified today).
- Human decision: approve live signing and the 1Password prompts.
  Decide separately whether the OpenZeppelin adapter needs a live claim. That case needs a small new runner step.

**W3. Name the demo offer prerequisite.** Rank 3. Optional; it can proceed now.

- Trigger: the next demo documentation change, or a user who cannot use the offer action.
- Benefit: a new Friendbot account has no trustline. The docs then tell the user how to create one.
- Smallest scope: in `docs/WEB-BRIDGE.md:59` and `demo/site/index.html:23`, name issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.
  State that the bridge cannot sign `changeTrust`. Point to the existing direct-signing workflow in `.agents/skills/walleterm`.
- Acceptance: both texts name the exact issuer and the direct-signing path. The bridge operation list stays unchanged.
- Dependencies: none.
- Human decision: none.

**W4. C11 fixture authorization expectations.** Rank 4. Conditional.

- Trigger: a request to run the base or extended contract rows of `tests/live.ts`.
- Benefit: the harness stops disclosing signatures for RPC-selected trees.
- Smallest scope: add expected root trees to each `invoke` call. Compare credential type, address, and full root XDR for every recorded entry.
  Finish all comparisons before `mutate.beforeSign` or any signer callback. Reject unexpected entries.
  Give C08 its nested tree and E02 its delegate entry. Keep presigned replay and deliberate negative mutations.
- Acceptance: offline tests change the contract, method, argument, subtree, and entry count. Each case makes zero signer calls.
  A malformed entry after a valid entry also makes zero calls. Existing C08, E02, replay, and negative rows still pass offline.
  An independent review accepts the signing change, as `AGENTS.md` requires.
- Dependencies: none beyond the trigger.
- Human decision: `DEFERRED.md` offers local expectations or accepted RPC trust. I recommend local expectations. The choice is small.

**W5. C13 X06 recovery.** Rank 5. Conditional.

- Trigger: a request for a CAP-85 live run that can execute X06.
- Benefit: an interrupted X06 row can finish without invented history or repeated operations.
- Smallest scope: the five steps in section 1.
- Acceptance: offline tests interrupt before final submission, after final-step persistence, during final reads, and before row persistence.
  Tests cover saved success, reconciled success, unknown outcome, missing history, and mismatched final state.
  Each recovered case makes zero additional X06 submissions and never re-reads `before` after `adopt-ref`.
- Dependencies: none. No current checkpoint needs migration.
- Human decision: none for the design. The later live run needs approval.

**W6. Release identification.** Rank 6. It needs a release decision.

- Trigger: a decision to publish or tag a release, or a report of a skill and binary mismatch.
- Benefit: an agent can match an installed binary to its interface and source.
- Smallest scope: change the version constant when the CLI interface changes. Alternatively, print the release directory digest.
- Acceptance: `walleterm --version` differs between installs with different command contracts.
- Dependencies: a release process. None exists now: the repository has no tags.
- Human decision: choose a versioning rule.

**Do nothing now:** Wallets Kit adapter, journal export, C07, the deferred C09 restored-status residual, and all accepted limits.
Revisit the adapter only for a real target website that uses the Kit.
That website must accept a module import or a Kit dependency update.
The user must also accept a published package and its support scope. An upstream request is optional.

### Jev and research-tool work

These items are proposals for the Jev repository. They are separate from Walleterm.
Each proposal needs a review of Jev source and design before implementation. I did not read the Jev source.

**J1. Record a sanitized transport cause.** Rank 1.

- Trigger: all 19 failed runs recorded only "Jev transport failed". The checked lane, `01-signer-astra`, also had empty stderr.
- Benefit: an operator can tell a denied network from a provider fault without guessing.
- Smallest scope: add one cause class to the failure record, such as DNS, connect, TLS, timeout, or HTTP status.
  Exclude URLs, headers, tokens, and response bodies.
- Acceptance: an offline test with a denied connection records the class and no secret material.

**J2. Check the network before a paid reservation.** Rank 2.

- Trigger: the 19 failed attempts reserved `$0.165858543`. That is 38.5% of the recorded `$0.430850701`. These amounts are not proven bills.
- Benefit: a call without network access can fail before its first reservation.
- Smallest scope: a free connectivity check before the first reservation, or an explicit `doctor` network option.
- Limit: a free check cannot guarantee that later paid requests succeed or avoid reservations.
- Acceptance: a run without network access exits before its first reservation and reports the cause class.

**J3. Label stop cascades separately.** Rank 3.

- Trigger: the central run reported 62 currentness failures that were really unassessed documents after a stop.
- Benefit: readers stop treating unassessed documents as failed checks or open claims.
- Smallest scope: count "not assessed after stop" apart from real assessment failures in `load` and `failures.json`.
- Acceptance: a replay of the central run reports 62 unassessed documents and zero currentness failures.

**Research brief practice.** Future briefs should require a free network check before the first paid call.
That check lowers the risk of a failed paid call. It does not remove it.
They should also require one claim-to-source table for decision-relevant claims. This report uses that form.

## 5. Readiness and decisions

| Work | Clear existing requirement | Real product choice | Fresh live approval |
| --- | --- | --- | --- |
| W1 typecheck scope | Yes | No | No |
| W2 integrated live acceptance | Yes, when the trigger occurs | OZ live claim only | Yes |
| W3 offer prerequisite docs | Yes | No | No |
| W4 C11 | Yes, after the small DEFERRED choice | Local expectations or accepted RPC trust | Only for the later harness run |
| W5 C13 | Yes | No | Only for the later harness run |
| W6 release identification | No | Versioning and release policy | No |
| Wallets Kit adapter | No | Real target website, package, support scope | Later, for acceptance |
| J1-J3 (Jev proposals) | Only after Jev source and design review | No | No |

## Research record

- Preflight: Jev `0.1.0` doctor passed without network checks. `parallel-cli` `0.9.3` reported `authenticated: true`.
  Free HTTPS requests succeeded before any paid call.
- Stellar Raven MCP: 2 discovery searches and 1 `execute` script. All 5 service calls succeeded.
- stellar-raven-jev: 1 search. It returned exit 2 (partial), `$0.015045232`, no transport failure, and no rate limit.
- Parallel Search MCP: 1 search for Cloudflare tunnel responses. It exposed no dollar amount.
- Perplexity: available but not used. Primary sources closed every question.
- Free primary reads: GitHub REST and raw files, and two read-only testnet RPC calls.
- New metered spend: `$0.015045232` reported by Jev, plus one Parallel call of unknown cost. The limit was `$10`.
- I sent no private code, private URL, credential, seed, or user data to any research tool.
- Remaining uncertainty: Wallets Kit maintainers alone can say whether they would accept a testnet-only module.
- The deployed-bundle point for the Kit is an inference from its `init` module list. I did not test a deployed website.
- I did not assess testnet continuity since the historical runs. A larger ledger sequence alone does not prove it.

## Limits

- I ran no broad suite. Source is unchanged since the accepted CI and Opus checks.
- I ran two focused offline checks: the C09 reproduction probe and the checkout typecheck.
- The C09 probe used isolated mock keys and in-memory mocks in the session scratchpad.
- I read local checkpoint structure and public observations only. I read no key material.
- I accessed no 1Password item, signing service, mainnet, submission path, tunnel, or real-prefix install.
- The testnet RPC calls were read-only version and ledger queries.
- The X06 restart window comes from code reading. I did not reproduce it.
- All 568 original audit files still match their recorded hashes.

## Evidence

- [Local checks](evidence/local-checks.json): source paths, checkpoint state, typecheck, version, and frozen-audit hashes.
- [C09 probe](evidence/c09-probe.ts.txt): probe additions and output.
- [Research sources](evidence/research.json): claims, versions, direct sources, and spend.
- [Jev analysis](evidence/jev-analysis.json): failure classes, stale counts, and this review's run.
- Earlier records: [DEFERRED.md](../2026-09-27-remediation/DEFERRED.md), [REPORT.md](../2026-09-27-remediation/REPORT.md),
  [Opus review](../2026-09-27-opus-review/README.md), [FEATURES.md](../2026-09-26/FEATURES.md), [RESEARCH.md](../2026-09-26/RESEARCH.md).
