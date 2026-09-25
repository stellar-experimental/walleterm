# Read-only review: submission guard integration (wt-opus, w44:p4)

Verdict: no concrete remaining blocker. No path signs or restores after an unknown submission.

## Evidence
- submission.mjs:117-119 writes the gate before rpc.sendTransaction. Every later failure in send() (121-138) becomes blocked(); the gate stays on disk.
- live-utils.mjs:29 (signDigest), :52 (sign), :65 (fund), and submission.mjs:112 (send) call assertClear. So every signature and send stops while a gate exists, in the same process and in later runs.
- live.mjs:9 calls assertClear before a run. live.mjs:4-6 reconcile only queries the original hash.
- classic.mjs:149 restoreB calls assertClear before it reads state or signs. The G04/G09/G10 finally blocks cannot sign after an unknown send.
- contracts.mjs:440 rethrows UnknownSubmission before the C13 restore. :443 rethrows an unknown restore. :469-470 and :482-485 record "blocked" and stop the run.
- contracts.mjs:94-100 sendOrStop wraps only non-guard errors. Those errors are pre-send failures or known terminal mismatches. No label in contracts.mjs matches the regex, so no terminal result is relabeled.
- Terminal handling: submission.mjs:98-107 treats FAILED or ERROR+errorResult as terminal, archives it, records it, and clears the gate. Then :139-141 throws a normal Error for a mismatch. Restore then runs only on a known terminal outcome. That is correct.
- ERROR without errorResult, TRY_AGAIN_LATER, other statuses, timeouts, and archive/record/clear write failures all keep the gate (fail closed).

## Non-blocking notes
N1. classic.mjs:174-176: if the restore submit itself is unknown, restoreB records "<label>" as "failed".
    Its recovery text says "Restore B with the listed authorized test keys", but it should say to reconcile the hash first.
    The guard also records "<label>.submission" as "blocked", and the gate still stops any automated signature. So this is only an evidence-text issue.
N2. submission.mjs:153: reconcile() never resolves a hash that stays NOT_FOUND. Examples: time bounds expired before inclusion, or the hash aged out of RPC retention.
    A person must remove the gate by hand. This is fail-closed. It is a liveness limit, not a safety defect.
N3. live.mjs:5-6 exits 0 after reconcile even when expectationMatched is false. The recorded row keeps transaction_status and expectationMatched.
