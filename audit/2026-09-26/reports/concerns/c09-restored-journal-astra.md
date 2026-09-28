# C09: Restored signed envelope consistency

## Assignment and scope

| Field | Value |
| --- | --- |
| Reviewer | Fresh Astra reviewer; assigned model `gpt-6-astra`; assigned effort `xhigh` |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Assigned scope | `demo/site/app.ts:251-281,618-628,704,719`; `demo/site/activity.ts:181-194` |
| Supporting coverage | Journal writes, action locks, reload, status recovery, SDK hashing, and existing C09 reproductions |
| Original reports | `reports/05-demo-astra.md`, D2; `reports/05-demo-daybreak.md`, restoration portion of Finding 1 |

The assignment supplies the model and effort labels. This report does not independently attest runtime selection.
I read the required snapshot documents and original reports. I did not read the paired concern report.
I changed no production source and delegated no work. I assessed only C09.

## Verdict

**Conditional defect; Low severity; P3 priority.** Confidence is high for the missing check and reproduced behavior.
The evidence does not establish a current ordinary-use failure or an independent signing exploit.
Affected users require a structurally valid, inconsistent saved demo record.
The practical consequence concerns testnet submission tracking and misleading verification status.
One conditional concern remains. It does not justify blocking a release on security grounds within the documented demo scope.

## Reachable scenario and exact references

1. A saved record describes payment A. Its `signed_xdr` instead contains already signed payment B.
2. `readJournal()` accepts the record at `demo/site/app.ts:251-281`. It only decodes `review` records.
3. Reload records the state at `app.ts:785-787`. Activity calls `signed` records “Signature verified” at `activity.ts:178-194`.
4. The user selects Submit. The handler decodes B and checks its expiry at `app.ts:701-710`.
5. The handler saves `submitting` and sends B at `app.ts:711-719` without checking its hash or signature.
6. A lost response changes the record to `unknown` at `app.ts:737-739`. Recovery queries A at `app.ts:751`.

The preserved reproduction creates B with an isolated mock key before replacing the field.
It proves that the handler sends B to mocked fetch and retains A's hash.
It does not demonstrate live ledger acceptance, newly authorized signing, or an ordinary path that constructs this inconsistent record.

## Ordinary use, damage, and compromise

| Situation | Evidence and material consequence |
| --- | --- |
| Ordinary application paths | Fresh signing checks hash, signature count, and signer at `app.ts:618-625`. Only then does it save signed bytes. |
| Storage writes | `app.ts:246-249` writes the complete serialized record in one call. No reviewed storage writer independently replaces `signed_xdr`. |
| Tabs and wallet changes | `app.ts:459-471` locks and compares whole records. Existing tests preserve the original signer during wallet changes. |
| Ordinary storage exceptions | Reproductions send nothing before a failed submission save. A failure after POST preserves durable `submitting` and prevents another POST. |
| Accidental damage | Invalid JSON and invalid review XDR block actions. Structurally valid damage can bypass restored signature checks. Its frequency remains unmeasured. |
| Another valid envelope | Substitution requires an existing valid signature for B. The reproduction supplies it explicitly. Random damage does not provide that signature. |
| Same-origin compromise | Executing attacker code can bypass this page's checks or submit an available envelope directly. Revalidation adds no independent security boundary. |

The unsigned-envelope reproduction also enables Submit and sends bytes to mocked fetch.
Its `tx_bad_auth` response is injected. It does not prove that a real network accepted an unsigned transaction.
The preserved [Stellar result-code reference](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/result-codes/transactions) documents rejection for insufficient valid signatures.
The Activity label follows the stored state. Decoding its XDR does not verify a signature at `app.ts:83-90`.

## Minimum mitigation and alternatives

Validate restored `signed`, `submitting`, and `unknown` records with one small validator.
Reuse the existing fresh-signature checks.
Compare the decoded unsigned and signed transaction hashes with the saved hash.
Require the transaction source to match the saved signer. Require one valid signature from that signer.
Run validation inside `readJournal()` so startup and the existing action lock use the same check.
Preserve inconsistent storage and block transaction actions through the existing `journalBlocked` handling.
Continue to permit Disconnect. Keep expiry decisions in the existing submission and ledger-recovery paths.
Validate against the saved signer. A different currently selected wallet must not invalidate an earlier signed record.

A narrower alternative checks immediately before POST. It leaves restored Activity verification claims unsupported until that check.
A label change alone improves accuracy but leaves the wrong-hash recovery problem.
No journal redesign, additional signer service, or new trust mechanism is necessary for C09.

## Exact checks and verification plan

| Check | Outcome | Evidence |
| --- | --- | --- |
| Frozen manifest and baseline Git tree | Passed twice: 199 tracked files, zero differences | [results.json](../../checks/concerns/c09-astra/results.json) |
| SDK version and preserved source hashes | Passed: SDK 17.1.0; both SDK files match | [results.json](../../checks/concerns/c09-astra/results.json) |
| Existing C09 reproductions and counterevidence | Passed: 8; filtered out: 5 | [restoration.log](../../checks/concerns/c09-astra/restoration.log) |
| Existing journal, wallet, and recovery controls | Passed: 6; filtered out: 18 | [guards.log](../../checks/concerns/c09-astra/guards.log) |

All exact commands and working directories appear in [COMMANDS.md](../../checks/concerns/c09-astra/COMMANDS.md).
The [check driver](../../checks/concerns/c09-astra/run-checks.py) reproduces those commands. I added no test cases and repeated no complete baseline suite.
Passing fault reproductions confirm current behavior. They do not establish a fix.
After mitigation, reject replaced envelopes, absent or invalid signatures, wrong sources, and inconsistent hashes without sending a POST.
Retain normal restoration, wallet-switch recovery, preserved storage, Disconnect, and status checks for expired unresolved transactions.

## Sources, costs, and limits

The [source ledger](../../research/concerns/c09-astra/SOURCES.md) lists primary URLs, preserved evidence, access dates, versions, and applicability.
It includes installed SDK source, Stellar result codes, and the W3C Web Locks specification.
New research cost: **$0 total; $0 Jev**. Earlier provider charges remain separate; some remain unknown.
Live signing, live submission, public tunnels, and native browser corruption tests: **not_run**.
The mocks establish handler behavior. They do not establish browser disk faults, real account authorization, or testnet inclusion.
No blocker remains for this concern review. No additional research allocation is necessary.
