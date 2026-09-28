//! Command dispatch, strict JSON input, and JSON or readable output with exact exit codes.

use std::cell::Cell;
use std::fmt;
use std::io::{self, Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, Visitor};
use serde_json::{Map, Value};

use crate::agent::{Agent, Signer};
use crate::authorization::{AuthEntryInput, attach_auth_signature, inspect_auth_entry, json_u32};
use crate::error::{Error, Result};
use crate::stellar::account_key;
use crate::util::{hex, lower_hex};

pub const VERSION: &str = match option_env!("WALLETERM_VERSION") {
    Some(v) => v,
    None => "dev",
};
const MAX_INPUT: usize = 4096;
const MAX_AUTH_INPUT: usize = 49152;
/// One absolute deadline covers input, connection, listing, and signing.
pub const DEADLINE: Duration = Duration::from_secs(120);

pub const HELP: &str = r#"walleterm list [--human]
walleterm sign [--human] < request.json
walleterm sign-auth < request.json
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
"#;

/// Everything `run` touches, so tests can inject a mock agent socket and failing writers.
pub struct Io<'a> {
    pub input: &'a mut dyn Read,
    pub out: &'a mut dyn Write,
    pub diagnostic: &'a mut dyn Write,
    pub socket: Option<&'a Path>,
    pub deadline: Instant,
}

/// Write the whole text once. A failed write must not report success or trigger a retry.
fn write_output(out: &mut dyn Write, text: &str) -> i32 {
    match out.write_all(text.as_bytes()).and_then(|()| out.flush()) {
        Ok(()) => 0,
        Err(_) => 1,
    }
}

/// JSON with the same bytes as Go's encoder: `<`, `>`, `&`, U+2028, and U+2029 are escaped.
/// These characters can occur only inside JSON strings, so a text replacement is exact.
pub fn json_line(value: &impl Serialize) -> String {
    let text = serde_json::to_string(value).expect("plain data always serializes");
    let mut out = String::with_capacity(text.len() + 1);
    for c in text.chars() {
        match c {
            '<' => out.push_str("\\u003c"),
            '>' => out.push_str("\\u003e"),
            '&' => out.push_str("\\u0026"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c => out.push(c),
        }
    }
    out.push('\n');
    out
}

#[derive(Serialize)]
struct Failure<'a> {
    ok: bool,
    error: ErrorBody<'a>,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    code: &'a str,
    message: &'a str,
}

/// Report an error in the requested format. `invalid_input` exits 2; every other error exits 1.
fn output_error(out: &mut dyn Write, human: bool, e: &Error) -> i32 {
    let text = if human {
        format!("{}: {}\n", e.code, e.message)
    } else {
        json_line(&Failure { ok: false, error: ErrorBody { code: e.code, message: &e.message } })
    };
    let _ = write_output(out, &text);
    if e.code == "invalid_input" { 2 } else { 1 }
}

/// Go's `strconv.Quote` for a valid UTF-8 comment. Control and format characters never reach the terminal.
pub fn go_quote(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{7}' => out.push_str("\\a"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{b}' => out.push_str("\\v"),
            ' '..='~' => out.push(c),
            c if (c as u32) < 0x20 || c == '\u{7f}' => out.push_str(&format!("\\x{:02x}", c as u32)),
            c if printable(c) => out.push(c),
            c if (c as u32) < 0x10000 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push_str(&format!("\\U{:08x}", c as u32)),
        }
    }
    out.push('"');
    out
}

/// Go's `unicode.IsPrint` for non-ASCII characters, without the unassigned code point table.
/// Control (Cc), format (Cf), separator (Zs, Zl, Zp), private-use (Co), and noncharacters are not printable.
fn printable(c: char) -> bool {
    let n = c as u32;
    let format = matches!(
        n,
        0xad | 0x600..=0x605
            | 0x61c
            | 0x6dd
            | 0x70f
            | 0x890..=0x891
            | 0x8e2
            | 0x180e
            | 0x200b..=0x200f
            | 0x202a..=0x202e
            | 0x2060..=0x2064
            | 0x2066..=0x206f
            | 0xfeff
            | 0xfff9..=0xfffb
            | 0x110bd
            | 0x110cd
            | 0x13430..=0x1343f
            | 0x1bca0..=0x1bca3
            | 0x1d173..=0x1d17a
            | 0xe0001
            | 0xe0020..=0xe007f
    );
    let private = matches!(n, 0xe000..=0xf8ff | 0xf0000..=0x10ffff);
    let noncharacter = matches!(n, 0xfdd0..=0xfdef) || n & 0xfffe == 0xfffe;
    !(c.is_control() || c.is_whitespace() || format || private || noncharacter)
}

#[derive(Clone, Copy, PartialEq)]
enum Phase {
    Open,
    Key,
    Value,
}

/// The `sign` input as Go's token decoder reads it: one object with two string fields.
/// `phase` records where a syntax error occurred; `rejected` holds a field-level message.
struct SignInput<'a> {
    phase: &'a Cell<Phase>,
    rejected: &'a Cell<Option<&'static str>>,
}

impl<'de> DeserializeSeed<'de> for SignInput<'_> {
    type Value = (Option<String>, Option<String>);

    fn deserialize<D: Deserializer<'de>>(
        self,
        deserializer: D,
    ) -> std::result::Result<Self::Value, D::Error> {
        deserializer.deserialize_map(self)
    }
}

impl<'de> Visitor<'de> for SignInput<'_> {
    type Value = (Option<String>, Option<String>);

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("one JSON object")
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<Self::Value, A::Error> {
        let (mut public_key, mut digest) = (None, None);
        loop {
            self.phase.set(Phase::Key);
            let Some(name) = map.next_key::<String>()? else { break };
            let slot = match name.as_str() {
                "public_key" => &mut public_key,
                "digest" => &mut digest,
                _ => {
                    self.rejected.set(Some("The input contains an unknown field."));
                    return Err(de::Error::custom("unknown field"));
                }
            };
            if slot.is_some() {
                self.rejected.set(Some("The input contains a duplicate field."));
                return Err(de::Error::custom("duplicate field"));
            }
            self.phase.set(Phase::Value);
            *slot = Some(map.next_value::<String>()?);
        }
        self.phase.set(Phase::Open);
        Ok((public_key, digest))
    }
}

fn invalid(message: &str) -> Error {
    Error::new("invalid_input", message)
}

fn read_limited(input: &mut dyn Read, limit: usize) -> std::result::Result<Vec<u8>, io::Error> {
    let mut bytes = Vec::new();
    input.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Parse `sign` input with Go's messages. Invalid UTF-8 inside strings becomes U+FFFD, as in Go.
fn parse_sign_input(input: &mut dyn Read) -> Result<([u8; 32], String, [u8; 32])> {
    let bytes = match read_limited(input, MAX_INPUT) {
        Err(e) if e.kind() == io::ErrorKind::TimedOut => {
            return Err(Error::new("timeout", "The input read timed out."));
        }
        Err(_) => return Err(invalid("The input must be at most 4096 bytes.")),
        Ok(b) if b.len() > MAX_INPUT => return Err(invalid("The input must be at most 4096 bytes.")),
        Ok(b) => b,
    };
    let text = String::from_utf8_lossy(&bytes);
    let (phase, rejected) = (Cell::new(Phase::Open), Cell::new(None));
    let mut deserializer = serde_json::Deserializer::from_str(&text);
    let result = SignInput { phase: &phase, rejected: &rejected }.deserialize(&mut deserializer);
    let (public_key, digest) = match result {
        Ok(fields) => fields,
        Err(_) if rejected.get().is_some() => return Err(invalid(rejected.get().unwrap())),
        Err(_) if phase.get() == Phase::Value => {
            return Err(invalid("The input must contain string fields."));
        }
        Err(_) => return Err(invalid("The input must be one JSON object.")),
    };
    if deserializer.end().is_err() {
        return Err(invalid("The input must contain no trailing JSON."));
    }
    let public_key = public_key.unwrap_or_default();
    let Some(key) = account_key(&public_key) else {
        return Err(invalid("The public key must be a canonical Ed25519 G-address."));
    };
    let digest_text = digest.unwrap_or_default();
    let Some(digest) = lower_hex::<32>(&digest_text) else {
        return Err(invalid("The digest must contain 64 lowercase hexadecimal characters."));
    };
    Ok((key, digest_text, digest))
}

#[derive(Serialize)]
struct ListOutput<'a> {
    ok: bool,
    signers: &'a [Signer],
}

#[derive(Serialize)]
struct SignOutput<'a> {
    ok: bool,
    public_key: &'a str,
    digest: &'a str,
    signature: String,
    verified: bool,
}

fn list_or_sign(command: &str, human: bool, io: &mut Io) -> i32 {
    let mut request = None;
    if command == "sign" {
        match parse_sign_input(io.input) {
            Ok(value) => request = Some(value),
            Err(e) => return output_error(io.out, human, &e),
        }
    }
    let Some(socket) = io.socket else {
        let e = Error::new("unsupported_platform", "The 1Password socket is available only on macOS.");
        return output_error(io.out, human, &e);
    };
    let mut agent = match Agent::connect(socket, io.deadline) {
        Ok(agent) => agent,
        Err(e) => return output_error(io.out, human, &e),
    };
    let signers = match agent.list() {
        Ok(signers) => signers,
        Err(e) => return output_error(io.out, human, &e),
    };
    let Some((key, digest_text, digest)) = request else {
        if !human {
            return write_output(io.out, &json_line(&ListOutput { ok: true, signers: &signers }));
        }
        for s in &signers {
            let line = format!("{} {} {}\n", s.public_key, s.fingerprint, go_quote(&s.comment));
            if write_output(io.out, &line) != 0 {
                return 1;
            }
        }
        return 0;
    };
    let Some(selected) = signers.iter().find(|s| s.key == key) else {
        let e = Error::new("key_not_found", "The selected public key is not available from the agent.");
        return output_error(io.out, human, &e);
    };
    let notice =
        format!("Request a signature for public key {} and digest {digest_text}.\n", selected.public_key);
    if write_output(io.diagnostic, &notice) != 0 {
        return output_error(
            io.out,
            human,
            &Error::new("output_error", "The signing notice could not be written."),
        );
    }
    let signature = match agent.sign(selected, &digest) {
        Ok(signature) => signature,
        Err(e) => return output_error(io.out, human, &e),
    };
    let signature = hex(&signature);
    if human {
        let text = format!(
            "Public key: {}\nDigest: {digest_text}\nSignature: {signature}\nVerified: true\n",
            selected.public_key
        );
        return write_output(io.out, &text);
    }
    let output = SignOutput {
        ok: true,
        public_key: &selected.public_key,
        digest: &digest_text,
        signature,
        verified: true,
    };
    write_output(io.out, &json_line(&output))
}

const AUTH_FIELDS: [&str; 6] =
    ["auth_entry_xdr", "public_key", "network_passphrase", "address", "adapter", "latest_ledger"];

/// The `sign-auth` request with the TS sidecar's messages and order of checks.
pub fn parse_auth_input(bytes: &[u8]) -> Result<Map<String, Value>> {
    if bytes.len() > MAX_AUTH_INPUT {
        return Err(invalid("The authorization request is too large."));
    }
    let Ok(text) = std::str::from_utf8(bytes) else {
        return Err(invalid("Use valid UTF-8 JSON."));
    };
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(text) else {
        return Err(invalid("Send one JSON object."));
    };
    if !crate::json::no_duplicates(text) {
        return Err(invalid("Duplicate JSON fields are not supported."));
    }
    if object.len() != AUTH_FIELDS.len() || !AUTH_FIELDS.iter().all(|f| object.contains_key(*f)) {
        return Err(invalid("The authorization request fields are invalid."));
    }
    Ok(object)
}

#[derive(Serialize)]
struct AuthOutput<'a> {
    ok: bool,
    public_key: &'a str,
    digest: String,
    signed_auth_entry_xdr: String,
    verified: bool,
}

/// Validate one explicit authorization entry, sign its adapter digest, and attach the signature.
fn sign_auth(io: &mut Io) -> i32 {
    let fail = |out: &mut dyn Write, e: &Error| output_error(out, false, e);
    let bytes = match read_limited(io.input, MAX_AUTH_INPUT) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::TimedOut => {
            return fail(io.out, &Error::new("timeout", "The authorization request stopped or timed out."));
        }
        Err(_) => {
            return fail(
                io.out,
                &Error::new("signing_failed", "The authorization request could not be read."),
            );
        }
    };
    let object = match parse_auth_input(&bytes) {
        Ok(object) => object,
        Err(e) => return fail(io.out, &e),
    };
    let input = AuthEntryInput::from_json(&object);
    let latest = json_u32(&object["latest_ledger"]);
    let checked = match inspect_auth_entry(&input, &input.public_key, latest) {
        Ok(checked) => checked,
        Err(e) => return fail(io.out, &e),
    };
    let digest = hex(&checked.digest);
    let notice = format!("Sign authorization {} with {}: {digest}\n", input.address, input.public_key);
    if write_output(io.diagnostic, &notice) != 0 {
        return fail(io.out, &Error::new("output_error", "The signing notice could not be written."));
    }
    // The agent's own failure codes collapse into signing_failed, as the sidecar reported them.
    let signed = sign_digest(io, &checked.key, &checked.digest).map_err(|e| match e.code {
        "timeout" | "unsupported_platform" => e,
        _ => Error::new("signing_failed", e.message),
    });
    let signature = match signed {
        Ok(signature) => hex(&signature),
        Err(e) => return fail(io.out, &e),
    };
    let signed = match attach_auth_signature(&input, &input.public_key, latest, &signature) {
        Ok(signed) => signed,
        Err(e) => return fail(io.out, &e),
    };
    let output = AuthOutput {
        ok: true,
        public_key: &input.public_key,
        digest,
        signed_auth_entry_xdr: signed,
        verified: true,
    };
    write_output(io.out, &json_line(&output))
}

fn sign_digest(io: &Io, key: &[u8; 32], digest: &[u8; 32]) -> Result<[u8; 64]> {
    let socket = io.socket.ok_or_else(|| {
        Error::new("unsupported_platform", "The 1Password socket is available only on macOS.")
    })?;
    let mut agent = Agent::connect(socket, io.deadline)?;
    let signers = agent.list()?;
    let Some(signer) = signers.iter().find(|s| &s.key == key) else {
        return Err(Error::new("key_not_found", "The selected public key is not available from the agent."));
    };
    agent.sign(signer, digest)
}

/// Run one command. Returns the process exit code.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    match args.as_slice() {
        ["--help" | "-h"] => return write_output(io.out, HELP),
        ["--version"] => return write_output(io.out, &format!("walleterm {VERSION}\n")),
        ["sign-auth", "--help" | "-h"] => {
            let help = "walleterm sign-auth < request.json\nSign one explicit authorization entry. See docs/INTERFACE.md.\n";
            return write_output(io.out, help);
        }
        ["sign-auth"] => return sign_auth(io),
        ["sign-auth", ..] => {
            return output_error(io.out, false, &invalid("Use walleterm sign-auth < request.json."));
        }
        [command @ ("tunnel" | "demo"), rest @ ..] => return crate::service::run(command, rest, io.out),
        // The private supervisor mode of `walleterm tunnel`. It is not part of the public interface.
        ["tunnel-child", rest @ ..] => {
            let args = rest.iter().map(|s| s.to_string()).collect();
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
                return 1;
            };
            return runtime.block_on(crate::tunnel::run_supervisor(args));
        }
        _ => {}
    }
    let human = args.len() == 2 && args[1] == "--human";
    let usage = invalid("Use list or sign with an optional --human flag.");
    match args.as_slice() {
        [command @ ("list" | "sign")] | [command @ ("list" | "sign"), "--human"] => {
            list_or_sign(command, human, io)
        }
        _ => output_error(io.out, human, &usage),
    }
}
