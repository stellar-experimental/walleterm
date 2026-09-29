//! Command dispatch, strict JSON input, and JSON or readable output with exact exit codes.

use std::io::{self, Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::{Agent, Signer};
use crate::artifact::{self, Artifact, Checked, Scope, Signed};
use crate::error::{Error, Result};
use crate::stellar::account_key;
use crate::transaction::TESTNET;
use crate::util::{hex, now_ms, valid_passphrase};

pub const VERSION: &str = match option_env!("WALLETERM_VERSION") {
    Some(v) => v,
    None => "dev",
};
/// Equal to the bridge body limit.
const MAX_INPUT: usize = crate::http::MAX_BODY;
/// One absolute deadline covers input, connection, listing, and signing.
pub const DEADLINE: Duration = Duration::from_secs(120);

pub const HELP: &str = r#"walleterm list [--human]
walleterm sign < request.json
walleterm tunnel [--port 8787] [--vault <name-or-id>]
walleterm demo [--port 8788]
walleterm --help
walleterm --version

List and sign return JSON. list --human prints one readable line for each signer.
Tunnel and demo print readable public links and QR codes.
List output: {"ok":true,"signers":[{"public_key":"G...","fingerprint":"SHA256:...","comment":"..."}]}
Sign input: one JSON object with public_key and exactly one artifact. Finish it with EOF.
  {"public_key":"G...","network_passphrase":"...","transaction_xdr":"..."}
  {"public_key":"G...","network_passphrase":"...","preimage_xdr":"..."}
  {"public_key":"G...","network_passphrase":"...","auth_entry_xdr":"...","address":"G... or C...","adapter":{"type":"account"}}
  {"public_key":"G...","message":"SEP-53 text of 1 to 1024 UTF-8 bytes"}
Sign output: {"ok":true,"public_key":"G...","digest":"...","signature":"128 lowercase hexadecimal characters","verified":true}
A transaction adds signed_transaction_xdr. An authorization entry adds signed_auth_entry_xdr.
Adapters: account, contract-ed25519, and openzeppelin-ed25519 with verifier and context_rule_ids.

Use 1Password desktop to create, manage, and approve signers.
Tunnel starts the testnet signing bridge. It prints a connection code and QR code for websites.
--vault limits website wallets to a 1Password vault name or ID. Filtering requires the 1Password CLI.
--vault does not filter the local list or sign commands.
A connected website approves its own requests. 1Password can still ask for approval on the Mac.
Demo starts an independent example website with its own temporary public URL and QR code.
Walleterm computes the digest from the artifact. 1Password signs only those 32 bytes.
1Password does not display the network, amount, destination, or contract policy. Review the artifact first.
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

fn invalid(message: &str) -> Error {
    Error::new("invalid_input", message)
}

fn read_limited(input: &mut dyn Read, limit: usize) -> std::result::Result<Vec<u8>, io::Error> {
    let mut bytes = Vec::new();
    input.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    Ok(bytes)
}

const ARTIFACT_KEYS: [&str; 4] = ["transaction_xdr", "preimage_xdr", "auth_entry_xdr", "message"];

/// The exact key set of each shape, named by its artifact key.
fn shape(artifact_key: &str) -> (&'static str, &'static [&'static str]) {
    match artifact_key {
        "transaction_xdr" => ("transaction", &["public_key", "network_passphrase", "transaction_xdr"]),
        "preimage_xdr" => ("preimage", &["public_key", "network_passphrase", "preimage_xdr"]),
        "auth_entry_xdr" => {
            ("entry", &["public_key", "network_passphrase", "auth_entry_xdr", "address", "adapter"])
        }
        _ => ("message", &["public_key", "message"]),
    }
}

/// One `sign` request: the selected key, its network, and exactly one artifact.
struct SignRequest {
    public_key: String,
    passphrase: Option<String>,
    artifact: Artifact,
}

/// Parse `sign` input strictly. Every failure is `invalid_input`, before any agent connection.
fn parse_sign_request(bytes: &[u8]) -> Result<SignRequest> {
    if bytes.len() > MAX_INPUT {
        return Err(invalid(&format!("The input must be at most {MAX_INPUT} bytes.")));
    }
    // A lossy conversion would change message bytes without an error.
    let Ok(text) = std::str::from_utf8(bytes) else {
        return Err(invalid("The input must be valid UTF-8."));
    };
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let Ok(Value::Object(object)) = Value::deserialize(&mut deserializer) else {
        return Err(invalid("The input must be one JSON object."));
    };
    if deserializer.end().is_err() {
        return Err(invalid("The input must contain no trailing JSON."));
    }
    if !crate::json::no_duplicates(text) {
        return Err(invalid("The input contains a duplicate field."));
    }
    let present: Vec<&str> = ARTIFACT_KEYS.into_iter().filter(|k| object.contains_key(*k)).collect();
    let [artifact_key] = present.as_slice() else {
        return Err(invalid(
            "Provide exactly one of transaction_xdr, preimage_xdr, auth_entry_xdr, or message.",
        ));
    };
    let (name, fields) = shape(artifact_key);
    if object.len() != fields.len() || !fields.iter().all(|f| object.contains_key(*f)) {
        return Err(invalid(&format!("The {name} shape has exactly these fields: {}.", fields.join(", "))));
    }
    for (field, value) in &object {
        match (field.as_str(), value) {
            ("adapter", Value::Object(_)) => {}
            ("adapter", _) => return Err(invalid("The adapter must be a JSON object.")),
            (_, Value::String(text)) if text.is_empty() => {
                return Err(invalid(&format!("The {field} field must not be empty.")));
            }
            (_, Value::String(_)) => {}
            _ => return Err(invalid(&format!("The {field} field must be a JSON string."))),
        }
    }
    let text = |name: &str| object.get(name).and_then(Value::as_str).map(str::to_owned);
    let public_key = text("public_key").unwrap_or_default();
    if account_key(&public_key).is_none() {
        return Err(invalid("The public key must be a canonical Ed25519 G-address."));
    }
    let passphrase = text("network_passphrase");
    if passphrase.as_deref().is_some_and(|p| !valid_passphrase(p)) {
        return Err(invalid("Provide the exact network passphrase."));
    }
    let artifact = match *artifact_key {
        "transaction_xdr" => Artifact::Transaction(text("transaction_xdr").unwrap()),
        "preimage_xdr" => Artifact::Preimage(text("preimage_xdr").unwrap()),
        "auth_entry_xdr" => Artifact::Authorization {
            entry_xdr: text("auth_entry_xdr").unwrap(),
            address: text("address").unwrap(),
            adapter: object["adapter"].clone(),
        },
        _ => Artifact::Message(text("message").unwrap()),
    };
    Ok(SignRequest { public_key, passphrase, artifact })
}

/// The notice name of a public network. Any other passphrase is quoted.
fn network_name(passphrase: &str) -> String {
    match passphrase {
        TESTNET => "testnet".into(),
        "Public Global Stellar Network ; September 2015" => "pubnet".into(),
        "Test SDF Future Network ; October 2022" => "futurenet".into(),
        other => format!("network {}", go_quote(other)),
    }
}

/// The one line that the CLI writes to standard error before the agent request.
fn notice(request: &SignRequest, checked: &Checked) -> String {
    let (key, digest, d) = (&request.public_key, hex(&checked.digest), &checked.details);
    let network = request.passphrase.as_deref().map(network_name).unwrap_or_default();
    let (address, expiration) = (d["address"].as_str().unwrap_or_default(), &d["expiration_ledger"]);
    match &request.artifact {
        Artifact::Transaction(_) => format!("Sign transaction {digest} on {network} with {key}.\n"),
        Artifact::Preimage(_) => format!(
            "Sign authorization preimage {digest} for {address} on {network} with {key}, expiring at ledger {expiration}.\n"
        ),
        Artifact::Authorization { adapter, .. } => format!(
            "Sign authorization entry {digest} for {address} ({}) on {network} with {key}, expiring at ledger {expiration}.\n",
            adapter["type"].as_str().unwrap_or_default()
        ),
        Artifact::Message(text) => format!(
            "Sign SEP-53 message {digest} with {key} ({} bytes, no network, site, or expiry binding): {}\n",
            text.len(),
            go_quote(text)
        ),
    }
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
    digest: String,
    signature: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    signed_transaction_xdr: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signed_auth_entry_xdr: Option<String>,
    verified: bool,
}

fn list(human: bool, io: &mut Io) -> i32 {
    let runtime = match agent_runtime() {
        Ok(runtime) => runtime,
        Err(e) => return output_error(io.out, human, &e),
    };
    let signers = match runtime.block_on(async { connect(io).await?.list().await }) {
        Ok(signers) => signers,
        Err(e) => return output_error(io.out, human, &e),
    };
    if !human {
        return write_output(io.out, &json_line(&ListOutput { ok: true, signers: &signers }));
    }
    for s in &signers {
        let line = format!("{} {} {}\n", s.public_key, s.fingerprint, go_quote(&s.comment));
        if write_output(io.out, &line) != 0 {
            return 1;
        }
    }
    0
}

fn agent_runtime() -> Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| crate::agent::unavailable())
}

async fn connect(io: &Io<'_>) -> Result<Agent> {
    let socket = io.socket.ok_or_else(|| {
        Error::new("unsupported_platform", "The 1Password socket is available only on macOS.")
    })?;
    Agent::connect(socket, io.deadline).await
}

/// Inspect one artifact, sign its digest once, then verify and attach the signature.
fn sign(io: &mut Io) -> i32 {
    let fail = |out: &mut dyn Write, e: &Error| output_error(out, false, e);
    let bytes = match read_limited(io.input, MAX_INPUT) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == io::ErrorKind::TimedOut => {
            return fail(io.out, &Error::new("timeout", "The input read timed out."));
        }
        Err(_) => return fail(io.out, &invalid("The input could not be read.")),
    };
    let request = match parse_sign_request(&bytes) {
        Ok(request) => request,
        Err(e) => return fail(io.out, &e),
    };
    let scope =
        Scope { key: &request.public_key, passphrase: request.passphrase.as_deref(), now_ms: now_ms() };
    // Every rule failure is invalid input and happens before the agent connection.
    let checked = match artifact::inspect(&request.artifact, &scope) {
        Ok(checked) => checked,
        Err(e) => return fail(io.out, &invalid(&e.message)),
    };
    let runtime = match agent_runtime() {
        Ok(runtime) => runtime,
        Err(e) => return fail(io.out, &e),
    };
    let signature = match runtime.block_on(async {
        let mut agent = connect(io).await?;
        let signers = agent.list().await?;
        let Some(signer) = signers.iter().find(|s| s.key == checked.key) else {
            return Err(Error::new(
                "key_not_found",
                "The selected public key is not available from the agent.",
            ));
        };
        if write_output(io.diagnostic, &notice(&request, &checked)) != 0 {
            return Err(Error::new("output_error", "The signing notice could not be written."));
        }
        agent.sign(signer, &checked.digest).await
    }) {
        Ok(signature) => signature,
        Err(e) => return fail(io.out, &e),
    };
    // The same scope as inspection: the result depends only on the reviewed request.
    let signed = match artifact::finish(&request.artifact, &scope, &signature) {
        Ok(signed) => signed,
        Err(e) => return fail(io.out, &Error::new("invalid_signature", e.message)),
    };
    let (signed_transaction_xdr, signed_auth_entry_xdr) = match signed {
        Signed::Transaction(xdr) => (Some(xdr), None),
        Signed::AuthEntry(xdr) => (None, Some(xdr)),
        Signed::Raw => (None, None),
    };
    let output = SignOutput {
        ok: true,
        public_key: &request.public_key,
        digest: hex(&checked.digest),
        signature: hex(&signature),
        signed_transaction_xdr,
        signed_auth_entry_xdr,
        verified: true,
    };
    write_output(io.out, &json_line(&output))
}

/// Run one command. Returns the process exit code.
pub fn run(args: &[String], io: &mut Io) -> i32 {
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let human = args.len() == 2 && args[1] == "--human";
    match args.as_slice() {
        ["--help" | "-h"] => write_output(io.out, HELP),
        ["--version"] => write_output(io.out, &format!("walleterm {VERSION}\n")),
        ["list"] | ["list", "--human"] => list(human, io),
        ["sign"] => sign(io),
        [command @ ("tunnel" | "demo"), rest @ ..] => crate::service::run(command, rest, io.out),
        // The private supervisor mode of `walleterm tunnel`. It is not part of the public interface.
        ["tunnel-child", rest @ ..] => {
            let args = rest.iter().map(|s| s.to_string()).collect();
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
                return 1;
            };
            runtime.block_on(crate::tunnel::run_supervisor(args))
        }
        _ => output_error(
            io.out,
            human,
            &invalid("Use walleterm list [--human] or walleterm sign < request.json."),
        ),
    }
}
