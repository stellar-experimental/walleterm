package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestServiceOptions(t *testing.T) {
	tunnel, err := parseServiceOptions("tunnel", nil)
	if err != nil || tunnel.Port != 8787 {
		t.Fatalf("bad tunnel options: %+v %v", tunnel, err)
	}
	demo, err := parseServiceOptions("demo", nil)
	if err != nil || demo.Port != 8788 {
		t.Fatalf("bad demo options: %+v %v", demo, err)
	}
	for _, command := range []string{"tunnel", "demo"} {
		for _, args := range [][]string{{"--human"}, {"--public"}, {"--recipient", "GTEST"}, {"--port", "0"}, {"extra"}} {
			if _, err := parseServiceOptions(command, args); err == nil {
				t.Fatalf("accepted %s %v", command, args)
			}
		}
	}
	if _, err := parseServiceOptions("tunnel", []string{"--state-dir", "/tmp/state"}); err == nil {
		t.Fatal("tunnel accepted a state directory")
	}
}

func TestSeparatedHelp(t *testing.T) {
	for _, command := range []string{"tunnel", "demo"} {
		var output bytes.Buffer
		if code := runServiceCommand(command, []string{"--help"}, &output); code != 0 || !strings.Contains(output.String(), "walleterm "+command) || strings.Contains(output.String(), "--recipient") || strings.Contains(output.String(), "--human") || strings.Contains(output.String(), "--public") {
			t.Fatalf("bad help: %d %s", code, output.String())
		}
	}
}

func TestBunVersion(t *testing.T) {
	for _, version := range []string{"1.4.2", "1.4.3", "1.5.0", "2.0.0", "v1.4.2"} {
		if !supportedBunVersion(version) {
			t.Fatalf("rejected %s", version)
		}
	}
	for _, version := range []string{"", "1", "1.4", "1.4.1", "1.3.99", "0.9.0", "1.4.2-canary", "2.bad.0"} {
		if supportedBunVersion(version) {
			t.Fatalf("accepted %s", version)
		}
	}
}
