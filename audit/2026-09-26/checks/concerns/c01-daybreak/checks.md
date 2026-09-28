# C01 daybreak checks

## Frozen source identity

Command:

```sh
shasum -a 256 /private/tmp/walleterm-audit-40d6cca9db73/main.go \
  /private/tmp/walleterm-audit-40d6cca9db73/docs/INTERFACE.md
```

Result: `passed`.

- `main.go`: `43f4fe2e97c5e5837e34b7d8f4b38792fc277851fbec15da5cf1d5006c15c1da`
- `docs/INTERFACE.md`: `05df4a7a812778a343fb006a62831d6c070cd6de1682bf594ce15a7a7d28ccb4`
- Both hashes match `audit/2026-09-26/manifest.json`.
- The manifest records revision `40d6cca9db732a0db16d154c80d4a153bf33c6b7`.

## Preserved reproduction

Reviewed files:

- `checks/01-signer-astra/audit_test.go:248-307`
- `checks/01-signer-astra/audit-output-deadline.log`

Result: `confirmed`.

The full diagnostic pipe blocked `run` for more than 122 seconds.
The documented deadline was 120 seconds.
Closing the pipe returned `output_error`.
The mock received zero signing requests.
I did not repeat the 122-second test.

## Focused offline tests

Command:

```sh
go test -race \
  -run 'Test(ListAndSignOutputFailure|DiagnosticFailurePreventsSigning|AgentReadDeadlineReturnsTimeout)$' \
  -count=1 .
```

Working directory: `/private/tmp/walleterm-audit-40d6cca9db73`.

- First run: `blocked` by sandbox Unix-socket restrictions.
- Permitted rerun: `passed` in `1.273s`.
- Output: `ok walleterm`.

These tests used isolated mock keys and local Unix sockets.
They requested no 1Password signature.
They used no Stellar network.

## Environment

- Operating system: `Darwin`.
- Go target: `darwin/arm64`.
- Go version: `go1.27.1`.

## Research usage

No external research was necessary.
The frozen code, interface, and preserved reproduction resolved the concern.
New research cost was `$0`.
Jev usage was `$0`.
