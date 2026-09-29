# Rust port record (2026-09-28)

This record covers the port of walleterm to one Rust binary: [#33](https://github.com/stellar-experimental/walleterm/pull/33), merged as `dd8dfe2`.
It keeps the plan, the independent reviews, the test reports, and the final measurements.
The base was `52a7fc3`. The branch history, with every reviewed commit, is on #33.

## Roles

- **Planner and reviewer:** Astra (Codex, xhigh). It wrote the plan and reviewed each phase in detached checkouts.
- **Implementer:** Opus (Claude Code). It reviewed the plan, wrote the code, and fixed each finding with a regression test.
- **Test agent:** a separate Opus session. It ran the full matrix on each phase commit, and proved that each new test fails on the older code.
- All work used mock keys and mock external programs. No test used 1Password, a real tunnel, testnet, codesign, or notarization.

## Contents

| Path | What it holds |
| --- | --- |
| [plan/PLAN.md](plan/PLAN.md) | The accepted migration plan (Astra, version 2), with phases 0 to 8 and acceptance checks |
| [plan/OPUS-REVIEW-1.md](plan/OPUS-REVIEW-1.md) | The implementer's review of the first plan draft |
| `plan/*.json`, `plan/*.tsv`, `plan/inventory-active-v2.md` | File inventory, dependency evidence, the browser-test split, and plan validation |
| `plan/BRIEF.md`, `plan/TESTER-BRIEF.md` | The briefs for the reviewer and the test agent |
| `reviews/REVIEW-REQUEST-*.md` | What each review covered, and the implementer's notes |
| `reviews/REVIEW-*.md` | Astra's reviews: findings, evidence summaries, and verdicts |
| `tests/phase-*.md`, `tests/final.md` | The test agent's reports, with its small check scripts |
| [MEASUREMENTS.md](MEASUREMENTS.md) | Size, start time, memory, dependencies, source lines, and test counts against the base |
| `evidence/gen-vectors.ts.txt` | The producer of `fixtures/parity/vectors.json` (it imported the removed TS bridge, so it is stored as text) |

## Review outcome

| Phase | Scope | Verdict |
| --- | --- | --- |
| 1 | Signing core and frozen vectors | Changes, then accepted |
| 2 | Native CLI signer | Changes, then accepted |
| 3 | Bridge protocol v3 | Four findings (`.env` vault filter, shutdown races, late selection, vault cleanup), fixed and accepted |
| 4 to 6 | Tunnel, embedded demo, maintainer tools | Six findings, fixed and accepted |
| 7 | Removal of Go and the TS hosts | Three findings, then one regression in the fix, fixed and accepted |
| 8 | Art generator in Rust | Accepted, then reverted before merge; the generator stays TypeScript (see #33) |

## Limits of this record

- The reviews link to evidence under `/private/tmp` on the maintainer's Mac. That evidence is not kept here.
- The test agent's logs and the baseline package binaries are not kept here, because of their size.
- A regression escaped all of these checks: `walleterm tunnel` readiness failed on a real network, because the macOS resolver cached the first NXDOMAIN answer for the new tunnel name. Every tunnel test used a mock probe. The fix is in `fix/tunnel-dns-readiness`.
