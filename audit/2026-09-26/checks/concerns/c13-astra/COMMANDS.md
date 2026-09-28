# C13 check record

Working directory: `/Users/kalepail/Desktop/walleterm-v2`.
Runtime checks used Bun `1.4.2` on macOS arm64.
No command contacted a provider, signer, public service, or Stellar network.

## Existing reproduction

```sh
bun audit/2026-09-26/checks/06-contracts-astra/x06-recovery-repro.ts > audit/2026-09-26/checks/concerns/c13-astra/existing-reproduction.json
```

Exit `0`. The control passed. Saved final success reproduced the obsolete assertion.
Both the original script and coordinator output received inspection before this run.

## Extended reproduction

```sh
bun audit/2026-09-26/checks/concerns/c13-astra/recovery-check.ts > audit/2026-09-26/checks/concerns/c13-astra/recovery-result.json 2> audit/2026-09-26/checks/concerns/c13-astra/recovery-stderr.txt
```

Exit `1`. An incorrect extraction delimiter stopped the script before any scenario.
The script searched for `async function deployReference(`, which the frozen file does not contain.
Only the assigned script changed. The corrected delimiter is `const call =`.

```sh
bun audit/2026-09-26/checks/concerns/c13-astra/recovery-check.ts > audit/2026-09-26/checks/concerns/c13-astra/recovery-result-2.json 2> audit/2026-09-26/checks/concerns/c13-astra/recovery-stderr-2.txt
```

Exit `0`. All five scenario assertions passed. The stderr file is empty.

| Scenario | Expected result | Actual result |
| --- | --- | --- |
| Control | One mock operation; completed row | passed |
| Saved success | Final read fails; both restarts reject obsolete state; zero restart operations | passed |
| Inflight SUCCESS | Original hash resolves; real checkpoint saves success; both restarts reject obsolete state | passed |
| Unknown inflight | Original hash remains; startup stops before funding or row execution | passed |
| Final mismatch | Current final assertion rejects direct WASM with version 2 | passed |

The script imports frozen checkpoint binding, persistence, preparation, and reconciliation functions.
It extracts unchanged `stepper`, `deployWasm`, `x06`, and `runCap85` bodies.
It removes only the runner's export keyword for dynamic evaluation.
The row list contains only X06. The network check receives a mocked testnet response.
RPC, executable reads, operation execution, funding, and recording use isolated local substitutes.
Signing and submission functions throw if called. No keys exist in this check.
The script creates temporary checkpoints under `/private/tmp/c13-astra-*` and removes them after execution.
Saved-success starts from cached `adopt-ref` evidence and generates the final checkpoint through the frozen stepper.
Inflight-success starts from a saved final hash and executes actual `prepareCap85` and `reconcileInflight` functions.
This check proves harness behavior under those inputs. It does not execute WASM or establish live acceptance.

## File and source verification

Before and after the checks, Python compared every manifest file using `hashlib.sha256(Path.read_bytes())`.
All 199 tracked files matched `manifest.json` both times.
Evidence: `source-before.json` and `source-after.json`.
The extended script also asserts the exact SHA-256 of `tests/cap85.ts` before extraction.
Python independently verified the preserved CAP-85 text against its original source index.
Evidence: `../../../research/concerns/c13-astra/evidence.json`, relative to this directory.

The saved verification script repeats these comparisons and checks the final scenario output.

```sh
python3 audit/2026-09-26/checks/concerns/c13-astra/verify-files.py > audit/2026-09-26/checks/concerns/c13-astra/final-verification.json
```

Exit `0`. All comparisons and scenario-output checks passed.

Tool discovery inspected registered tool names without making provider requests.
`command -v bun`, `command -v stellar-raven-jev`, and `command -v parallel-cli` succeeded.
Raven, Parallel Search MCP, and Perplexity search tools appeared in the registered tool list.
No unresolved source question required CLI help, Jev doctor, or a paid request.
