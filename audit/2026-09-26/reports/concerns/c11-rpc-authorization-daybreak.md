# C11 RPC authorization tree review

## Assignment and verdict

| Field | Value |
| --- | --- |
| Review | `C11`; Daybreak; `xhigh` |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Scope | Shared contract harness and CAP-71/CAP-85 root validators |
| Ownership | `reports/concerns/c11-rpc-authorization-daybreak.md` |
| Verdict | Confirmed; medium priority; high confidence |
| Affected users | Maintainers running the baseline or extended live fixture suites |
| Unaffected paths | Standalone CLI workflows, tunnel, production keys, and mainnet |

I made no production changes, delegated no work, and did not read the paired concern report.

The fixture-only shared harness signs an RPC-selected tree after matching only its expected address.
The later enforcement simulation sends the signed entry to the same RPC. That step cannot revoke the signature.
The exploit requires a malicious or compromised response from the fixed official testnet RPC.
No evidence shows that such a provider compromise occurred.

## Reachable scenario

1. The Bun live harness builds an intended contract transaction.
2. It requests recording simulation from `https://soroban-testnet.stellar.org`.
3. The RPC returns the expected address with a changed contract, method, arguments, or subtree.
4. `invoke` selects an authorizer by address and calls `sdk.authorizeEntry`.
5. The signer signs the changed tree before any tree comparison.
6. Enforcement simulation receives the signed entry inside the transaction XDR.
7. A local rejection prevents submission but does not invalidate the signature.

Another transaction can consume the authorization when the signed tree permits that transaction.
The attacker must use the nonce before the signed expiration value.
The same RPC supplies the base ledger for that value.
The network identifier restricts this signature to testnet.

## Source trace and controls

| Source | Result |
| --- | --- |
| `tests/contracts.ts:431-446` | Recording accepts the RPC tree and matches only its address. |
| `tests/contracts.ts:456-464` | `sdk.authorizeEntry` requests the digest signature. |
| `tests/contracts.ts:473-474` | Enforcement receives the transaction after signing. |
| `tests/extended-contracts.ts:17,696-706` | Extended cases use the same `invoke` path. |
| `tests/live-utils.ts:8-18,29-38` | The harness fixes testnet, official RPC, and three dedicated keys. |
| `tests/contracts.ts:21,434` | Expiration equals the RPC-reported ledger plus 60. The actual chain-tip window is unverified. |
| SDK `lib/esm/base/auth.js:31-50,153-185` | The payload hashes the RPC tree with bound authorization fields. |
| SDK `lib/esm/rpc/server.js:1129-1144` | Simulation sends the full transaction XDR to the RPC. |

CAP-71 validates before signing at `tests/cap71.ts:630-647`. Its regression proves zero signing calls at `tests/cap71.test.ts:648-709`.
CAP-85 validates all entries at `tests/cap85.ts:249-285,448-481`. Its malformed-root test is at `tests/cap85.ts:1607-1717`.

## Evidence and counterevidence

The preserved regression changed the contract, method, and argument. Enforcement received one signed attacker tree.
My fresh Bun `1.4.2` run passed one test in one file.
It made no envelope signature, submission, network call, or live signing request. Four source hashes matched the 199-file manifest.

The official endpoint, testnet, and dedicated keys reduce the impact.
The intended 60-ledger window depends on the untrusted RPC ledger value.
Enforcement prevents local submission. It does not prevent separate use of the disclosed signature.

The mock proves reachability, not a provider compromise or stolen production funds.

## Minimum mitigation

Validate every recorded entry before the first signer callback.
Require each shared `invoke` call to declare its expected tree and allowed credential type.
Compare complete canonical XDR. Reject unexpected addresses and undeclared source-account entries before signing.

Reuse the CAP-85 two-phase pattern with caller-supplied trees for nested authorization.
Validate before test mutations or callbacks. Keep `presigned` replay cases separate because they request no signature.

An independently based shorter expiration only reduces exposure time. It does not validate the tree.

Add the reproduction to the Bun suite. Mutate each root field and assert zero signing calls.
Keep C08 and E02 controls. Run targeted tests, typecheck, and the locked Bun suite.

## Checks and research

| Check | Outcome | Evidence |
| --- | --- | --- |
| Scoped source identity | passed | `shasum -a 256` matched four `manifest.json` hashes. |
| RPC root injection | passed | `bun test audit/2026-09-26/checks/06-contracts-daybreak/rpc-root-injection.test.ts`; one test passed. |
| CAP-71 and CAP-85 controls | passed by inspection | Both reject changed roots before signing. |
| Central baseline | passed, reused | `checks/baseline-permitted-results.json` |
| Live 1Password or testnet check | `not_run` | The review forbids live signatures and testnet writes. |

I reused `research/06-contracts-daybreak/sources.md` and its preserved primary evidence.
[CAP-46-11](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0046-11.md) defines the signed fields and independent tree semantics.
The [simulation guide](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/transaction-simulation) defines recording and enforcement modes.
The 2026-09-26 sources apply to SDK `17.1.0` and the recorded protocol 28 testnet suite.
No unresolved fact required new research. New research and Jev costs were `$0`.

## Limits

I did not prove an RPC compromise or a separate on-ledger consumption transaction.
Protocol rules and direct disclosure establish that enforcement cannot revoke the signature.
This conclusion applies to the fixture harness at the frozen revision.
