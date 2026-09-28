# C15 command record

The source root was `/private/tmp/walleterm-audit-40d6cca9db73`.
The caller root was `/Users/kalepail/Desktop/walleterm-v2`.
Only this directory and the assigned report received new files.

## Executed checks

From the caller root:

```sh
python3 audit/2026-09-26/checks/concerns/c15-astra/check.py
```

The command exited 0. `results.json` records the outcomes and generated file hashes.
`check.py` used these child commands:

```text
git ls-tree -rz 40d6cca9db732a0db16d154c80d4a153bf33c6b7
bun --version
python3 /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/08-product-astra/distribution-probe.py
bun run build
bun -e 'await import(process.argv[1]);' TEMP/sdk-only/walleterm.js
bun -e 'await import(process.argv[1]);' TEMP/sdk-only/connect.js
bun -e 'await import(process.argv[1]);' TEMP/sdk-only/scan.js
bun -e 'await import(process.argv[1]);' TEMP/complete/sdk/walleterm.js
bun -e 'await import(process.argv[1]);' TEMP/complete/sdk/connect.js
bun -e 'await import(process.argv[1]);' TEMP/complete/sdk/scan.js
bun /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c15-astra/graph.ts TEMP/build TEMP/complete
```

`TEMP` was a unique `/private/tmp/walleterm-c15-astra-*` directory. The script removed it after checking.
The build ran inside `TEMP/build`, using copied frozen sources and the existing snapshot dependency directory.
It ran the unchanged build script and declaration compiler. It did not install dependencies or access the network.
The three incomplete-layout commands returned 1. All other listed child commands returned 0.
The unchanged preserved reproduction also created and removed its own temporary copies.
`graph.ts` imported the scanner's generated dependency directly. It checked every static and dynamic reference.
It used the unchanged demo server handler with mock requests and responses. It never called `listen()`.

Evidence files: `results.json`, `build.log`, `graph.json`, `graph.stderr.txt`, and `preserved-probe-rerun.json`.
`graph.stderr.txt` is empty. The fresh build differed from the supplied build in generated filenames and bytes.
Both builds independently confirmed the missing shared-file failure. Build reproducibility was outside this concern.

## Read-only preparation

`cat`, `nl -ba`, `sed -n`, and bounded `rg` searches read the assigned briefs and source locations.
Both original product reports and the preserved reproduction were read before execution.
`uname -sm` returned `Darwin arm64`. `bun --version` returned `1.4.2`.
`git remote get-url origin` supplied the repository URL used for baseline links.
A preliminary inline Python comparison also verified 199 source files against the manifest and Git tree.
An initial plural `references/services.md` lookup failed. The correct file was `references/service.md`.
Two initial shell globs matched no files. Subsequent directory searches used explicit `rg -g` patterns.
These preparation errors did not affect the executed checks.

## Research accounting

Tool discovery found Raven, Parallel Search, and Perplexity MCP operations.
No research provider call ran. No external fact remained unresolved after source inspection and offline checks.
New charges were $0, including $0 for Jev. No new provider result or unknown charge exists.
The existing reproduction supplies the relevant preserved primary evidence.
