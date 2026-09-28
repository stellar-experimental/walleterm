# C05: Delayed signature after an observed remote revision change

## Scope and decision

- Date: 2026-09-26. Requested model: `gpt-6-astra`. Requested effort: `xhigh`.
- This report does not independently attest the runtime model selection.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Assigned scope: `sdk/walleterm.ts:237–262,301–302,356–385` and `sdk/connect.ts:279–296`.
- Supporting scope: bridge grants, request cancellation, transaction validation, and the demo's signing and submission paths.
- Verdict: **confirmed SDK correctness defect**. Priority: **P2, normal**. Severity: **Medium**. Confidence: **High**.
- Affected users share an `available` session across client instances and observe a revision change before signing resolves.
- The affected instance must receive a delayed success that the bridge emitted before the change.
- This merits a bounded SDK fix. The evidence does not establish an urgent signing-authority breach.
- I read both named original reports. I did not read the paired concern report or delegate work.

## Reachable sequence and cause

1. Two same-origin pages restore one session token with permission for wallets A and B.
2. The first client requests A at revision 1. The bridge produces and emits its signed response.
3. The transport delays that response before the SDK processes it.
4. The second client selects B, or selects B and then A, reaching revision 2 or 3.
5. The first client calls `getAddress()` and observes that newer revision.
6. The delayed response arrives. The first client's outstanding signing promise resolves successfully with A's signed XDR.

The component stores and restores the token at `sdk/connect.ts:221–265`.
Browser opener storage copying supplies a legitimate route to two clients with that token; see the retained MDN evidence.
Health checks read the account periodically and on focus at `sdk/connect.ts:201–203,267–296`.
`readAccount()` updates the revision without changing `generation` or aborting signing at `sdk/walleterm.ts:237–262`.
`signTransaction()` captures the revision at `301–302`, but its final guard checks only abort, token, and generation at `356–358`.
It returns the old XDR and the original signer address at `381–385`.
For A-B-A, the component also suppresses `onChange` because it compares only address and network at `sdk/connect.ts:290–296`.

## Actual impact and boundaries

The defect allows stale success after the client knows its selection changed.
The returned signature remains valid for the originally requested transaction and its originally granted signer.
Both reproductions made exactly one mock signing call, before either wallet change.
They did not demonstrate signing with an ungranted wallet, changed transaction bytes, private-key access, or submission.
The bridge already classified the request as `unknown` and deleted its stored XDR when the delayed success arrived.
`bridge/server.ts:175–183` marks the result delivered when building its response, before the SDK promise resolves.
Thus, deleting the stored result cannot remove the earlier response from the transport.
The protocol explicitly preserves this signature limit at `bridge/PROTOCOL.md:61–65,101`.
The fix must reject stale SDK success; it cannot undo a produced signature or prove that signing stopped.

The demo's signing completion checks the original hash and signer, which this valid old signature satisfies.
It then records `signed` at `demo/site/app.ts:616–629`; its account callback does not cancel signing at `109–124`.
Its transaction lock covers transaction actions at `450–471`, not the separate connection component's wallet selection.
The demo permits later submission of that signed record, even after A-B; see `415–416,701–720`.
Submission still requires a separate user action. No automatic submission follows from this race.
These demo consequences follow from source inspection; this review did not run a browser submission flow.

## Counterevidence and reproduced checks

- Local `selectWallet()` advances `generation` and aborts active signing at `sdk/walleterm.ts:191–193`.
- The bridge checks grants and fresh key availability at `bridge/server.ts:250–251,398–412`.
- It atomically changes selection and withholds stored results at `bridge/server.ts:413–434`.
- It rejects stale request revisions before duplicate handling at `bridge/server.ts:476–492`, including A-B-A.
- Testnet, source-account, operation, and expiry checks remain active at `bridge/transaction.ts:12–83`.
- These controls support the original clean assessment for request admission; they do not cover delayed remote-response acceptance.

| Check actually run | Outcome | Evidence under `checks/concerns/c05-astra/` |
| --- | --- | --- |
| Seven source files against Git baseline bytes | passed; all equal | `source-identity.json` |
| Existing A-B and A-B-A reproduction | passed; both stale successes confirmed | `remote-switch-permitted.log` |
| Six existing bridge/SDK counterevidence tests | passed; no failures | `counterevidence-permitted.log` |
| Initial restricted executions | blocked by local listener restrictions; exit 1 | `remote-switch.log`, `counterevidence.log` |

Exact commands appear in `checks/concerns/c05-astra/COMMANDS.md` and both result JSON files.
Bun 1.4.2 ran the existing probes against the real frozen bridge with isolated mock keys and loopback transport.
The harness controls response timing and copies the token explicitly. It does not prove physical-browser frequency or storage copying.
The permitted rerun resolved the listener restriction. No new probe or full baseline rerun was necessary.

## Minimum mitigation and verification

Add the captured selection revision to the final success guard inside the existing `try` at `sdk/walleterm.ts:356–358`.
For scoped signing, reject when the current revision differs, even when the address returns to A.
Use the existing cancellation path so `unknown` remains visible. Preserve the original transaction identity.
Aborting active signing when `readAccount()` observes a newer revision can shorten cancellation latency; it is optional for this finding.
A generation change there needs care: `checkHealth()` currently discards results when generation changes at `sdk/connect.ts:279–288`.
An address-only guard misses A-B-A. Preventing opener copying alone leaves other clients that share a session uncovered.
Verify rejection for both existing reproductions, `requestState: 'unknown'`, and successful completion when the revision stays unchanged.
Retain local-switch, stale-admission, cancellation-401, and unchanged-revision recovery checks. No protocol extension is necessary.

## Sources, research usage, and limits

Primary implementation evidence uses the frozen baseline; seven relevant files independently matched Git bytes.
The retained [MDN sessionStorage documentation](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage) describes opener copying.
That unversioned source was accessed on 2026-09-26; `research/04-sdk-astra/parallel-mcp.json` retains its text.
`research/concerns/c05-astra/SOURCES.md` records applicability, tool discovery, and reuse.
New research calls: **0**. New research cost: **$0**. Jev: **$0**, within its **$0.25** limit.
No unresolved external fact required another search. No additional allocation is needed.
Live 1Password, public tunnels, physical browsers, and testnet submission: **not_run**.
No source, dependencies, configuration, or Git state changed. The bounded concern has sufficient evidence; no blocker remains.
