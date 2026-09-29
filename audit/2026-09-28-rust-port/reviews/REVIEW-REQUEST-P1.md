# Review request: Phase 1, commit 1660f97

Opus accepted ASTRA-PLAN-v2 with two process notes:

1. Phase 1 is one commit, not two. It holds the pure core for all three adapters, SEP-43 preimages, and transactions.
   The pure functions share parsing code, so a split added no review value. Review them together.
2. Phase 0 transcripts: the XDR-level vectors are frozen now (fixtures/parity/vectors.json, 81 cases from the TS sources at 52a7fc3).
   The CLI JSON / raw SSH frame transcripts will be frozen at the start of Phase 2, from the Go tests' mock agent, before any Rust signer code.
   The HTTP lifecycle traces will be frozen at the start of Phase 3.

Review the commit (`git show 1660f97`) as a security reviewer. Focus on:

- Digest construction for all three adapters and the SEP-43 preimage path.
- Exact artifact mutation: only the credential signature changes; one DecoratedSignature appended to the outer envelope.
- Canonical decoding (`src/stellar.rs`): strict Base64, full-buffer consumption, re-encode equality, the lenient path that only classifies NonCanonical vs Invalid, and XDR_DEPTH = 500 (measured: release < 256 KiB stack, debug ~1 MiB).
- JSON-loose field handling in `AuthEntryInput::from_json` and `json_u32` (JS Number.isInteger parity).
- Error codes and messages versus the TS sources.
- Anything the vectors miss. Name the missing case precisely.
- Whether the recorded differences in fixtures/parity/README.md are acceptable.

Write `_migration/REVIEW-P1.md` with findings ranked by severity (blocker / should-fix / note), each with file:line and a concrete failing input where possible.
Do not edit tracked files. Reply with only the review path and a one-word verdict (ACCEPT / CHANGES).
