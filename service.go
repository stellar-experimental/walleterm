package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type serviceOptions struct {
	Port int `json:"port"`
}

func serviceUsage(command string) string {
	if command == "tunnel" {
		return "walleterm tunnel [--port 8787]"
	}
	return "walleterm demo [--port 8788]"
}

func parseServiceOptions(command string, args []string) (serviceOptions, error) {
	var config serviceOptions
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	port := 8788
	if command == "tunnel" {
		port = 8787
	}
	flags.IntVar(&config.Port, "port", port, "loopback server port")
	if err := flags.Parse(args); err != nil || flags.NArg() != 0 || config.Port < 1 || config.Port > 65535 {
		return config, failure("invalid_input", "Use "+serviceUsage(command)+".")
	}
	return config, nil
}

func runServiceCommand(command string, args []string, out io.Writer) int {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		vaultHelp := ""
		if command == "tunnel" {
			vaultHelp = "Set OP_VAULT to a vault name or ID to filter website wallets. Filtering requires the 1Password CLI.\n"
		}
		return writeOutput(out, serviceUsage(command)+"\nRequires Bun 1.4.2 or later and cloudflared. Shows public links and QR codes.\nThe signing bridge requires macOS and the 1Password SSH agent.\n"+vaultHelp+"Press Ctrl+C to stop this service.\n")
	}
	config, err := parseServiceOptions(command, args)
	if err != nil {
		return outputError(out, true, err)
	}
	if command == "tunnel" && runtime.GOOS != "darwin" {
		return outputError(out, true, failure("unsupported_platform", "The signing bridge requires macOS."))
	}
	bun, err := exec.LookPath("bun")
	if err != nil {
		return outputError(out, true, failure("start_failed", "Install Bun 1.4.2 or later. On macOS, run: brew install bun"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	version, versionErr := exec.CommandContext(ctx, bun, "--version").Output()
	if versionErr != nil || !supportedBunVersion(strings.TrimSpace(string(version))) {
		return outputError(out, true, failure("start_failed", "Install Bun 1.4.2 or later."))
	}
	if _, err := exec.LookPath("cloudflared"); err != nil {
		return outputError(out, true, failure("start_failed", "Install cloudflared. On macOS, run: brew install cloudflared"))
	}
	binary, err := os.Executable()
	if err != nil {
		return outputError(out, true, err)
	}
	binary, err = filepath.EvalSymlinks(binary)
	if err != nil {
		return outputError(out, true, err)
	}
	directory := "demo"
	if command == "tunnel" {
		directory = "bridge"
	}
	entry := filepath.Clean(filepath.Join(filepath.Dir(binary), "..", directory, "entry.ts"))
	if info, err := os.Stat(entry); err != nil || info.IsDir() {
		return outputError(out, true, failure("start_failed", "The service files are missing. Run make install from the bridge checkout."))
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return outputError(out, true, err)
	}
	environment := make([]string, 0, len(os.Environ())+1)
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "WALLETERM_BINARY=") {
			environment = append(environment, value)
		}
	}
	environment = append(environment, "WALLETERM_BINARY="+binary)
	if err := syscall.Exec(bun, []string{bun, entry, string(encoded)}, environment); err != nil {
		return outputError(out, true, failure("start_failed", "The service could not start."))
	}
	return 0
}

// Compare only stable releases. The web runtime uses Bun 1.4.2 APIs.
func supportedBunVersion(version string) bool {
	parts := strings.Split(strings.TrimPrefix(version, "v"), ".")
	if len(parts) != 3 {
		return false
	}
	minimum := []int{1, 4, 2}
	values := make([]int, 3)
	for i, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil || n < 0 {
			return false
		}
		values[i] = n
	}
	for i, value := range values {
		if value != minimum[i] {
			return value > minimum[i]
		}
	}
	return true
}
