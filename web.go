package main

import (
	"flag"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

type webOptions struct {
	signer    string
	recipient string
	stateDir  string
	port      int
	human     bool
}

func parseWebOptions(args []string) (webOptions, error) {
	var result webOptions
	flags := flag.NewFlagSet("web", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.StringVar(&result.signer, "signer", "", "testnet signer G-address")
	flags.StringVar(&result.recipient, "recipient", "", "testnet recipient G-address")
	flags.StringVar(&result.stateDir, "state-dir", "", "durable web journal directory")
	flags.IntVar(&result.port, "port", 8787, "loopback server port")
	flags.BoolVar(&result.human, "human", false, "show pairing link and QR code")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 {
		return result, failure("invalid_input", "Use web with --signer, --recipient, and optional --port, --state-dir, --human.")
	}
	if _, err := decodeAddress(result.signer); err != nil {
		return result, failure("invalid_input", "The signer must be a canonical Ed25519 G-address.")
	}
	if _, err := decodeAddress(result.recipient); err != nil {
		return result, failure("invalid_input", "The recipient must be a canonical Ed25519 G-address.")
	}
	if result.port < 1 || result.port > 65535 {
		return result, failure("invalid_input", "The port must be between 1 and 65535.")
	}
	if result.stateDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return result, failure("web_start_failed", "The home directory is unavailable.")
		}
		result.stateDir = filepath.Join(home, "Library", "Application Support", "walleterm", "web")
	}
	absolute, err := filepath.Abs(result.stateDir)
	if err != nil {
		return result, failure("invalid_input", "The state directory is invalid.")
	}
	result.stateDir = absolute
	return result, nil
}

func webLauncher(executable string) (string, error) {
	base := filepath.Dir(executable)
	for _, candidate := range []string{
		filepath.Join(base, "..", "share", "walleterm", "poc", "launcher.mjs"),
		filepath.Join(base, "..", "poc", "launcher.mjs"),
	} {
		path := filepath.Clean(candidate)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path, nil
		}
	}
	return "", failure("web_start_failed", "The web assets are missing. Run make install from the web proof checkout.")
}

func runWeb(args []string, out io.Writer) int {
	config, err := parseWebOptions(args)
	if err != nil {
		return outputError(out, config.human, err)
	}
	if runtime.GOOS != "darwin" {
		return outputError(out, config.human, failure("unsupported_platform", "The 1Password web companion requires macOS."))
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return outputError(out, config.human, failure("web_start_failed", "Install Node.js to run the web companion."))
	}
	if _, err := exec.LookPath("cloudflared"); err != nil {
		return outputError(out, config.human, failure("web_start_failed", "Install cloudflared to run the web companion."))
	}
	binary, err := os.Executable()
	if err != nil {
		return outputError(out, config.human, failure("web_start_failed", "The walleterm executable path is unavailable."))
	}
	binary, err = filepath.EvalSymlinks(binary)
	if err != nil {
		return outputError(out, config.human, failure("web_start_failed", "The walleterm executable path is invalid."))
	}
	launcher, err := webLauncher(binary)
	if err != nil {
		return outputError(out, config.human, err)
	}
	command := []string{node, launcher, "--signer", config.signer, "--recipient", config.recipient,
		"--port", strconv.Itoa(config.port), "--state-dir", config.stateDir}
	if config.human {
		command = append(command, "--human")
	}
	environment := make([]string, 0, len(os.Environ())+1)
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "WALLETERM_BINARY=") {
			environment = append(environment, entry)
		}
	}
	environment = append(environment, "WALLETERM_BINARY="+binary)
	if err := syscall.Exec(node, command, environment); err != nil {
		return outputError(out, config.human, failure("web_start_failed", "The web companion could not start."))
	}
	return 0
}
