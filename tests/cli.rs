//! The native CLI through a real Unix socket mock agent. The Go signer transcripts (`fixtures/parity/cli.json`)
//! still fix `list`, the agent protocol, and every agent failure. Frozen JS vectors fix each signed artifact.
//! Mock seeds and the public SEP-53 test key only. Nothing here opens the real 1Password socket.

use std::io::{self, Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::Value;
use walleterm::cli::{DEADLINE, Io, run};
use walleterm::util::{hex, lower_hex};

const SEED: [u8; 32] = [7; 32];

fn fixture(name: &str) -> Value {
    let path = format!("{}/fixtures/parity/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len()).step_by(2).map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap()).collect()
}

/// A private directory for one mock socket. macOS limits socket paths to 104 bytes.
struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = PathBuf::from(format!("/private/tmp/wt-rs-{}-{n}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self(dir)
    }
    fn socket(&self) -> PathBuf {
        self.0.join("agent.sock")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn read_frame(stream: &mut UnixStream) -> io::Result<Vec<u8>> {
    let mut header = [0u8; 4];
    stream.read_exact(&mut header)?;
    let mut body = vec![0u8; u32::from_be_bytes(header) as usize];
    stream.read_exact(&mut body)?;
    Ok(body)
}

fn write_frame(stream: &mut UnixStream, body: &[u8]) -> io::Result<()> {
    let mut frame = (body.len() as u32).to_be_bytes().to_vec();
    frame.extend(body);
    stream.write_all(&frame)
}

enum Reply {
    Frame(Vec<u8>),
    Raw(Vec<u8>),
    /// Sign the requested digest with the mock seed.
    SignDigest,
}

/// The digest inside a sign request: type 13, key blob (4 + 51 bytes), digest (4 + 32 bytes), flags.
fn requested_digest(request: &[u8]) -> [u8; 32] {
    request[1 + 4 + 51 + 4..1 + 4 + 51 + 4 + 32].try_into().unwrap()
}

fn sign_response(signature: &[u8; 64]) -> Vec<u8> {
    let mut wrapped = Vec::new();
    for part in [&b"ssh-ed25519"[..], signature] {
        wrapped.extend((part.len() as u32).to_be_bytes());
        wrapped.extend(part);
    }
    let mut body = vec![14];
    body.extend((wrapped.len() as u32).to_be_bytes());
    body.extend(wrapped);
    body
}

/// Serve one connection: answer each request in order, then record any unexpected follow-up request.
fn mock_agent(path: &Path, replies: Vec<Reply>) -> JoinHandle<Vec<Vec<u8>>> {
    let listener = UnixListener::bind(path).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let (ready, wait) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        ready.send(()).unwrap();
        let mut got = Vec::new();
        // A command that fails before it connects must fail its test, not hang it.
        listener.set_nonblocking(true).unwrap();
        let waited = Instant::now();
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(e)
                    if e.kind() == io::ErrorKind::WouldBlock && waited.elapsed() < Duration::from_secs(5) =>
                {
                    std::thread::sleep(Duration::from_millis(2));
                }
                Err(_) => return got,
            }
        };
        stream.set_nonblocking(false).unwrap();
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        for reply in replies {
            let Ok(request) = read_frame(&mut stream) else { return got };
            got.push(request.clone());
            match reply {
                Reply::Frame(body) => {
                    let _ = write_frame(&mut stream, &body);
                }
                Reply::Raw(bytes) => {
                    let _ = stream.write_all(&bytes);
                    return got;
                }
                Reply::SignDigest => {
                    let signature =
                        SigningKey::from_bytes(&SEED).sign(&requested_digest(&request)).to_bytes();
                    let _ = write_frame(&mut stream, &sign_response(&signature));
                }
            }
        }
        let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
        if let Ok(request) = read_frame(&mut stream) {
            got.push(request);
        }
        got
    });
    wait.recv().unwrap();
    handle
}

struct Outcome {
    exit: i32,
    stdout: String,
    stderr: String,
    requests: Vec<Vec<u8>>,
}

fn invoke(
    args: &[&str],
    stdin: &[u8],
    socket: Option<&Path>,
    agent: Option<JoinHandle<Vec<Vec<u8>>>>,
) -> Outcome {
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let (mut out, mut diagnostic) = (Vec::new(), Vec::new());
    let mut input = stdin;
    let mut io = Io {
        input: &mut input,
        out: &mut out,
        diagnostic: &mut diagnostic,
        socket,
        deadline: Instant::now() + DEADLINE,
    };
    let exit = run(&args, &mut io);
    let requests = agent.map(|a| a.join().unwrap()).unwrap_or_default();
    Outcome {
        exit,
        stdout: String::from_utf8(out).unwrap(),
        stderr: String::from_utf8(diagnostic).unwrap(),
        requests,
    }
}

/// Cases that still apply byte for byte: `list` and its agent protocol failures.
/// The digest `sign` input, `--human` on `sign`, and the old usage and help text were removed on purpose.
#[test]
fn go_signer_transcripts_for_list() {
    let file = fixture("cli.json");
    let missing = PathBuf::from(file["missing_socket"].as_str().unwrap());
    let mut failures = Vec::new();
    let cases = file["cases"].as_array().unwrap();
    let kept: Vec<&Value> = cases
        .iter()
        .filter(|c| c["id"].as_str().unwrap().starts_with("list-") || c["id"] == "no-platform")
        .collect();
    assert_eq!(kept.len(), 19);
    for case in kept {
        let id = case["id"].as_str().unwrap();
        let args: Vec<&str> = case["args"].as_array().unwrap().iter().map(|a| a.as_str().unwrap()).collect();
        let scratch = Scratch::new();
        let (socket, agent) = if case["no_socket"] == true {
            (if id == "no-platform" { None } else { Some(missing.clone()) }, None)
        } else {
            let replies = case["agent"]
                .as_array()
                .unwrap()
                .iter()
                .map(|f| {
                    let f = f.as_str().unwrap();
                    f.strip_prefix("raw:")
                        .map_or_else(|| Reply::Frame(unhex(f)), |raw| Reply::Raw(unhex(raw)))
                })
                .collect();
            (Some(scratch.socket()), Some(mock_agent(&scratch.socket(), replies)))
        };
        let got = invoke(&args, case["stdin"].as_str().unwrap().as_bytes(), socket.as_deref(), agent);
        let requests: Vec<String> = got.requests.iter().map(|r| hex(r)).collect();
        let want: Vec<&str> =
            case["requests"].as_array().unwrap().iter().map(|r| r.as_str().unwrap()).collect();
        let matches = got.exit == case["exit"].as_i64().unwrap() as i32
            && got.stdout == case["stdout"].as_str().unwrap()
            && got.stderr == case["stderr"].as_str().unwrap()
            && requests == want;
        if !matches {
            failures.push(format!(
                "{id}\n  exit {} vs {}\n  stdout {:?}\n  want   {:?}\n  stderr {:?}\n  want   {:?}\n  requests {requests:?}\n  want     {want:?}",
                got.exit, case["exit"], got.stdout, case["stdout"], got.stderr, case["stderr"]
            ));
        }
    }
    assert!(failures.is_empty(), "{} transcripts differ:\n{}", failures.len(), failures.join("\n"));
}

/// The recorded agent replies for a `sign` request, replayed with the message shape. Each failure keeps its
/// exact code and message. The request frames differ only in the digest, so they are not compared.
#[test]
fn recorded_agent_failures_keep_their_codes() {
    let file = fixture("cli.json");
    let ids = [
        "sign-refused",
        "sign-refused-trailing",
        "sign-wrong-algorithm",
        "sign-bad-signature",
        "sign-short-signature",
        "sign-trailing",
        "sign-wrong-type",
        "sign-key-not-found",
    ];
    for id in ids {
        let case = file["cases"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap();
        let stdin: Value = serde_json::from_str(case["stdin"].as_str().unwrap()).unwrap();
        let request = serde_json::json!({ "public_key": stdin["public_key"], "message": "walleterm parity" });
        let replies =
            case["agent"].as_array().unwrap().iter().map(|f| Reply::Frame(unhex(f.as_str().unwrap())));
        let scratch = Scratch::new();
        let agent = mock_agent(&scratch.socket(), replies.collect());
        let got = invoke(&["sign"], request.to_string().as_bytes(), Some(&scratch.socket()), Some(agent));
        assert_eq!(got.exit, case["exit"].as_i64().unwrap() as i32, "{id}");
        assert_eq!(got.stdout, case["stdout"].as_str().unwrap(), "{id}");
        assert_eq!(got.requests.len(), case["requests"].as_array().unwrap().len(), "{id}");
        let signing = got.requests.iter().filter(|r| r[0] == 13).count();
        assert_eq!(got.stderr.is_empty(), signing == 0, "{id}: the notice precedes each signing request");
    }
}

const CLOSED: &str =
    "The agent closed the connection without a signature. The 1Password approval prompt may have timed out.";
const TRUNCATED: &str = "The agent returned a truncated frame.";

/// Whether the agent answers the identities request, the bytes it then sends before it closes, and the message.
/// On 2026-09-28, an unanswered prompt while 1Password was locked closed the connection before any response byte.
/// Any partial frame stays a truncated frame.
/// Live runs listed keys without a prompt, so a close before the identities answer keeps the old message.
const CLOSES: [(bool, &[u8], &str); 5] = [
    (true, &[], CLOSED),
    (true, &[0, 0], TRUNCATED),
    (true, &[0, 0, 0, 0x10], TRUNCATED),
    (true, &[0, 0, 0, 0x10, 14], TRUNCATED),
    (false, &[], TRUNCATED),
];

fn closing_agent(scratch: &Scratch, listed: bool, raw: &[u8]) -> JoinHandle<Vec<Vec<u8>>> {
    let mut replies = if listed { vec![Reply::Frame(identities_body())] } else { Vec::new() };
    replies.push(Reply::Raw(raw.to_vec()));
    mock_agent(&scratch.socket(), replies)
}

/// The request types the agent received: 11 lists, 13 signs.
fn kinds(requests: &[Vec<u8>]) -> Vec<u8> {
    requests.iter().map(|r| r[0]).collect()
}

#[test]
fn a_close_before_the_sign_response_names_the_prompt() {
    for (listed, raw, message) in CLOSES {
        let scratch = Scratch::new();
        let agent = closing_agent(&scratch, listed, raw);
        let got = invoke(&["sign"], sign_input().as_bytes(), Some(&scratch.socket()), Some(agent));
        let failure =
            format!("{{\"ok\":false,\"error\":{{\"code\":\"agent_protocol\",\"message\":\"{message}\"}}}}\n");
        assert_eq!((got.exit, got.stdout), (1, failure), "{listed} {raw:?}");
        assert_eq!(kinds(&got.requests), if listed { &[11, 13][..] } else { &[11] }, "{listed} {raw:?}");
    }
}

#[tokio::test(flavor = "current_thread")]
async fn the_bridge_agent_client_names_the_same_close() {
    for (listed, raw, message) in CLOSES {
        let scratch = Scratch::new();
        let agent = closing_agent(&scratch, listed, raw);
        let (socket, limit, cancel) =
            (scratch.socket(), Duration::from_secs(5), walleterm::cancel::Cancel::new());
        let e = walleterm::agent::sign(&socket, &mock_address(), &[1; 32], limit, &cancel).await.unwrap_err();
        assert_eq!((e.code, e.message.as_str()), ("agent_protocol", message), "{listed} {raw:?}");
        let requests = agent.join().unwrap();
        assert_eq!(kinds(&requests), if listed { &[11, 13][..] } else { &[11] }, "{listed} {raw:?}");
    }
    // Vault discovery lists through the same client.
    let scratch = Scratch::new();
    let agent = closing_agent(&scratch, false, &[]);
    let cancel = walleterm::cancel::Cancel::new();
    let e = walleterm::agent::list(&scratch.socket(), Duration::from_secs(5), &cancel).await.unwrap_err();
    assert_eq!((e.code, e.message.as_str()), ("agent_protocol", TRUNCATED));
    assert_eq!(kinds(&agent.join().unwrap()), [11]);
}

#[tokio::test(flavor = "current_thread")]
async fn canceling_the_shared_client_closes_a_partial_sign_response_without_retry() {
    let scratch = Scratch::new();
    let socket = scratch.socket();
    let listener = UnixListener::bind(&socket).unwrap();
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600)).unwrap();
    let (started, received) = tokio::sync::oneshot::channel();
    let agent = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let list = read_frame(&mut stream).unwrap();
        write_frame(&mut stream, &identities_body()).unwrap();
        let sign = read_frame(&mut stream).unwrap();
        stream.write_all(&[0, 0]).unwrap();
        started.send(()).unwrap();
        let mut byte = [0];
        assert_eq!(stream.read(&mut byte).unwrap(), 0, "cancellation closes the socket");
        vec![list, sign]
    });
    let cancel = walleterm::cancel::Cancel::new();
    let flag = cancel.clone();
    let task = tokio::spawn(async move {
        walleterm::agent::sign(&socket, &mock_address(), &[1; 32], Duration::from_secs(5), &flag).await
    });
    tokio::time::timeout(Duration::from_secs(5), received).await.unwrap().unwrap();
    cancel.abort();
    let result = tokio::time::timeout(Duration::from_secs(1), task).await.unwrap().unwrap();
    assert_eq!(result.unwrap_err(), cancel.reason());
    assert_eq!(kinds(&agent.join().unwrap()), [11, 13]);
}

#[test]
fn every_signing_request_has_the_exact_wire_form() {
    let file = fixture("cli.json");
    let case = file["cases"].as_array().unwrap().iter().find(|c| c["id"] == "sign-json").unwrap();
    let request = unhex(case["requests"][1].as_str().unwrap());
    let key = SigningKey::from_bytes(&SEED).verifying_key().to_bytes();
    let digest = lower_hex::<32>(&"01".repeat(32)).unwrap();
    assert_eq!(
        request,
        walleterm::agent::sign_request(
            &walleterm::agent::parse_identities(&unhex(case["agent"][0].as_str().unwrap())).unwrap()[0].blob,
            &digest
        )
    );
    assert_eq!(&request[request.len() - 4..], &[0, 0, 0, 0], "flags must be zero");
    assert_eq!(&request[1 + 4 + 4 + 11 + 4..1 + 4 + 4 + 11 + 4 + 32], &key);
}

fn mock_blob() -> Vec<u8> {
    let key = SigningKey::from_bytes(&SEED).verifying_key().to_bytes();
    let mut blob = Vec::new();
    for part in [&b"ssh-ed25519"[..], &key] {
        blob.extend((part.len() as u32).to_be_bytes());
        blob.extend(part);
    }
    blob
}

fn identities_body() -> Vec<u8> {
    let blob = mock_blob();
    let mut body = vec![12, 0, 0, 0, 1];
    body.extend((blob.len() as u32).to_be_bytes());
    body.extend(blob);
    body.extend(12u32.to_be_bytes());
    body.extend(b"offline mock");
    body
}

fn mock_address() -> String {
    walleterm::stellar::account_address(&SigningKey::from_bytes(&SEED).verifying_key().to_bytes())
}

fn sign_input() -> String {
    serde_json::json!({ "public_key": mock_address(), "message": "walleterm offline test" }).to_string()
}

/// A writer that always fails, or accepts all but one byte.
struct Failing {
    short: bool,
    calls: usize,
}

impl Write for Failing {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.calls += 1;
        if self.short {
            Ok(buf.len().saturating_sub(1).min(1))
        } else {
            Err(io::ErrorKind::BrokenPipe.into())
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn run_with(
    args: &[&str],
    stdin: &[u8],
    out: &mut dyn Write,
    diagnostic: &mut dyn Write,
    socket: Option<&Path>,
    deadline: Instant,
) -> i32 {
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let mut input = stdin;
    run(&args, &mut Io { input: &mut input, out, diagnostic, socket, deadline })
}

#[test]
fn socket_type_owner_and_mode_are_checked() {
    let scratch = Scratch::new();
    let listener = UnixListener::bind(scratch.socket()).unwrap();
    std::fs::set_permissions(scratch.socket(), std::fs::Permissions::from_mode(0o666)).unwrap();
    let got = invoke(&["list"], b"", Some(&scratch.socket()), None);
    assert_eq!(got.exit, 1);
    assert!(
        got.stdout.contains("The 1Password socket has an invalid type, owner, or mode."),
        "{}",
        got.stdout
    );
    drop(listener);
    for mode in [0o644, 0o600] {
        let file = scratch.0.join(format!("file-{mode:o}"));
        std::fs::write(&file, b"").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap();
        assert!(walleterm::agent::check_socket(&file).is_err());
    }
    let link = scratch.0.join("link.sock");
    let target = scratch.0.join("target.sock");
    let _listener = UnixListener::bind(&target).unwrap();
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();
    std::os::unix::fs::symlink(&target, &link).unwrap();
    assert!(walleterm::agent::check_socket(&target).is_ok());
    assert!(walleterm::agent::check_socket(&link).is_err(), "a symlink must not stand in for the socket");
}

#[test]
fn a_silent_agent_times_out_at_the_absolute_deadline() {
    let scratch = Scratch::new();
    let listener = UnixListener::bind(scratch.socket()).unwrap();
    std::fs::set_permissions(scratch.socket(), std::fs::Permissions::from_mode(0o600)).unwrap();
    let holder = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        std::thread::sleep(Duration::from_millis(400));
        drop(stream);
    });
    let start = Instant::now();
    let (mut out, mut diagnostic) = (Vec::new(), Vec::new());
    let deadline = start + Duration::from_millis(150);
    let exit = run_with(&["list"], b"", &mut out, &mut diagnostic, Some(&scratch.socket()), deadline);
    let elapsed = start.elapsed();
    holder.join().unwrap();
    assert_eq!(exit, 1);
    assert!(String::from_utf8(out).unwrap().contains(r#""code":"timeout""#));
    assert!(elapsed >= Duration::from_millis(150) && elapsed < Duration::from_millis(390), "{elapsed:?}");
}

#[test]
fn a_dribbling_agent_cannot_extend_the_deadline() {
    let scratch = Scratch::new();
    let listener = UnixListener::bind(scratch.socket()).unwrap();
    std::fs::set_permissions(scratch.socket(), std::fs::Permissions::from_mode(0o600)).unwrap();
    let body = identities_body();
    let dribbler = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_frame(&mut stream);
        let mut frame = (body.len() as u32).to_be_bytes().to_vec();
        frame.extend(body);
        for byte in frame {
            if stream.write_all(&[byte]).is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    });
    let start = Instant::now();
    let (mut out, mut diagnostic) = (Vec::new(), Vec::new());
    let exit = run_with(
        &["list"],
        b"",
        &mut out,
        &mut diagnostic,
        Some(&scratch.socket()),
        start + Duration::from_millis(200),
    );
    assert_eq!(exit, 1);
    assert!(String::from_utf8(out).unwrap().contains(r#""code":"timeout""#));
    assert!(start.elapsed() < Duration::from_millis(450));
    dribbler.join().unwrap();
}

#[test]
fn a_slow_but_complete_agent_succeeds() {
    let scratch = Scratch::new();
    let listener = UnixListener::bind(scratch.socket()).unwrap();
    std::fs::set_permissions(scratch.socket(), std::fs::Permissions::from_mode(0o600)).unwrap();
    let body = identities_body();
    let agent = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_frame(&mut stream);
        let mut frame = (body.len() as u32).to_be_bytes().to_vec();
        frame.extend(body);
        for chunk in frame.chunks(7) {
            stream.write_all(chunk).unwrap();
            std::thread::sleep(Duration::from_millis(2));
        }
    });
    let got = invoke(&["list"], b"", Some(&scratch.socket()), None);
    agent.join().unwrap();
    assert_eq!(got.exit, 0, "{}", got.stdout);
    assert!(got.stdout.contains("offline mock"));
}

#[test]
fn input_reads_share_the_deadline() {
    let mut fds = [0; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    let deadline = Instant::now() + Duration::from_millis(80);
    let mut reader = walleterm::platform::DeadlineReader { fd: fds[0], deadline };
    let (mut out, mut diagnostic) = (Vec::new(), Vec::new());
    let args = vec!["sign".to_string()];
    let exit = run(
        &args,
        &mut Io { input: &mut reader, out: &mut out, diagnostic: &mut diagnostic, socket: None, deadline },
    );
    assert_eq!(exit, 1);
    assert_eq!(
        String::from_utf8(out).unwrap(),
        "{\"ok\":false,\"error\":{\"code\":\"timeout\",\"message\":\"The input read timed out.\"}}\n"
    );
    unsafe {
        libc::close(fds[0]);
        libc::close(fds[1]);
    }
}

#[test]
fn output_failure_never_repeats_signing() {
    for (command, human) in [("list", false), ("list", true), ("sign", false)] {
        for short in [false, true] {
            let scratch = Scratch::new();
            let replies = if command == "sign" {
                vec![Reply::Frame(identities_body()), Reply::SignDigest]
            } else {
                vec![Reply::Frame(identities_body())]
            };
            let agent = mock_agent(&scratch.socket(), replies);
            let mut args = vec![command];
            if human {
                args.push("--human");
            }
            let mut out = Failing { short, calls: 0 };
            let exit = run_with(
                &args,
                sign_input().as_bytes(),
                &mut out,
                &mut Vec::new(),
                Some(&scratch.socket()),
                Instant::now() + DEADLINE,
            );
            let requests = agent.join().unwrap();
            let signs = requests.iter().filter(|r| r[0] == 13).count();
            assert_eq!(exit, 1, "{command} human={human} short={short}");
            assert_eq!(signs, usize::from(command == "sign"), "{command} human={human} short={short}");
            assert_eq!(requests.len(), 1 + signs, "no follow-up request after an output failure");
        }
    }
}

#[test]
fn a_failed_notice_prevents_signing() {
    for short in [false, true] {
        let scratch = Scratch::new();
        let agent = mock_agent(&scratch.socket(), vec![Reply::Frame(identities_body())]);
        let (mut out, mut diagnostic) = (Vec::new(), Failing { short, calls: 0 });
        let exit = run_with(
            &["sign"],
            sign_input().as_bytes(),
            &mut out,
            &mut diagnostic,
            Some(&scratch.socket()),
            Instant::now() + DEADLINE,
        );
        let requests = agent.join().unwrap();
        assert_eq!(exit, 1);
        assert_eq!(requests, vec![vec![11]], "only the identities request");
        let text = String::from_utf8(out).unwrap();
        assert!(text.contains(r#""code":"output_error""#), "{text}");
    }
}

#[test]
fn help_version_and_usage() {
    let got = invoke(&["--version"], b"", None, None);
    assert_eq!(
        (got.exit, got.stdout.as_str()),
        (0, format!("walleterm {}\n", walleterm::cli::VERSION).as_str())
    );
    for command in ["--help", "-h", "--version"] {
        for short in [false, true] {
            let mut out = Failing { short, calls: 0 };
            assert_eq!(run_with(&[command], b"", &mut out, &mut Vec::new(), None, Instant::now()), 1);
        }
    }
    for command in ["--help", "-h"] {
        let got = invoke(&[command], b"", None, None);
        assert_eq!((got.exit, got.stdout.as_str()), (0, walleterm::cli::HELP));
    }
    assert!(!walleterm::cli::HELP.contains("sign-auth") && !walleterm::cli::HELP.contains("sign [--human]"));
    let usage = "{\"ok\":false,\"error\":{\"code\":\"invalid_input\",\"message\":\"Use walleterm list [--human] or walleterm sign \\u003c request.json.\"}}\n";
    for args in [
        &[][..],
        &["export"],
        &["sign-auth"],
        &["sign-auth", "--help"],
        &["sign", "extra"],
        &["list", "--human", "x"],
        &["list", "--json"],
    ] {
        let got = invoke(args, b"{}", None, None);
        assert_eq!((got.exit, got.stdout.as_str()), (2, usage), "{args:?}");
    }
    // A second argument of --human selects readable output, as for list. `sign` has no readable output.
    for args in [&["export", "--human"][..], &["sign", "--human"]] {
        let got = invoke(args, b"", None, None);
        assert_eq!(
            (got.exit, got.stdout.as_str()),
            (2, "invalid_input: Use walleterm list [--human] or walleterm sign < request.json.\n")
        );
    }
}

#[test]
fn human_comments_cannot_reach_the_terminal_raw() {
    use walleterm::cli::go_quote;
    assert_eq!(go_quote("name\x1b[31m\nnext"), r#""name\x1b[31m\nnext""#);
    assert_eq!(go_quote("tab\tq\"b\\"), r#""tab\tq\"b\\""#);
    assert_eq!(go_quote("café 名前"), "\"café 名前\"");
    assert_eq!(
        go_quote("\u{7f}\u{85}\u{a0}\u{200b}\u{202e}\u{feff}"),
        r#""\x7f\u0085\u00a0\u200b\u202e\ufeff""#
    );
    assert_eq!(go_quote("\u{e000}\u{f0000}"), r#""\ue000\U000f0000""#);
}

#[test]
fn the_binary_rejects_bad_input_without_touching_the_agent() {
    let run_binary = |args: &[&str], stdin: &[u8]| {
        let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_walleterm"))
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(stdin).unwrap();
        let output = child.wait_with_output().unwrap();
        (
            output.status.code(),
            String::from_utf8(output.stdout).unwrap(),
            String::from_utf8(output.stderr).unwrap(),
        )
    };
    let (code, out, err) = run_binary(&["sign"], b"{}");
    assert_eq!((code, err.as_str()), (Some(2), ""));
    assert_eq!(
        out,
        "{\"ok\":false,\"error\":{\"code\":\"invalid_input\",\"message\":\"Provide exactly one of transaction_xdr, preimage_xdr, auth_entry_xdr, or message.\"}}\n"
    );
    let (code, out, _) = run_binary(&["sign-auth"], b"[]");
    assert_eq!(code, Some(2));
    assert!(out.contains("Use walleterm list [--human] or walleterm sign"));
    let (code, out, _) = run_binary(&["--help"], b"");
    assert_eq!((code, out.as_str()), (Some(0), walleterm::cli::HELP));
}

/// A writer that waits before accepting each write.
struct Slow(Duration);

impl Write for Slow {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        std::thread::sleep(self.0);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn a_late_notice_never_sends_a_signing_request_after_the_deadline() {
    let scratch = Scratch::new();
    let agent = mock_agent(&scratch.socket(), vec![Reply::Frame(identities_body()), Reply::SignDigest]);
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_millis(100);
    let exit = run_with(
        &["sign"],
        sign_input().as_bytes(),
        &mut out,
        &mut Slow(Duration::from_millis(250)),
        Some(&scratch.socket()),
        deadline,
    );
    let requests = agent.join().unwrap();
    assert_eq!(exit, 1);
    assert_eq!(requests.iter().filter(|r| r[0] == 13).count(), 0, "no signing request after the deadline");
    assert_eq!(
        String::from_utf8(out).unwrap(),
        "{\"ok\":false,\"error\":{\"code\":\"timeout\",\"message\":\"The agent operation timed out.\"}}\n"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn a_buffered_response_after_the_deadline_is_not_read() {
    let scratch = Scratch::new();
    let listener = UnixListener::bind(scratch.socket()).unwrap();
    std::fs::set_permissions(scratch.socket(), std::fs::Permissions::from_mode(0o600)).unwrap();
    let body = identities_body();
    // The mock answers before any request arrives, so the response waits in the socket buffer.
    let agent = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = write_frame(&mut stream, &body);
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        read_frame(&mut stream).ok()
    });
    let deadline = Instant::now() + Duration::from_millis(20);
    let mut connection = walleterm::agent::Agent::connect(&scratch.socket(), deadline).await.unwrap();
    std::thread::sleep(Duration::from_millis(60));
    assert_eq!(connection.list().await.unwrap_err().code, "timeout");
    drop(connection);
    assert_eq!(agent.join().unwrap(), None, "the expired client sent no request");
}

#[test]
fn format_characters_are_escaped_like_go() {
    let bs = '\\';
    let expected = format!("\"x{bs}U000e0001{bs}U000e0061{bs}U000110bdy\"");
    assert_eq!(walleterm::cli::go_quote("x\u{e0001}\u{e0061}\u{110bd}y"), expected);
}

/// Offline XDR builders for the sign shapes.
mod build {
    use stellar_xdr::*;
    use walleterm::util::sha256;

    pub fn account(key: [u8; 32]) -> MuxedAccount {
        MuxedAccount::Ed25519(Uint256(key))
    }

    pub fn address(key: [u8; 32]) -> ScAddress {
        ScAddress::Account(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(key))))
    }

    pub fn contract(n: u8) -> ScAddress {
        ScAddress::Contract(ContractId(Hash([n; 32])))
    }

    pub fn text(value: &impl WriteXdr) -> String {
        walleterm::stellar::encode(value)
    }

    fn operations() -> VecM<Operation, 100> {
        let body = OperationBody::ManageData(ManageDataOp {
            data_name: String64("walleterm".try_into().unwrap()),
            data_value: None,
        });
        vec![Operation { source_account: None, body }].try_into().unwrap()
    }

    /// A V1 envelope with one manageData operation. `None` means no time bounds.
    pub fn transaction(source: [u8; 32], max_time: Option<u64>) -> TransactionEnvelope {
        let cond = max_time.map_or(Preconditions::None, |t| {
            Preconditions::Time(TimeBounds { min_time: TimePoint(0), max_time: TimePoint(t) })
        });
        TransactionEnvelope::Tx(TransactionV1Envelope {
            tx: Transaction {
                source_account: account(source),
                fee: 100,
                seq_num: SequenceNumber(7),
                cond,
                memo: Memo::None,
                operations: operations(),
                ext: TransactionExt::V0,
            },
            signatures: VecM::default(),
        })
    }

    pub fn v0(source: [u8; 32]) -> TransactionEnvelope {
        TransactionEnvelope::TxV0(TransactionV0Envelope {
            tx: TransactionV0 {
                source_account_ed25519: Uint256(source),
                fee: 100,
                seq_num: SequenceNumber(7),
                time_bounds: None,
                memo: Memo::None,
                operations: operations(),
                ext: TransactionV0Ext::V0,
            },
            signatures: VecM::default(),
        })
    }

    pub fn fee_bump(fee_source: [u8; 32], inner: TransactionEnvelope) -> TransactionEnvelope {
        let TransactionEnvelope::Tx(inner) = inner else { panic!("a V1 inner envelope") };
        TransactionEnvelope::TxFeeBump(FeeBumpTransactionEnvelope {
            tx: FeeBumpTransaction {
                fee_source: account(fee_source),
                fee: 400,
                inner_tx: FeeBumpTransactionInnerTx::Tx(inner),
                ext: FeeBumpTransactionExt::V0,
            },
            signatures: VecM::default(),
        })
    }

    /// The network-bound hash, computed from the XDR types.
    pub fn hash(envelope: &TransactionEnvelope, passphrase: &str) -> [u8; 32] {
        let tagged = match envelope {
            TransactionEnvelope::Tx(v1) => TransactionSignaturePayloadTaggedTransaction::Tx(v1.tx.clone()),
            TransactionEnvelope::TxFeeBump(outer) => {
                TransactionSignaturePayloadTaggedTransaction::TxFeeBump(outer.tx.clone())
            }
            TransactionEnvelope::TxV0(_) => panic!("no V0 hash"),
        };
        let payload = TransactionSignaturePayload {
            network_id: Hash(sha256(passphrase.as_bytes())),
            tagged_transaction: tagged,
        };
        sha256(&payload.to_xdr(Limits::none()).unwrap())
    }

    /// Append `signature` with the hint of `key`.
    pub fn with_signature(
        mut envelope: TransactionEnvelope,
        key: [u8; 32],
        signature: [u8; 64],
    ) -> TransactionEnvelope {
        let decorated = DecoratedSignature {
            hint: SignatureHint([key[28], key[29], key[30], key[31]]),
            signature: Signature(signature.to_vec().try_into().unwrap()),
        };
        let signatures = match &mut envelope {
            TransactionEnvelope::Tx(v1) => &mut v1.signatures,
            TransactionEnvelope::TxFeeBump(outer) => &mut outer.signatures,
            TransactionEnvelope::TxV0(v0) => &mut v0.signatures,
        };
        let mut list = signatures.to_vec();
        list.push(decorated);
        *signatures = list.try_into().unwrap();
        envelope
    }

    pub fn signatures(envelope: &TransactionEnvelope) -> Vec<DecoratedSignature> {
        match envelope {
            TransactionEnvelope::Tx(v1) => v1.signatures.to_vec(),
            TransactionEnvelope::TxFeeBump(outer) => outer.signatures.to_vec(),
            TransactionEnvelope::TxV0(v0) => v0.signatures.to_vec(),
        }
    }

    fn invocation() -> SorobanAuthorizedInvocation {
        SorobanAuthorizedInvocation {
            function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
                contract_address: contract(2),
                function_name: ScSymbol("f".try_into().unwrap()),
                args: VecM::default(),
            }),
            sub_invocations: VecM::default(),
        }
    }

    pub fn entry(address: ScAddress, expiration: u32, v2: bool) -> String {
        let credentials = SorobanAddressCredentials {
            address,
            nonce: 5,
            signature_expiration_ledger: expiration,
            signature: ScVal::Void,
        };
        let credentials = if v2 {
            SorobanCredentials::AddressV2(credentials)
        } else {
            SorobanCredentials::Address(credentials)
        };
        text(&SorobanAuthorizationEntry { credentials, root_invocation: invocation() })
    }

    pub fn preimage(address: ScAddress, expiration: u32, passphrase: &str) -> String {
        text(&HashIdPreimage::SorobanAuthorizationWithAddress(
            HashIdPreimageSorobanAuthorizationWithAddress {
                network_id: Hash(sha256(passphrase.as_bytes())),
                nonce: 5,
                signature_expiration_ledger: expiration,
                address,
                invocation: invocation(),
            },
        ))
    }

    pub fn legacy_preimage(passphrase: &str) -> String {
        text(&HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
            network_id: Hash(sha256(passphrase.as_bytes())),
            nonce: 5,
            signature_expiration_ledger: 100,
            invocation: invocation(),
        }))
    }
}

const TESTNET: &str = walleterm::network::TESTNET;
const PUBNET: &str = "Public Global Stellar Network ; September 2015";

fn mock_public() -> [u8; 32] {
    SigningKey::from_bytes(&SEED).verifying_key().to_bytes()
}

fn other_public() -> [u8; 32] {
    SigningKey::from_bytes(&[9; 32]).verifying_key().to_bytes()
}

fn now_seconds() -> u64 {
    walleterm::util::now_ms() / 1000
}

fn identities_for(key: &[u8; 32]) -> Vec<u8> {
    let mut blob = Vec::new();
    for part in [&b"ssh-ed25519"[..], key] {
        blob.extend((part.len() as u32).to_be_bytes());
        blob.extend(part);
    }
    let mut body = vec![12, 0, 0, 0, 1];
    body.extend((blob.len() as u32).to_be_bytes());
    body.extend(blob);
    body.extend(4u32.to_be_bytes());
    body.extend(b"mock");
    body
}

/// Sign once with the mock seed. The agent must receive exactly one signing request, for the reported digest.
fn signed(request: &Value) -> (Value, String, String) {
    let scratch = Scratch::new();
    let agent = mock_agent(&scratch.socket(), vec![Reply::Frame(identities_body()), Reply::SignDigest]);
    let got = invoke(&["sign"], request.to_string().as_bytes(), Some(&scratch.socket()), Some(agent));
    assert_eq!(got.exit, 0, "{request}: {}", got.stdout);
    let signing: Vec<&Vec<u8>> = got.requests.iter().filter(|r| r[0] == 13).collect();
    assert_eq!(signing.len(), 1, "one signing request");
    let out: Value = serde_json::from_str(&got.stdout).unwrap();
    assert_eq!(out["digest"], hex(&requested_digest(signing[0])));
    assert_eq!(
        (&out["ok"], &out["verified"], &out["public_key"]),
        (&json!(true), &json!(true), &json!(mock_address()))
    );
    let signature = lower_hex::<64>(out["signature"].as_str().unwrap()).unwrap();
    let digest = lower_hex::<32>(out["digest"].as_str().unwrap()).unwrap();
    assert!(walleterm::stellar::verify(&mock_public(), &digest, &signature));
    (out, got.stderr, got.stdout)
}

/// A refused request: exit 2, `invalid_input` with `message`, and no agent connection at all.
fn refused(stdin: &[u8], message: &str) {
    let scratch = Scratch::new();
    let agent = mock_agent(&scratch.socket(), vec![Reply::SignDigest]);
    let got = invoke(&["sign"], stdin, Some(&scratch.socket()), None);
    // The CLI never connected. Connect once so the mock ends.
    let _ = UnixStream::connect(scratch.socket());
    let requests = agent.join().unwrap();
    let shown = String::from_utf8_lossy(&stdin[..stdin.len().min(120)]).into_owned();
    assert_eq!(got.exit, 2, "{shown}: {}", got.stdout);
    assert_eq!(got.stdout, json_error(message), "{shown}");
    assert_eq!(got.stderr, "", "{shown}");
    assert!(requests.is_empty(), "{shown}: the agent received {} requests", requests.len());
}

fn json_error(message: &str) -> String {
    let message = walleterm::cli::json_line(&message);
    format!("{{\"ok\":false,\"error\":{{\"code\":\"invalid_input\",\"message\":{}}}}}\n", message.trim_end())
}

use serde_json::json;
use walleterm::util::lower_hex as parse_hex;

#[test]
fn transactions_sign_without_time_bounds_for_any_signer_and_any_network() {
    use stellar_xdr::{Limits, ReadXdr, TransactionEnvelope};
    let (me, other) = (mock_public(), other_public());
    let cases = [
        ("no time bounds", build::transaction(me, None), TESTNET),
        ("a long lifetime", build::transaction(me, Some(now_seconds() + 30 * 86_400)), TESTNET),
        ("the largest max_time", build::transaction(me, Some(u64::MAX)), TESTNET),
        ("a co-signer for another account", build::transaction(other, None), TESTNET),
        ("a fee bump for another fee source", build::fee_bump(other, build::transaction(me, None)), TESTNET),
        ("mainnet", build::transaction(me, None), PUBNET),
        ("local", build::transaction(me, None), "Standalone Network ; February 2017"),
        ("a custom network", build::transaction(me, None), "Walleterm ; offline"),
    ];
    for (name, envelope, network) in cases {
        let request = json!({
            "public_key": mock_address(),
            "network_passphrase": network,
            "transaction_xdr": build::text(&envelope),
        });
        let (out, notice, raw) = signed(&request);
        let order = ["ok", "public_key", "digest", "signature", "signed_transaction_xdr", "verified"];
        let positions: Vec<usize> = order.iter().map(|k| raw.find(&format!("\"{k}\":")).unwrap()).collect();
        assert!(positions.windows(2).all(|w| w[0] < w[1]), "{name}: {raw}");
        assert_eq!(out.as_object().unwrap().len(), order.len(), "{name}");
        let hash = build::hash(&envelope, network);
        assert_eq!(out["digest"], hex(&hash), "{name}");
        let after = TransactionEnvelope::from_xdr_base64(
            out["signed_transaction_xdr"].as_str().unwrap(),
            Limits::none(),
        )
        .unwrap();
        let signature = parse_hex::<64>(out["signature"].as_str().unwrap()).unwrap();
        assert_eq!(
            after,
            build::with_signature(envelope.clone(), me, signature),
            "{name}: one appended signature"
        );
        let label = match network {
            TESTNET => "testnet".to_owned(),
            PUBNET => "mainnet".to_owned(),
            "Standalone Network ; February 2017" => "local".to_owned(),
            custom => format!("network {}", walleterm::cli::go_quote(custom)),
        };
        assert_eq!(notice, format!("Sign transaction {} on {label} with {}.\n", hex(&hash), mock_address()));
    }
    // 19 existing signatures leave room for the selected key.
    let mut envelope = build::transaction(other, None);
    for seed in 20..39u8 {
        envelope = build::with_signature(envelope, [seed; 32], [seed; 64]);
    }
    let request = json!({"public_key": mock_address(), "network_passphrase": TESTNET, "transaction_xdr": build::text(&envelope)});
    let (out, _, _) = signed(&request);
    let after =
        TransactionEnvelope::from_xdr_base64(out["signed_transaction_xdr"].as_str().unwrap(), Limits::none())
            .unwrap();
    assert_eq!(build::signatures(&after).len(), 20);
}

/// The frozen JS SDK results for preimages and entries, reproduced end to end through the CLI and the agent.
#[test]
fn frozen_vectors_sign_end_to_end() {
    let vectors = fixture("vectors.json");
    let case =
        |id: &str| vectors["cases"].as_array().unwrap().iter().find(|c| c["id"] == id).unwrap().clone();
    for id in ["preimage-account", "preimage-contract"] {
        let c = case(id);
        let request = json!({
            "public_key": c["public_key"],
            "network_passphrase": c["network_passphrase"],
            "preimage_xdr": c["preimage_xdr"],
        });
        let (out, notice, _) = signed(&request);
        assert_eq!(out["digest"], c["expect"]["digest"], "{id}");
        assert_eq!(out["signature"], c["expect"]["signature"], "{id}");
        assert_eq!(out.as_object().unwrap().len(), 5, "{id}: no signed artifact for a preimage");
        assert!(
            notice.starts_with(&format!(
                "Sign authorization preimage {} for {} on testnet with {}, expiring at ledger ",
                c["expect"]["digest"].as_str().unwrap(),
                c["expect"]["address"].as_str().unwrap(),
                mock_address()
            )),
            "{notice}"
        );
    }
    for id in ["auth-account", "auth-contract-ed25519", "auth-openzeppelin", "auth-window-max-ledger"] {
        let c = case(id);
        let mut request = c["input"].clone();
        let adapter = request["adapter"]["type"].as_str().unwrap().to_owned();
        let (out, notice, _) = signed(&request);
        assert_eq!(out["digest"], c["expect"]["digest"], "{id}");
        assert_eq!(out["signature"], c["expect"]["signature"], "{id}");
        assert_eq!(out["signed_auth_entry_xdr"], c["expect"]["signed_auth_entry_xdr"], "{id}");
        let prefix = format!(
            "Sign authorization entry {} for {} ({adapter}) on testnet with {}, expiring at ledger ",
            c["expect"]["digest"].as_str().unwrap(),
            request["address"].as_str().unwrap(),
            mock_address()
        );
        assert!(notice.starts_with(&prefix), "{notice}");
        // `latest_ledger` is an unknown field now.
        request["latest_ledger"] = json!(100);
        refused(
            request.to_string().as_bytes(),
            "The entry shape has exactly these fields: public_key, network_passphrase, auth_entry_xdr, address, adapter.",
        );
    }
}

#[test]
fn authorization_expiry_needs_no_ledger() {
    let (me, other) = (mock_public(), other_public());
    let key = mock_address();
    for expiration in [1, 4_000_000, u32::MAX] {
        // A preimage bound to another G-address signs in the CLI: a multisig co-signer needs it.
        for bound in [build::address(me), build::address(other), build::contract(1)] {
            let request = json!({
                "public_key": key,
                "network_passphrase": TESTNET,
                "preimage_xdr": build::preimage(bound.clone(), expiration, TESTNET),
            });
            let (out, notice, _) = signed(&request);
            assert!(notice.ends_with(&format!(", expiring at ledger {expiration}.\n")), "{notice}");
            let raw = base64_decode(request["preimage_xdr"].as_str().unwrap());
            assert_eq!(out["digest"], hex(&walleterm::util::sha256(&raw)));
            assert!(notice.contains(&format!(" for {bound} on testnet")), "{notice}");
        }
        let request = json!({
            "public_key": key,
            "network_passphrase": TESTNET,
            "auth_entry_xdr": build::entry(build::contract(1), expiration, true),
            "address": build::contract(1).to_string(),
            "adapter": {"type": "contract-ed25519"},
        });
        signed(&request);
    }
    let zero = "Set the authorization expiration ledger. Ledger 0 is always in the past.";
    let request = json!({
        "public_key": key,
        "network_passphrase": TESTNET,
        "preimage_xdr": build::preimage(build::address(me), 0, TESTNET),
    });
    refused(request.to_string().as_bytes(), zero);
    let request = json!({
        "public_key": key,
        "network_passphrase": TESTNET,
        "auth_entry_xdr": build::entry(build::contract(1), 0, true),
        "address": build::contract(1).to_string(),
        "adapter": {"type": "contract-ed25519"},
    });
    refused(request.to_string().as_bytes(), zero);
}

fn base64_decode(text: &str) -> Vec<u8> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD.decode(text).unwrap()
}

/// SEP-53 v1.0.0 test cases. The agent lists the public SEP-53 test key and answers with the published signature.
/// Ed25519 is deterministic, so only the published digest makes the CLI accept and return it.
#[test]
fn sep53_messages_sign_to_the_specification() {
    let public = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
    let key = walleterm::stellar::account_key(public).unwrap();
    for (message, bytes, digest, signature) in [
        (
            "Hello, World!",
            13,
            "d52eb59c06bb510d065997ff93077068eed0a486c20215b5e02e1ab0d2ebea5f",
            "7cee5d6d885752104c85eea421dfdcb95abf01f1271d11c4bec3fcbd7874dccd6e2e98b97b8eb23b643cac4073bb77de5d07b0710139180ae9f3cbba78f2ba04",
        ),
        (
            "こんにちは、世界！",
            27,
            "7bde4f792e336ed43df42ad66a92b44cb1bc60708e8bee63494c289dee161682",
            "083536eb95ecf32dce59b07fe7a1fd8cf814b2ce46f40d2a16e4ea1f6cecd980e04e6fbef9d21f98011c785a81edb85f3776a6e7d942b435eb0adc07da4d4604",
        ),
    ] {
        let scratch = Scratch::new();
        let raw = parse_hex::<64>(signature).unwrap();
        let replies = vec![Reply::Frame(identities_for(&key)), Reply::Frame(sign_response(&raw))];
        let agent = mock_agent(&scratch.socket(), replies);
        let request = json!({ "public_key": public, "message": message });
        let got = invoke(&["sign"], request.to_string().as_bytes(), Some(&scratch.socket()), Some(agent));
        assert_eq!(got.exit, 0, "{}", got.stdout);
        assert_eq!(hex(&requested_digest(&got.requests[1])), digest);
        assert_eq!(
            got.stdout,
            format!(
                "{{\"ok\":true,\"public_key\":\"{public}\",\"digest\":\"{digest}\",\"signature\":\"{signature}\",\"verified\":true}}\n"
            )
        );
        assert_eq!(
            got.stderr,
            format!(
                "Sign SEP-53 message {digest} with {public} ({bytes} bytes, no network, site, or expiry binding): \"{message}\"\n"
            )
        );
    }
}

/// The limit counts UTF-8 bytes. No content filter applies; the notice escapes every character.
#[test]
fn messages_count_bytes_and_the_notice_escapes_every_character() {
    let key = mock_address();
    for message in
        ["a".repeat(1024), "é".repeat(512), format!("{}a", "日".repeat(341)), "x\0y\u{202e}z\n".into()]
    {
        let (out, notice, _) = signed(&json!({ "public_key": key, "message": message }));
        assert_eq!(out["digest"], hex(&walleterm::message::digest(message.as_bytes())));
        assert_eq!(out.as_object().unwrap().len(), 5);
        assert!(
            notice.contains(&format!(" ({} bytes, no network, site, or expiry binding): ", message.len()))
        );
    }
    let (_, notice, _) = signed(&json!({ "public_key": key, "message": "x\0y\u{202e}z\n" }));
    assert_eq!(notice.rsplit_once("): ").unwrap().1, "\"x\\x00y\\u202ez\\n\"\n");
    assert_eq!(notice.matches('\n').count(), 1, "the text cannot add a line");
    let limit = "The message must contain 1 to 1024 UTF-8 bytes.";
    for message in ["a".repeat(1025), "é".repeat(513), "日".repeat(342)] {
        refused(json!({ "public_key": key, "message": message }).to_string().as_bytes(), limit);
    }
}

#[test]
fn strict_refusals_never_reach_the_agent() {
    let key = mock_address();
    let (me, other) = (mock_public(), other_public());
    let tx = build::text(&build::transaction(me, None));
    let preimage = build::preimage(build::address(me), 100, TESTNET);
    let entry = build::entry(build::contract(1), 100, true);
    let contract = build::contract(1).to_string();
    let one = "Provide exactly one of transaction_xdr, preimage_xdr, auth_entry_xdr, or message.";
    let tx_fields =
        "The transaction shape has exactly these fields: public_key, network_passphrase, transaction_xdr.";
    let preimage_fields =
        "The preimage shape has exactly these fields: public_key, network_passphrase, preimage_xdr.";
    let entry_fields = "The entry shape has exactly these fields: public_key, network_passphrase, auth_entry_xdr, address, adapter.";
    let message_fields = "The message shape has exactly these fields: public_key, message.";
    let full_tx = json!({"public_key": key, "network_passphrase": TESTNET, "transaction_xdr": tx});
    let full_preimage = json!({"public_key": key, "network_passphrase": TESTNET, "preimage_xdr": preimage});
    let full_entry = json!({
        "public_key": key, "network_passphrase": TESTNET, "auth_entry_xdr": entry,
        "address": contract, "adapter": {"type": "contract-ed25519"},
    });
    let full_message = json!({"public_key": key, "message": "hello"});
    let mut cases: Vec<(Vec<u8>, String)> = Vec::new();
    let mut add =
        |value: Value, message: &str| cases.push((value.to_string().into_bytes(), message.to_owned()));
    // Artifact key counts 0, 2, 3, and 4, and the removed digest input.
    add(json!({"public_key": key}), one);
    add(json!({"public_key": key, "digest": "01".repeat(32)}), one);
    add(
        json!({"public_key": key, "network_passphrase": TESTNET, "transaction_xdr": tx, "message": "hi"}),
        one,
    );
    add(
        json!({"public_key": key, "network_passphrase": TESTNET, "transaction_xdr": tx, "preimage_xdr": preimage, "message": "hi"}),
        one,
    );
    add(
        json!({"public_key": key, "network_passphrase": TESTNET, "transaction_xdr": tx, "preimage_xdr": preimage,
            "auth_entry_xdr": entry, "address": contract, "adapter": {"type": "account"}, "message": "hi"}),
        one,
    );
    // Each shape with one key missing, one extra key, and latest_ledger.
    for (full, fields, message) in [
        (&full_tx, ["public_key", "network_passphrase"].as_slice(), tx_fields),
        (&full_preimage, &["public_key", "network_passphrase"], preimage_fields),
        (&full_entry, &["public_key", "network_passphrase", "address", "adapter"], entry_fields),
        (&full_message, &["public_key"], message_fields),
    ] {
        for field in fields {
            let mut missing = full.clone();
            missing.as_object_mut().unwrap().remove(*field);
            add(missing, message);
        }
        for extra in ["extra", "latest_ledger"] {
            let mut more = full.clone();
            more[extra] = json!(100);
            add(more, message);
        }
    }
    let mut networked = full_message.clone();
    networked["network_passphrase"] = json!(TESTNET);
    add(networked, message_fields);
    // Types and empty strings.
    add(json!({"public_key": key, "message": 5}), "The message field must be a JSON string.");
    add(json!({"public_key": null, "message": "hi"}), "The public_key field must be a JSON string.");
    add(json!({"public_key": key, "message": ""}), "The message field must not be empty.");
    add(
        json!({"public_key": key, "network_passphrase": TESTNET, "transaction_xdr": ""}),
        "The transaction_xdr field must not be empty.",
    );
    let mut adapter_text = full_entry.clone();
    adapter_text["adapter"] = json!("account");
    add(adapter_text, "The adapter must be a JSON object.");
    add(
        json!({"public_key": key.to_lowercase(), "message": "hi"}),
        "The public key must be a canonical Ed25519 G-address.",
    );
    for passphrase in [" \t".to_owned(), "a".repeat(257)] {
        let mut network = full_tx.clone();
        network["network_passphrase"] = json!(passphrase);
        add(network, "Provide the exact network passphrase.");
    }
    // Transaction rules.
    let mut twenty = build::transaction(me, None);
    for seed in 20..40u8 {
        twenty = build::with_signature(twenty, [seed; 32], [seed; 64]);
    }
    let unsigned = build::transaction(me, None);
    let own = SigningKey::from_bytes(&SEED).sign(&build::hash(&unsigned, TESTNET)).to_bytes();
    let expired = "The transaction expired. Its max_time is at or before the current time.";
    for (envelope, message) in [
        (twenty, "The transaction has too many signatures."),
        (build::with_signature(unsigned, me, own), "The selected account already signed this transaction."),
        (build::transaction(me, Some(1)), expired),
        (build::transaction(me, Some(now_seconds().saturating_sub(1))), expired),
        (build::fee_bump(me, build::transaction(other, Some(1))), expired),
        (build::v0(me), "Use a V1 or fee-bump transaction envelope."),
    ] {
        add(
            json!({"public_key": key, "network_passphrase": TESTNET, "transaction_xdr": build::text(&envelope)}),
            message,
        );
    }
    // Preimage and entry rules.
    add(
        json!({"public_key": key, "network_passphrase": TESTNET, "preimage_xdr": build::legacy_preimage(TESTNET)}),
        "Use an address-bound (CAP-71) preimage. The legacy preimage permits cross-address replay.",
    );
    add(
        json!({"public_key": key, "network_passphrase": PUBNET, "preimage_xdr": preimage}),
        "The authorization is for a different network.",
    );
    let mut v1 = full_entry.clone();
    v1["auth_entry_xdr"] = json!(build::entry(build::contract(1), 100, false));
    add(
        v1,
        "Authorization signing requires address-bound V2 credentials. Legacy V1 permits cross-address replay.",
    );
    let mut moved = full_entry.clone();
    moved["address"] = json!(build::contract(2).to_string());
    add(moved, "The authorization address differs from the requested address.");
    // The account adapter signs only for the selected G-address, even when another account lists the key.
    let mut other_account = full_entry.clone();
    other_account["auth_entry_xdr"] = json!(build::entry(build::address(other), 100, true));
    other_account["address"] = json!(build::address(other).to_string());
    other_account["adapter"] = json!({"type": "account"});
    add(other_account, "The account authorization must match the selected G-address.");
    for (bytes, message) in cases {
        refused(&bytes, &message);
    }
    // Raw input rules: duplicates at any depth, trailing JSON, invalid UTF-8, a lone surrogate, and the size limit.
    let duplicate = "The input contains a duplicate field.";
    refused(format!(r#"{{"public_key":"{key}","message":"a","message":"b"}}"#).as_bytes(), duplicate);
    let entry_text = full_entry
        .to_string()
        .replace(r#"{"type":"contract-ed25519"}"#, r#"{"type":"account","type":"contract-ed25519"}"#);
    refused(entry_text.as_bytes(), duplicate);
    refused(
        format!(r#"{{"public_key":"{key}","message":"a"}} {{}}"#).as_bytes(),
        "The input must contain no trailing JSON.",
    );
    let mut invalid = format!(r#"{{"public_key":"{key}","message":"a"#).into_bytes();
    invalid.extend([0xff, b'"', b'}']);
    refused(&invalid, "The input must be valid UTF-8.");
    refused(
        format!(r#"{{"public_key":"{key}","message":"a\ud800b"}}"#).as_bytes(),
        "The input must be one JSON object.",
    );
    refused(b"[]", "The input must be one JSON object.");
    refused(&vec![b' '; 393_217], "The input must be at most 393216 bytes.");
}
