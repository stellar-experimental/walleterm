package main

import (
	"bytes"
	"crypto/ed25519"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// SEP-23 v1.3.0, valid non-multiplexed account test case.
const sep23Address = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ"
const sep23Key = "3f0c34bf93ad0d9971d04ccc90f705511c838aad9734a4a2fb0d7a03fc7fe89a" // gitleaks:allow -- Published public-key test vector.

func TestStrKeyPublishedVector(t *testing.T) {
	key, _ := hex.DecodeString(sep23Key)
	if got := encodeAddress(key); got != sep23Address {
		t.Fatalf("encode = %s", got)
	}
	decoded, err := decodeAddress(sep23Address)
	if err != nil || !bytes.Equal(decoded, key) {
		t.Fatalf("decode = %x, %v", decoded, err)
	}
	for _, bad := range []string{
		strings.ToLower(sep23Address),
		sep23Address[:55] + "A",
		sep23Address + "A",
		"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHG",
		"S" + sep23Address[1:],
	} {
		if _, err := decodeAddress(bad); err == nil {
			t.Errorf("accepted %q", bad)
		}
	}
}

// The stellar-strkey Rust crate publishes this independent zero-key example.
func TestStrKeyIndependentZeroVector(t *testing.T) {
	const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
	key := make([]byte, 32)
	if got := encodeAddress(key); got != address {
		t.Fatalf("encode = %s", got)
	}
	decoded, err := decodeAddress(address)
	if err != nil || !bytes.Equal(decoded, key) {
		t.Fatalf("decode = %x, %v", decoded, err)
	}
}

func TestInputStrictness(t *testing.T) {
	digest := strings.Repeat("ab", 32)
	valid := fmt.Sprintf(`{"public_key":"%s","digest":"%s"}`, sep23Address, digest)
	if key, value, raw, err := parseInput(strings.NewReader(valid)); err != nil || key != sep23Address || value != digest || len(raw) != 32 {
		t.Fatalf("valid input: %q %q %x %v", key, value, raw, err)
	}
	for _, input := range []string{
		"", "null", "[]", valid + "{}", valid + "x",
		fmt.Sprintf(`{"public_key":"%s","public_key":"%s","digest":"%s"}`, sep23Address, sep23Address, digest),
		fmt.Sprintf(`{"public_key":"%s","\u0064igest":"%s","digest":"%s"}`, sep23Address, digest, digest),
		fmt.Sprintf(`{"public_key":"%s","digest":"%s","extra":"x"}`, sep23Address, digest),
		fmt.Sprintf(`{"public_key":"%s","digest":12}`, sep23Address),
		fmt.Sprintf(`{"public_key":"%s","digest":"%s"}`, sep23Address, strings.ToUpper(digest)),
		strings.Repeat(" ", maxInput+1),
	} {
		if _, _, _, err := parseInput(strings.NewReader(input)); err == nil {
			t.Errorf("accepted input %q", input)
		}
	}
}

func mockKey() (ed25519.PublicKey, ed25519.PrivateKey) {
	// This fixed, offline test key is never used for an account or a transaction.
	private := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{7}, 32))
	return private.Public().(ed25519.PublicKey), private
}

func keyBlob(key ed25519.PublicKey) []byte {
	return putString(putString(nil, []byte("ssh-ed25519")), key)
}

func writeFrame(c net.Conn, body []byte) error {
	frame := binary.BigEndian.AppendUint32(nil, uint32(len(body)))
	_, err := c.Write(append(frame, body...))
	return err
}

func readFrame(c net.Conn) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(c, header[:]); err != nil {
		return nil, err
	}
	body := make([]byte, binary.BigEndian.Uint32(header[:]))
	_, err := io.ReadFull(c, body)
	return body, err
}

func mockSocket(t *testing.T, serve func(net.Conn) error) (string, <-chan error) {
	t.Helper()
	dir, err := os.MkdirTemp("/private/tmp", "wt-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "agent.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		defer listener.Close()
		conn, err := listener.Accept()
		if err == nil {
			defer conn.Close()
			err = serve(conn)
		}
		done <- err
	}()
	return path, done
}

func identities(blob []byte, comment string) []byte {
	b := binary.BigEndian.AppendUint32([]byte{12}, 1)
	b = putString(b, blob)
	return putString(b, []byte(comment))
}

func TestListAndSignWithOfflineMock(t *testing.T) {
	key, private := mockKey()
	blob := keyBlob(key)
	address := encodeAddress(key)
	digest := strings.Repeat("01", 32)
	for _, command := range []string{"list", "sign"} {
		t.Run(command, func(t *testing.T) {
			path, done := mockSocket(t, func(c net.Conn) error {
				request, err := readFrame(c)
				if err != nil || !bytes.Equal(request, []byte{11}) {
					return fmt.Errorf("identities request: %x %v", request, err)
				}
				if err := writeFrame(c, identities(blob, "offline mock")); err != nil {
					return err
				}
				if command == "list" {
					return nil
				}
				request, err = readFrame(c)
				if err != nil {
					return err
				}
				p := parser{request}
				kind, _ := p.byte()
				selected, _ := p.string()
				payload, _ := p.string()
				flags, _ := p.uint32()
				want, _ := hex.DecodeString(digest)
				if kind != 13 || !bytes.Equal(selected, blob) || !bytes.Equal(payload, want) || flags != 0 || len(p.data) != 0 {
					return fmt.Errorf("invalid sign request")
				}
				signed := putString(putString(nil, []byte("ssh-ed25519")), ed25519.Sign(private, payload))
				return writeFrame(c, putString([]byte{14}, signed))
			})
			var out, diagnostic bytes.Buffer
			input := fmt.Sprintf(`{"public_key":"%s","digest":"%s"}`, address, digest)
			if code := run([]string{command}, strings.NewReader(input), &out, &diagnostic, path); code != 0 {
				t.Fatalf("exit %d: %s", code, out.String())
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			var result map[string]any
			if err := json.Unmarshal(out.Bytes(), &result); err != nil || result["ok"] != true {
				t.Fatalf("output: %s %v", out.String(), err)
			}
			if command == "sign" {
				if result["verified"] != true || len(result["signature"].(string)) != 128 || !strings.Contains(diagnostic.String(), digest) {
					t.Fatalf("sign output or notice: %s %s", out.String(), diagnostic.String())
				}
			} else if len(result["signers"].([]any)) != 1 {
				t.Fatalf("list output: %s", out.String())
			}
		})
	}
}

func TestProtocolFailures(t *testing.T) {
	key, _ := mockKey()
	blob := keyBlob(key)
	input := fmt.Sprintf(`{"public_key":"%s","digest":"%s"}`, encodeAddress(key), strings.Repeat("00", 32))
	for _, tc := range []struct {
		name, code string
		response   []byte
	}{
		{"refused", "signing_refused", []byte{5}},
		{"wrong algorithm", "agent_protocol", putString([]byte{14}, putString(putString(nil, []byte("ssh-rsa")), bytes.Repeat([]byte{1}, 64)))},
		{"bad signature", "invalid_signature", putString([]byte{14}, putString(putString(nil, []byte("ssh-ed25519")), bytes.Repeat([]byte{1}, 64)))},
		{"trailing", "agent_protocol", append(putString([]byte{14}, putString(putString(nil, []byte("ssh-ed25519")), bytes.Repeat([]byte{1}, 64))), 0)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path, done := mockSocket(t, func(c net.Conn) error {
				if _, err := readFrame(c); err != nil {
					return err
				}
				if err := writeFrame(c, identities(blob, "mock")); err != nil {
					return err
				}
				if _, err := readFrame(c); err != nil {
					return err
				}
				return writeFrame(c, tc.response)
			})
			var out bytes.Buffer
			if code := run([]string{"sign"}, strings.NewReader(input), &out, io.Discard, path); code != 1 {
				t.Fatalf("exit %d: %s", code, out.String())
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(out.String(), `"code":"`+tc.code+`"`) {
				t.Fatalf("output: %s", out.String())
			}
		})
	}
}

func TestKeyNotFoundNeverRequestsSignature(t *testing.T) {
	listed, _ := mockKey()
	other := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{8}, 32)).Public().(ed25519.PublicKey)
	path, done := mockSocket(t, func(c net.Conn) error {
		if _, err := readFrame(c); err != nil {
			return err
		}
		if err := writeFrame(c, identities(keyBlob(listed), "listed")); err != nil {
			return err
		}
		_ = c.SetReadDeadline(time.Now().Add(time.Second))
		if request, err := readFrame(c); !errors.Is(err, io.EOF) {
			return fmt.Errorf("unexpected follow-up request %x: %v", request, err)
		}
		return nil
	})
	input := fmt.Sprintf(`{"public_key":"%s","digest":"%s"}`, encodeAddress(other), strings.Repeat("00", 32))
	var out, diagnostic bytes.Buffer
	if code := run([]string{"sign"}, strings.NewReader(input), &out, &diagnostic, path); code != 1 {
		t.Fatalf("exit %d: %s", code, out.String())
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), `"code":"key_not_found"`) || diagnostic.Len() != 0 {
		t.Fatalf("output: %s, notice: %s", out.String(), diagnostic.String())
	}
}

func TestUnsupportedRSAIdentityIsSkipped(t *testing.T) {
	key, _ := mockKey()
	rsa := putString(putString(putString(nil, []byte("ssh-rsa")), []byte{1, 0, 1}), []byte{1})
	response := binary.BigEndian.AppendUint32([]byte{12}, 2)
	response = putString(putString(response, rsa), []byte("RSA"))
	response = putString(putString(response, keyBlob(key)), []byte("Ed25519"))
	path, done := mockSocket(t, func(c net.Conn) error {
		if _, err := readFrame(c); err != nil {
			return err
		}
		return writeFrame(c, response)
	})
	var out bytes.Buffer
	if code := run([]string{"list"}, strings.NewReader(""), &out, io.Discard, path); code != 0 {
		t.Fatalf("exit %d: %s", code, out.String())
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	var result struct {
		Signers []signer `json:"signers"`
	}
	if err := json.Unmarshal(out.Bytes(), &result); err != nil || len(result.Signers) != 1 || result.Signers[0].PublicKey != encodeAddress(key) {
		t.Fatalf("signers: %s, %v", out.String(), err)
	}
}

func TestWorldWritableUnixSocketIsRejected(t *testing.T) {
	dir, err := os.MkdirTemp("/private/tmp", "wt-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	path := filepath.Join(dir, "agent.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if code := run([]string{"list"}, strings.NewReader(""), &out, io.Discard, path); code != 1 || !strings.Contains(out.String(), `"code":"agent_unavailable"`) {
		t.Fatalf("exit %d: %s", code, out.String())
	}
}

func TestAgentReadDeadlineReturnsTimeout(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	requestRead := make(chan struct{})
	go func() {
		_, _ = readFrame(server)
		close(requestRead)
	}()
	_ = client.SetDeadline(time.Now().Add(50 * time.Millisecond))
	_, err := listSigners(client)
	<-requestRead
	var cli *cliError
	if !errors.As(err, &cli) || cli.Code != "timeout" {
		t.Fatalf("want timeout, got %v", err)
	}
}

func TestInputReadDeadlineReturnsTimeout(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	if err := reader.SetReadDeadline(time.Now().Add(50 * time.Millisecond)); err != nil {
		t.Fatal(err)
	}
	_, _, _, err = parseInput(reader)
	var cli *cliError
	if !errors.As(err, &cli) || cli.Code != "timeout" {
		t.Fatalf("want timeout, got %v", err)
	}
}

func TestBoundsAndSocketChecks(t *testing.T) {
	for _, body := range [][]byte{{}, {12, 0, 0, 4, 1}, {12, 0, 0, 0, 0, 0}, binary.BigEndian.AppendUint32([]byte{12}, maxIdentities+1)} {
		c1, c2 := net.Pipe()
		go func() {
			defer c2.Close()
			_, _ = readFrame(c2)
			_ = writeFrame(c2, body)
		}()
		_ = c1.SetDeadline(time.Now().Add(time.Second))
		_, err := listSigners(c1)
		c1.Close()
		if err == nil {
			t.Fatalf("accepted malformed identities %x", body)
		}
	}
	c1, c2 := net.Pipe()
	go func() {
		defer c2.Close()
		_, _ = readFrame(c2)
		_, _ = c2.Write(binary.BigEndian.AppendUint32(nil, maxFrame+1))
	}()
	_ = c1.SetDeadline(time.Now().Add(time.Second))
	if _, err := exchange(c1, []byte{11}); err == nil {
		t.Fatal("accepted oversized frame")
	}
	c1.Close()
	for _, mode := range []os.FileMode{0644, 0600} {
		path := filepath.Join(t.TempDir(), "not-socket")
		if err := os.WriteFile(path, nil, mode); err != nil {
			t.Fatal(err)
		}
		if err := checkSocket(path); err == nil {
			t.Fatal("accepted regular file")
		}
	}
	if err := checkSocket(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("accepted missing socket")
	}
	var out bytes.Buffer
	if code := run([]string{"sign"}, strings.NewReader("{}"), &out, io.Discard, ""); code != 2 || !strings.Contains(out.String(), "invalid_input") {
		t.Fatalf("input before socket: %d %s", code, out.String())
	}
	if err := frameError(os.ErrDeadlineExceeded); err == nil {
		t.Fatal("missing timeout")
	} else {
		var e *cliError
		if !errors.As(err, &e) || e.Code != "timeout" {
			t.Fatalf("timeout: %v", err)
		}
	}
}

func TestHelpVersionAndHuman(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want string
	}{
		{[]string{"--help"}, "walleterm sign"},
		{[]string{"--version"}, "walleterm " + version},
		{[]string{"list", "--human"}, "agent_unavailable:"},
	} {
		var out bytes.Buffer
		run(tc.args, strings.NewReader(""), &out, io.Discard, "/missing")
		if !strings.Contains(out.String(), tc.want) {
			t.Fatalf("%v: %s", tc.args, out.String())
		}
	}
}

func TestHumanCommentIsQuoted(t *testing.T) {
	key, _ := mockKey()
	path, done := mockSocket(t, func(c net.Conn) error {
		if _, err := readFrame(c); err != nil {
			return err
		}
		return writeFrame(c, identities(keyBlob(key), "name\x1b[31m\nnext"))
	})
	var out bytes.Buffer
	if code := run([]string{"list", "--human"}, strings.NewReader(""), &out, io.Discard, path); code != 0 {
		t.Fatalf("exit %d: %s", code, out.String())
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if strings.ContainsRune(out.String(), '\x1b') || !strings.Contains(out.String(), `"name\x1b[31m\nnext"`) {
		t.Fatalf("unsafe comment: %q", out.String())
	}
}

type shortWriter struct{ net.Conn }

func (c shortWriter) Write(b []byte) (int, error) {
	if len(b) > 2 {
		b = b[:2]
	}
	return c.Conn.Write(b)
}

func TestExchangeHandlesShortWrites(t *testing.T) {
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()
	done := make(chan error, 1)
	go func() {
		request, err := readFrame(server)
		if err == nil && !bytes.Equal(request, []byte{11}) {
			err = fmt.Errorf("request = %x", request)
		}
		if err == nil {
			err = writeFrame(server, []byte{12, 0, 0, 0, 0})
		}
		done <- err
	}()
	_ = client.SetDeadline(time.Now().Add(time.Second))
	response, err := exchange(shortWriter{client}, []byte{11})
	if err != nil || !bytes.Equal(response, []byte{12, 0, 0, 0, 0}) {
		t.Fatalf("response = %x, %v", response, err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

type failingOutput struct {
	short bool
	calls int
}

func (w *failingOutput) Write(p []byte) (int, error) {
	w.calls++
	if w.short {
		return len(p) - 1, nil
	}
	return 0, io.ErrClosedPipe
}

func TestHelpAndVersionOutputFailure(t *testing.T) {
	for _, command := range []string{"--help", "-h", "--version"} {
		for _, short := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/short=%t", command, short), func(t *testing.T) {
				out := &failingOutput{short: short}
				if code := run([]string{command}, strings.NewReader(""), out, io.Discard, "/unused"); code != 1 {
					t.Fatalf("exit = %d, want 1", code)
				}
				if out.calls != 1 {
					t.Fatalf("output writes = %d, want 1", out.calls)
				}
			})
		}
	}
}

func TestListAndSignOutputFailure(t *testing.T) {
	key, private := mockKey()
	blob := keyBlob(key)
	digest := bytes.Repeat([]byte{1}, 32)
	input := fmt.Sprintf(`{"public_key":"%s","digest":"%x"}`, encodeAddress(key), digest)
	for _, command := range []string{"list", "sign"} {
		for _, human := range []bool{false, true} {
			for _, short := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/human=%t/short=%t", command, human, short), func(t *testing.T) {
					signRequests := 0
					path, done := mockSocket(t, func(c net.Conn) error {
						_ = c.SetDeadline(time.Now().Add(2 * time.Second))
						request, err := readFrame(c)
						if err != nil || !bytes.Equal(request, []byte{11}) {
							return fmt.Errorf("identities request: %x %v", request, err)
						}
						if err := writeFrame(c, identities(blob, "offline mock")); err != nil {
							return err
						}
						if command == "sign" {
							request, err = readFrame(c)
							if err != nil {
								return err
							}
							want := binary.BigEndian.AppendUint32(putString(putString([]byte{13}, blob), digest), 0)
							if !bytes.Equal(request, want) {
								return fmt.Errorf("unexpected signing request: %x", request)
							}
							signRequests++
							signed := putString(putString(nil, []byte("ssh-ed25519")), ed25519.Sign(private, digest))
							if err := writeFrame(c, putString([]byte{14}, signed)); err != nil {
								return err
							}
						}
						if request, err := readFrame(c); !errors.Is(err, io.EOF) {
							return fmt.Errorf("unexpected follow-up request %x: %v", request, err)
						}
						return nil
					})
					out := &failingOutput{short: short}
					args := []string{command}
					if human {
						args = append(args, "--human")
					}
					code := run(args, strings.NewReader(input), out, io.Discard, path)
					if err := <-done; err != nil {
						t.Fatal(err)
					}
					if code != 1 || out.calls != 1 {
						t.Fatalf("exit = %d, output writes = %d; want 1, 1", code, out.calls)
					}
					want := 0
					if command == "sign" {
						want = 1
					}
					if signRequests != want {
						t.Fatalf("sign requests = %d, want %d", signRequests, want)
					}
				})
			}
		}
	}
}

func TestDiagnosticFailurePreventsSigning(t *testing.T) {
	key, _ := mockKey()
	input := fmt.Sprintf(`{"public_key":"%s","digest":"%s"}`, encodeAddress(key), strings.Repeat("01", 32))
	for _, human := range []bool{false, true} {
		for _, short := range []bool{false, true} {
			t.Run(fmt.Sprintf("human=%t/short=%t", human, short), func(t *testing.T) {
				path, done := mockSocket(t, func(c net.Conn) error {
					_ = c.SetDeadline(time.Now().Add(2 * time.Second))
					request, err := readFrame(c)
					if err != nil || !bytes.Equal(request, []byte{11}) {
						return fmt.Errorf("identities request: %x %v", request, err)
					}
					if err := writeFrame(c, identities(keyBlob(key), "offline mock")); err != nil {
						return err
					}
					if request, err := readFrame(c); !errors.Is(err, io.EOF) {
						return fmt.Errorf("expected no signing request, got %x: %v", request, err)
					}
					return nil
				})
				var out bytes.Buffer
				diagnostic := &failingOutput{short: short}
				args := []string{"sign"}
				if human {
					args = append(args, "--human")
				}
				code := run(args, strings.NewReader(input), &out, diagnostic, path)
				if err := <-done; err != nil {
					t.Fatal(err)
				}
				if code != 1 || diagnostic.calls != 1 {
					t.Fatalf("exit = %d, diagnostic writes = %d; want 1, 1", code, diagnostic.calls)
				}
				if human {
					if !strings.HasPrefix(out.String(), "output_error: ") {
						t.Fatalf("output: %s", out.String())
					}
				} else {
					var result struct {
						OK    bool     `json:"ok"`
						Error cliError `json:"error"`
					}
					if err := json.Unmarshal(out.Bytes(), &result); err != nil || result.OK || result.Error.Code != "output_error" {
						t.Fatalf("output: %s, error: %v", out.String(), err)
					}
				}
			})
		}
	}
}
