# C06 research usage

Date: `2026-09-26`.
Allocation: `$1` total, including at most `$0.25` for Jev.
New provider requests: zero. New research charges: `$0`. Jev charges: `$0`.

The review reused the preserved browser API evidence and source probes.
No unresolved source question required another paid search.
The late-pairing question required a local execution check, not additional research.

Tool discovery found Stellar Raven MCP, Parallel Search MCP, and Perplexity MCP.
The review did not call those providers or invoke Jev or parallel-cli.
Thus, no new provider failure, partial result, or unknown charge occurred.
Historical provider charges belong to the original reviews and remain unchanged.

## Reused source

- URL: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Version: unversioned Mozilla browser API documentation.
- Original access date: `2026-09-26`.
- Retained text: `research/04-sdk-astra/parallel-cli.json`, matching URL entry.
- Supporting index: `research/04-sdk-astra/SOURCES.md`.
- Applicability: secure context, permission, and pending camera acquisition in `sdk/scan.ts:37,72–82`.
- Limit: API documentation does not establish the frequency of component destruction in deployed sites.

The frozen source and local mocks establish the missing cancellation and late connection commit.
The review did not treat earlier research summaries as new browser execution evidence.
