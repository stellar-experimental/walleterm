# C11: RPC authorization tree validation

Read `CONCERN.md` and `reports/06-contracts-daybreak.md`.
Read `reports/06-contracts-astra.md` when available.

Source: `tests/contracts.ts:431-474`, `tests/extended-contracts.ts`, and the CAP-71/CAP-85 root validators.
Evidence: `checks/06-contracts-daybreak/rpc-root-injection.test.ts.txt` and `checks/coordinator-contract-1.txt`.

Determine whether a changed RPC authorization tree reaches the signer before validation.
Check what the enforcement simulation discloses and whether that step can revoke a signature.
Keep the fixed official testnet endpoint, dedicated keys, expiration window, and fixture-only use explicit.
Compare the current base harness with the existing CAP-71 and CAP-85 validators.
Do not imply a compromised provider was observed.

Write `reports/concerns/c11-rpc-authorization-MODEL.md`.
Use `checks/concerns/c11-MODEL/` and `research/concerns/c11-MODEL/` when needed.
Replace MODEL with the assigned `astra` or `daybreak` label.
