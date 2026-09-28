# C10 command evidence

## Reproduce all checks

Working directory: `/Users/kalepail/Desktop/walleterm-v2`.

```sh
python3 audit/2026-09-26/checks/concerns/c10-astra/run-checks.py
```

Result: exit `0`.
The runner checks all 199 manifest hashes before and after testing.
It verifies the SDK version and both hashes from the preserved SDK implementation excerpts.
It writes `results.json` and the two test logs in this directory.

## Exact test commands

Working directory: `/private/tmp/walleterm-audit-40d6cca9db73`.

```sh
bun test /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/05-demo-astra/adversarial.test.ts -t 'fresh signing rejects|normal signed review|normal reload submits'
bun test /Users/kalepail/Desktop/walleterm-v2/audit/2026-09-26/checks/concerns/c10-astra/signed-review.test.ts
```

First command: exit `0`; 3 passed; 0 failed; 10 filtered.
Evidence: `existing-reproductions.log`.
Second command: exit `0`; 1 passed; 0 failed.
Evidence: `signed-review.log`.
The second log records the displayed JSON before signing, after signing, and after reload.
The initial payment review contains no signed envelope.
The test obtains the signature response from an isolated mock, then reloads the exact resulting journal.
The test makes zero network calls and requests no 1Password signature.
It also checks that decoding the signed envelope gives the initial reviewed body.

## Runtime and source inspection

```sh
bun --version
```

Result: exit `0`; `1.4.2`.
The test logs also identify build `744846f84`.
The manifest and installed package identify `@stellar/stellar-sdk` version `17.1.0`.
`results.json` records the matching SDK file hashes and the unchanged snapshot hashes.

I read the assigned briefs, original reports, preserved reproduction, and coordinator reproduction log.
I traced the frozen renderer, decoder, signing result, normal submission, journal restoration, and modal handlers.
I inspected the existing VM fixture and test support before execution.
The added test copies the preserved reproduction's setup before its first test.
Only the added C10 test executes from that copy.
The added check covers normal reload display, which the selected preserved tests did not assert.

## Research discovery and charges

Tool metadata exposed `mcp__stellar_raven__search` and `mcp__stellar_raven__execute`.
It also exposed `mcp__parallel_search__web_search_preview` and `mcp__perplexity__perplexity_search`.
The app variants of Raven and Parallel also appeared.
I did not invoke these providers, Jev, or parallel-cli.
The preserved SDK excerpts answered the relevant signature question.
New provider calls: `0`. New research cost: `$0`. New Jev cost: `$0`.
Historical charges from other reviewers are outside this incremental total.

## Limits

All executed tests use the frozen TypeScript app through the existing VM fixture.
Mock DOM and storage behavior do not establish real-browser layout or platform acceptance.
Existing submission counterevidence uses a mocked Horizon response.
Live signatures, live submission, public services, and the full baseline suite: `not_run`.
