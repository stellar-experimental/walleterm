package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestAuthorizationDispatch(t *testing.T) {
	var output bytes.Buffer
	if code := run([]string{"sign-auth", "--help"}, strings.NewReader(""), &output, &output, ""); code != 0 || !strings.Contains(output.String(), "sign-auth") {
		t.Fatalf("invalid authorization help: %d %s", code, output.String())
	}
	for _, args := range [][]string{{"sign-auth", "--human"}, {"sign-auth", "--digest", "00"}, {"sign-auth", "extra"}} {
		output.Reset()
		if code := run(args, strings.NewReader(""), &output, &output, ""); code != 2 || !strings.Contains(output.String(), `"invalid_input"`) {
			t.Fatalf("invalid authorization arguments accepted: %v %d %s", args, code, output.String())
		}
	}
}
