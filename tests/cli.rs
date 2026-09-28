//! The native CLI against frozen transcripts of the Go signer (`fixtures/parity/cli.json`) and the
//! TS `sign-auth` sidecar (`fixtures/parity/sign-auth.json`), through a real Unix socket mock agent.
//! Mock seeds only. Nothing here opens the real 1Password socket.

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

/// Serve one connection: answer each request in order, then record any unexpected follow-up request.
fn mock_agent(path: &Path, replies: Vec<Reply>) -> JoinHandle<Vec<Vec<u8>>> {
    let listener = UnixListener::bind(path).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let (ready, wait) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        ready.send(()).unwrap();
        let mut got = Vec::new();
        let Ok((mut stream, _)) = listener.accept() else { return got };
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
                    // type 13, key blob (4 + 51 bytes), digest (4 + 32 bytes), flags.
                    let digest = &request[1 + 4 + 51 + 4..1 + 4 + 51 + 4 + 32];
                    let signature = SigningKey::from_bytes(&SEED).sign(digest).to_bytes();
                    let mut wrapped = Vec::new();
                    for part in [&b"ssh-ed25519"[..], &signature] {
                        wrapped.extend((part.len() as u32).to_be_bytes());
                        wrapped.extend(part);
                    }
                    let mut body = vec![14];
                    body.extend((wrapped.len() as u32).to_be_bytes());
                    body.extend(wrapped);
                    let _ = write_frame(&mut stream, &body);
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

#[test]
fn go_signer_transcripts() {
    let file = fixture("cli.json");
    let missing = PathBuf::from(file["missing_socket"].as_str().unwrap());
    let mut failures = Vec::new();
    for case in file["cases"].as_array().unwrap() {
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

#[test]
fn sign_auth_transcripts() {
    let file = fixture("sign-auth.json");
    let key = SigningKey::from_bytes(&SEED).verifying_key().to_bytes();
    let other = SigningKey::from_bytes(&[8; 32]).verifying_key().to_bytes();
    let identities = |key: &[u8; 32]| {
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
    };
    let mut failures = Vec::new();
    for case in file["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let stdin = case
            .get("stdin_hex")
            .and_then(Value::as_str)
            .map_or_else(|| case["stdin"].as_str().unwrap().as_bytes().to_vec(), unhex);
        let replies = match case.get("mode").and_then(Value::as_str) {
            Some("refused") => vec![Reply::Frame(identities(&key)), Reply::Frame(vec![5])],
            Some("not-found") => vec![Reply::Frame(identities(&other))],
            _ => vec![Reply::Frame(identities(&key)), Reply::SignDigest],
        };
        let scratch = Scratch::new();
        let agent = mock_agent(&scratch.socket(), replies);
        // Rejected input never opens the socket. Connect once so the mock thread always ends.
        let got = invoke(&["sign-auth"], &stdin, Some(&scratch.socket()), None);
        if got.exit == 2 || got.stdout.contains("\"ok\":false,\"error\":{\"code\":\"invalid_input\"") {
            let _ = UnixStream::connect(scratch.socket());
        }
        let requests = agent.join().unwrap();
        let signed = requests.iter().filter(|r| r.first() == Some(&13)).count();
        let matches = got.exit == case["exit"].as_i64().unwrap() as i32
            && got.stdout == case["stdout"].as_str().unwrap()
            && got.stderr == case["stderr"].as_str().unwrap();
        let expect_signing = case["exit"] == 0 || case.get("mode").and_then(Value::as_str) == Some("refused");
        if !matches || (signed == 1) != expect_signing {
            failures.push(format!(
                "{id}\n  exit {} vs {}\n  stdout {:?}\n  want   {:?}\n  stderr {:?}\n  want   {:?}\n  sign requests {signed}",
                got.exit, case["exit"], got.stdout, case["stdout"], got.stderr, case["stderr"]
            ));
        }
    }
    assert!(failures.is_empty(), "{} transcripts differ:\n{}", failures.len(), failures.join("\n"));
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

fn sign_input() -> String {
    let address =
        walleterm::stellar::account_address(&SigningKey::from_bytes(&SEED).verifying_key().to_bytes());
    format!(r#"{{"public_key":"{address}","digest":"{}"}}"#, "01".repeat(32))
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
    let deadline = Instant::now() + Duration::from_millis(80);
    let mut reader = walleterm::platform::DeadlineReader { fd: fds[0], deadline };
    let mut out = Vec::new();
    let args = vec!["sign-auth".to_string()];
    let exit = run(
        &args,
        &mut Io { input: &mut reader, out: &mut out, diagnostic: &mut diagnostic, socket: None, deadline },
    );
    assert_eq!(exit, 1);
    assert!(String::from_utf8(out).unwrap().contains(r#""code":"timeout""#));
    unsafe {
        libc::close(fds[0]);
        libc::close(fds[1]);
    }
}

#[test]
fn output_failure_never_repeats_signing() {
    for command in ["list", "sign"] {
        for human in [false, true] {
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
}

#[test]
fn a_failed_notice_prevents_signing() {
    for human in [false, true] {
        for short in [false, true] {
            let scratch = Scratch::new();
            let agent = mock_agent(&scratch.socket(), vec![Reply::Frame(identities_body())]);
            let mut args = vec!["sign"];
            if human {
                args.push("--human");
            }
            let (mut out, mut diagnostic) = (Vec::new(), Failing { short, calls: 0 });
            let exit = run_with(
                &args,
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
            if human {
                assert!(text.starts_with("output_error: "), "{text}");
            } else {
                assert!(text.contains(r#""code":"output_error""#), "{text}");
            }
        }
    }
    // sign-auth: the same rule.
    let file = fixture("sign-auth.json");
    let case = file["cases"].as_array().unwrap().iter().find(|c| c["id"] == "signauth-account").unwrap();
    let scratch = Scratch::new();
    let agent = mock_agent(&scratch.socket(), vec![]);
    let mut out = Vec::new();
    let exit = run_with(
        &["sign-auth"],
        case["stdin"].as_str().unwrap().as_bytes(),
        &mut out,
        &mut Failing { short: false, calls: 0 },
        Some(&scratch.socket()),
        Instant::now() + DEADLINE,
    );
    let _ = UnixStream::connect(scratch.socket());
    assert!(agent.join().unwrap().is_empty(), "sign-auth must not open the agent after a failed notice");
    assert_eq!(exit, 1);
    assert!(String::from_utf8(out).unwrap().contains(r#""code":"output_error""#));
}

#[test]
fn help_version_and_sign_auth_arguments() {
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
    let got = invoke(&["sign-auth", "--help"], b"", None, None);
    assert_eq!(got.exit, 0);
    assert!(got.stdout.starts_with("walleterm sign-auth < request.json\n"));
    for args in [&["sign-auth", "--human"][..], &["sign-auth", "--digest", "00"], &["sign-auth", "extra"]] {
        let got = invoke(args, b"", None, None);
        assert_eq!(got.exit, 2, "{args:?}");
        assert_eq!(
            got.stdout,
            "{\"ok\":false,\"error\":{\"code\":\"invalid_input\",\"message\":\"Use walleterm sign-auth \\u003c request.json.\"}}\n",
            "Go's JSON encoder escapes <"
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
        "{\"ok\":false,\"error\":{\"code\":\"invalid_input\",\"message\":\"The public key must be a canonical Ed25519 G-address.\"}}\n"
    );
    let (code, out, _) = run_binary(&["sign-auth"], b"[]");
    assert_eq!(code, Some(2));
    assert!(out.contains("Send one JSON object."));
    let (code, out, _) = run_binary(&["export"], b"");
    assert_eq!(code, Some(2));
    assert!(out.contains("Use list or sign with an optional --human flag."));
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

#[test]
fn a_buffered_response_after_the_deadline_is_not_read() {
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
    let mut connection = walleterm::agent::Agent::connect(&scratch.socket(), deadline).unwrap();
    std::thread::sleep(Duration::from_millis(60));
    assert_eq!(connection.list().unwrap_err().code, "timeout");
    drop(connection);
    assert_eq!(agent.join().unwrap(), None, "the expired client sent no request");
}

#[test]
fn format_characters_are_escaped_like_go() {
    let bs = '\\';
    let expected = format!("\"x{bs}U000e0001{bs}U000e0061{bs}U000110bdy\"");
    assert_eq!(walleterm::cli::go_quote("x\u{e0001}\u{e0061}\u{110bd}y"), expected);
}
