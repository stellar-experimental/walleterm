package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unicode/utf8"
)

const (
	version       = "0.1.0"
	maxFrame      = 1 << 20
	maxIdentities = 1024
	maxInput      = 4096
)

type cliError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *cliError) Error() string { return e.Message }

func failure(code, message string) error { return &cliError{code, message} }

type signer struct {
	PublicKey   string `json:"public_key"`
	Fingerprint string `json:"fingerprint"`
	Comment     string `json:"comment"`
	blob        []byte
	key         ed25519.PublicKey
}

func main() {
	path := ""
	if runtime.GOOS == "darwin" {
		if account, err := user.LookupId(strconv.Itoa(os.Getuid())); err == nil && account.HomeDir != "" {
			path = filepath.Join(account.HomeDir, "Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock")
		}
	}
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr, path))
}

// The socket path is injectable only through this internal function.
func run(args []string, in io.Reader, out, diagnostic io.Writer, socketPath string) int {
	if len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		return writeOutput(out, `walleterm list [--human]
walleterm sign [--human] < request.json
walleterm tunnel [--port 8787]
walleterm demo [--port 8788]
walleterm --help
walleterm --version

List and sign return JSON by default. --human changes their output format.
Tunnel and demo print readable public links and QR codes.
List output: {"ok":true,"signers":[{"public_key":"G...","fingerprint":"SHA256:...","comment":"..."}]}
Sign input:  {"public_key":"G...","digest":"64 lowercase hexadecimal characters"}
Sign output: {"ok":true,"public_key":"G...","digest":"...","signature":"128 lowercase hexadecimal characters","verified":true}
Finish sign input with EOF.

Use 1Password desktop to create, manage, and approve signers.
Tunnel starts the testnet signing bridge. It prints a connection code and QR code for websites.
OP_VAULT limits website wallets to a 1Password vault name or ID. Filtering requires the 1Password CLI.
OP_VAULT does not filter the local list or sign commands.
A connected website approves its own requests. 1Password can still ask for approval on the Mac.
Demo starts an independent example website with its own temporary public URL and QR code.
The agent signs the 32 digest bytes. It cannot inspect the network, amount, destination, or contract policy.
Inspect the source transaction before you compute the digest. 1Password does not display Stellar transaction details.
Use Stellar CLI to construct, inspect, and submit transactions.
Use Stellar Raven for protocol research and contract discovery.
Companion skill: ~/.agents/skills/walleterm/SKILL.md (install with make install-skill).
`)
	}
	if len(args) == 1 && args[0] == "--version" {
		return writeOutput(out, "walleterm "+version+"\n")
	}
	if len(args) > 0 && (args[0] == "tunnel" || args[0] == "demo") {
		return runServiceCommand(args[0], args[1:], out)
	}
	human := false
	command := ""
	if len(args) > 0 {
		command = args[0]
	}
	if len(args) == 2 && args[1] == "--human" {
		human = true
	} else if len(args) != 1 {
		return outputError(out, human, failure("invalid_input", "Use list or sign with an optional --human flag."))
	}
	if command != "list" && command != "sign" {
		return outputError(out, human, failure("invalid_input", "Use list or sign with an optional --human flag."))
	}

	var publicKey, digestText string
	var digest []byte
	deadline := time.Now().Add(120 * time.Second)
	if command == "sign" {
		if file, ok := in.(*os.File); ok {
			if err := file.SetReadDeadline(deadline); err == nil {
				defer file.SetReadDeadline(time.Time{})
			}
		}
		var err error
		publicKey, digestText, digest, err = parseInput(in)
		if err != nil {
			return outputError(out, human, err)
		}
	}
	if socketPath == "" {
		return outputError(out, human, failure("unsupported_platform", "The 1Password socket is available only on macOS."))
	}
	if err := checkSocket(socketPath); err != nil {
		return outputError(out, human, err)
	}
	conn, err := (&net.Dialer{Deadline: deadline}).Dial("unix", socketPath)
	if err != nil {
		return outputError(out, human, transportError(err))
	}
	defer conn.Close()
	if err := conn.SetDeadline(deadline); err != nil {
		return outputError(out, human, transportError(err))
	}
	signers, err := listSigners(conn)
	if err != nil {
		return outputError(out, human, err)
	}
	if command == "list" {
		if human {
			for _, s := range signers {
				if writeOutput(out, fmt.Sprintf("%s %s %s\n", s.PublicKey, s.Fingerprint, strconv.Quote(s.Comment))) != 0 {
					return 1
				}
			}
		} else {
			return writeOutput(out, jsonLine(struct {
				OK      bool     `json:"ok"`
				Signers []signer `json:"signers"`
			}{true, signers})+"\n")
		}
		return 0
	}
	var selected *signer
	for i := range signers {
		if signers[i].PublicKey == publicKey {
			selected = &signers[i]
			break
		}
	}
	if selected == nil {
		return outputError(out, human, failure("key_not_found", "The selected public key is not available from the agent."))
	}
	if writeOutput(diagnostic, fmt.Sprintf("Request a signature for public key %s and digest %s.\n", publicKey, digestText)) != 0 {
		return outputError(out, human, failure("output_error", "The signing notice could not be written."))
	}
	signature, err := sign(conn, selected.blob, digest)
	if err != nil {
		return outputError(out, human, err)
	}
	if !ed25519.Verify(selected.key, digest, signature) {
		return outputError(out, human, failure("invalid_signature", "The agent signature failed Ed25519 verification."))
	}
	if human {
		return writeOutput(out, fmt.Sprintf("Public key: %s\nDigest: %s\nSignature: %x\nVerified: true\n", publicKey, digestText, signature))
	} else {
		return writeOutput(out, jsonLine(struct {
			OK        bool   `json:"ok"`
			PublicKey string `json:"public_key"`
			Digest    string `json:"digest"`
			Signature string `json:"signature"`
			Verified  bool   `json:"verified"`
		}{true, publicKey, digestText, hex.EncodeToString(signature), true})+"\n")
	}
}

// A failed output write must not report success or trigger a retry.
func writeOutput(out io.Writer, text string) int {
	n, err := io.WriteString(out, text)
	if err != nil || n != len(text) {
		return 1
	}
	return 0
}

func jsonLine(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func outputError(out io.Writer, human bool, err error) int {
	var e *cliError
	if !errors.As(err, &e) {
		e = &cliError{"agent_protocol", "The agent returned invalid data."}
	}
	if human {
		fmt.Fprintf(out, "%s: %s\n", e.Code, e.Message)
	} else {
		fmt.Fprintln(out, jsonLine(struct {
			OK    bool      `json:"ok"`
			Error *cliError `json:"error"`
		}{false, e}))
	}
	if e.Code == "invalid_input" {
		return 2
	}
	return 1
}

func parseInput(in io.Reader) (string, string, []byte, error) {
	b, err := io.ReadAll(io.LimitReader(in, maxInput+1))
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return "", "", nil, failure("timeout", "The input read timed out.")
	}
	if err != nil || len(b) > maxInput {
		return "", "", nil, failure("invalid_input", "The input must be at most 4096 bytes.")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	t, err := d.Token()
	if err != nil || t != json.Delim('{') {
		return "", "", nil, failure("invalid_input", "The input must be one JSON object.")
	}
	values := map[string]string{}
	for d.More() {
		t, err = d.Token()
		if err != nil {
			return "", "", nil, failure("invalid_input", "The input must be one JSON object.")
		}
		name, ok := t.(string)
		if !ok || (name != "public_key" && name != "digest") {
			return "", "", nil, failure("invalid_input", "The input contains an unknown field.")
		}
		if _, exists := values[name]; exists {
			return "", "", nil, failure("invalid_input", "The input contains a duplicate field.")
		}
		t, err = d.Token()
		if err != nil {
			return "", "", nil, failure("invalid_input", "The input must contain string fields.")
		}
		value, ok := t.(string)
		if !ok {
			return "", "", nil, failure("invalid_input", "The input must contain string fields.")
		}
		values[name] = value
	}
	if t, err = d.Token(); err != nil || t != json.Delim('}') {
		return "", "", nil, failure("invalid_input", "The input must be one JSON object.")
	}
	if _, err = d.Token(); err != io.EOF {
		return "", "", nil, failure("invalid_input", "The input must contain no trailing JSON.")
	}
	publicKey := values["public_key"]
	if _, err := decodeAddress(publicKey); err != nil {
		return "", "", nil, failure("invalid_input", "The public key must be a canonical Ed25519 G-address.")
	}
	digestText := values["digest"]
	if len(digestText) != 64 {
		return "", "", nil, failure("invalid_input", "The digest must contain 64 lowercase hexadecimal characters.")
	}
	for _, c := range digestText {
		if !strings.ContainsRune("0123456789abcdef", c) {
			return "", "", nil, failure("invalid_input", "The digest must contain 64 lowercase hexadecimal characters.")
		}
	}
	digest, _ := hex.DecodeString(digestText)
	return publicKey, digestText, digest, nil
}

// SEP-23 v1.3.0: version 6<<3, CRC16-XMODEM in little-endian order.
func checksum(b []byte) uint16 {
	var crc uint16
	for _, v := range b {
		crc ^= uint16(v) << 8
		for i := 0; i < 8; i++ {
			if crc&0x8000 != 0 {
				crc = crc<<1 ^ 0x1021
			} else {
				crc <<= 1
			}
		}
	}
	return crc
}

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func encodeAddress(key []byte) string {
	b := make([]byte, 35)
	b[0] = 48
	copy(b[1:], key)
	binary.LittleEndian.PutUint16(b[33:], checksum(b[:33]))
	return b32.EncodeToString(b)
}

func decodeAddress(address string) (ed25519.PublicKey, error) {
	if len(address) != 56 || !strings.HasPrefix(address, "G") {
		return nil, errors.New("invalid address")
	}
	b, err := b32.DecodeString(address)
	if err != nil || len(b) != 35 || b[0] != 48 || binary.LittleEndian.Uint16(b[33:]) != checksum(b[:33]) {
		return nil, errors.New("invalid address")
	}
	key := ed25519.PublicKey(b[1:33])
	if encodeAddress(key) != address {
		return nil, errors.New("noncanonical address")
	}
	return key, nil
}

func checkSocket(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return failure("agent_unavailable", "The 1Password socket is unavailable.")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm()&0077 != 0 || stat.Uid != uint32(os.Getuid()) {
		return failure("agent_unavailable", "The 1Password socket has an invalid type, owner, or mode.")
	}
	return nil
}

func transportError(err error) error {
	var n net.Error
	if errors.As(err, &n) && n.Timeout() {
		return failure("timeout", "The agent operation timed out.")
	}
	return failure("agent_unavailable", "The 1Password socket is unavailable.")
}

func putString(dst, value []byte) []byte {
	dst = binary.BigEndian.AppendUint32(dst, uint32(len(value)))
	return append(dst, value...)
}

func exchange(conn net.Conn, message []byte) ([]byte, error) {
	frame := binary.BigEndian.AppendUint32(nil, uint32(len(message)))
	frame = append(frame, message...)
	for len(frame) > 0 {
		n, err := conn.Write(frame)
		if err != nil {
			return nil, transportError(err)
		}
		if n == 0 {
			return nil, transportError(io.ErrShortWrite)
		}
		frame = frame[n:]
	}
	var size [4]byte
	if _, err := io.ReadFull(conn, size[:]); err != nil {
		return nil, frameError(err)
	}
	n := binary.BigEndian.Uint32(size[:])
	if n == 0 || n > maxFrame {
		return nil, failure("agent_protocol", "The agent returned an invalid frame length.")
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(conn, b); err != nil {
		return nil, frameError(err)
	}
	return b, nil
}

func frameError(err error) error {
	var n net.Error
	if errors.As(err, &n) && n.Timeout() {
		return failure("timeout", "The agent operation timed out.")
	}
	return failure("agent_protocol", "The agent returned a truncated frame.")
}

type parser struct{ data []byte }

func (p *parser) byte() (byte, error) {
	if len(p.data) < 1 {
		return 0, errors.New("short response")
	}
	v := p.data[0]
	p.data = p.data[1:]
	return v, nil
}

func (p *parser) uint32() (uint32, error) {
	if len(p.data) < 4 {
		return 0, errors.New("short response")
	}
	v := binary.BigEndian.Uint32(p.data)
	p.data = p.data[4:]
	return v, nil
}

func (p *parser) string() ([]byte, error) {
	n, err := p.uint32()
	if err != nil || n > uint32(len(p.data)) {
		return nil, errors.New("invalid string length")
	}
	v := p.data[:n]
	p.data = p.data[n:]
	return v, nil
}

func listSigners(conn net.Conn) ([]signer, error) {
	b, err := exchange(conn, []byte{11})
	if err != nil {
		return nil, err
	}
	p := parser{b}
	kind, err := p.byte()
	if err != nil || kind != 12 {
		return nil, failure("agent_protocol", "The agent returned an invalid identities response.")
	}
	count, err := p.uint32()
	if err != nil || count > maxIdentities {
		return nil, failure("agent_protocol", "The agent returned too many identities.")
	}
	signers := make([]signer, 0)
	seen := make(map[string]bool)
	for i := uint32(0); i < count; i++ {
		blob, e1 := p.string()
		comment, e2 := p.string()
		if e1 != nil || e2 != nil || !utf8.Valid(comment) {
			return nil, failure("agent_protocol", "The agent returned an invalid identity.")
		}
		key, supported, err := parseKeyBlob(blob)
		if err != nil {
			return nil, failure("agent_protocol", "The agent returned an invalid key blob.")
		}
		if !supported {
			continue
		}
		address := encodeAddress(key)
		if seen[address] {
			return nil, failure("agent_protocol", "The agent returned a duplicate Ed25519 identity.")
		}
		seen[address] = true
		hash := sha256.Sum256(blob)
		signers = append(signers, signer{address, "SHA256:" + base64.RawStdEncoding.EncodeToString(hash[:]), string(comment), blob, key})
	}
	if len(p.data) != 0 {
		return nil, failure("agent_protocol", "The agent returned trailing identities data.")
	}
	return signers, nil
}

func parseKeyBlob(blob []byte) (ed25519.PublicKey, bool, error) {
	p := parser{blob}
	algorithm, err := p.string()
	if err != nil || len(algorithm) == 0 {
		return nil, false, errors.New("invalid algorithm")
	}
	if string(algorithm) != "ssh-ed25519" {
		return nil, false, nil
	}
	key, err := p.string()
	if err != nil || len(key) != ed25519.PublicKeySize || len(p.data) != 0 {
		return nil, false, errors.New("invalid Ed25519 key")
	}
	return ed25519.PublicKey(key), true, nil
}

func sign(conn net.Conn, blob, digest []byte) ([]byte, error) {
	request := putString([]byte{13}, blob)
	request = putString(request, digest)
	request = binary.BigEndian.AppendUint32(request, 0)
	b, err := exchange(conn, request)
	if err != nil {
		return nil, err
	}
	p := parser{b}
	kind, err := p.byte()
	if err != nil {
		return nil, failure("agent_protocol", "The agent returned an invalid sign response.")
	}
	if kind == 5 && len(p.data) == 0 {
		return nil, failure("signing_refused", "The agent returned SSH_AGENT_FAILURE for the signing request.")
	}
	if kind != 14 {
		return nil, failure("agent_protocol", "The agent returned an invalid sign response.")
	}
	wrapped, err := p.string()
	if err != nil || len(p.data) != 0 {
		return nil, failure("agent_protocol", "The agent returned an invalid signature wrapper.")
	}
	s := parser{wrapped}
	algorithm, e1 := s.string()
	signature, e2 := s.string()
	if e1 != nil || e2 != nil || string(algorithm) != "ssh-ed25519" || len(signature) != ed25519.SignatureSize || len(s.data) != 0 {
		return nil, failure("agent_protocol", "The agent returned an invalid Ed25519 signature.")
	}
	return signature, nil
}
