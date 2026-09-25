package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestSeparatedHelp(t *testing.T) {
	for _, command := range []string{"tunnel", "demo"} {
		var output bytes.Buffer
		if code := runServiceCommand(command, []string{"--help"}, &output); code != 0 || !strings.Contains(output.String(), "walleterm "+command) || strings.Contains(output.String(), "--recipient") || strings.Contains(output.String(), "--human") || strings.Contains(output.String(), "--public") {
			t.Fatalf("bad help: %d %s", code, output.String())
		}
	}
}
