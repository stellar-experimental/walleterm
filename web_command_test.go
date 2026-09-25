package main

import (
	"slices"
	"testing"
)

func TestWebCommandOptionalSigner(t *testing.T) {
	config := webOptions{recipient: "GRECIPIENT", port: 8787, stateDir: "/tmp/journal"}
	command := webCommand("node", "/tmp/launcher.mjs", config)
	if slices.Contains(command, "--signer") || slices.Contains(command, "") {
		t.Fatalf("the optional signer produced invalid arguments: %q", command)
	}
	config.signer = "GSIGNER"
	command = webCommand("node", "/tmp/launcher.mjs", config)
	if !slices.Contains(command, "--signer") || !slices.Contains(command, "GSIGNER") {
		t.Fatalf("the signer was not passed: %q", command)
	}
}
