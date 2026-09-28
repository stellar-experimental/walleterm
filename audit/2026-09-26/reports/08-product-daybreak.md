# 08 Product audit — Daybreak

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Result

I found no confirmed defect. I found one P3 unresolved concern about supported macOS versions and architectures. I found no material feature gap.

## Review identity

| Item | Value |
| --- | --- |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Model and effort | Daybreak xhigh, as requested |
| Runtime metadata | The session exposed no independent model metadata. |
| Review date | 2026-09-26 |
| Independence | I read no other area report or coordinator `FEATURES.md` before this report. |
| Delegation | None |

## Coverage

I first read the four required documents. I then read all 24 files under `docs/*.md`.
I read both agent-skill trees and all installation or build scripts.
I reviewed `Makefile`, lockfiles, manifests, compiler settings, CI, configuration, and platform gates.

The link check covered 41 Markdown files and 89 local links. No local link was missing.

## Corrected non-issue

### The CAP-85 cleanup removes ignored test outputs

I initially classified `fixtures/cap85/build.sh:15` as a P2 defect. That classification was wrong, and I withdraw it.

`git ls-tree` found 199 baseline files and zero `test_snapshots` files. The audit manifest also contains zero snapshot entries.
`.gitignore:27` ignores `**/test_snapshots/`.

Native coordinator tests generated the 16 CAP-85 JSON files. Their frozen-directory presence did not show source-control ownership.

The Soroban SDK writes snapshots after tests involving `Env`. Each snapshot contains published events and final ledger storage.
Snapshots support differential review when a project commits and compares them.

This project does not commit these generated files. The build cleanup removes ignored outputs, not a committed regression baseline.
I found no product defect in this cleanup.

Evidence: `checks/tracked-snapshot-check.json`, `checks/08-product-daybreak/build-script-cleanup.json`, and `research/08-product-daybreak/soroban-test-snapshot-semantics.md`.

## Unresolved concern

### P3 — The supported macOS floor and Intel status are unclear

Confidence: medium.

`README.md:1-8` requires macOS and Bun `1.4.2` or later. It states no minimum macOS version or tested architecture.

`main.go:51-58` and `main.go:126-128` restrict `list` and `sign` to macOS. `service.go:44-58` restricts `tunnel` to macOS.
The `demo` command has no equivalent platform gate.

Current Bun documentation requires macOS 13 or later. Bun publishes Apple Silicon and Intel binaries.
The installer requires Bun before release switching.

CI uses `macos-15`, which GitHub currently maps to an arm64 M1 runner. No Intel job verifies the x86 runtime.

Agents cannot learn the supported macOS floor from project documentation. They cannot distinguish supported Intel use from plausible unverified use.

Both Apple archive hashes are valid. Go and Bun support both Apple architectures.
The project promises macOS first, not every macOS release.

State the supported macOS floor and tested architecture in `README.md`. Call Intel `not_tested` until a separate runner verifies it.

## Installation, build, and dependency assessment

`scripts/install.ts` builds a unique staged release before changing command links. It removes development dependencies before installation.
It replaces each link through a temporary symlink and atomic rename.

The isolated install created release `0965f1efb3262a6032f9dd7f`. All 49 manifest files existed, and all relative imports resolved.
No staging directory remained.

The release contained 71 production packages and all three direct runtime packages. No direct development package remained.
Two focused installer tests passed, including old-command preservation after failure.

The alias returned `walleterm 0.1.0` through Stellar CLI `28.0.0`. This result matches the official `stellar-` plugin rule.

`scripts/build.ts` produced the expected artifacts. `fixtures/build.sh` showed no material product issue.
I did not run the CAP-85 cleanup command.

| Tool | Installed version |
| --- | --- |
| macOS | `26.7`, build `25G229`, arm64 |
| Go | `1.27.1` |
| Bun | `1.4.2` |
| Stellar CLI | `28.0.0`, commit `300aaf...` |
| stellar-xdr | `28.0.0`, commit `d0f133...` |
| cloudflared | `2026.9.3` |
| 1Password CLI | `2.39.0` |
| Rust and Cargo | `1.93.0` |
| cargo-audit | `0.22.1` |

`go.mod` declares Go `1.22` and no third-party module. `package.json` contains three runtime dependencies and six development dependencies.
All direct versions are exact. `bun.lock` pins each transitive package with an integrity value.

The npm advisory API returned no advisory. OSV returned no advisory for 101 exact locked npm versions.
`MAL-2026-2307` affects two other `axios` versions. It does not affect the locked `axios@1.20.0`.

RustSec found no vulnerability in four Cargo lockfiles. It reported unmaintained `paste@1.0.15` only in fixture graphs.
This informational warning does not affect the installed runtime.

## CI, configuration, and agent workflows

CI pins all three actions to verified release commits. It pins Go, Bun, Rust, and Stellar CLI versions.
Both Apple archive hashes matched official metadata. CI uses the frozen Bun lockfile and disables dependency scripts.
It runs formatting, Go tests, Go vet, TypeScript, Bun tests, and contract tests.

The `Makefile` composes focused checks without hidden installation or publication. The Bun and TypeScript settings match documented runtime boundaries.

The direct skill separates review, digest creation, signing, assembly, and submission. It covers every documented signing workflow.

The site skill separates the public service from manual interception. It states testnet limits and the missing terminal approval step.
It preserves unknown signing and submission outcomes.

Both skills require installed-command discovery before versioned procedures. Both keep private keys inside 1Password.
Both distinguish a signature from ledger acceptance. The supported agent workflows are complete for the stated purpose.

## Accepted limits and feature opportunity

- Digest signing cannot inspect a transaction. This limit matches the interface.
- The public bridge supports three classic testnet operations. This limit is explicit.
- Passkeys remain deferred. They do not block the Ed25519 purpose.
- Mainnet service use remains unsupported. The documentation does not claim it.
- Quick Tunnels use temporary URLs. The service explains recovery behavior.
- The npm package remains private. No package publication is promised.

A read-only `doctor --json` command could improve agent setup checks. It could report the installed tool versions.
This command is not required for acceptance.

## Checks

| Check | Status | Result |
| --- | --- | --- |
| Isolated production install | passed | Complete temporary release; no real home installation |
| Manifest and imports | passed | 49 files; zero missing imports |
| Installer failure handling | passed | 2 tests; 0 failures |
| Stellar plugin alias | passed | Returned `walleterm 0.1.0` |
| Documentation links | passed | 41 files; 89 links; zero missing |
| Build script syntax | passed | Both scripts parsed |
| CAP-85 snapshot classification | passed | Zero tracked files; 16 ignored outputs |
| npm, OSV, and RustSec | passed | Zero applicable vulnerabilities |
| CI pins and archives | passed | All checked commits and hashes matched |
| Central suites | not_run | The coordinator reported the permitted baseline as passed |
| Live actions | not_run | The task prohibited services, keys, signing, and submission |
| Go vulnerability scanner | not_run | `govulncheck` was unavailable |

All meaningful commands appear in `checks/08-product-daybreak/commands.md`.

## Research usage

Stellar Raven MCP returned official CLI and snapshot documentation. Jev ran two bounded searches after its required checks.
Both Jev searches failed during transport and returned no source text. The visible Jev cost was `$0.017459`.

Parallel CLI returned ten official Bun results with one visible search SKU. Parallel Search MCP returned official 1Password sources.
Perplexity supplied an advisory candidate that direct OSV evidence rejected. Research artifacts are under `research/08-product-daybreak/`.
Other provider charges remain unknown.

Primary sources include:

- [Stellar CLI plugins](https://developers.stellar.org/docs/tools/cli/plugins)
- [Stellar test snapshots](https://developers.stellar.org/docs/build/guides/testing/differential-tests-with-test-snapshots)
- [Bun installation](https://bun.com/docs/installation)
- [Bun package installation](https://bun.com/docs/pm/cli/install)
- [1Password SSH agent](https://www.1password.dev/ssh/agent)
- [1Password CLI setup](https://www.1password.dev/cli/get-started)
- [GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Stellar CLI v28.0.0](https://github.com/stellar/stellar-cli/releases/tag/v28.0.0)
- [OSV `MAL-2026-2307`](https://osv.dev/vulnerability/MAL-2026-2307)
- [RustSec `RUSTSEC-2024-0436`](https://rustsec.org/advisories/RUSTSEC-2024-0436.html)

I accessed all listed sources on 2026-09-26.

## Limits

The frozen snapshot has no Git metadata. I verified the baseline through the workspace Git tree and audit manifest.
I changed no source or skill link. I started no service and accessed no key. I created no signature or submission.
