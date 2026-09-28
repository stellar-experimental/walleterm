package main

import (
	"encoding/json"
	"flag"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
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
			vaultHelp = "Set OP_VAULT in the shell or working directory's .env to filter website wallets by vault name or ID.\nShell values override .env. Filtering requires the 1Password CLI.\n"
		}
		return writeOutput(out, serviceUsage(command)+"\nRequires cloudflared. Shows public links and QR codes.\nThe signing bridge requires macOS and the 1Password SSH agent.\n"+vaultHelp+"Press Ctrl+C to stop this service.\n")
	}
	config, err := parseServiceOptions(command, args)
	if err != nil {
		return outputError(out, true, err)
	}
	if command == "tunnel" && runtime.GOOS != "darwin" {
		return outputError(out, true, failure("unsupported_platform", "The signing bridge requires macOS."))
	}
	if _, err := exec.LookPath("cloudflared"); err != nil {
		return outputError(out, true, failure("start_failed", "Install cloudflared. On macOS, run: brew install cloudflared"))
	}
	bridge, binary, err := bridgePath()
	if err != nil {
		return outputError(out, true, err)
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
	if err := syscall.Exec(bridge, []string{bridge, command, string(encoded)}, environment); err != nil {
		return outputError(out, true, failure("start_failed", "The service could not start."))
	}
	return 0
}

// Each release keeps walleterm-bridge beside the Go binary. Resolve links so the pair always matches.
func bridgePath() (string, string, error) {
	binary, err := os.Executable()
	if err != nil {
		return "", "", err
	}
	binary, err = filepath.EvalSymlinks(binary)
	if err != nil {
		return "", "", err
	}
	bridge := filepath.Join(filepath.Dir(binary), "walleterm-bridge")
	if info, err := os.Stat(bridge); err != nil || !info.Mode().IsRegular() {
		return "", "", failure("start_failed", "The walleterm-bridge binary is missing. Reinstall walleterm.")
	}
	return bridge, binary, nil
}
