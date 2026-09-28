# C05 Astra source reuse

Review date: 2026-09-26. New provider calls: 0. New provider charges: $0.
The follow-up allocation was $1, including at most $0.25 for Jev. Neither allocation was used.

## Implementation evidence

Baseline: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.
Source root: `/private/tmp/walleterm-audit-40d6cca9db73`.
`checks/concerns/c05-astra/source-identity.json` records independent byte comparisons for seven relevant source files.
The installed package declares `@stellar/stellar-sdk` 17.1.0. The checks ran Bun 1.4.2.
No external documentation overrides the frozen implementation or its protocol.

## Browser source

- URL: https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
- Title: Window: sessionStorage property.
- Version: unversioned browser documentation.
- Original access date: 2026-09-26.
- Retained text: `research/04-sdk-astra/parallel-mcp.json`.
- Applicability: a page with an opener initially receives a copy of the opener's session storage.
- Limit: the storage areas remain separate. Ordinary independent tabs need not share a token.
- Test limit: the reproduction copies the capability explicitly; it does not exercise browser storage behavior.

The retained documentation and frozen restoration code resolve the required reachability question.
The race also applies whenever two authorized client instances share the same session token.

## Research tool availability

Session discovery exposed these MCP tools:

- `mcp__stellar_raven__search` and `mcp__stellar_raven__execute`.
- `mcp__parallel_search__web_search_preview` and `mcp__parallel_search__web_fetch`.
- `mcp__perplexity__perplexity_search`, plus its ask, reason, and research tools.

Jev and `parallel-cli` remained authorized through COMMON. This review did not invoke or check either CLI.
No unresolved external question justified another provider request or CLI setup.
Earlier provider charges belong to the original reviews. This follow-up incurred no provider charge or unknown charge.
