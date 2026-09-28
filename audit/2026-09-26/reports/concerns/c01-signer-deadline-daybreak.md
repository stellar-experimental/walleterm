# C01: Output backpressure and the advertised signer deadline

## Summary

| Field | Result |
|---|---|
| Concern | `C01` |
| Model | `daybreak` |
| Effort | `xhigh` |
| Revision | `40d6cca9db732a0db16d154c80d4a153bf33c6b7` |
| Source | `/private/tmp/walleterm-audit-40d6cca9db73` |
| Verdict | Confirmed contract mismatch |
| Priority | Low |
| Confidence | High |
| Minimum resolution | Documentation clarification |
| Affected users | Callers that stop draining standard output or standard error |

Documentation clarification is sufficient for the current CLI boundary. Blocked output can exceed the current full-operation promise.
Normal pipe consumers remain unaffected when they drain both streams. The caller owns the pipes and outer process lifetime.

## Scope and baseline

I reviewed frozen `main.go:113,137,169,193` and `docs/INTERFACE.md:127-142`. The relevant hashes matched the manifest.
The central Go race, Go vet, TypeScript, 224 Bun, and three contract checks passed.
I reviewed both named original signer reports, but not the paired C01 concern report.

## Reachable scenario and impact

1. A caller starts `walleterm sign` with a standard-error pipe.
2. The caller stops reading that pipe, or another process fills it.
3. Key discovery succeeds before the absolute agent deadline.
4. `main.go:169` writes the signing notice synchronously.
5. `main.go:193-198` has no output deadline or cancellation path.
6. The connection deadline at `main.go:137` cannot interrupt that write.

The preserved test remained blocked after 122.001 seconds. Closing the pipe returned `output_error`.
The mock received zero signing requests.

The final result uses the same `writeOutput` path at `main.go:180-188`.
A blocked result can follow one signing request. The caller can then have an unknown signature result.

The command can exceed its advertised elapsed-time limit. This condition does not expose a private key.
The evidence shows no transaction submission or unauthorized signing.

## Counterevidence

- The preserved reproduction deliberately fills an operating-system pipe.
- A normal consumer drains standard output and standard error concurrently.
- A sign notice and sign result are small.
- Agent reads and writes use the shared 120-second deadline.
- A notice failure prevents signing, while a final output failure does not retry.
- The focused output and deadline tests passed with mock keys.

The reproduction covers only the notice path. The final result uses the same blocking writer.

## Minimum mitigation and alternatives

Clarify `docs/INTERFACE.md:138-139` with these requirements:

- Apply the 120-second deadline to pollable sign input and all agent I/O.
- Require callers to drain standard output and standard error concurrently.
- Require callers to enforce an outer process timeout.
- Treat a timeout after the signing notice as an unknown signature result.
- Prohibit automatic signing retries after that unknown result.

A runtime change is necessary only if the full-process guarantee remains.
The runtime can apply deadlines to pollable output files. Unsupported writers still need a caller timeout.

## Verification steps

1. Review the changed interface against each requirement above.
2. Retain the preserved blocked-notice test as contract evidence.
3. Confirm zero signing requests after a notice failure.
4. Confirm one signing request and no retry after a result failure.

Runtime enforcement needs bounded full-pipe tests for both output streams.

## Exact checks

| Check | Status | Evidence |
|---|---|---|
| Frozen hashes against manifest | passed | `checks/concerns/c01-daybreak/checks.md` |
| Preserved 122-second notice reproduction | confirmed | `checks/01-signer-astra/audit-output-deadline.log` |
| Preserved reproduction source review | passed | `checks/01-signer-astra/audit_test.go:248-307` |
| Focused output and deadline tests | passed | `checks/concerns/c01-daybreak/checks.md` |
| First focused sandbox run | blocked | Unix-socket creation was not permitted |
| Live 1Password signing | `not_run` | Prohibited and unnecessary |
| Testnet submission | `not_run` | Prohibited and unrelated |

## Sources, costs, and limits

The frozen code and interface are the controlling primary sources. The macOS reproduction supplies direct runtime evidence.
No unresolved external fact remained, so I ran no research tool.
New research cost was `$0`, including `$0` Jev usage. No provider call created an unknown charge.

This review does not renew live 1Password acceptance. It does not repeat the long reproduction.
These limits do not change the verdict.
