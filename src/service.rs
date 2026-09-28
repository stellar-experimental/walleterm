//! `walleterm tunnel` and `walleterm demo`: option parsing, startup banners, signals, and exit codes.

use std::io::Write;
use std::os::unix::fs::PermissionsExt;

fn usage(command: &str) -> &'static str {
    if command == "tunnel" { "walleterm tunnel [--port 8787]" } else { "walleterm demo [--port 8788]" }
}

/// Go `flag` rules for the single `--port` option: `-port` or `--port`, then `=N` or a separate `N`.
pub fn parse_port(command: &str, args: &[&str]) -> Option<u16> {
    let mut port: u32 = if command == "tunnel" { 8787 } else { 8788 };
    let mut rest = args.iter();
    while let Some(&arg) = rest.next() {
        if arg == "--" {
            if rest.next().is_some() {
                return None;
            }
            break;
        }
        let name = arg.strip_prefix("--").or_else(|| arg.strip_prefix('-'))?;
        let (name, value) = match name.split_once('=') {
            Some((name, value)) => (name, value),
            None => (name, *rest.next()?),
        };
        if name != "port" {
            return None;
        }
        let digits = value.strip_prefix('+').unwrap_or(value);
        if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        port = digits.parse().ok()?;
    }
    (1..=65535).contains(&port).then_some(port as u16)
}

fn on_path(program: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|path| {
        std::env::split_paths(&path).any(|dir| {
            std::fs::metadata(dir.join(program))
                .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        })
    })
}

fn fail(out: &mut dyn Write, code: &'static str, message: &str) -> i32 {
    let _ = writeln!(out, "{code}: {message}");
    if code == "invalid_input" { 2 } else { 1 }
}

/// The bridge as a tunnel service: a loopback listener that serves the protocol.
pub struct BridgeService {
    bridge: std::sync::Arc<crate::bridge::Bridge>,
    port: u16,
    stop: crate::cancel::Cancel,
}

impl BridgeService {
    pub fn new(bridge: std::sync::Arc<crate::bridge::Bridge>, port: u16) -> Self {
        Self { bridge, port, stop: crate::cancel::Cancel::new() }
    }
}

impl crate::tunnel::Service for BridgeService {
    fn name(&self) -> &'static str {
        "walleterm"
    }
    fn listen(&self) -> crate::bridge::BoxFuture<crate::error::Result<()>> {
        let (bridge, port, stop) = (self.bridge.clone(), self.port, self.stop.clone());
        Box::pin(async move {
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.map_err(|e| {
                if e.kind() == std::io::ErrorKind::AddrInUse {
                    crate::error::Error::new(
                        "address_in_use",
                        "The local port is in use. Choose another --port.",
                    )
                } else {
                    crate::error::Error::new("internal", "The local service did not start. Try again.")
                }
            })?;
            let handler: crate::http::Handler = std::sync::Arc::new(move |req, body| {
                let bridge = bridge.clone();
                Box::pin(async move { bridge.handle(req, body).await })
            });
            tokio::spawn(crate::http::serve(listener, handler, std::time::Duration::from_secs(150), stop));
            Ok(())
        })
    }
    fn close(&self) -> crate::bridge::BoxFuture<()> {
        let (bridge, stop) = (self.bridge.clone(), self.stop.clone());
        Box::pin(async move {
            stop.abort();
            bridge.close().await;
        })
    }
    fn set_public_origin(&self, origin: &str) {
        let _ = self.bridge.set_public_origin(origin);
    }
    fn pairing(&self) -> Option<serde_json::Value> {
        Some(self.bridge.pairing())
    }
    fn on_pairing_changed(&self, callback: Box<dyn Fn() + Send + Sync>) {
        self.bridge.on_pairing_changed(callback);
    }
}

struct Terminal;

impl crate::tunnel::Output for Terminal {
    fn write(&self, text: &str) -> bool {
        let mut out = std::io::stdout().lock();
        out.write_all(text.as_bytes()).and_then(|()| out.flush()).is_ok()
    }
    fn columns(&self) -> Option<usize> {
        crate::platform::terminal_columns()
    }
}

/// SIGINT or SIGTERM cancels the returned flag.
fn signals() -> crate::cancel::Cancel {
    use tokio::signal::unix::{SignalKind, signal};
    let stop = crate::cancel::Cancel::new();
    let flag = stop.clone();
    tokio::spawn(async move {
        let (Ok(mut interrupt), Ok(mut terminate)) =
            (signal(SignalKind::interrupt()), signal(SignalKind::terminate()))
        else {
            return;
        };
        tokio::select! {
            _ = interrupt.recv() => {}
            _ = terminate.recv() => {}
        }
        flag.abort();
    });
    stop
}

/// `walleterm tunnel`: the testnet signing bridge behind a Quick Tunnel.
fn run_tunnel(port: u16) -> i32 {
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(_) => return 1,
    };
    runtime.block_on(async {
        let cwd = std::env::current_dir().unwrap_or_default();
        let setting = match crate::config::load_vault(&cwd, std::env::var("OP_VAULT").ok()) {
            Ok(setting) => setting,
            Err(_) => {
                println!("The .env file in this directory could not be read.");
                return 1;
            }
        };
        for name in &setting.ignored {
            eprintln!("Walleterm ignores OP_VAULT in {name}. Move it to .env.");
        }
        let banner = match setting.vault.as_deref().filter(|v| !v.is_empty()) {
            Some(vault) => format!(
                "Website wallets: 1Password vault {}.\n",
                serde_json::to_string(vault).unwrap_or_default()
            ),
            None => {
                "Website wallets: every Ed25519 key in the 1Password SSH agent. Set OP_VAULT to limit them.\n"
                    .to_owned()
            }
        };
        let output: std::sync::Arc<dyn crate::tunnel::Output> = std::sync::Arc::new(Terminal);
        if !output.write(&banner) {
            return 1;
        }
        let (Some(socket), Ok(client)) = (crate::platform::agent_socket(), crate::ledger::https_client())
        else {
            println!("The signing bridge requires macOS and the 1Password SSH agent.");
            return 1;
        };
        let probe_client = match crate::ledger::https_client() {
            Ok(client) => std::sync::Arc::new(client),
            Err(e) => {
                println!("{}", e.message);
                return 1;
            }
        };
        let bridge =
            crate::bridge::Bridge::new(crate::bridge::production(socket, setting.vault, client), port);
        let service = std::sync::Arc::new(BridgeService::new(bridge, port));
        run_launch("Walleterm tunnel", port, service, output, probe_client).await
    })
}

/// Launch, wait for the service to end, and report a startup failure in plain text.
pub async fn run_launch(
    label: &str,
    port: u16,
    service: std::sync::Arc<dyn crate::tunnel::Service>,
    output: std::sync::Arc<dyn crate::tunnel::Output>,
    client: std::sync::Arc<crate::ledger::HttpsClient>,
) -> i32 {
    let probe_client = client.clone();
    let probe: Box<crate::tunnel::ProbeFn> = Box::new(move |origin, cancel| {
        let client = probe_client.clone();
        Box::pin(async move { crate::tunnel::public_probe(&client, &origin, &cancel).await })
    });
    let ready_client = client.clone();
    let deps = crate::tunnel::LaunchDeps {
        spawn_tunnel: Box::new(crate::tunnel::spawn_supervisor),
        ready: Box::new(move |origin, name, cancel| {
            let client = ready_client.clone();
            Box::pin(async move {
                let probe: Box<crate::tunnel::ProbeFn> = Box::new(move |origin, cancel| {
                    let client = client.clone();
                    Box::pin(async move { crate::tunnel::public_probe(&client, &origin, &cancel).await })
                });
                crate::tunnel::public_ready(&origin, name, &probe, &cancel).await
            })
        }),
        probe,
        output,
        environment: std::env::vars().collect(),
        health_interval: crate::tunnel::HEALTH_INTERVAL,
        recovery_delay: crate::tunnel::RECOVERY_DELAY,
        stop: signals(),
    };
    match crate::tunnel::launch(label, port, service, deps).await {
        Ok(running) => running.done().await,
        Err((e, code)) => {
            if e.code != "service_stopped" {
                println!("{}", e.message);
            }
            code
        }
    }
}

pub fn run(command: &str, args: &[&str], out: &mut dyn Write) -> i32 {
    if let ["--help" | "-h"] = args {
        let vault = if command == "tunnel" {
            "Set OP_VAULT in the shell or working directory's .env to filter website wallets by vault name or ID.\nShell values override .env. Filtering requires the 1Password CLI.\n"
        } else {
            ""
        };
        let text = format!(
            "{}\nRequires cloudflared. Shows public links and QR codes.\nThe signing bridge requires macOS and the 1Password SSH agent.\n{vault}Press Ctrl+C to stop this service.\n",
            usage(command)
        );
        return if out.write_all(text.as_bytes()).is_ok() { 0 } else { 1 };
    }
    let Some(port) = parse_port(command, args) else {
        return fail(out, "invalid_input", &format!("Use {}.", usage(command)));
    };
    if command == "tunnel" && !cfg!(target_os = "macos") {
        return fail(out, "unsupported_platform", "The signing bridge requires macOS.");
    }
    if !on_path("cloudflared") {
        return fail(out, "start_failed", "Install cloudflared. On macOS, run: brew install cloudflared");
    }
    if command == "tunnel" {
        return run_tunnel(port);
    }
    run_demo(port)
}

/// `walleterm demo`: the example website behind its own Quick Tunnel.
fn run_demo(port: u16) -> i32 {
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else { return 1 };
    runtime.block_on(async {
        let client = match crate::ledger::https_client() {
            Ok(client) => std::sync::Arc::new(client),
            Err(e) => {
                println!("{}", e.message);
                return 1;
            }
        };
        let service = std::sync::Arc::new(crate::demo::DemoService::new(port));
        run_launch("Walleterm demo", port, service, std::sync::Arc::new(Terminal), client).await
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_options_follow_go_flag_rules() {
        assert_eq!(parse_port("tunnel", &[]), Some(8787));
        assert_eq!(parse_port("demo", &[]), Some(8788));
        for args in [
            &["--port", "9000"][..],
            &["-port", "9000"],
            &["--port=9000"],
            &["-port=9000"],
            &["--port", "+9000"],
        ] {
            assert_eq!(parse_port("demo", args), Some(9000), "{args:?}");
        }
        assert_eq!(parse_port("demo", &["--"]), Some(8788));
        for args in [
            &["--human"][..],
            &["--public"],
            &["--recipient", "GTEST"],
            &["--port", "0"],
            &["--port", "65536"],
            &["--port"],
            &["--port", "x"],
            &["extra"],
            &["--", "extra"],
            &["--state-dir", "/tmp/state"],
            &["--port", "65537", "--"],
            &["--port", "65537"],
            &["--port=0", "--"],
        ] {
            assert_eq!(parse_port("tunnel", args), None, "{args:?}");
        }
    }

    #[test]
    fn help_names_only_the_port_option() {
        for command in ["tunnel", "demo"] {
            let mut out = Vec::new();
            assert_eq!(run(command, &["--help"], &mut out), 0);
            let text = String::from_utf8(out).unwrap();
            assert!(text.contains(&format!("walleterm {command}")));
            assert!(!text.contains("--recipient") && !text.contains("--human") && !text.contains("--public"));
        }
    }
}
