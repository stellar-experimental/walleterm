package main

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// The sidecar owns XDR and adapter logic. The existing sign command owns the socket.
func runAuthCommand(args []string, out io.Writer) int {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		return writeOutput(out, "walleterm sign-auth < request.json\nSign one explicit authorization entry. See docs/INTERFACE.md.\n")
	}
	if len(args) != 0 {
		return outputError(out, false, failure("invalid_input", "Use walleterm sign-auth < request.json."))
	}
	bun, err := exec.LookPath("bun")
	if err != nil {
		return outputError(out, false, failure("start_failed", "Install Bun 1.4.2 or later."))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	version, err := exec.CommandContext(ctx, bun, "--version").Output()
	if err != nil || !supportedBunVersion(strings.TrimSpace(string(version))) {
		return outputError(out, false, failure("start_failed", "Install Bun 1.4.2 or later."))
	}
	binary, err := os.Executable()
	if err != nil {
		return outputError(out, false, err)
	}
	binary, err = filepath.EvalSymlinks(binary)
	if err != nil {
		return outputError(out, false, err)
	}
	entry := filepath.Join(filepath.Dir(binary), "..", "bridge", "auth-cli.ts")
	if info, err := os.Stat(entry); err != nil || info.IsDir() {
		return outputError(out, false, failure("start_failed", "The authorization files are missing. Run make install."))
	}
	// Pass the resolved executable as an argument. The caller cannot substitute another signer.
	if err := syscall.Exec(bun, []string{bun, "--no-env-file", entry, binary}, os.Environ()); err != nil {
		return outputError(out, false, failure("start_failed", "The authorization service could not start."))
	}
	return 0
}
