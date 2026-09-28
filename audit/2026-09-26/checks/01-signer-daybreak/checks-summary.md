# Go signer check summary

Date: 2026-09-26

Environment: `go1.27.1 darwin/arm64`, Darwin `25.6.0`, macOS `26.7`.

Snapshot: `/private/tmp/walleterm-audit-40d6cca9db73`

Revision: `40d6cca9db732a0db16d154c80d4a153bf33c6b7`

## Results

| Check | Status | Result |
|---|---|---|
| `go test -count=1 -coverprofile=.../go-cover.out ./...` | passed | `ok walleterm 0.312s`, 76.4% statements |
| `go test -race -count=10 ./...` | passed | `ok walleterm 2.526s` |
| `go vet ./...` | passed | No output |
| `go test -run 'TestInputStrictness\|TestBoundsAndSocketChecks\|TestProtocolFailures' -count=100 ./...` | passed | `ok walleterm 0.480s` |
| `go tool cover -func=.../go-cover.out` | passed | `main.go` signer functions received focused coverage |

The permitted runs used isolated mock keys and Unix sockets.

No command accessed the 1Password socket.

No command requested a signature or used a network.

## Sandbox attempt

The first sandbox run could not bind mock Unix sockets.

It failed with `bind: operation not permitted`.

This result was an environment restriction, not a product defect.

The permitted runs superseded that result.

## Coverage details

| Function | Coverage |
|---|---:|
| `run` | 85.9% |
| `parseInput` | 90.2% |
| `checkSocket` | 100.0% |
| `exchange` | 84.2% |
| `listSigners` | 87.1% |
| `parseKeyBlob` | 80.0% |
| `sign` | 87.0% |
| `transportError` | 0.0% |

Coverage artifact: `go-cover.out`

SHA-256: `fe92c2713f25b610988be71efc50d568a64f8efe3ed26a696f92f88f1b13203a`
