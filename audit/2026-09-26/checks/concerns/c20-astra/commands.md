# C20 Astra check record

The caller directory was `/Users/kalepail/Desktop/walleterm-v2`.
All product source reads used `/private/tmp/walleterm-audit-40d6cca9db73`.
The review wrote only its assigned report and `checks/concerns/c20-astra/` files.

## Executed verification

```sh
python3 audit/2026-09-26/checks/concerns/c20-astra/check.py
```

Outcome: exit 0, `passed`; 199 frozen files verified; two preserved architecture build records checked.
The script records source excerpts, source ranges, original build commands, host versions, and preserved primary-source references.
Outputs: `results.json` and `source-excerpts.txt` in this directory.
The script makes no network request and starts no signer or service.

The script executes this read-only Git command:

```sh
git -C /Users/kalepail/Desktop/walleterm-v2 ls-tree -rz 40d6cca9db732a0db16d154c80d4a153bf33c6b7
```

It compares every listed blob with the frozen file's calculated Git blob hash.
It also compares every frozen file's SHA-256 value with `manifest.json`.
It asserts the preserved compilation exits, arm64 help exit, arm64 plugin exit, and absence of Intel execution records.

## Source and test inspection

I read the required briefs and four frozen introductory documents first.
I read both original product reports and their relevant check records.
I read `main.go` through its command dispatch and socket connection.
I read `service.go`, `scripts/install.ts`, `Makefile`, manifests, and the complete CI workflow.
I inspected `service_test.go`, including `TestBunVersion`, before deciding against new tests.

The focused platform search ran from the frozen source:

```sh
rg -n -i 'macos|intel|apple silicon|arm64|amd64|x86_64|sonoma|ventura|monterey|support.*platform|minimum.*(system|version)' README.md docs .agents/skills evidence -g '*.md' -g '*.json' -g '!raw/**'
rg -n -i 'darwin|macos|unsupported.platform|supportedBunVersion|runtime.GOARCH' main_test.go service_test.go
```

Both searches returned exit 0. Neither established an explicit release-floor or Intel runtime promise.
An earlier exploratory search included nonexistent `cmd` and `internal` directories and returned exit 2.
The corrected searches and direct source reads above replaced that incomplete search.

## Reused checks

`checks/08-product-astra/commands.md` specifies the original temporary build procedure.
`checks/08-product-astra/platform-builds.json` retains its exact output paths and exit statuses.
The original procedure used `GOOS=darwin`, each `GOARCH`, and a temporary Go cache:

```text
go build -trimpath -o TEMP/ARCH/walleterm .
file TEMP/ARCH/walleterm
TEMP/arm64/walleterm --help
stellar walleterm --version
```

`TEMP` and `ARCH` above describe original temporary values. `results.json` preserves both exact original build command arrays.
The original reviewer removed those temporary binaries. This review did not rebuild or execute them.
The arm64 record contains both execution results. The amd64 record contains compilation and file identification only.
`checks/08-product-daybreak/tool-versions.json` supplies the recorded host and dependency versions.
`checks/baseline-permitted-results.json` records central test exits. This review did not repeat those suites.

## Research and remaining checks

I inspected available tool metadata for Raven, Parallel Search, and Perplexity.
I read `/Users/kalepail/Desktop/stellar-raven-jev/skills/stellar-raven-jev/SKILL.md`.
I read `/Users/kalepail/.agents/skills/parallel-web-search/SKILL.md`.
No research CLI or provider call ran. No help or doctor prerequisites were needed for an unused CLI.
The preserved Bun installation result contains rolling documentation and no publication date.
The GitHub runner source file contains the original reviewer's dated primary-source note.
Neither source establishes version-specific compatibility for the full product.
New spend: $0. New Jev spend: $0. No failed or partial new provider result exists.
Intel execution, older macOS execution, hosted CI, services, key access, signatures, and submissions remain `not_run` here.
