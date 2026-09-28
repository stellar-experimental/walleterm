# C02 astra checks

The review used the frozen source and the existing reproduction.
No new test, public tunnel, signer call, or transaction ran.
All paths below identify the source or the assigned evidence files.

## Runtime and source checks

```sh
command -v bun
bun --version
uname -sm
python3 /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c02-astra/verify_snapshot.py
```

The runtime was `/Users/kalepail/.bun/bin/bun`, Bun 1.4.2 (`744846f84`), Darwin arm64.
The saved verifier compares all manifest paths and bytes with the baseline Git tree.
It writes `source-verification.json` and hashes the preserved evidence used for C02.
The earlier inline manifest check also passed for 199 files.
It compared SHA-256 values and baseline paths before the test.

## Existing reproduction

Working directory: `/private/tmp/walleterm-audit-40d6cca9db73`.
I read the complete `targeted.test.ts` before execution.
The filter selects only its malformed-request test.
The selected test uses the unchanged demo handler and a loopback TCP connection.
It sets a synthetic accepted public origin without starting a tunnel.
Both the test runner and its child disable environment-file loading.

```sh
env TMPDIR=/private/tmp BUN_INSTALL_CACHE_DIR=/private/tmp/walleterm-audit-c02-astra-bun-cache \
  bun --no-env-file test -t 'malformed demo' \
  /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/03-runtime-astra/targeted.test.ts \
  > /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c02-astra/malformed-rerun.log 2>&1
```

The sandbox run exited 1 after the 6000ms test timeout.
It supplied no crash observation and remains inconclusive.
The harness waits for child stdout before it reports child stderr.

The permitted repeat used the same command with this output destination:

```text
/Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c02-astra/malformed-permitted.log
```

The repeat used `sandbox_permissions=require_escalated` for loopback access.
Automatic approval review permitted it.
The test exited 1: zero passed, one failed, two filtered out.
The demo child exited 1 with `ERR_INVALID_URL` at `demo/server.ts:47`.
The log records `GET //%25` and the synthetic accepted host.
The response header was `HTTP/1.1 200 OK`; the process still exited.
The survival assertion failed before the following `/api/session` request ran.
The test's `finally` calls `stopChild(child, 500)`; the child already exited.

## Bounded inspection

I read the three assigned briefs, `manifest.json`, and `reports/03-runtime-astra.md`.
I read the frozen `AGENTS.md`, `README.md`, `docs/PLAN.md`, and `docs/INTERFACE.md`.
I read `demo/server.ts`, `demo/entry.ts`, and `bridge/runtime.ts`.
I inspected `bridge/launch.ts:198-321,356-463` and `service.go:73-102` for the process path.
I read the preserved reproduction, its encoded-request log, and its command ledger.
I read the preserved primary source `research/03-runtime-astra/cloudflare-normalization.md`.

The source search was:

```sh
rg -n 'uncaughtException|unhandledRejection|createDemoSite|launchService|try|catch|exit|recover' \
  demo/entry.ts bridge/launch.ts service.go package.json demo/server.test.ts bridge/runtime.ts
```

It exited 2 because `demo/server.test.ts` does not exist.
The existing reproduction supplied the relevant test; this search failure was not a product defect.
A memory registry search for `C02|demo-url|audit/2026-09-26|frozen source` returned no matches.
I read the general code-review skill but did not apply its unrelated diff and delegation workflow.
I discovered Raven, Parallel, and Perplexity tool metadata without calling those providers.
No new research query, Jev command, or paid processor ran.
New research cost was $0; new Jev cost was $0.
I did not read the paired concern report or other concern conclusions.
