# Targeted check results

## RPC root injection

Command:

```text
bun test audit/2026-09-26/checks/06-contracts-daybreak/rpc-root-injection.test.ts
```

Result: passed.
The check ran one test in one file.
The mocked RPC replaced the contract, method, and argument.
The shared `invoke` path still requested one digest signature.
The enforcement request returned that signed attacker-selected tree to the RPC.
It did not sign an envelope or submit a transaction.

## CAP-85 source hashes

Command:

```text
bun -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; const base="/private/tmp/walleterm-audit-40d6cca9db73/fixtures/cap85/"; const m=JSON.parse(readFileSync(base+"wasm/manifest.json","utf8")); const rows=Object.entries(m.sources).map(([file,want])=>{const got=createHash("sha256").update(readFileSync(base+file)).digest("hex");return {file,want,got,matches:want===got}}); console.log(JSON.stringify({checked:rows.length,matched:rows.filter(r=>r.matches).length,rows},null,2));'
```

Result: passed.
All 14 recorded source hashes matched the frozen source.

## Central evidence used

- `audit/2026-09-26/checks/rust-results.json`: four commands passed.
- `audit/2026-09-26/checks/rust-summary.json`: 30 Rust cases passed.
- `audit/2026-09-26/checks/baseline-permitted-results.json`: Go race and Bun tests passed.
- `audit/2026-09-26/checks/fixture-hashes.json`: 14 artifact hashes matched.

I did not repeat these central checks.
