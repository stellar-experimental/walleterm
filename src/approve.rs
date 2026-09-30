//! `walleterm approve`: review and answer the request that waits in `walleterm tunnel`.
//! The tunnel serves a private Unix socket for its port. The socket never goes through the public tunnel.
//! Any process of the same user can use it, as any such process can use the 1Password SSH agent (`SECURITY.md`).

use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::bridge::Bridge;
use crate::cancel::Cancel;
use crate::error::{Error, Result};
use crate::platform::current_uid;

pub const DEFAULT_PORT: u16 = 8787;
/// A request line: `{"op":"show"}` or `{"op":"answer","id":"<uuid>","approved":true}`.
const MAX_REQUEST: usize = 4096;
/// A reply holds the decoded artifact. A 262144-character transaction decodes to much less than this.
const MAX_REPLY: usize = 8 << 20;
/// One exchange on the socket, from connection to the last byte of the reply.
const EXCHANGE: Duration = Duration::from_secs(5);

pub const USAGE: &str = "walleterm approve [<id> [--deny]] [--port 8787]";

/// The private directory of the approval sockets. The path comes from the account database, as the
/// 1Password socket path does, so `HOME` and `TMPDIR` cannot point the command at another directory.
pub fn directory() -> Option<PathBuf> {
    crate::platform::account_home().map(|home| home.join("Library/Application Support/walleterm"))
}

pub fn socket_path(dir: &Path, port: u16) -> PathBuf {
    dir.join(format!("approve-{port}.sock"))
}

/// The directory must be a real directory that only this user can enter.
fn check_directory(dir: &Path) -> Result<()> {
    let private = std::fs::symlink_metadata(dir).is_ok_and(|info| {
        info.file_type().is_dir() && info.uid() == current_uid() && info.permissions().mode() & 0o077 == 0
    });
    if private {
        Ok(())
    } else {
        Err(Error::new(
            "start_failed",
            format!("{} must be a directory that only you can open (mode 0700).", dir.display()),
        ))
    }
}

/// The approval socket of one tunnel. Dropping it stops the listener and removes this socket only.
pub struct Server {
    path: PathBuf,
    /// The device and inode of the socket that this process created.
    created: (u64, u64),
    stop: Cancel,
}

impl Server {
    /// Create the private directory, replace a stale socket for this port, and serve the bridge.
    /// The caller binds its TCP port first. No other tunnel then uses this port, so an old socket is stale.
    pub fn start(dir: &Path, port: u16, bridge: Arc<Bridge>) -> Result<Self> {
        let failed = |e: &dyn std::fmt::Display| {
            Error::new("start_failed", format!("The approval socket did not start in {}: {e}", dir.display()))
        };
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir).map_err(|e| failed(&e))?;
        check_directory(dir)?;
        let path = socket_path(dir, port);
        match std::fs::symlink_metadata(&path) {
            Ok(info) if info.file_type().is_socket() && info.uid() == current_uid() => {
                std::fs::remove_file(&path).map_err(|e| failed(&e))?;
            }
            Ok(_) => {
                return Err(failed(&format!("{} is not a walleterm socket. Remove it.", path.display())));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(failed(&e)),
        }
        let listener = UnixListener::bind(&path).map_err(|e| failed(&e))?;
        let info = std::fs::symlink_metadata(&path).map_err(|e| failed(&e))?;
        let stop = Cancel::new();
        tokio::spawn(serve(listener, bridge, stop.clone()));
        Ok(Self { path, created: (info.dev(), info.ino()), stop })
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.stop.abort();
        let ours = std::fs::symlink_metadata(&self.path).is_ok_and(|i| (i.dev(), i.ino()) == self.created);
        if ours {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

async fn serve(listener: UnixListener, bridge: Arc<Bridge>, stop: Cancel) {
    loop {
        let stream = tokio::select! {
            () = stop.cancelled() => return,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => stream,
                // A lasting failure, such as no free file descriptor, must not spin.
                Err(_) => {
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            },
        };
        let bridge = bridge.clone();
        // A stalled client holds only its own task, and only for one exchange.
        tokio::spawn(async move {
            let _ = tokio::time::timeout(EXCHANGE, exchange(stream, &bridge)).await;
        });
    }
}

async fn exchange(stream: UnixStream, bridge: &Bridge) -> std::io::Result<()> {
    // The directory mode is the first gate. The peer's user ID is the second.
    if stream.peer_cred()?.uid() != current_uid() {
        return Ok(());
    }
    let (read, mut write) = stream.into_split();
    let mut line = Vec::new();
    BufReader::new(read.take(MAX_REQUEST as u64 + 1)).read_until(b'\n', &mut line).await?;
    let reply = reply(&line, bridge);
    write.write_all(crate::cli::json_line(&reply).as_bytes()).await?;
    write.shutdown().await
}

fn failure(code: &str, message: &str) -> Value {
    json!({ "ok": false, "error": { "code": code, "message": message } })
}

/// Answer one request line. `show` never changes state. `answer` resolves only the named waiting request.
pub fn reply(line: &[u8], bridge: &Bridge) -> Value {
    if line.len() > MAX_REQUEST {
        return failure("invalid_input", "The approval request is too long.");
    }
    let Ok(Value::Object(request)) = serde_json::from_slice::<Value>(line) else {
        return failure("invalid_input", "Send one JSON object.");
    };
    let text = |name: &str| request.get(name).and_then(Value::as_str);
    match (text("op"), request.len()) {
        (Some("show"), 1) => json!({ "ok": true, "request": bridge.waiting() }),
        (Some("answer"), 3) => {
            let (Some(id), Some(approved)) = (text("id"), request.get("approved").and_then(Value::as_bool))
            else {
                return failure("invalid_input", "An answer has a string id and a boolean approved.");
            };
            match bridge.answer(id, approved) {
                Ok(()) => json!({ "ok": true, "approved": approved }),
                Err(e) => failure(e.code, &e.message),
            }
        }
        _ => failure(
            "invalid_input",
            "Use {\"op\":\"show\"} or {\"op\":\"answer\",\"id\":...,\"approved\":...}.",
        ),
    }
}

/// `walleterm approve [<id> [--deny]] [--port 8787]` parsed. `None` is a usage error.
fn parse(args: &[&str]) -> Option<(u16, Option<(String, bool)>)> {
    let (mut port, mut id, mut deny) = (None, None, false);
    let mut rest = args.iter();
    while let Some(&arg) = rest.next() {
        match arg {
            "--deny" if !deny => deny = true,
            "--port" if port.is_none() => port = Some(rest.next()?.parse::<u16>().ok().filter(|p| *p > 0)?),
            _ if arg.starts_with("--port=") && port.is_none() => {
                port = Some(arg["--port=".len()..].parse::<u16>().ok().filter(|p| *p > 0)?);
            }
            // The bridge ID is a lowercase UUID.
            _ if id.is_none()
                && arg.len() == 36
                && arg.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-') =>
            {
                id = Some(arg.to_owned());
            }
            _ => return None,
        }
    }
    if deny && id.is_none() {
        return None;
    }
    Some((port.unwrap_or(DEFAULT_PORT), id.map(|id| (id, !deny))))
}

/// Send one request line to the tunnel and return its reply.
async fn call(path: &Path, request: &Value) -> Result<Value> {
    let unavailable = |why: &str| {
        Error::new(
            "tunnel_unavailable",
            format!(
                "{why} Start walleterm tunnel with approval, or name its --port. Socket: {}",
                path.display()
            ),
        )
    };
    // A symbolic link could point at another program. Connect only to this user's socket.
    let ours = std::fs::symlink_metadata(path)
        .is_ok_and(|info| info.file_type().is_socket() && info.uid() == current_uid());
    if !ours {
        return Err(unavailable("The socket path is not a walleterm socket."));
    }
    let exchange = async {
        let mut stream = UnixStream::connect(path).await.map_err(|_| unavailable("No tunnel answered."))?;
        stream
            .write_all(crate::cli::json_line(request).as_bytes())
            .await
            .map_err(|_| unavailable("The tunnel closed the connection."))?;
        let mut reply = Vec::new();
        stream
            .take(MAX_REPLY as u64 + 1)
            .read_to_end(&mut reply)
            .await
            .map_err(|_| unavailable("The tunnel closed the connection."))?;
        match serde_json::from_slice::<Value>(&reply) {
            Ok(value @ Value::Object(_)) if reply.len() <= MAX_REPLY => Ok(value),
            _ => Err(unavailable("The tunnel sent an invalid reply.")),
        }
    };
    tokio::time::timeout(EXCHANGE, exchange)
        .await
        .unwrap_or_else(|_| Err(unavailable("The tunnel did not answer.")))
}

/// JSON for a terminal: bidirectional, format, separator, and private-use characters become `\uXXXX` escapes.
/// A JSON parser still reads the original text. Only JSON strings can hold such characters.
fn for_terminal(json: &str) -> String {
    let mut out = String::with_capacity(json.len());
    for c in json.chars() {
        if c.is_ascii() || crate::cli::printable(c) {
            out.push(c);
        } else {
            let mut units = [0u16; 2];
            for unit in c.encode_utf16(&mut units) {
                out.push_str(&format!("\\u{unit:04x}"));
            }
        }
    }
    out
}

/// Run `walleterm approve`. Prints one JSON line. Exit code 2 is a usage error, 1 any other failure.
pub fn command(args: &[&str], out: &mut dyn Write) -> i32 {
    command_in(directory().filter(|_| cfg!(target_os = "macos")), args, out)
}

/// `command` with the socket directory as an input, so tests never touch the user's real directory.
pub fn command_in(dir: Option<PathBuf>, args: &[&str], out: &mut dyn Write) -> i32 {
    let print = |out: &mut dyn Write, value: &Value| {
        let text = for_terminal(&crate::cli::json_line(value));
        let written = out.write_all(text.as_bytes()).and_then(|()| out.flush());
        let ok = value["ok"].as_bool() == Some(true);
        match (written, ok) {
            (Err(_), _) => 1,
            (Ok(()), true) => 0,
            (Ok(()), false) if value["error"]["code"] == "invalid_input" => 2,
            (Ok(()), false) => 1,
        }
    };
    let Some((port, answer)) = parse(args) else {
        return print(out, &failure("invalid_input", &format!("Use {USAGE}.")));
    };
    let Some(dir) = dir else {
        return print(out, &failure("unsupported_platform", "walleterm approve requires macOS."));
    };
    let path = socket_path(&dir, port);
    if std::fs::symlink_metadata(&path).is_err() {
        let message = format!(
            "No walleterm tunnel with approval runs on port {port}. Start one, or name its --port. Socket: {}",
            path.display()
        );
        return print(out, &failure("tunnel_unavailable", &message));
    }
    if let Err(e) = check_directory(&dir) {
        return print(out, &failure("tunnel_unavailable", &e.message));
    }
    let request = match &answer {
        None => json!({ "op": "show" }),
        Some((id, approved)) => json!({ "op": "answer", "id": id, "approved": approved }),
    };
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else {
        return print(out, &failure("internal", "The command could not start."));
    };
    match runtime.block_on(call(&path, &request)) {
        Ok(reply) => print(out, &reply),
        Err(e) => print(out, &failure(e.code, &e.message)),
    }
}

/// Serve one bridge on a socket in `dir` and call it, for tests that must not touch the real directory.
pub async fn call_in(dir: &Path, port: u16, request: &Value) -> Result<Value> {
    check_directory(dir)?;
    call(&socket_path(dir, port), request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_command_takes_an_optional_id_deny_and_port() {
        let id = "0f3c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";
        assert_eq!(parse(&[]), Some((8787, None)));
        assert_eq!(parse(&["--port", "9000"]), Some((9000, None)));
        assert_eq!(parse(&["--port=9000"]), Some((9000, None)));
        assert_eq!(parse(&[id]), Some((8787, Some((id.to_owned(), true)))));
        assert_eq!(parse(&[id, "--deny", "--port", "9000"]), Some((9000, Some((id.to_owned(), false)))));
        for args in [
            &["--deny"][..],
            &[id, id],
            &[id, "--deny", "--deny"],
            &["--port"],
            &["--port", "0"],
            &["--port", "65536"],
            &["--port", "1", "--port", "2"],
            &["0F3C2B1A-9D8E-4F7A-8B6C-5D4E3F2A1B0C"],
            &["transaction"],
            &["--approve"],
        ] {
            assert_eq!(parse(args), None, "{args:?}");
        }
    }
}
