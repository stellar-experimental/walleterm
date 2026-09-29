# Phase 1 fixes and Phase 2 security review

Verdict: **CHANGES**.

Phase 1 fixes: `1fc9888bef07edd6d9927294a02ccabfef3fbfb3`.
Phase 2 signer: `caf7256f09be375700f5eaf42f098393d337deef`.

I reviewed separate detached checkouts of both commits. Both checkouts retain unchanged tracked files.
I excluded the shared worktree's Phase 3 changes.
Source locations below refer to `caf7256`, unless stated otherwise.

The Phase 1 findings are closed at `1fc9888`.
Phase 2 needs two corrections. I found no blocker-level key exposure or digest substitution defect.

## Should-fix findings

### S1. An expired deadline still permits a signing request

Locations: `src/agent.rs:241-266`; `src/cli.rs:305-314`.

`Agent::exchange` writes before checking the deadline.
`read_full` also reads before checking it.
Both functions check time only after an operation returns `WouldBlock`.
A writable socket therefore permits a new signing request after the absolute deadline.

Concrete reproduction:

1. Use the frozen `sign-json` input and its mock identity response.
2. Give `Io` an absolute deadline 100 milliseconds ahead.
3. Make the diagnostic writer accept the signing notice after a 250-millisecond delay.
4. Record every request at the mock agent.

The command sends request type `13` after the deadline.
My run recorded one signing request, exit `1`, and this result:

```json
{"ok":false,"error":{"code":"timeout","message":"The agent operation timed out."}}
```

The production equivalent occurs when stderr blocks beyond 120 seconds, then resumes.
Output itself has no internal deadline by design.
However, its completion must not permit new signing after the signing deadline.
The current command can return `timeout` after it already delivered that late request.
This reproduction uses an isolated mock key. It does not establish a live 1Password incident.

Check the deadline before each read and write, including immediately writable operations.
Check it before the signing exchange starts.
Preserve the same absolute deadline across input, connection, listing, and signing.
Preserve the existing no-retry rule.

A scratch correction added `self.wait(...)` before both I/O loops' operations.
The same regression then recorded zero signing requests and the expected timeout.
The Go reference also rejected a signing write after its socket deadline, without sending request bytes.

Add `review_late_notice_must_not_send_sign_request` as a regression.
Also test an already-buffered response after expiry. The current silent-agent and dribbling-agent tests require `WouldBlock`.
They do not exercise this gap.

Evidence: [failing probe](review-p2/evidence/adversarial-tests.log), [corrected scratch probe](review-p2/evidence/deadline-fix-probe.log), and [Go reference](review-p2/evidence/go-reference.log).
Probe source: [review.rs](review-p2/probe/tests/review.rs).

### S2. The `--` branch wraps an invalid port into a valid port

Location: `src/service.rs:19-20`.

Concrete input: `walleterm tunnel --port 65537 --`.
`parse_port` returns `Some(1)`.
The branch casts the `u32` value to `u16` before checking its range.
The Go parser rejects this input with `invalid_input`.
The Rust command can instead start the service on port `1`, when its dependencies permit startup.

This differs from the recorded decimal-only restriction.
The value is decimal but exceeds the permitted range.
Validate `1..=65535` before every conversion to `u16`.
Prefer one final range check after the option loop.
Add the exact input above and its version without `--` to the port tests.
Both must fail before service startup.

Evidence: [Rust probe](review-p2/evidence/adversarial-tests.log) and [Go reference](review-p2/evidence/go-reference.log).

## Note

### N1. Human output still prints some format characters without escaping them

Locations: `src/cli.rs:140-148`; `fixtures/parity/README.md:36-37`.

Use the identity comment `x\U000e0001\U000e0061\U000110bdy`.
These three code points have Unicode category `Cf`.
Go prints the escaped form:

```text
"x\U000e0001\U000e0061\U000110bdy"
```

Rust prints the three characters themselves.
The recorded difference describes unassigned characters, so it does not cover this case.
The function comment also promises that format characters never reach the terminal.

Complete the format-character exclusion table and add these exact cases.
Alternatively, explicitly accept this additional display difference and correct the recorded claim.
Comments remain display metadata. This finding does not demonstrate signer redirection or an ASCII terminal escape bypass.
It does not independently block security acceptance.

Evidence: [Rust probe](review-p2/evidence/adversarial-tests.log), [Go output](review-p2/evidence/go-reference.log), and [Unicode categories](review-p2/evidence/manifest.json).

## Phase 1 closure at `1fc9888`

| Prior item | Result |
| --- | --- |
| S1: fractional JSON values | Closed. `float_roundtrip`, two complete vectors, and raw-text numeric tests reject the demonstrated inputs. |
| N1: Base64URL diagnostics | Closed. Only the rejection-classification path normalizes the URL alphabet. Three vectors retain rejection and match TypeScript messages. |
| N2: structural transaction admission | Closed. The README identifies broader admission. The separate Rust test preserves the body and existing signatures. The SDK still rejects the invalid asset. |
| Weak-key verification case | Added and passed. The identity point with identity `R` and zero `S` fails verification. |
| Noncanonical scalar case | Added and passed. Replacing a valid signature's `S` with the group order fails verification. |

All 81 original vector cases remain unchanged when matched by case ID.
The six additions appear beside their related cases. They do not form a trailing block.
The updated vector file contains 87 cases.
The TypeScript reader passed all 88 tests, including the invalid-asset rejection.

Evidence: [vector integrity](review-p2/evidence/p1-vector-integrity.json), [Rust tests](review-p2/evidence/p1-cargo-test.log), and [Bun tests](review-p2/evidence/p1-bun-vectors.log).

## Security checks and limits

| Area | Result |
| --- | --- |
| Frozen CLI behavior | All 57 Go transcripts passed, including exact output and captured request bodies. |
| Frozen authorization behavior | All 26 sign-auth transcripts passed, including zero signing requests for input rejection. |
| Wire binding | Requests contain the selected full key blob, the exact 32 digest bytes, and zero flags. |
| Agent responses | Bounded frames, bounded identity counts, duplicate rejection, exact wrappers, and independent signature verification remain intact. |
| Socket selection | The executable uses the real UID's account home. It exposes no socket override. |
| Socket checks | Type, restrictive mode, and symlink tests passed. I inspected the owner comparison; I did not create another user's socket. |
| Environment | The service filters `BUN_*`, `NODE_OPTIONS`, and caller-provided `WALLETERM_BINARY`. It supplies its own resolved binary path. |
| Failed signing notice | Committed tests send no signing request. sign-auth also avoids opening the agent after this failure. |
| Failed result output | Committed list/sign tests passed. Added sign-auth tests recorded exactly one signing request for both writer failure modes. |
| Signals during input | The actual executable exited on SIGINT and SIGTERM for both signing commands, without JSON output. |
| Signals after a signing request | A scratch CLI runner using the pinned library closed its mock connection on either signal. It sent no follow-up request. |
| Retry behavior | No tested failure repeated signing. Cancellation after sending a request does not prove that an external signer stopped. |

The signal behavior matches the recorded change for native sign-auth.
The remaining surrogate, numeric-overflow, decimal-port, and strict-verification differences fail closed or preserve the selected authority.
I accept those recorded differences. N1 needs a more accurate display statement.

Connection establishment remains synchronous at `src/agent.rs:227`, before `set_nonblocking`.
The source does not enforce a deadline inside that connect call.
A full mock listener backlog returned immediate refusal on this Mac.
I did not reproduce a connection stall, so I do not classify one as a confirmed defect.
The passing read-timeout tests do not establish a bounded connection time.

## Validation

| Pinned revision or check | Result |
| --- | --- |
| `caf7256`, `cargo test --locked` | 13 unit tests, 13 CLI tests, and three vector tests passed. |
| `1fc9888`, `cargo test --locked` | 16 unit tests, 13 CLI tests, and four vector tests passed. |
| `1fc9888`, Bun vector reader | 88 passed; 94 assertions. |
| Additional Phase 2 probes | S1, S2, and N1 reproduced. Both sign-auth output-failure cases passed. |
| Scratch deadline correction | The late-notice test passed with zero signing requests. |
| Cancellation checks | Eight signal cases passed. |
| Shared worktree edits by this review | None. No `.ts`, `.js`, or `.mts` files were created there. |
| Live signing, testnet, full repository suite, release | Not run. |

The [manifest](review-p2/evidence/manifest.json) records the exact commits and parity-file hashes.
The [Phase 2 log](review-p2/evidence/p2-cargo-test.log) and [cancellation results](review-p2/evidence/cancellation.json) preserve the main checks.

Correct S1 and S2 in a new commit before Phase 2 acceptance.
Keep the Phase 1 corrections and their frozen expectations unchanged.
