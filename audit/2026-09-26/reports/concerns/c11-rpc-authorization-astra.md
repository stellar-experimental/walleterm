# C11: RPC authorization tree validation

## Assignment and scope

- Reviewer assignment: `gpt-6-astra`, `xhigh`.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Review date: 2026-09-26, America/New_York.
- Scope: shared `invoke`, extended callers, CAP-71/CAP-85 validators, and their direct signing dependencies.

I read both assigned area reports and the existing reproduction before adding one focused check.
I did not read the paired concern report, delegate work, or change production files.

## Verdict

**Confirmed validation defect; Low severity, P3 priority, High confidence. One concern.**
The shared harness signs an RPC-selected tree without checking its intended meaning.
Exploitation requires an altered RPC response and a permitted signing request.
Affected users are operators running the base or extended testnet acceptance harness with dedicated test keys.
The evidence does not establish a compromised provider, unauthorized live signing, key disclosure, or a production website attack.

The digest-only interface is an accepted limit. The fixture caller still owns artifact inspection under `docs/INTERFACE.md:147-148`.

## Reachable scenario and source references

1. `tests/live.ts:12-13` reaches the base and extended runners.
2. `tests/contracts.ts:431-446` accepts recorded entries and selects an authorizer using only its address.
3. An altered response retains that address but changes the contract, function, arguments, or subtree.
4. `tests/contracts.ts:456-464` calls `authorizeEntry` before checking the returned tree.
5. `tests/contracts.ts:144-155` requests a G-account digest signature through `ctx.signDigest`.
6. `tests/live-utils.ts:52-93` requests and verifies that signature without inspecting the tree.
7. `tests/contracts.ts:473-474` sends the signed authorization entry to enforcement simulation.
8. A reported enforcement error stops envelope signing and local submission at `tests/contracts.ts:519-523`.

The installed SDK sends the complete transaction XDR in `lib/esm/rpc/server.js:1129-1136`.
Thus, the RPC receives the signature before returning its enforcement result. The signature binds the authorization tree, network, nonce, expiration, and V2 address.
It does not bind the enclosing transaction source or sequence number.
See SDK `lib/esm/base/auth.js:153-184`, version `17.1.0`.

Enforcement rejection cannot revoke that signature or consume its nonce on the network.
Another transaction can use it if the contract policy, nonce, expiration, and other protocol conditions permit.

Extended callers inherit the gap through `tests/extended-contracts.ts:17` and `tests/extended-contracts.ts:697-705`.
E02 signs a locally constructed delegate entry whose digest depends on the unchecked parent tree.
See `tests/extended-contracts.ts:577-580`, `tests/extended-contracts.ts:611-618`, and `tests/extended-contracts.ts:643-658`.

## Evidence and counterevidence

The existing reproduction exposed one signed attacker tree to a mocked enforcement RPC.
The added check uses an ordinary call without `expect` or mutation options. It changes `ping(who, 1)` to `ping(who, 999)` in the returned authorization tree.
After enforcement rejection, the disclosed signature verifies for the changed tree and a different transaction envelope.
It fails verification for the intended tree and mainnet. The check produces one mock digest signature, zero envelope signatures, and zero submissions.

On-chain consumption remains an inference from protocol rules; these checks prove disclosure and cryptographic validity.

- `tests/live-utils.ts:8-18` fixes the network and HTTPS endpoint to official testnet values.
- `docs/LIVE-TESTS.md:3-4` requires dedicated test keys and prior scope confirmation.
- An approved or cached 1Password session must permit signing; `README.md:119` documents that boundary.
- `tests/contracts.ts:21` and `tests/contracts.ts:434` set expiration to the reported ledger plus 60.
- That offset uses the same RPC response; it is not an independently verified 60-ledger limit against that RPC.
- CAP-71 checks the complete expected root before signing at `tests/cap71.ts:630-647`.
- CAP-85 validates all recorded entries before signing at `tests/cap85.ts:448-457`.
- Their rejection checks passed with zero signing requests for malformed entries.

## Minimum mitigation and verification

Construct the expected authorization trees locally from each row's known call and fixture behavior.
Validate every returned tree, credential category, and allowed address before requesting any signature.
Compare complete invocation XDR, including arguments and subtrees; reject unexpected source-account entries.
Preserve explicit replay entries and deliberate local negative mutations as separate test behavior.
Validate recorded entries before `mutate.beforeSign`, rather than disabling validation for negative rows.

Reuse the CAP-85 comparison approach, but do not impose its empty-subtree assumption on every base row.
C08 requires nested authorization at `tests/contracts.ts:848-901`; E02 requires its separate delegate entry.
No general policy framework, new CLI option, or digest-signer change is necessary.
An alternative is explicit acceptance of RPC trust for these fixtures, with the signature-disclosure limit documented.

Verify contract, method, argument, subtree, and unexpected-entry mutations with zero digest and envelope signing calls.
Include malformed entries after valid entries to prove that validation finishes before any signature.
Retain passing C08 nesting, E02 delegation, intentional mutation, and presigned replay controls.

## Exact checks and costs

I ran `python3 audit/2026-09-26/checks/concerns/c11-astra/run-checks.py` from the caller repository.
`checks/concerns/c11-astra/results.json` records every child command, working directory, exit code, and log filename.

| Check | Outcome | Evidence under `checks/concerns/c11-astra/` |
| --- | --- | --- |
| Existing reproduction | passed: 1 test | `original-reproduction.log` |
| Signature disclosure supplement | passed: 1 test | `signature-disclosure.log`, `signature-disclosure.test.ts` |
| CAP-71 mock controls | passed: 2 tests; 15 unrelated tests filtered | `cap71-root-controls.log` |
| CAP-85 offline self-test | passed, including four malformed-entry controls | `cap85-self-test.log` |
| Frozen source identity | passed: 199 hashes before and after | `results.json` |
| Live 1Password, testnet consumption, full baseline | not_run | Outside this focused check |

New research cost: **$0 total; $0 Jev; no unknown new provider charges**.
Raven, Parallel Search, and Perplexity MCP tools were discoverable; both requested CLI commands were present.
Preserved primary text and installed SDK code resolved the question, so no new provider calls ran.
Historical provider failures and charges remain in the original research records; they are not new review costs.
No blocker or additional research allocation remains.

## Primary evidence and limits

`research/concerns/c11-astra/sources.json` records six source files, SHA-256 hashes, access information, and applicability.
The preserved [signing guide](https://developers.stellar.org/docs/build/guides/transactions/signing-soroban-invocations) explains detached signing and enforcement simulation.
The preserved [transaction reference](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction) defines tree fields and expiration semantics.
[CAP-71-01](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-01.md) defines the address-bound preimage; [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md) applies it to V2 credentials.
The preserved CAP snapshots cover protocol 27; installed SDK `17.1.0` confirms their application here. The source records date from 2026-09-27 UTC, corresponding to this 2026-09-26 local audit.
