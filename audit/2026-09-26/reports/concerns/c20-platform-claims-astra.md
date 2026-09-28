# C20 — Platform support wording

## Identity and scope

- Requested reviewer: Astra, xhigh. The session provides no independent model or effort attestation.
- Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Source: `/private/tmp/walleterm-audit-40d6cca9db73`. Review completed: 2026-09-27.
- Scope: platform promises, platform guards, installer prerequisites, pinned tools, CI architecture, and preserved platform checks.
- I read both original `08-product-*` reports. I did not read the paired C20 report or delegate.

## Verdict

**Accepted limit. The allegation of a false platform promise is unsupported.**
Confidence: high for the wording assessment. No confirmed defect or material feature gap exists within C20.
Priority: optional P3 documentation improvement; no release blocker.
Potentially affected readers use Intel Macs or older macOS releases and need compatibility information before installation.
The evidence demonstrates no runtime failure for those users. Their runtime coverage remains unverified.

## Evidence and reachable scenario

| Source | Consequential behavior |
| --- | --- |
| `README.md:3`, `README.md:11`, `docs/PLAN.md:8` | The project targets macOS and requires prerequisite tools. It promises no specific macOS floor or Intel runtime coverage. |
| `main.go:51-58`, `main.go:126-128` | The signer selects the macOS socket and rejects an unavailable platform path. These checks establish no release floor. |
| `service.go:56-67`, `service.go:105-125` | The tunnel requires macOS and checks Bun `>=1.4.2`. The checks establish no Intel runtime certification. |
| `Makefile:13-14`, `scripts/install.ts:31-35`, `scripts/install.ts:72-87` | Installation needs Bun and Go before it completes the staged release. Dependency availability constrains installation. |
| `go.mod:3`, `package.json:5-6`, `.github/workflows/test.yml:15-27` | Go declares `1.22`. CI pins Go `1.27.1`, Bun `1.4.2`, Rust `1.93.0`, and Stellar CLI `28.0.0`. |
| `.github/workflows/test.yml:10`, `.github/workflows/test.yml:23-26` | One runner label selects one architecture. The two archive branches do not create two runtime jobs. |

An Intel or older-macOS reader can follow the installation instructions without finding a tested-platform statement.
This omission creates uncertainty. It does not demonstrate a broken supported installation or a false compatibility claim.
The independent demo's missing macOS guard does not promise support for another signing platform: `service.go:56`, `docs/INTERFACE.md:37`.

## Counterevidence and exact checks

Paths below use the `audit/2026-09-26/` root.

| Check | Outcome and evidence |
| --- | --- |
| `python3 audit/2026-09-26/checks/concerns/c20-astra/check.py` | **passed**, exit 0. All 199 files match both manifest SHA-256 values and baseline Git blobs. |
| Source trace and preserved-record assertions | **passed**. See `checks/concerns/c20-astra/source-excerpts.txt` and `results.json`. |
| Prior Go architecture builds | **passed**, reused. `checks/08-product-astra/platform-builds.json` records arm64 and amd64 compilation. |
| Prior arm64 execution | **passed**, reused. The same record contains successful help and Stellar plugin version checks. |
| Intel runtime and older macOS execution | **not_run** in this review. The inspected records establish neither. |
| New builds, runtime tests, hosted CI, and live actions | **not_run**. Additional local execution cannot establish the missing hardware or release coverage. |

The original reviewer explicitly separated amd64 compilation from execution. No evidence shows a hidden Intel runtime claim.
`checks/08-product-daybreak/tool-versions.json` records macOS `26.7`, build `25G229`, arm64, Go `1.27.1`, and Bun `1.4.2`.
I inspected existing checks before deciding that C20 needs no new runtime test.
`checks/concerns/c20-astra/commands.md` records exact commands and evidence provenance.

## Minimum mitigation and verification

No runtime mitigation is required. Optionally add this small statement near the README prerequisites:

> The 2026-09-26 local checks used macOS 26.7 arm64, Go 1.27.1, and Bun 1.4.2.
> The Intel Go binary compiled. Intel runtime and older macOS releases remain unverified.

Keeping the current macOS-first wording is also reasonable. A support matrix or new platform guard adds unnecessary scope.
Verify the proposed statement against the two preserved check files above before publication.
Before adding an operating-system floor, obtain primary evidence for the exact dependency versions and test that floor separately.
Before claiming Intel runtime coverage, run the supported offline workflow on Intel hardware and record its environment.
Keep live 1Password acceptance separate and require its existing authorization.

## Primary evidence, costs, and limits

The original reviewers accessed these primary sources on 2026-09-26. This review reused their preserved evidence.
The [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) maps `macos-15` to arm64 in the preserved runner note.
See `research/08-product-daybreak/github-runner-source.md`. That note establishes the recorded mapping, not successful CI execution.
The [Bun installation page](https://bun.com/docs/installation) supplies rolling platform requirements, not version-specific evidence for the entire installed product.
See `research/08-product-daybreak/parallel-cli-bun-install-platforms.json`. This report therefore asserts no minimum macOS release.
I discovered the available research tools and read the required Jev and Parallel skill files. No unresolved fact required another query.
New research cost: **$0 total; $0 Jev**. New provider calls: **0**. Earlier unreported provider charges remain unknown.
Blockers: none for C20. No additional allocation is needed. This review changed no production source, dependency, configuration, or Git state.
