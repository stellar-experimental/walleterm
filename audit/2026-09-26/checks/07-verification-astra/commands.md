# Verification audit command record

Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Date: 2026-09-26.
Source directory: `/private/tmp/walleterm-audit-40d6cca9db73`.
Commands and scripts received inspection before execution.

## Offline execution

The following commands ran from the frozen source directory.
Each command returned exit status 0.

```sh
bun --no-env-file test tests/submission.test.ts tests/checkpoint.test.ts > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/07-verification-astra/focused-tests.stdout 2> /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/07-verification-astra/focused-tests.stderr
bun --no-env-file /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/07-verification-astra/offline-probes.ts > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/07-verification-astra/offline-probes.json 2> /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/07-verification-astra/offline-probes.stderr
```

The focused suite passed 36 submission tests and two checkpoint tests.
The probes reproduced both CLI failures and passed both shared-guard controls.
The CLI probes transpiled the frozen source body and replaced its imported dependencies.
They captured command arguments and evidence targets without executing commands or writing live evidence.
Their signer mock called the real shared guard before incrementing its call counter.
The classic probe executed `runClassic` with mock account responses and the real submission guard.
The recorder probe used the real guard and a result callback that threw.
All temporary guard files stayed inside a new `/private/tmp/walleterm-07-astra-*` directory.
The probe removed that directory after completion.
Neither probe imported `live-utils.ts` or read signer metadata.

The following command ran from `/Users/kalepail/Desktop/walleterm-v2` and returned exit status 0.

```sh
python3 audit/2026-09-26/checks/07-verification-astra/evidence-check.py > audit/2026-09-26/checks/07-verification-astra/evidence-check.json 2> audit/2026-09-26/checks/07-verification-astra/evidence-check.stderr
```

The script used `git ls-tree` and `git show` for read-only revision comparisons.
It verified 59 files from the 199 tracked files.
It parsed all 11 tracked JSON summaries, rejected duplicate keys, and checked protocol hash counts and formats.
It compared historical source hashes with their current TypeScript counterparts.
It did not follow evidence paths into ignored files.

## Research commands

The audit read both required research skills before these commands.
Help and doctor commands passed; doctor established local readiness only.

```sh
stellar-raven-jev --help
stellar-raven-jev search --help
stellar-raven-jev doctor
parallel-cli search --help
```

Evidence: `research/07-verification-astra/cli-help-doctor.txt`.
The installed Jev CLI reported version `0.1.0`; Bun reported version `1.4.2`.

The first Jev command failed with exit status 1 after sandbox transport errors.
Usage reported $0.008729397; no document was selected.

```sh
stellar-raven-jev --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev --budget-usd 1 --retain-days 0 search 'What do official Stellar RPC sources say about reconciling an uncertain transaction submission using its original hash, especially NOT_FOUND and retention limits?' --bundle > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev-compact.json 2> /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev-stderr.txt
```

The approved network retry used the same question and a reduced $0.99 cap.
It returned exit status 2 with usable partial evidence and $0.017990716 reported usage.

```sh
stellar-raven-jev --output-dir /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev --budget-usd 0.99 --retain-days 0 search 'What do official Stellar RPC sources say about reconciling an uncertain transaction submission using its original hash, especially NOT_FOUND and retention limits?' --bundle > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev-retry-compact.json 2> /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/jev-retry-stderr.txt
```

The first Parallel CLI attempt failed with exit status 4 after transport retries.

```sh
parallel-cli search 'Find official Stellar RPC sendTransaction documentation for ERROR, TRY_AGAIN_LATER, DUPLICATE, and asynchronous confirmation.' -q 'site:developers.stellar.org sendTransaction TRY_AGAIN_LATER DUPLICATE' --max-results 3 --excerpt-max-chars-total 8000 --json -o /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/parallel-cli.json > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/parallel-cli.stdout 2> /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/research/07-verification-astra/parallel-cli.stderr
```

The approved network retry used the same command, with `parallel-cli-retry.stdout` and `parallel-cli-retry.stderr` output names.
It returned exit status 0 and one `sku_search` usage unit.
The retained result is `parallel-cli.json`.

| MCP action | Outcome | Evidence |
| --- | --- | --- |
| Stellar Raven discovery, then `stellarDocs.search_rpc_horizon_data_docs` | Returned primary RPC configuration content | `raven.json` |
| Parallel Search `web_search_preview` | Returned primary filesystem documentation; one `sku_search` unit | `parallel-mcp.json` |
| Perplexity search | Returned three primary Stellar pages for challenge and source discovery | `perplexity.json` |

All MCP evidence paths above use `research/07-verification-astra/`.
No paid deep-research processor ran.

## Inspection commands and inherited checks

Source inspection used `rg --files`, `rg -n`, `nl -ba`, `sed -n`, `cat`, and bounded Python JSON readers.
Git inventory and revision reads did not change Git state.
One coverage search returned no matching terms, with exit status 1.
One guessed SDK parser path did not exist, with exit status 2.
Neither result was a test failure or evidence of a code defect.

The central baseline supplied Go race tests, Go vet, TypeScript, 224 Bun tests, and three contract self-tests.
The central Rust summary supplied 30 passed fixture tests across four workspaces.
This audit read the central result files and did not repeat those commands.
These inherited results establish local checks only.

The report marks all current live checks `not_run`.
No ignored credentials, signer metadata, private keys, or raw live journals were read.
No source edits or live signing, submissions, commands, or public services occurred.
