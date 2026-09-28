# Sol remediation contract

You are one sequential worker for the coordinator. Do not delegate or control Herdr.
Read AGENTS.md, docs/PLAN.md, your concern brief, and the named current source first.
Read docs/INTERFACE.md for CLI changes and docs/OPENZEPPELIN.md for relevant fixture changes.
The original audit is audit/2026-09-26. Its source baseline is historical.
Use the current repository for implementation. Earlier accepted changes can already be present.

First assess viability, accuracy, usefulness, and the minimum correction.
Implement only when the fix remains obvious, narrow, and consistent with the accepted product boundaries.
If a policy choice, larger design, or uncertain benefit remains, return deferred with the reason.
Do not expand the task to nearby findings or optional features.

Edit only the paths assigned in your brief. Preserve all other work and the original audit.
The existing interception.md change belongs to other work. Do not alter it.
Do not change tsconfig.json to hide ignored Pagebook captures.
Do not commit, push, deploy, install into the real prefix, or start a public tunnel.
Do not read credentials, private-key fields, or live 1Password state.
Do not sign or submit live transactions. Mock keys remain isolated and unfunded.

Use existing test patterns. Add focused regressions for changed runtime behavior.
Do not add tests that only repeat documentation or implementation spelling.
Use temporary directories for standalone probes. Do not leave runnable probes inside audit/.
Run the affected tests and formatting checks. Do not repeat broad suites without a new reason.
Record any environment failure separately from a product failure.
The sandbox blocks local listeners here. Use permitted execution for tests that require loopback listeners.
TypeScript 7 requires `--ignoreConfig` when a focused command supplies source filenames directly.
The coordinator runs combined verification after the sequential changes.

Preserve unknown-result semantics, original transaction identity, and the ban on automatic signing retries.
The website intentionally approves supported testnet requests by sending them.
The raw digest signer cannot inspect transaction meaning. Do not redesign these accepted boundaries.

## Research

The user requested parallel-cli and Stellar Raven MCP for unresolved questions.
Reuse primary evidence under audit/2026-09-26/research when it already decides the question.
Discover Raven operations through its search tool before calling execute.
Read /Users/kalepail/.agents/skills/parallel-web-search/SKILL.md before using parallel-cli.
Check installed CLI help. Save any new evidence only under your assigned research directory.
Use public technical questions. Do not transmit private code or credentials.
Allow at most $2 of new metered research for this worker. Never buy credits or subscriptions.
No deep-research processors or Jev calls are needed for this pass.
If research does not make the correction clear, defer it.

## Completion

Return a compact result with: implemented or deferred, viability reasoning, changed files, exact tests, and remaining limits.
Keep sentences short and technical names exact.
Stop after the assigned concern has a justified outcome.
