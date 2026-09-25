# Final signing-core review

Reviewed on 2026-09-25. The source remained unchanged during this review.

## Finding

### P2: Output failures can discard the signature and still return success

Locations: `main.go:165`, `main.go:167-175`. Related notice handling: `main.go:156-157`.

The signing command ignores the result of each output write. It then returns exit code 0 unconditionally.
An unwritable output descriptor or exhausted output filesystem can therefore discard the signature while reporting success.
The required diagnostic notice also ignores write failures. Signing continues even when the notice cannot be written.

Check the diagnostic write before sending the signing request. Return a nonzero exit code when signature output fails.
Do not retry signing to recover from an output failure.

Reproduction executed without an agent connection:

```sh
python3 - <<'PY'
import os
import subprocess
with open('/dev/null', 'rb') as output:
    result = subprocess.run(
        ['go', 'run', 'main.go', '--version'],
        stdout=output,
        stderr=subprocess.PIPE,
        env={**os.environ, 'GOPROXY': 'off', 'GOSUMDB': 'off', 'GOTOOLCHAIN': 'local'},
        text=True,
    )
print({'exit_code': result.returncode, 'stderr': result.stderr})
PY
```

Observed result: `{'exit_code': 0, 'stderr': ''}`. The read-only stdout descriptor receives no output.
The version command demonstrates the unchecked-write behavior at `main.go:83-84`.
The signing path uses the same unchecked writes and unconditional success return.
I did not execute this reproduction against the signing command or a live agent.

A focused regression test should call `run` with an offline mock agent and a writer that returns `io.ErrClosedPipe`.
Check both JSON and human output. Require nonzero status after a signature-output failure.
For a diagnostic-write failure, require zero signing requests.
Existing successful-output tests use `bytes.Buffer`; they do not exercise failed output writes.

## Verification

These checks passed with network dependency lookup disabled:

```sh
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test -count=1 ./...
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go vet ./...
GOPROXY=off GOSUMDB=off GOTOOLCHAIN=local go test -race -count=1 ./...
```

The first sandboxed attempt failed because the sandbox blocked the Go build cache.
The permitted rerun passed. Tests used isolated mock keys and local mock connections.
I accessed no vaults, real agent sockets, or network services.

I checked these properties directly in the source:

- Input parsing limits reads to 4097 bytes and rejects inputs above 4096 bytes.
- Parsing rejects duplicate fields, unknown fields, trailing JSON, invalid addresses, and invalid digest strings.
- Response allocation stops above 1 MiB. Identity processing stops above 1024 entries.
- Ed25519 parsing requires exact key and signature lengths and rejects trailing bytes.
- Selection matches the complete canonical public key. Comments do not select signers.
- The signing request carries the decoded 32 bytes and flags zero.
- Independent Ed25519 verification uses the selected public key and the original digest.
- A single absolute deadline covers supported input reads, connection establishment, listing, and signing.
- The documented non-pollable-input limitation remains applicable.
- Socket checks require the current owner, a socket node, and no group or other permissions.
- Filesystem checks do not authenticate the peer against a compromised local user. The interface states this limit.
- Generic agent failure does not claim that the user selected Deny.
- The core closes connections and does not retry signing.

I found no additional actionable defects within the frozen source scope.
This review does not establish live approval behavior, vault provenance, or resistance to a compromised local user.

## Reviewed source hashes

```text
main.go
sha256 a17ebe439e43c5a99d97d5668dd3c7ffbcdd454d30cad65d350a9e1b8042c02f

main_test.go
sha256 7d65b675a9a7b8de1aefae5f57edb9c4defa34224b5396219708f8461b1d65f0
```

I also read `AGENTS.md`, `docs/INTERFACE.md`, and `Makefile` for the review contract.
I wrote only this report. I did not change the signing core, tests, helper files, or build rules.
