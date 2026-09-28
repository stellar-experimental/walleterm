package main

import (
	"io"
	"syscall"
)

// The sidecar owns XDR and adapter logic. The existing sign command owns the socket.
func runAuthCommand(args []string, out io.Writer) int {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		return writeOutput(out, "walleterm sign-auth < request.json\nSign one explicit authorization entry. See docs/INTERFACE.md.\n")
	}
	if len(args) != 0 {
		return outputError(out, false, failure("invalid_input", "Use walleterm sign-auth < request.json."))
	}
	bridge, binary, err := bridgePath()
	if err != nil {
		return outputError(out, false, err)
	}
	// Pass the resolved executable as an argument. The caller cannot substitute another signer.
	if err := syscall.Exec(bridge, []string{bridge, "sign-auth", binary}, bridgeEnvironment()); err != nil {
		return outputError(out, false, failure("start_failed", "The authorization service could not start."))
	}
	return 0
}
