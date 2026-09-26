# Independent skill review

Reviewed on 2026-09-26 with skill-creator and ai-tools.
The reviewed checkout ended at `f159ddc9e8f0e78a06948161c9c3911a8ac559a8`.
Its skill revision is `e6bf9f4`. Later copy-button changes do not change the signing or installation contracts reviewed here.

## Assessment

No material skill defect remains in the reviewed source.
The skills use the same useful construction pattern as Herdr.
They direct command discovery to the installed CLI and keep conditional details in bundled references.
Their scope descriptions separate direct signing, tunnel integration, and manual interception.
Their coverage fits the supported product without requiring unrelated research or a complete contract audit for ordinary payments.

The direct signing skill preserves the raw 32-byte digest boundary and independent signature verification.
It requires complete artifact and authorization-tree review before signing.
Its references distinguish classic envelopes, fee bumps, native auth, OpenZeppelin auth, CAP-71, and CAP-85 code trust.
The acceptance reference states its tested versions, dates, exclusions, and observational results.

The website skill matches the current bridge, SDK, and manual helpers.
It states that the public tunnel has no terminal transaction-approval step.
It preserves the supported transaction limits, wallet grants, selection revisions, cancellation limits, and unknown-result recovery.
It correctly states that a sell offer can trade immediately.
Its manual helpers verify the selected signer, exact transaction hash, preserved body, and existing signatures before returning XDR.

No further Walleterm skill edit is warranted by this review.

## Independent checks

- Both source skills and their temporary copies passed the skill validator.
- Every relative Markdown link resolved inside an unrelated temporary copy.
- Canonical, Claude Code, and Codex source links resolved to the current complete skill trees.
- OpenCode, Grok, and Codex discovered both current descriptions from outside the project.
- OpenCode loaded the current skill bodies.
- `npx skills ls -g` listed both skills at global scope.
- Both archived Desktop upload packages matched their current source files byte for byte.
- Claude Desktop showed both account skills at `v1` with `Enable skill: on`.
- `bun test tests/site-bridge.test.ts bridge/server.test.ts bridge/vault.test.ts` passed: 52 tests, zero failures.
- `go test ./...` passed using the Go test cache.

The focused tests exercised isolated mock signing, vault filtering, signature verification, request binding, wallet switching, cancellation, and recovery.
They did not request a live 1Password signature or submit a Stellar transaction.
This review does not claim new live testnet or camera acceptance.
It also does not claim a fresh model-based forward test of each prose branch.

## Installation limits

Local source links update when source files change. Desktop account uploads remain snapshots.
The skills require the documented execution tools; installation alone does not provide the Mac's 1Password socket to cloud execution.
The local `npx skills` listing does not provide remote update tracking for these source links.

## Jev follow-up

The companion review found an incorrect zero-spend statement in Jev's CLI help.
The corrected help states that routing can spend before a busy response.
All seven Jev CLI integration tests passed. The installed binary now contains the corrected help.
The Jev account skill also completed its separate Desktop upload and showed `Enable skill: on`.
No browser permission change was needed for the native application upload.
