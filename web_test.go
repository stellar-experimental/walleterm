package main

import (
	"strings"
	"testing"
)

func TestServiceOptions(t *testing.T) {
	tunnel, err := parseServiceOptions("tunnel", nil)
	if err != nil || tunnel.Port != 8787 || !strings.HasSuffix(tunnel.StateDir, "/walleterm/bridge") {
		t.Fatalf("bad tunnel options: %+v %v", tunnel, err)
	}
	demo, err := parseServiceOptions("demo", nil)
	if err != nil || demo.Port != 8788 || demo.StateDir != "" {
		t.Fatalf("bad demo options: %+v %v", demo, err)
	}
	for _, command := range []string{"tunnel", "demo"} {
		for _, args := range [][]string{{"--human"}, {"--public"}, {"--recipient", "GTEST"}, {"--port", "0"}, {"extra"}} {
			if _, err := parseServiceOptions(command, args); err == nil {
				t.Fatalf("accepted %s %v", command, args)
			}
		}
	}
	if _, err := parseServiceOptions("demo", []string{"--state-dir", "/tmp/state"}); err == nil {
		t.Fatal("demo accepted bridge configuration")
	}
}
