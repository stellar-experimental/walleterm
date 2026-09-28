# 08-product independent audit

<!-- coordinator-area-status -->
> Initial area review. The [concern register](../CONCERNS.md) records later paired decisions and coordinator reconciliation.
> Focused reviews can narrow or reject an initial finding.

## Scope and conclusion

- Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
- Frozen source: `/private/tmp/walleterm-audit-40d6cca9db73`.
- Reviewer: Astra; requested reasoning effort: xhigh. Date: 2026-09-26.
- Confirmed findings: **1 Low**. Unresolved material concerns: **0**.
- No significant capability gap or reachable dependency vulnerability was confirmed within the checked scope.
- I read neither another current area report nor the coordinator's `FEATURES.md`.
- I used no delegates, real installation prefixes, real skill-link changes, keys, signatures, submissions, or public services.

All source locations refer to the frozen tree.
`checks/08-product-astra/frozen-source.json` confirms all 199 tracked files match the requested revision.

## Code and document coverage

| Area | Reviewed material and trace |
| --- | --- |
| Installation | All `scripts/*`; staging, dependency installation, asset building, release naming, command links, and cleanup. |
| Build/configuration | `Makefile`, `package.json`, `bun.lock`, `go.mod`, both `tsconfig*`, `bunfig.toml`, formatting files, and `.gitignore`. |
| CI | Entire `.github/workflows/test.yml`; action pins, tool versions, architecture selection, checksum verification, and offline checks. |
| Platform | `main.go`, `service.go`; macOS socket selection, Bun checks, executable resolution, and service dispatch. |
| Dependencies | All 101 Bun lock entries and 235 distinct registry package versions across four Cargo lockfiles. |
| Fixtures | Both fixture build scripts, manifest generators, workspace manifests, fixture documentation, and artifact metadata. |
| Product documents | All 45 Markdown files, including every `docs/*`, root rules, protocol, fixture guides, and evidence documentation. |
| Direct skill | Complete `walleterm` skill and six references: classic, fee-bump, OpenZeppelin, delegation, code trust, and acceptance. |
| Website skill | Complete `walleterm-site-bridge` skill, metadata, four references, and three helper scripts. |
| Consequential paths | SDK distribution imports, bridge transaction parsing, demo asset serving, and browser network ownership. |

The complete document list and hashes are in `checks/08-product-astra/document-inventory.json`.
Dependency inventories are `npm-inventory.json` and `cargo-inventory.json` in the same check directory.
All installed package versions present in the inspected dependency tree matched their frozen lock entries.

## Finding F1 — Low: The connection guide omits required shared build files

**Confidence:** High.
**Location:** `docs/CONNECTION-UI.md:19-20`.
Related implementation: `scripts/build.ts:8-22`, `sdk/scan.ts:69`, and `demo/server.ts:31-33`.

**Scenario:** An integrator follows the connection guide and copies only the generated SDK directory.
The guide says to serve SDK files together and supply `jsqr.js`.
The current build instead emits shared files above `dist/sdk`.
The generated `connect.js` imports `../chunk-zx43w6gh.js`.
Other client and scanner imports require shared files too.
The integrator's deployment therefore cannot load the connection component.

**Impact:** The documented website integration fails before wallet connection.
This does not affect the installed demo or the digest signer.
**Evidence:** `checks/08-product-astra/distribution-probe.py` copied each layout into an unrelated temporary directory.
The SDK-only import failed with a missing shared module.
The complete `dist` import passed.
Exact results are in `checks/08-product-astra/distribution-probe.json`.
**Counterevidence:** `README.md:167-170` already requires `dist/` and `sdk/connect.css`.
The website skill's service reference also requires the complete distribution.
The demo explicitly serves shared files, so its working behavior does not validate the older integration instructions.
**Minimum mitigation:** Replace those two guide sentences with the existing full-distribution instructions.
Preserve the generated directory structure and copy the stylesheet separately.
Remove the obsolete separate `jsqr.js` requirement.
**Verification plan:** Copy files exactly as the revised guide directs.
Import the component and scanner from that copy.
Verify that every static and dynamic import resolves.
No signing or live network check is needed.
## Installation, build, and platform assessment

`scripts/install.ts:68-87` builds inside a unique release stage.
It runs a frozen dependency install, builds browser files, then installs production dependencies without lifecycle scripts.
`scripts/install.ts:88-108` derives a release name and replaces the command link only after preparation.
The relative Stellar alias follows the same command.
The installer retains old releases and removes failed stages.
The two existing installer tests passed.
Additional mock checks injected failures in Go compilation, dependency installation, browser building, and production dependency installation.
All four failures preserved both commands and the old release.
A successful installation under a path containing spaces passed.
A repeated identical installation reused its release.
These checks did not exercise machine crashes or concurrent filesystem mutations.
`service.go:74-102` resolves the installed executable before selecting its adjacent service files.
It passes that resolved binary to the bridge through `WALLETERM_BINARY`.
This supports the documented separation between an installed release and its source checkout.
The installer excludes caller `.env` files; the service retains the caller directory for documented Bun configuration loading.
`Makefile:15-45` checks skill destinations before creating source links.
It rejects conflicting files and links.
I reviewed that target without running it.
The core deliberately supports macOS; `main.go:51-58` selects only the fixed 1Password socket.
`service.go:54-55` rejects a signing tunnel on other systems.
macOS arm64 and amd64 compilation passed.
The arm64 binary's help and Stellar plugin dispatch passed from a temporary caller directory.
The amd64 binary was compiled but not executed.
Linux and Windows support are not current product promises.
CI uses read-only repository permission and pinned action commits.
It pins Go 1.27.1, Bun 1.4.2, Rust 1.93.0, and Stellar CLI 28.0.0.
It verifies the downloaded Stellar archive and builds CAP-71 fixtures before `make test`.
I did not rerun central suites, formatting, or the hosted workflow.
## Dependencies and actual advisory applicability

| Dependency | Installed/locked version | Applicability |
| --- | --- | --- |
| Stellar SDK | 17.1.0 | Bridge parsing and verification; browser transaction construction; fixture adapters. |
| Axios | 1.20.0 | Transitive SDK dependency; checked September advisories list 1.20.0 as patched. |
| form-data | 4.0.6 | Outside the affected 4.0.0–4.0.3 range. |
| jsqr / qrcode | 1.4.0 / 1.5.4 | Camera decoding and terminal QR generation; Bun advisory query returned no entries. |
| TypeScript / Bun types | 7.0.2 / 1.4.2 | Build and checking tools, removed from production dependency installation. |
| Twinkleplop | bash/json 0.1.5; core 0.2.2 | Build dependencies bundled into demo highlighting; the installer includes their license. |
| Soroban SDK | 27.0.2, 27.0.6, and 28.0.0, locked | Fixture-only dependencies; absent from the installed signer and bridge release. |
| paste | 1.0.15 | All four Cargo locks include this unmaintained transitive dependency; no exploit is stated. |

`bun audit --json` returned `{}`, exit 0.
OSV returned one advisory for the 235 Rust package-version queries: `RUSTSEC-2024-0436`.
RustSec classifies it as an unmaintained-package notice.
The lockfiles reference `paste` through `ark-ff` and `wasmi_core`.
This fixture notice does not establish a production signing vulnerability. [RustSec](https://rustsec.org/advisories/RUSTSEC-2024-0436.html)

The inspected Axios advisories concern data URLs, proxy handling, or fetch redirects.
Their primary records list 1.20.0 as patched. [Data URLs](https://github.com/axios/axios/security/advisories/GHSA-c29m-xwm3-cm6r), [proxy handling](https://github.com/axios/axios/security/advisories/GHSA-mghh-pgcx-3jjj), [fetch redirects](https://github.com/axios/axios/security/advisories/GHSA-r4gj-5m52-g5wh)
The form-data record fixes the relevant issue at 4.0.4. [Primary advisory](https://github.com/form-data/form-data/security/advisories/GHSA-fjxv-7rqg-78g4)
Additionally, the bridge uses SDK parsing and verification functions, without constructing an SDK network client.
The demo uses browser `fetch` against fixed testnet services.
Package presence alone therefore does not prove those attack paths.
Go has no external module dependencies; this audit did not run a separate Go standard-library advisory scanner.
## Agent workflows, non-issues, and opportunities

The direct skill covers artifact review, digest checking, exact signer selection, output validation, insertion, submission authority, and original-hash recovery.
Its references distinguish envelope signatures, native authorization, OpenZeppelin digests, and delegated authorization.
The website skill correctly separates the automatic testnet bridge from manual request interception.
Both portable skill trees have no missing local Markdown targets.
Ten absent historical screenshot links explicitly refer to local, untracked evidence; they do not break operational skill references.
Cached 1Password approval and digest-only signing are documented limits.
1Password's authorization model permits application-scoped approval reuse. [1Password security](https://developer.1password.com/docs/ssh/agent/security)
Mainnet bridge support, passkeys, permanent services, and universal contract adapters are outside the accepted product scope.
The existing Stellar CLI 28.0.0 help still exposes no external signer option.
The separate hash/encode workflow therefore remains useful. [Stellar CLI manual](https://developers.stellar.org/docs/tools/cli/stellar-cli)

Two small maintenance opportunities remain.
First, `docs/STELLAR-CLI.md:193-199` retains obsolete deferred-coverage wording.
`docs/PROTOCOL-UPDATES.md` and the portable acceptance reference already record the completed delegation coverage.
Link that older section to the later evidence; do not add another authorization framework.
Second, `main.go:28` fixes `--version` at `0.1.0`.
An installed release identifier would help agents match a command to its documentation.
Neither opportunity blocks the supported signing workflow.
## Checks and evidence

Paths below are relative to `audit/2026-09-26/`.
| Check | Outcome | Evidence |
| --- | --- | --- |
| Frozen revision comparison | passed; 199/199 files | `checks/08-product-astra/frozen-source.json` |
| `bun test scripts/install.test.ts` | passed; 2 tests | `checks/08-product-astra/install-baseline.log` |
| `python3 .../install-probe.py` | passed; four failures, success, repeat | `checks/08-product-astra/install-probe.json` |
| `python3 .../distribution-probe.py` | reproduced F1; complete layout passed | `checks/08-product-astra/distribution-probe.json` |
| macOS builds and plugin help | passed; both architectures compiled | `checks/08-product-astra/platform-builds.json` |
| Static document/package checks | passed; no broken skill links | `checks/08-product-astra/static-audit.log` |
| Bun advisory query | passed; no returned entries | `research/08-product-astra/bun-audit.json` |
| Rust advisory query | passed; one informational notice | `research/08-product-astra/osv-matches.json` |
| Live signatures, submission, public services | not_run | Prohibited for this lane. |
| Central Go/Bun/Rust suites and formatting | supplied passed; not repeated | COMMON and the caller's baseline statement. |

`checks/08-product-astra/commands.md` indexes commands, versions, research inputs, outcomes, and evidence files.

## Research sources, cost, and limits

All primary sources above were accessed on 2026-09-26.
`research/08-product-astra/primary-advisories.json` retains five primary advisory excerpts.

| Requested tool | Result and retained evidence | Visible usage |
| --- | --- | --- |
| Stellar Raven MCP | Ran first; official source discovery was adjacent to the CLI question. `raven.json` | Monetary charge unavailable. |
| stellar-raven-jev 0.1.0 | Initial transport failure; retry returned partial source evidence. `jev-compact.json`, `jev-retry-compact.json`, `jev/` | $0.008729397 + $0.018602107 = **$0.027331504**. |
| Parallel Search MCP | 1Password platform and approval sources. `parallel-mcp.json` | 1 `sku_search`; charge unavailable. |
| parallel-cli 0.9.3 | Sandbox connection failed; permitted retry passed. `parallel-cli.json` | 1 successful `sku_search`; charge unavailable. |
| Perplexity MCP | Advisory challenge search. `perplexity.json` | One search; charge unavailable. |
| Parallel extraction | Primary advisory text. `primary-advisories.json` | 5 `sku_extract_excerpts`; charge unavailable. |

The initial advisory search mentioned Axios 1.16.0 before lock inspection.
The successful CLI query and primary-source assessment used the actual 1.20.0 version.
Jev reported partial coverage, including source limits and one fallback.
Its retained CLI text supports hashing; installed CLI help supplies the current command check.
No paid deep-research processor or credit purchase ran.
Visible Jev spend stayed below $1. The lane allocation was $10; other provider totals remain unverified.
No further allocation is needed for this report.
Live acceptance, fresh hosted CI execution, and real installation remain `not_run`.
