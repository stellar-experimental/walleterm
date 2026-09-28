# Command record

The review used `/private/tmp/walleterm-audit-40d6cca9db73` as the frozen source.
It wrote only the assigned audit paths and temporary prefixes.

## Inspection

- `rg --files --hidden -g '!audit/**' -g '!.git/**' SNAPSHOT`
  - Result: inventoried source, configuration, documents, skills, fixtures, and CI.
- `nl -ba FILE` and `sed -n RANGE FILE`
  - Result: read all 24 `docs/*.md` files and both skill trees.
- `rg -n PATTERN FILES`
  - Result: traced versions, lock entries, platform gates, and workflow promises.
- `diff -qr SNAPSHOT/dist RELEASE/dist`
  - Result: fresh chunk names differed. All installed import targets resolved.

## Installed tools

- `uname -a`, `sw_vers`, and tool `--version` commands
  - Result: see `tool-versions.json`.
- `stellar-raven-jev --help`, `search --help`, `doctor`, and `usage --help`
  - Result: configuration was ready. Remote authentication remained unchecked before use.
- `parallel-cli --help` and `parallel-cli search --help`
  - Result: version `0.9.3` supported the required saved JSON search.

## Installation

- `make install PREFIX=/private/tmp/walleterm-product-daybreak-prefix`
  - Result: passed with Bun `1.4.2`; release `0965f1efb3262a6032f9dd7f` installed.
- `bun .../install-evidence.ts PREFIX .../install-evidence.json`
  - Result: 49 manifest files existed. No staging directory remained.
  - Result: 71 production packages existed. No direct development package remained.
  - Result: all generated relative imports resolved.
- `bun test scripts/install.test.ts`
  - Result: two tests passed. Failure preserved the prior command.
- `walleterm --version`, `--help`, `tunnel --help`, and `demo --help`
  - Result: passed without starting a service.
- `stellar walleterm --version` with the temporary prefix first on `PATH`
  - Result: returned `walleterm 0.1.0`.
- `go version -m RELEASE/bin/walleterm`
  - Result: Go `1.27.1`, `darwin/arm64`, and no third-party Go module.

## Documents and skills

- `bun .../doc-links.ts SNAPSHOT .../doc-links.json`
  - Result: checked 41 Markdown files and 89 local links. No link was missing.
- No skill installation command ran.
  - Result: no skill link changed.

## Build scripts

- `sh -n fixtures/build.sh`
  - Result: passed.
- `sh -n fixtures/cap85/build.sh`
  - Result: passed.
- `find fixtures/cap85/... -type d -name test_snapshots -print`
  - Result: found five directories containing 16 generated snapshot files.
- The cleanup command did not run.

### Snapshot classification correction

- `git ls-tree -r --name-only 40d6cca9db732a0db16d154c80d4a153bf33c6b7`
  - Result: found 199 tracked files and zero `test_snapshots` files.
- `jq` inspection of `audit/2026-09-26/manifest.json`
  - Result: found 199 source entries and zero `test_snapshots` entries.
- `git show 40d6cca9db73:.gitignore` and `git check-ignore -v`
  - Result: `**/test_snapshots/` ignores generated snapshot directories.
- Stellar Raven MCP and official Stellar documentation review
  - Result: native tests generate snapshots after tests involving `Env`.
  - Result: snapshots become differential baselines when a project commits and diffs them.
- The earlier P2 classification was wrong and is withdrawn.
  - Result: CAP-85 cleanup removes ignored generated outputs, not tracked source.

## Dependencies and advisories

- `bun audit --json`
  - Result: `{}` from the npm advisory API.
- `bun .../osv-query.ts bun.lock .../osv-lock-querybatch.json`
  - Result: OSV returned no advisories for 101 exact locked npm versions.
- `curl ... api.osv.dev/v1/query` for `axios@1.20.0`
  - Result: `{}`.
- `curl ... api.osv.dev/v1/vulns/MAL-2026-2307`
  - Result: only `axios` versions `0.30.4` and `1.14.1` were affected.
- `cargo audit -d /private/tmp/walleterm-product-daybreak-rustsec-db -f LOCK --json`
  - Result: four Cargo locks had zero vulnerabilities.
  - Result: all four reported `RUSTSEC-2024-0436` for unmaintained `paste@1.0.15`.
- `govulncheck -version`
  - Result: command unavailable. The Go module has no third-party dependencies.

## CI verification

- `git ls-remote OFFICIAL_REPOSITORY refs/tags/VERSION`
  - Result: all three workflow action SHAs matched their official tags.
- `gh api repos/stellar/stellar-cli/releases/tags/v28.0.0`
  - Result: both Apple archive digests matched the workflow.
- GitHub-hosted runner documentation lookup
  - Result: current `macos-15` is an arm64 M1 runner.

## Research

- Stellar Raven MCP official documentation search
  - Result: official plugin, signing, and platform sources returned.
- `stellar-raven-jev search` with two bounded questions
  - Result: both failed during Jev transport. No source text returned.
  - Result: combined visible Jev cost was `$0.017459`.
- `parallel-cli search ... -o parallel-cli-bun-install-platforms.json`
  - Result: passed with one search SKU and no warning.
- Parallel Search MCP official 1Password query
  - Result: passed with one search SKU.
- Perplexity MCP dependency challenge
  - Result: found one candidate. Direct OSV evidence rejected its applicability.
