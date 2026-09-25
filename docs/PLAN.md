# Execution plan

Status: the CLI, local tests, live signing proof, and classic acceptance passed on 2026-09-25.
Contract acceptance also passed. C09 uses the sponsor coverage from C01-C04.
See `../evidence/acceptance-summary.json` for final outcomes and explicit limits.

See `../evidence/1password-feasibility.json` for the independent signature check.
See `INTERFACE.md` for the frozen two-command contract.

## Product boundary

Build a macOS CLI that lists public signers and requests Ed25519 signatures from the 1Password desktop SSH agent.
Keep private key generation, storage, and signing inside the 1Password desktop app.
Use the official Stellar CLI to build, simulate, inspect, and submit transactions.
Use Stellar Raven MCP to resolve protocol questions and discover contract interfaces.

Start with two commands: `list` and `sign`.
Add `--human` for readable output, plus standard `--help` and `--version`.
Use JSON on standard input for signing and JSON on standard output for results.
Send diagnostics to standard error. Return a nonzero exit code for every failure.
Do not select a default signer or a default network.

The signing input identifies one public key and an exact 32-byte payload.
The caller constructs and checks the payload with the Stellar CLI or official SDK.
The CLI verifies each returned signature before it returns success.
Raw signing does not prove account ownership, threshold satisfaction, or transaction acceptance.

Use the known 1Password socket directly. Do not use `SSH_AUTH_SOCK` as an automatic fallback.
Treat socket ownership checks as local checks, not cryptographic proof of the server identity.
Use one implementation and one plugin executable alias, `stellar-walleterm`.
Confirm plugin dispatch before advertising `stellar walleterm`.

## Phase 0: establish feasibility

Owner: Astra research; parent coordinates the live check.

1. Confirm the SSH agent request and response formats from primary sources.
2. Create three fresh Ed25519 keys inside the 1Password desktop app.
3. Read only the public keys and match them to agent identities.
4. Request a signature over an exact 32-byte digest.
5. Verify the raw 64-byte signature independently.
6. Change one payload byte and confirm verification fails.
7. Record the app version, socket path, public key, digest, signature, and result.

Exit: a live 1Password signature passes independent Ed25519 verification without private key access.
If this fails, keep the product design provisional and record the blocker.

## Phase 1: implement the small core

Owner: Sol. Reviewer: Grok, followed by Astra for unresolved signing concerns.

Implement bounded SSH framing, public key conversion, explicit signer selection, and signature verification.
Reject malformed input before requesting signing approval.
Set finite input, frame, identity-count, and timeout limits.
Reject unsupported keys, invalid signatures, ambiguous identities, truncated frames, and extra response data.
Use one connection for each command, then close it. Never retry a denied signing request automatically.

Use Go standard-library sockets, JSON, Base32, and Ed25519 verification for the small standalone binary.
Verify the small StrKey checksum routine against official vectors and an independent Stellar SDK.
Use the official Stellar SDK in test helpers and contract adapters.
Keep network calls outside the signing core.

Exit: local protocol and CLI tests pass; independent review has no unresolved material findings.

## Phase 2: prove classic account signing

Owner: parent or Astra. Independent test review: Grok.

Fund only the fresh public accounts through Friendbot.
Build unsigned transactions with the official Stellar CLI or SDK.
Use the CLI under test for every signer signature.
Verify accepted payments, weighted multisig, operation sources, and fee-bump envelopes.
Record exact unsigned and signed XDR, transaction hashes, ledger outcomes, and resulting account state.

Exit: all classic scenarios in `TEST-MATRIX.md` have reproducible results.

## Phase 3: prove contract account signing

Owner: Fable implements test fixtures. Parent coordinates live signing.

Pin OpenZeppelin source to a full commit before compilation.
Build the supplied multisig example and a minimal custom Ed25519 account.
Add a small custom policy contract only when the existing examples cannot cover the required scenario.
Keep contract-specific signature encodings in test helpers and examples.
Use fresh C-accounts with the dedicated 1Password public signers.
Verify authorization entries independently of the transaction envelope.

Exit: G-account authorization, C-account authorization, OpenZeppelin multisig, and mixed-account scenarios pass on testnet.
Record unsupported contract formats explicitly. Do not claim universal smart-wallet compatibility.

## Phase 4: document and hand off

Owner: Opus drafts; parent verifies command examples.

Write a short README with installation, machine output, approval behavior, and copyable Stellar CLI pipelines.
Add a companion skill only after commands are stable.
Include Stellar CLI and Stellar Raven responsibilities in `--help`.
Explain how users create, name, rotate, and archive signers in 1Password.
Explain that on-chain signer removal and vault item deletion are separate actions.
Keep passkey work separate until a browser signing path and contract verifier pass their own acceptance tests.

Exit: a fresh agent can follow the documented workflow without reading implementation code.

## Herdr task contracts

| Agent | Model and effort | Initial task | Write ownership |
| --- | --- | --- | --- |
| wt-astra | GPT-6 Astra, high | Signing feasibility and verification | Research only initially |
| wt-fable | Fable 5.1, xhigh | OpenZeppelin formats and contract tests | Research only initially |
| wt-opus | Opus 5.5, high | CLI interface and final instructions | Research only initially |
| wt-grok | Grok 4.7, high | Independent failure analysis and test review | Review only |
| wt-sol | GPT-6 Sol, high | Minimal implementation and local tests | Assigned after interface freeze |

The parent assigns exact files before implementation begins.
Agents report through their Herdr panes. The parent records accepted findings in this repository.
Serialize live signing requests. Record when cached approval permits signing without a new prompt.

## Evidence rules

Each test records its expected result, observed result, command, timestamp, and relevant source versions.
Use `passed`, `failed`, `blocked`, or `not_run` for execution outcomes.
Use `covered_by` for coverage references and `passed_previous_run` for reused evidence.
Keep public keys, signatures, transaction XDR, and contract identifiers in the evidence files.
Keep credentials and private fields out of evidence files.
For a submission timeout, query the original transaction hash before attempting another submission.
Never replace an uncertain transaction with a newly signed transaction automatically.

## Follow-up work completed on 2026-09-25

The following work completed through the existing Herdr agents.
See `FOLLOWUP.md` for ownership and `../evidence/acceptance-summary.json` for results.

1. Review the final signing core and test runner independently, after the live-test corrections.
   Check parser bounds, socket selection, refusal handling, and unknown-submission recovery.
2. Complete live 1Password failure tests: explicit denial, locked app, cancellation, and lost connection.
   Keep current approval settings. Record cached approval separately from a new human approval.
3. Run a fresh-agent usability test from outside the checkout.
   Use the installed commands for one payment and one OpenZeppelin multisig authorization.
   Make the companion skill portable before installing it outside this checkout.
4. Extend coverage for native G-account Soroban multisig, delegated signers, and context-specific rules when required.
   Keep passkeys as a separate implementation and test project.

The CLI is installed in `~/.local/bin` with the `stellar-walleterm` executable alias.
Fresh login and non-interactive shells resolve both commands from `/tmp`.
`make install` updates the installed binary. See `../evidence/installation.json` for verification.
