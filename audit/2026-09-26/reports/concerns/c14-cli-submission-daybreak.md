# C14 — CLI acceptance submission bypass

## Review identity

| Field | Value |
| --- | --- |
| Concern | `C14` |
| Model | Daybreak |
| Effort | xhigh |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Scope | `tests/cli-pipeline.ts`, `tests/live-utils.ts`, `tests/submission.ts` |
| Verdict | Confirmed |
| Priority | P2, before the next live `CLI01` run |
| Confidence | High for the bypass; medium for fault frequency |

I did not read the paired concern report. The central baseline passed before this review and was not repeated.

## Decision

`CLI01` bypasses the shared submission guard. It can submit without first writing a durable pending gate.
The next process can request another signature while the original outcome remains unresolved.

This defect affects only an operator who directly runs `tests/cli-pipeline.ts`. The documented commands do not invoke this file.
The defect does not affect the Go signer, bridge, or guarded paths.

The payment uses testnet and dedicated test keys. Its `--amount 100` value means `0.0000100` test XLM.
The default maximum inclusion fee is also 100 stroops. These amounts do not create meaningful financial loss.

The material impact is a broken recovery invariant. The gap can invalidate a `CLI01` result. It can cause another payment.

## Reachable scenario

1. The pipeline writes unsigned evidence and obtains a signature.
2. `stellar tx send` starts at `tests/cli-pipeline.ts:42`.
3. The remote service accepts the transaction before the child returns usable output.
4. The 60-second child timeout throws before `tests/cli-pipeline.ts:43`.
5. No pending gate exists because the pipeline never calls `ctx.send`.
6. A later process reaches `signDigest` with a clear shared gate.
7. That process can sign a newly built transaction.

A second path starts after a successful CLI exit. The separate lookup can return `NOT_FOUND` at line 43.
The assertion then fails before `ctx.record`. The captured CLI output exists only in process memory.

## Source evidence

- `tests/cli-pipeline.ts:6-7` sets 60 seconds. Lines 30-34 store the digest and call the guarded signer check.
- `tests/cli-pipeline.ts:42-44` sends directly, performs one lookup, and requires immediate `SUCCESS`.
- `tests/cli-pipeline.ts:45-52` records the signed envelope only after that assertion.
- `tests/live-utils.ts:52-54` blocks signing only when the shared gate exists.
- `tests/live-utils.ts:115-151` creates the guard and exports `send`. `CLI01` does not use it.
- `tests/submission.ts:264-310` writes the gate before sending and retains it after uncertain results.
- `tests/submission.ts:320-335` reconciles only the stored hash. `docs/LIVE-TESTS.md:59-69` requires this process.

## Checks and counterevidence

The preserved timeout and `NOT_FOUND` probes reproduced the missing gate.
Each probe allowed a second mock signature. I inspected those probes and did not rerun them.

The unsigned evidence file preserves the original digest. The signature journal preserves the verified signature record.
A careful operator can investigate that digest. However, `bun tests/live.ts reconcile` does not read the unsigned evidence file.

The CLI path verifies CLI and SDK hash agreement. It also verifies the signature and signed transaction hash.
These checks protect transaction identity, but they do not create recovery state.

The historical `CLI01` result proves only the normal path. This review reproduced no live fault.
A pending transaction can conflict with another transaction using the same sequence. Therefore, duplicate payment is not guaranteed.

## Minimum mitigation

Use `createSubmissionGuard` with a CLI submission adapter in `cli-pipeline.ts`.
Parse the signed XDR into an SDK transaction. Use the existing directory and `ctx.record` callback.
The adapter must still execute `stellar tx send` with that exact XDR.

Create the archive and pending gate before starting the CLI child.
Treat a successful CLI exit as `PENDING`. Then poll `ctx.rpc.getTransaction` with the stored original hash.
Retain the gate after a timeout, error, or nonterminal lookup.
The existing `bun tests/live.ts reconcile` command can then recover the attempt.

Do not replace the CLI send with SDK submission. That change would remove the specific CLI submission coverage.
A manual warning is insufficient because later signing remains unblocked.

## Verification plan

- Test a timeout after mock acceptance. Restart the guard and confirm that it permits no further signer call.
- Return `NOT_FOUND` during reconciliation and confirm that the gate remains.
- Return terminal `SUCCESS` for the original hash and confirm that the gate clears.
- Add a successful case that asserts one mocked CLI send.
- Run live `CLI01` only after separate authorization.

## Primary sources, usage, and limits

The installed Stellar CLI 28.0.0 help defines payment amounts in stroops.
See `checks/stellar-payment-help.txt` and the independent check record.
The official [sendTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction) documentation says submission queues a transaction.
The official [getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction) documentation defines terminal and `NOT_FOUND` results.

I reused primary evidence and spent $0 on new research. I made no Jev call, so Jev usage was $0.
One web search returned no relevant primary result. It changed no conclusion.
No live CLI pipeline, signature, submission, public service, or source edit occurred. The review has no blocker.
