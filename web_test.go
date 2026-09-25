package main

import (
	"strings"
	"testing"
)

func TestParseWebOptions(t *testing.T) {
	signer := "GCECPDMQIBQCW3ZTQPRAN5UQXQZVZGI5OKYKRDGNZGW4HQYESDJ7SZBG"
	recipient := "GDAYLQYJ5TFW4SKZAXJFGX65GUALBBQ5C3UINZEJK66IAAEAGORJADBL"
	options, err := parseWebOptions([]string{"--signer", signer, "--recipient", recipient, "--port", "8791", "--human"})
	if err != nil || options.port != 8791 || !options.human || !strings.HasSuffix(options.stateDir, "/walleterm/web") {
		t.Fatalf("unexpected web options: %+v, %v", options, err)
	}
	for _, args := range [][]string{
		{"--signer", signer, "--recipient", recipient, "--port", "0"},
		{"--signer", recipient, "--recipient", "BAD"},
		{"--signer", signer, "--recipient", recipient, "extra"},
	} {
		if _, err := parseWebOptions(args); err == nil {
			t.Fatalf("accepted invalid options: %v", args)
		}
	}
}
