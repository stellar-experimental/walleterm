# C20 platform claims — Daybreak

## Review identity and scope

| Item | Value |
| --- | --- |
| Concern | `C20` |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Model and effort | Daybreak, xhigh |
| Baseline | Central Go, Bun, vet, TypeScript, and Rust checks passed |
| Scope | Platform claims, guards, prerequisites, CI architecture, and recorded builds |
| Independence | I did not read the paired C20 report. |
| Delegation | None |

I read both `08-product` reports and the named source paths. I inspected the existing platform reproduction before adding tests.

## Verdict

Verdict: **unsupported as a defect**. Priority: no correctness priority. A P3 documentation improvement remains useful.
Confidence: high. Concern count: zero confirmed defects.

The project promises macOS as its product family. It does not promise every macOS release or an Intel runtime.
Untested Intel operation does not make the current text false. The exact tested platform remains unclear to users.

Actual affected users have older macOS systems or Intel Macs. They receive incomplete compatibility guidance.

## Reachable scenario and source trace

`README.md:3` calls Walleterm a macOS companion. `docs/PLAN.md:8` states macOS support without a version or architecture.
Neither statement names Intel, Apple Silicon, or a minimum release.

`README.md:11` requires Bun `1.4.2` or later. `Makefile:13-14` uses Bun for installation.
`scripts/install.ts:29-35` enforces Bun `1.4.2` and checks Go.
A user below Bun's macOS floor cannot use the installer. This prerequisite failure is not an explicit compatibility promise.

`main.go:51-58` selects the signer socket for every Darwin architecture. `main.go:126-128` rejects systems without that socket path.
`service.go:44-70` checks Darwin for `tunnel` and checks Bun.
These guards identify an operating-system family, not a release or architecture.

`.github/workflows/test.yml:9-36` runs only `macos-15`. GitHub maps that label to an M1 `arm64` runner.
The workflow's `x86_64` download branch is therefore unexecuted.

## Evidence and counterevidence

`checks/08-product-daybreak/tool-versions.json` records macOS `26.7` on `arm64`.
`evidence/acceptance-summary.json:4-12` records only `macOS`.

`checks/08-product-astra/platform-builds.json` proves both Darwin builds compile.
Only the `arm64` binary ran its help and plugin checks. The `amd64` binary did not run.
Compilation does not validate Bun, 1Password, or service operation on Intel.

The Bun 1.4.2 tagged source requires macOS 13.0 or later. The tagged release provides Intel x64 assets.
This evidence makes Intel compatibility plausible, not tested.

No source claims Intel testing or support for every macOS release. No preserved result shows an Intel runtime failure.
These facts reject the disputed false-claim premise.

## Minimum mitigation

No mandatory code mitigation follows from C20. Add this small tested-platform statement near `README.md:11`:

> Tested on macOS 26.7 on Apple Silicon. Intel macOS is not tested. Bun 1.4.2 requires macOS 13 or later.

Do not state that Walleterm supports all macOS 13 systems. Other required tools can impose a higher floor.
An Intel CI job can support an affirmative Intel claim. It must execute installation, offline tests, and service startup checks.

## Exact checks

| Check | Status | Outcome and evidence |
| --- | --- | --- |
| Six key source hashes | passed | Matched `manifest.json`. |
| Platform claim search | passed | No Intel or release support statement exists. |
| `uname -m; sw_vers` | passed | Host is macOS `26.7`, `arm64`. |
| Existing `darwin/arm64` execution | passed | `checks/08-product-astra/platform-builds.json` |
| Existing `darwin/amd64` compile | passed | Compile only; the binary did not run. |
| `macos-15` architecture | passed | Official GitHub source states `arm64`. |
| Bun 1.4.2 platforms | passed | Tagged source states macOS 13 and x64 availability. |
| Central baseline | supplied_passed | I did not repeat the full suite. |
| Intel and older macOS runtime | not_run | No hardware or authorized virtual machine was available. |
| Live 1Password and services | not_run | The assignment prohibited these actions. |

I used `rg -n`, `nl -ba`, `jq`, and `shasum -a 256`. I added no test because existing evidence was decisive.

## Primary sources, cost, and limits

- [Bun 1.4.2 installation source](https://raw.githubusercontent.com/oven-sh/bun/bun-v1.4.2/docs/installation.mdx), accessed 2026-09-27.
- [Bun 1.4.2 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2), accessed 2026-09-27.
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), accessed 2026-09-27.

The source summary is `research/concerns/c20-daybreak/primary-platform-sources.md`.
New visible research cost: `$0.00`. New Jev cost: `$0.00`. The web provider returned no monetary charge data.
I did not call Raven, Jev, Parallel, Perplexity, or deep research.

I did not test a real Intel Mac or macOS 13 through macOS 25.
I did not derive a product floor from every required tool. These limits prevent an affirmative support statement.
