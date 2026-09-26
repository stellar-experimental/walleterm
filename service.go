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
		return writeOutput(out, serviceUsage(command)+"\nRequires Node.js 22 or later and cloudflared. Shows public links and QR codes.\nThe signing bridge requires macOS and the 1Password SSH agent.\nPress Ctrl+C to stop this service.\n")
	}
	config, err := parseServiceOptions(command, args)
	if err != nil {
		return outputError(out, true, err)
	}
	if command == "tunnel" && runtime.GOOS != "darwin" {
		return outputError(out, true, failure("unsupported_platform", "The signing bridge requires macOS."))
	}
	node, err := exec.LookPath("node")
	if err != nil {
		return outputError(out, true, failure("start_failed", "Install Node.js 22 or later. On macOS, run: brew install node"))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	version, versionErr := exec.CommandContext(ctx, node, "--version").Output()
	major, parseErr := strconv.Atoi(strings.Split(strings.TrimPrefix(strings.TrimSpace(string(version)), "v"), ".")[0])
	if versionErr != nil || parseErr != nil || major < 22 {
		return outputError(out, true, failure("start_failed", "Install Node.js 22 or later."))
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
	entry := filepath.Clean(filepath.Join(filepath.Dir(binary), "..", directory, "entry.mjs"))
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
	if err := syscall.Exec(node, []string{node, entry, string(encoded)}, environment); err != nil {
		return outputError(out, true, failure("start_failed", "The service could not start."))
	}
	return 0
}
