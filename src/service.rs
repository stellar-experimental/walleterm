//! `walleterm tunnel` and `walleterm demo`: option parsing, startup banners, signals, and exit codes.

use std::io::Write;
use std::os::unix::fs::PermissionsExt;

fn usage(command: &str) -> &'static str {
    if command == "tunnel" {
        "walleterm tunnel [--port 8787] [--vault <name-or-id>]"
    } else {
        "walleterm demo [--port 8788]"
    }
}

/// Service options. Only the signing tunnel accepts a vault filter.
#[derive(Debug, PartialEq, Eq)]
pub struct Options {
    pub port: u16,
    pub vault: Option<String>,
}

/// Keep the existing port syntax. A vault must be explicit, nonempty, and supplied only once.
pub fn parse_options(command: &str, args: &[&str]) -> Option<Options> {
    let mut port: u32 = if command == "tunnel" { 8787 } else { 8788 };
    let mut vault = None;
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
            None => {
                let value = *rest.next()?;
                if value.starts_with('-') {
                    return None;
                }
                (name, value)
            }
        };
        match name {
            "port" => {
                let digits = value.strip_prefix('+').unwrap_or(value);
                if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                port = digits.parse().ok()?;
            }
            "vault" if command == "tunnel" && vault.is_none() && !crate::util::js_blank(value) => {
                vault = Some(value.to_owned());
            }
            _ => return None,
        }
    }
    (1..=65535).contains(&port).then_some(Options { port: port as u16, vault })
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
    fn on_pairing_changed(&self, callback: Box<crate::bridge::PairingFn>) {
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

/// SIGINT, SIGTERM, or SIGHUP cancels the returned flag. A closed terminal sends SIGHUP.
/// The handlers exist before the service creates its directory or starts a child.
fn signals() -> crate::cancel::Cancel {
    use tokio::signal::unix::{SignalKind, signal};
    let stop = crate::cancel::Cancel::new();
    let (Ok(mut interrupt), Ok(mut terminate), Ok(mut hangup)) =
        (signal(SignalKind::interrupt()), signal(SignalKind::terminate()), signal(SignalKind::hangup()))
    else {
        return stop;
    };
    let flag = stop.clone();
    tokio::spawn(async move {
        tokio::select! {
            _ = interrupt.recv() => {}
            _ = terminate.recv() => {}
            _ = hangup.recv() => {}
        }
        flag.abort();
    });
    stop
}

/// `walleterm tunnel`: the testnet signing bridge behind a Quick Tunnel.
fn run_tunnel(port: u16, vault: Option<String>) -> i32 {
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(_) => return 1,
    };
    runtime.block_on(async {
        let banner = match vault.as_deref() {
            Some(vault) => format!(
                "Website wallets: 1Password vault {}.\n",
                serde_json::to_string(vault).unwrap_or_default()
            ),
            None => {
                "Website wallets: every Ed25519 key in the 1Password SSH agent. Use --vault to limit them.\n"
                    .to_owned()
            }
        };
        let output: std::sync::Arc<dyn crate::tunnel::Output> = std::sync::Arc::new(Terminal);
        if !output.write(&banner) {
            return 1;
        }
        let Some(socket) = crate::platform::agent_socket() else {
            println!("The signing bridge requires macOS and the 1Password SSH agent.");
            return 1;
        };
        let probe_client = match crate::http::https_client(crate::dns::Resolver::direct()) {
            Ok(client) => std::sync::Arc::new(client),
            Err(e) => {
                println!("{}", e.message);
                return 1;
            }
        };
        let bridge = crate::bridge::Bridge::new(crate::bridge::production(socket, vault), port);
        let service = std::sync::Arc::new(BridgeService::new(bridge, port));
        run_launch("Walleterm tunnel", port, service, output, probe_client).await
    })
}

/// A public health probe through the shared HTTPS client.
fn public_probe(client: std::sync::Arc<crate::http::HttpsClient>) -> Box<crate::tunnel::ProbeFn> {
    Box::new(move |origin, cancel| {
        let client = client.clone();
        Box::pin(async move { crate::tunnel::public_probe(&client, &origin, &cancel).await })
    })
}

/// Launch, wait for the service to end, and report a startup failure in plain text.
pub async fn run_launch(
    label: &str,
    port: u16,
    service: std::sync::Arc<dyn crate::tunnel::Service>,
    output: std::sync::Arc<dyn crate::tunnel::Output>,
    client: std::sync::Arc<crate::http::HttpsClient>,
) -> i32 {
    let deps = crate::tunnel::LaunchDeps {
        spawn_tunnel: Box::new(crate::tunnel::spawn_supervisor),
        ready: Box::new({
            let client = client.clone();
            move |origin, name, cancel| {
                let probe = public_probe(client.clone());
                Box::pin(async move { crate::tunnel::public_ready(&origin, name, &probe, &cancel).await })
            }
        }),
        probe: public_probe(client),
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
            "Use --vault <name-or-id> to filter website wallets. Filtering requires the 1Password CLI.\nWith no --vault, all Ed25519 agent keys are available. Shell variables and .env files do not select a vault.\n"
        } else {
            ""
        };
        let text = format!(
            "{}\nRequires cloudflared. Shows public links and QR codes.\nThe signing bridge requires macOS and the 1Password SSH agent.\n{vault}Press Ctrl+C to stop this service.\n",
            usage(command)
        );
        return if out.write_all(text.as_bytes()).is_ok() { 0 } else { 1 };
    }
    let Some(options) = parse_options(command, args) else {
        return fail(out, "invalid_input", &format!("Use {}.", usage(command)));
    };
    if command == "tunnel" && !cfg!(target_os = "macos") {
        return fail(out, "unsupported_platform", "The signing bridge requires macOS.");
    }
    if !on_path("cloudflared") {
        return fail(out, "start_failed", "Install cloudflared. On macOS, run: brew install cloudflared");
    }
    if command == "tunnel" {
        return run_tunnel(options.port, options.vault);
    }
    run_demo(options.port)
}

/// `walleterm demo`: the example website behind its own Quick Tunnel.
fn run_demo(port: u16) -> i32 {
    let Ok(runtime) = tokio::runtime::Builder::new_current_thread().enable_all().build() else { return 1 };
    runtime.block_on(async {
        let client = match crate::http::https_client(crate::dns::Resolver::direct()) {
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

    fn port(command: &str, args: &[&str]) -> Option<u16> {
        parse_options(command, args).map(|options| options.port)
    }

    #[test]
    fn port_options_follow_go_flag_rules() {
        assert_eq!(port("tunnel", &[]), Some(8787));
        assert_eq!(port("demo", &[]), Some(8788));
        for args in [
            &["--port", "9000"][..],
            &["-port", "9000"],
            &["--port=9000"],
            &["-port=9000"],
            &["--port", "+9000"],
        ] {
            assert_eq!(port("demo", args), Some(9000), "{args:?}");
        }
        assert_eq!(port("demo", &["--"]), Some(8788));
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
            assert_eq!(port("tunnel", args), None, "{args:?}");
        }
    }

    #[test]
    fn help_names_the_port_and_tunnel_vault_options() {
        for command in ["tunnel", "demo"] {
            let mut out = Vec::new();
            assert_eq!(run(command, &["--help"], &mut out), 0);
            let text = String::from_utf8(out).unwrap();
            assert!(text.contains(&format!("walleterm {command}")));
            assert_eq!(text.contains("--vault"), command == "tunnel");
            assert!(!text.contains("OP_VAULT"));
            assert!(!text.contains("--recipient") && !text.contains("--human") && !text.contains("--public"));
        }
    }

    #[test]
    fn a_vault_filter_is_explicit_and_cannot_be_empty_or_ambiguous() {
        assert_eq!(parse_options("tunnel", &[]).unwrap().vault, None);
        for args in [
            &["--vault", "Private Keys"][..],
            &["--vault=Private Keys"],
            &["--port=9000", "--vault", "Private Keys"],
        ] {
            assert_eq!(parse_options("tunnel", args).unwrap().vault.as_deref(), Some("Private Keys"));
        }
        for args in [
            &["--vault"][..],
            &["--vault="],
            &["--vault", ""],
            &["--vault", " \t\u{feff}"],
            &["--vault", "--port", "9000"],
            &["--vault=A", "--vault=B"],
        ] {
            assert!(parse_options("tunnel", args).is_none(), "{args:?}");
        }
        assert!(parse_options("demo", &["--vault", "Private"]).is_none());
    }
}
