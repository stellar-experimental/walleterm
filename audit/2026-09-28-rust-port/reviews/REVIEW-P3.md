CHANGES — Phase 3 requires four fixes before acceptance. The three Phase 2 fixes pass review.

I reviewed detached checkouts at these exact commits:

| Scope | Commit |
| --- | --- |
| Phase 3 | `885bf2748fc248da9406086f83d5823abe4558ef` |
| Phase 2 fixes | `e01e8279ac6e56e0c4d515a9473aab349b047b96` |
| Legacy behavior | `52a7fc388e93e19482a9cc2a96408ac4328c526e` |

`e01e827` contains Phase 3 and the later Phase 2 fixes. Its changes do not fix the findings below.
Both review checkouts remain clean. I did not change the shared worktree.
The probes used isolated mock keys, mock programs, and local sockets.
The native bridge is not yet the CLI service in these commits. The CLI still starts the Bun sidecar.

**P3-S1 — High: Valid `.env` syntax silently removes the vault filter.**

Locations: [src/config.rs:24](/private/tmp/walleterm-p3-review/p3/src/config.rs:24), [src/config.rs:72](/private/tmp/walleterm-p3-review/p3/src/config.rs:72), [src/vault.rs:208](/private/tmp/walleterm-p3-review/p3/src/vault.rs:208).

`env_value()` skips other variables before processing their quoted values. It also misses a UTF-8 BOM and tab-separated `export`.
These three inputs each produce `Private` through the legacy Bun `node:util.parseEnv` parser:

| Input | Rust result |
| --- | --- |
| UTF-8 BOM followed by `OP_VAULT=Private\n` | `None` |
| `export\tOP_VAULT=Private\n` | `None` |
| The multiline input below | `Some("")` |

```dotenv
OP_VAULT=Private
NOTE="example
OP_VAULT=
"
```

The last assignment sits inside `NOTE`. Rust treats it as a separate assignment and erases the actual vault setting.
`discover()` treats both missing and empty settings as permission to return all agent keys.

The integration probe loaded the BOM input through `load_vault()`. Its mock agent exposed two keys; only one belonged to `Private`.
Rust returned both keys and made no vault CLI calls. This expands website wallet discovery beyond the configured vault.
This finding does not claim that discovery alone approves signing.

Fix: Parse complete assignments, including other variables' quoted values, before selecting `OP_VAULT`.
Support the accepted BOM and `export` whitespace forms. Unsupported syntax must not silently remove a configured filter.
Add all three parser cases and a configuration-to-discovery regression.

Evidence: [reference values](/private/tmp/walleterm-reviews/p3-evidence/config-reference.json), [parser failures](/private/tmp/walleterm-reviews/p3-evidence/adversarial.log), [BOM failure](/private/tmp/walleterm-reviews/p3-evidence/config-bom.log), [unfiltered discovery](/private/tmp/walleterm-reviews/p3-evidence/vault-filter-bypass.log).

**P3-S2 — High: Shutdown can permit signing and accept a signature after closing starts.**

Locations: [src/bridge.rs:824](/private/tmp/walleterm-p3-review/p3/src/bridge.rs:824), [src/bridge.rs:868](/private/tmp/walleterm-p3-review/p3/src/bridge.rs:868), [src/bridge.rs:911](/private/tmp/walleterm-p3-review/p3/src/bridge.rs:911), [src/bridge.rs:1457](/private/tmp/walleterm-p3-review/p3/src/bridge.rs:1457), [src/cancel.rs:63](/private/tmp/walleterm-p3-review/p3/src/cancel.rs:63).

`close()` sets `state.closing` immediately. `Cancel::any()` forwards later cancellation through a spawned task.
`still()` checks the combined signal but does not check `state.closing`.
An already-ready dependency can resume before the forwarding task runs.

Two controlled schedules reproduce the gap:

1. Hold the signer listing after approval. Release it, then immediately await `close()` before the worker resumes.
   Rust calls the mock signing dependency once and records `Signed`. The legacy bridge makes zero signing calls.
2. Hold the mock signing result. Release it, then immediately await `close()` before the worker resumes.
   Rust records and logs `Signed` after shutdown starts. It must withhold this result.

These probes establish incorrect dependency invocation and stored state. They do not establish a live 1Password signature or delivery after shutdown.

Fix: Check closing state synchronously before starting signing and before storing a successful result.
Keep the eligibility check and state change under the same state lock where applicable.
Do not depend only on the cancellation forwarding task. Keep both schedules as regressions.

Evidence: [signing starts](/private/tmp/walleterm-reviews/p3-evidence/adversarial.log), [result accepted](/private/tmp/walleterm-reviews/p3-evidence/shutdown-result.log), [legacy comparison](/private/tmp/walleterm-reviews/p3-evidence/ts-lifecycle-reference.json).

**P3-S3 — High: A late selection body can disable the whole bridge.**

Locations: [src/bridge.rs:1199](/private/tmp/walleterm-p3-review/p3/src/bridge.rs:1199), [src/bridge.rs:577](/private/tmp/walleterm-p3-review/p3/src/bridge.rs:577), [src/http.rs:150](/private/tmp/walleterm-p3-review/p3/src/http.rs:150).

`select()` awaits the body, then indexes `state.sessions[session_id]` before it rechecks website authorization.
Another request can remove that session during the await. The index panics while holding the shared mutex.
The HTTP task catches the panic, but subsequent requests fail when they lock the poisoned mutex.

The raw HTTP probe used this sequence:

1. Pair a session with `wallet_scope: "selected"`.
2. Start an authorized `/v1/select` request, but send only the first body byte.
3. Disconnect that session. Call `/api/session` to run the expiry sweep.
4. Send the remaining valid selection body.

Rust returns HTTP 500 for selection and subsequent health requests. The legacy bridge returns selection HTTP 401 and health HTTP 200.
A paired website can therefore disrupt other sessions. The failure persists until the bridge restarts.

Fix: Recheck website authorization and session existence under the lock before indexing after the body await.
Return the normal disconnected-session error. Add this sequence as a regression; catching the panic alone does not repair the mutex.

Evidence: [panic and HTTP results](/private/tmp/walleterm-reviews/p3-evidence/adversarial.log), [legacy comparison](/private/tmp/walleterm-reviews/p3-evidence/ts-lifecycle-reference.json).

**P3-S4 — Medium: Vault batches delay failure handling and return before cancellation cleanup ends.**

Locations: [src/vault.rs:161](/private/tmp/walleterm-p3-review/p3/src/vault.rs:161), [src/vault.rs:75](/private/tmp/walleterm-p3-review/p3/src/vault.rs:75), [src/bridge.rs:868](/private/tmp/walleterm-p3-review/p3/src/bridge.rs:868), [src/cancel.rs:87](/private/tmp/walleterm-p3-review/p3/src/cancel.rs:87).

First, the batch starts concurrent reads but awaits their handles in input order.
The probe stalled the first read and failed the second read immediately.
The batch still waited after three seconds, despite the known failure. The probe then canceled it and verified child cleanup.
The source permits this wait until the lookup deadline or another cancellation. The lookup deadline is 120 seconds.

The committed failure test fails the first read, so it misses this order.

Second, the bridge wraps signer discovery in `signal.run(...)`. Cancellation drops the discovery future and its collection of task handles.
Dropping these handles detaches the reads. Their cleanup continues after the wrapper returns.
The probe used the same wrapper with two mock CLI children that ignored SIGTERM.
Both children remained alive at return and after 100 milliseconds. Both stopped within the probe's two-second cleanup wait.

This proves early return, not a permanent process leak. Worker completion therefore does not establish vault child cleanup.

Fix: Observe batch completions as they occur. On the first failure, cancel the other reads and await their cleanup.
For vault discovery, preserve that cleanup wait when the caller cancels.
Keep immediate socket closure for the native signer. Do not apply a future-dropping wrapper where completion must include child cleanup.
Test failure in each batch position and cancellation through the bridge's outer wrapper.

Evidence: [failure order](/private/tmp/walleterm-reviews/p3-evidence/vault-order.log), [outer cancellation](/private/tmp/walleterm-reviews/p3-evidence/vault-cancel-wrapper.log).

**Phase 2 findings: accepted at `e01e827`.**

- S1: `Agent::check()` now runs before every read and write attempt. The late-notice and buffered-response regressions pass.
- S2: `parse_port()` checks the range after option parsing. `--` no longer bypasses it. All three requested cases pass.
- N1: The Cf table covers all 170 entries in Go's Unicode 17.0.0 table. The format-character test passes.
  The parity README now limits the remaining difference to unassigned code points.

The synchronous CLI `UnixStream::connect()` still has no enforced connect timeout.
I do not require another change solely for this unconfirmed macOS stall.
The earlier backlog probe found immediate refusal. That observation does not prove every connect path has a deadline.
The native bridge uses the separate asynchronous client with cancellation and timeout control.

Evidence: [Phase 2 test run](/private/tmp/walleterm-reviews/p3-evidence/p2-fixes-tests.log), [Go Cf table](/private/tmp/walleterm-reviews/p3-evidence/go-format-table.json).

**HTTP trace deviation: conditionally acceptable after targeted coverage.**

The current test suites miss actual differences in shutdown and delayed-body handling. Passing them does not establish complete lifecycle parity.
I do not require a large trace archive solely to satisfy the original format.
Add the schedules above with expected outcomes established against the fixed legacy base.
Record statuses, signature availability, signing-call counts, and continued service after session removal.
Also add the dotenv and vault cleanup regressions. Do not derive expected behavior from the Rust implementation under review.

I accept the duplicate-key rejection, corrected authorization logs, and handlers that complete after client disconnection.
Dropping the native signing future correctly closes its socket in the probes.
That rule needs the vault cleanup exception described in P3-S4.

**Other security checks and limits.**

- Host and Origin checks bind website calls to their sessions. The reviewed code rejects duplicate authentication headers.
- Grant intersection, selection revision checks, and session-specific request storage pass the existing isolation tests.
  P3-S3 is the missing session check after body parsing.
- The bridge has one signing worker. Existing switch, revoke, and cancellation tests withhold results after signing starts.
  P3-S2 is the separate shutdown gap. I found no automatic signing retry.
- The ledger client uses its fixed HTTPS endpoint and default certificate verification. It does not follow redirects.
  The 16,384-byte cap, ten-second timeout, response identifiers, health status, and ledger range checks are present.
  Local ledger tests pass. I did not test a live TLS endpoint.
- HTTP handling enforces the 393,216-byte body cap. Separate probes observed header closure at 10.001 seconds.
  A stalled body returned HTTP 408 at 15.003 seconds. The body timer starts after headers.
- Three added native-agent probes pass. They cover cancellation before connection, cancellation after one signing request, and a silent-agent timeout.
  Each applicable probe verifies socket closure. No real agent socket was used.
- Vault CLI commands read item metadata and public-key fields only. Item references use validated identifiers.
- The test host requires `test-host`. Building that binary without the feature fails.
  Production dependency construction has no test-host override. The default debug binary lacks the test-host marker; the test host contains it.
  These checks do not replace the later release-package review.

Evidence: [native-agent probes](/private/tmp/walleterm-reviews/p3-evidence/native-agent.log), [HTTP deadlines](/private/tmp/walleterm-reviews/p3-evidence/http-deadlines.json), [feature rejection](/private/tmp/walleterm-reviews/p3-evidence/host-without-feature.log), [binary markers](/private/tmp/walleterm-reviews/p3-evidence/binary-boundary.json).

**Validation performed.**

| Check | Observed result |
| --- | --- |
| `cargo test --locked` at `885bf27` | 96 passed |
| `cargo test --locked` at `e01e827` | 99 passed |
| Browser SDK suite against Rust test host | 39 passed; 84 assertions |
| Five requested legacy bridge test files | 79 passed; 89 assertions |
| Added asynchronous native-agent probes | 3 passed |
| New defect probes | Failed as described above |

The Rust browser run contains 39 tests, rather than the request's stated 38.
The original fixture hash checks pass. The legacy bridge and SDK source used for comparison match the fixed base.
I did not run full `make test`, Clippy, `cargo deny`, live 1Password, or testnet acceptance.
I did not build or install a release package.

Small scratch changes confirm the causes of P3-S1, P3-S2, P3-S3, and P3-S4's failure-order issue.
Those changes exist only outside the shared worktree. They are demonstrations, not reviewed production fixes.
The scratch checks do not fix or close P3-S4's outer-cancellation issue.

Evidence: [Phase 3 tests](/private/tmp/walleterm-reviews/p3-evidence/p3-tests.log), [browser tests](/private/tmp/walleterm-reviews/p3-evidence/browser-tests.log), [legacy tests](/private/tmp/walleterm-reviews/p3-evidence/ts-bridge-tests.log), [reproduction instructions](/private/tmp/walleterm-reviews/p3-evidence/REPRODUCTION.md), [checkout state](/private/tmp/walleterm-reviews/p3-evidence/checkout-state.json).
