# C12 OpenZeppelin build provenance review

## Assignment

| Field | Value |
| --- | --- |
| Concern | `C12` |
| Model | Daybreak |
| Effort | xhigh |
| Baseline | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Frozen source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Source scope | `fixtures/build.sh:19-27`, `fixtures/manifest.ts:15`, and direct consumers |
| Verdict | Confirmed defect with a conditional trigger |
| Priority | Low, P3 |
| Confidence | High |
| Current artifact alteration | Unsupported by retained evidence |

I read no paired review, changed no production file, and used no live service.

## Verdict and affected users

The build can assign the pinned commit to artifacts built from modified tracked files.
The affected users are fixture builders and reviewers of testnet acceptance evidence.
The defect does not affect normal signer users or the installed runtime directly.

## Reachable scenario

`fixtures/build.sh:19-23` checks only whether `HEAD` equals `OZ_COMMIT`.
When `HEAD` matches, the script skips checkout and keeps local tracked changes.
`fixtures/build.sh:25-28` runs each OpenZeppelin build from that working tree.
`fixtures/manifest.ts:15-18` assigns the supplied commit to every `multisig_` artifact.

The live guide tells developers to run this script at `docs/LIVE-TESTS.md:31-43`.
The live harness trusts the commit label at `tests/contracts.ts:1181-1185`.
It verifies artifact hashes at `tests/contracts.ts:558-565`.
Those hashes verify artifact identity, but they do not verify clean source provenance.

## Evidence

The existing reproduction changed one tracked file without changing `HEAD`.
The unchanged script path then reached all four OpenZeppelin build commands.
The generated manifest assigned the unchanged commit to four changed stand-in artifacts.
I reran the existing reproduction, and it passed with exit code `0`.

Evidence files are `provenance-repro.py`, `provenance-result.json`, and `COMMANDS.md` under `checks/06-contracts-astra/`.

The frozen script hash matched the recorded reproduction hash.
The value was `a20f664d1b7489aadf06b0d6fa864a9c99d05c8794e00cc269461c1da050bccb`.

## Counterevidence and limits

The reproduction uses a source-byte stub instead of the real Stellar compiler.
It proves the script control flow and the false manifest attribution.
It does not prove that a real compiler produced altered WASM.

The six frozen artifacts match their manifest hashes and frozen Git blobs.
These checks prove retained byte identity, but not clean upstream provenance.

The snapshot excludes `fixtures/.oz-src/` through `.gitignore:4`.
Therefore, the original cached working tree is unavailable for inspection.
No evidence shows that the retained artifacts came from modified OpenZeppelin source.
No exact upstream rebuild ran during this review.

## Minimum mitigation

Reject a nonempty cached working tree before any fetch, checkout, compilation, or manifest write.
Use `git status --porcelain --untracked-files=all` to cover staged, unstaged, and untracked files.
Repeat the clean check after the pinned commit check and before compilation.
Return a clear error and leave every local file unchanged.

This mitigation is sufficient for the demonstrated single-process scenario.
It preserves developer work because it does not run `reset`, `clean`, or forced checkout.
A fresh isolated checkout is a stronger alternative, but it adds network and cache costs.
The status check does not prevent a concurrent edit after the check.

## Verification steps

1. Use an isolated cache with the expected `HEAD` and a modified tracked contract file.
2. Confirm that the script exits before the first `stellar contract build` call.
3. Confirm that the manifest and cached files remain unchanged.
4. Repeat the check with a staged change and an untracked source file.
5. Run a clean-cache control and confirm that compilation starts.

## Exact checks

| Check | Outcome |
| --- | --- |
| `python3 audit/2026-09-26/checks/06-contracts-astra/provenance-repro.py` | passed |
| `shasum -a 256` on the frozen build and manifest scripts | passed |
| Frozen `.oz-src` presence check | absent, as expected from `.gitignore` |
| `checks/fixture-hashes.json` review | 14 artifact comparisons passed |
| `checks/06-contracts-astra/source-verification.json` review | 199 tracked blobs matched |
| Network build or live acceptance | not_run |

## Sources, costs, and remaining limits

The frozen source and preserved evidence resolved the disputed question.
No external fact remained unresolved, so I ran no research provider.
The new research cost was `$0` total and `$0` for Jev.
Historical artifact provenance remains inconclusive because the original cache was not retained.
