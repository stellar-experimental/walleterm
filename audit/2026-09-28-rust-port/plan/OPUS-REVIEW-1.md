# Opus review of ASTRA-PLAN.md (round 1)

Verdict: accept the architecture, phases, vectors, security checklist, and inventory approach.
Revise the items below, then write `_migration/ASTRA-PLAN-v2.md` (or edit ASTRA-PLAN.md in place and list the changes at the top).

## Confirmed

- Your `revoke()` finding is real. On `4b40b8f`, `bridge/server.ts:261` ends a `signed` record as `denied`; line 491 does it correctly.
  I sent it to the PR #22 coordinator to fix before merge. The Rust port must follow the fixed behavior.
- Protocol v3 direct port, no WASM, keep the TS pre-check, no upstream stellar-cli work: agreed.
- Unwinding panics, `opt-level = "s"`, thin LTO first: agreed.

## Changes requested

1. **Drop `axum`.** The bridge and demo have a small fixed route set. Use `hyper` 1 + `hyper-util` with a plain `match` on method and path.
   AGENTS.md asks for minimal dependencies. Quantify the crate-count and binary-size delta in a probe and record it.
2. **Replace `reqwest` if a smaller graph gives the same controls.** Compare `hyper-util` legacy client + `hyper-tls` (native-tls on macOS).
   Hyper does not follow redirects or read proxy variables by default. Apply timeouts with `tokio::time::timeout` and cap bodies by hand.
   Pick the smaller graph when both meet the checklist. Record the numbers.
3. **Drop `time`.** The only need is UTC ISO-8601 with milliseconds. Use a small, tested days-to-civil function.
   Also check whether `tempfile`, `hex`, and `url` earn their place, or whether 10–30 lines of tested code replace each one. Keep `subtle` and `getrandom`.
4. **Test host as a feature-gated binary, not a `cfg(test)` entry in the unit-test executable.**
   Use `[[bin]] name = "walleterm-test-host"`, `required-features = ["test-host"]`. The release build never enables the feature.
   The package test asserts that the shipped binary has no test-host code (for example, a marker string that must be absent).
5. **Parity: freeze golden transcripts once, then delete the dual harness.** In Phase 0, capture Go/Bun outputs (CLI JSON, exit codes, raw SSH frames, HTTP lifecycle traces) into `fixtures/parity/`.
   Rust tests compare against those frozen files. Do not keep code that runs Go and Rust side by side after cutover.
6. **Python and the non-browser TS helpers.** The user's target is Rust everywhere and TS only where necessary.
   - `design/tools/artcheck.py` (NumPy/SciPy image QA): keep as a maintainer-only design tool. State this as the only Python exception.
   - `.agents/skills/walleterm-site-bridge/scripts/classic-attach.py` and `verify-signature.ts`: assess replacing both with one small TS (Bun) script or with the Stellar CLI. Remove Python from the skill if nothing is lost. Keep the independent-crypto property.
   - `legacy-freighter.ts` stays TS (it runs in a browser page).
7. **Art generator port (`design/art/*.ts`, ~714 lines) goes last and is gated.** Port it only if `site/art/` regenerates byte for byte.
   Note the float-formatting risk: JS `Number#toString` and Rust `{}` differ for exponents and `toFixed` rounding. If byte-identical output is not practical, keep it in TS and record why.
8. **Release tooling in `tools/` (xtask style): agreed.** Keep it small. Port behavior, not structure. Shell out to `codesign`, `xcrun notarytool`, `ditto`, `gh`, and `git`. Add no crates beyond what you listed.
9. **Commit per phase on `feat/rust-everywhere`.** Each phase ends green. The test agent runs `make test` (and the phase's extra targets) on the phase commit. You review that commit before the next phase.
10. **Size and dependency budget.** State targets after the dependency changes above: an expected shipped binary size range (including ~3.75 MB of embedded assets), a maximum resolved crate count, and a `cargo deny`-style advisory/license check (or state why not).

## Questions for you

- Is `libc` enough for `getpeereid`, `lstat`, `setsid`/`setpgid`, `killpg`, `poll`, and `isatty`, or do you need anything else?
- The browser tests currently import the TS host directly. How many test files need the Rust test host, and how many can use transport mocks only? Give the split.
- What is the smallest correct first commit for Phase 1 that I can start while PR #22 and #20 merge? (Pure XDR, digest, adapter code and vectors do not depend on the HTTP protocol.)

Reply in the terminal with only the path of the revised plan when done.
