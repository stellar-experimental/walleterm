# C17 check record

## Inspection

Working directory: `/Users/kalepail/Desktop/walleterm-v2`, unless a frozen source path appears.
The review read `briefs/COMMON.md`, `briefs/CONCERN.md`, and `briefs/C17-checkpoint-versions.md` under `audit/2026-09-26/`.
The review read the frozen `AGENTS.md`, `README.md`, `docs/PLAN.md`, and `docs/INTERFACE.md` first.
It then read both `reports/07-verification-*.md` and both `reports/06-contracts-*.md`.
It did not follow their concern-register links or inspect concern reports.

Source inspection used `rg -n`, `nl -ba`, `sed -n`, and `cat` on these bounded paths:

- `tests/cap71.ts`: checkpoint types, loaders, deployment reuse, `call()`, row completion, and row reuse.
- `tests/cap85.ts`: bindings, loaders, step reuse, row definitions, and runner completion.
- `tests/live.ts` and `tests/live-utils.ts`: invocation and result recording.
- `tests/checkpoint.test.ts`, `tests/cap71.test.ts`, and `tests/cap85.test.ts`: existing checkpoint and recovery coverage.
- `evidence/README.md`, `evidence/protocol-acceptance.json`, and `evidence/acceptance-summary.json`: historical acceptance claims.
- `docs/LIVE-TESTS.md`, `docs/BUN-MIGRATION.md`, and both protocol fixture READMEs: acceptance and recovery promises.
- `package.json` and `fixtures/cap85/wasm/manifest.json`: installed version and artifact metadata.

Existing reproduction inspection covered these files under `checks/`:

- `07-verification-daybreak/audit-checks.ts` and `audit-checks-result.json`.
- `07-verification-astra/offline-probes.ts` and `offline-probes.json`, searched for checkpoint and reuse coverage.
- `06-contracts-astra/x06-recovery-repro.ts`, inspected only for existing execution and mock boundaries.
- `07-verification-daybreak/focused-tests.txt`, inspected for existing checkpoint checks.

The Daybreak check established missing binding fields through source matching.
It did not execute changed-version reuse or distinguish incomplete row completion.
The other reproductions addressed different questions and were not rerun.
One research-path search used the snapshot directory incorrectly and returned exit `2`.
The corrected caller-directory read succeeded. No provider request failed.

## Targeted execution

Exact command:

```sh
bun audit/2026-09-26/checks/concerns/c17-astra/checkpoint-versions.ts > audit/2026-09-26/checks/concerns/c17-astra/checkpoint-versions.json 2> audit/2026-09-26/checks/concerns/c17-astra/checkpoint-versions.stderr
```

Runtime: Bun `1.4.2`, frozen JavaScript Stellar SDK `17.1.0`.
The JSON reported `status: passed`; stderr was empty.
The script checked all 199 tracked source hashes before importing the frozen modules.
It created synthetic public identifiers and temporary checkpoints under `/private/tmp/c17-astra-*`.
It removed those temporary files in `finally`.
No private keys were generated or accessed.

| Check | Outcome |
| --- | --- |
| Completed CAP-71 row, protocol 28 to mocked 29 | passed: historical status and protocol 28 retained |
| Incomplete CAP-71 row, protocol 28 to mocked 29 | passed_reproduction: fresh `passed` wrapper, old nested checks, no reuse marker |
| CAP-71 minimum protocol and changed network | passed: both rejected |
| Completed CAP-85 rows with changed assertion callback | passed: callbacks skipped, historical statuses retained |
| CAP-85 row without saved completion | passed: current callback reached and failed as designed |
| CAP-85 minimum protocol and changed network | passed: both rejected |
| Reused CAP-85 assertion step | passed: historical event and `reused_steps` retained |

The CAP-71 check used the actual exported runner.
The CAP-85 check transpiled the exact frozen `runCap85` and `stepper` bodies without editing source.
Injected CAP-85 row callbacks isolated assertion reachability; they did not simulate actual contract assertions.
Real checkpoint loaders, writers, row selection, and empty-state recovery remained in use.
The frozen `record()` body used memory-only file and console sinks.
RPC calls, signatures, and submissions failed immediately if the CAP-71 mock reached them.
CAP-85 used a mocked network response, no-op funding, and empty reconciliation.
Protocol `29` was hypothetical. This check establishes local control flow only.

## Final verification

```sh
python3 audit/2026-09-26/checks/concerns/c17-astra/verify.py > audit/2026-09-26/checks/concerns/c17-astra/verification.json
```

The verifier checks frozen hashes, result assertions, preserved primary-source hashes, and report presence.
See `verification.json` for its outcome.
No live test or full baseline suite ran.
