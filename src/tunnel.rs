//! The service launcher: a loopback service, a private Cloudflare Quick Tunnel, readiness, health checks,
//! and bounded recovery. The tunnel runs under a supervisor in its own process group.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::{Notify, mpsc, watch};
use tokio::time::Instant;

use crate::bridge::BoxFuture;
use crate::cancel::Cancel;
use crate::error::{Error, Result};
use crate::util::{iso_millis, now_ms};

/// Health probes run this often after startup.
pub const HEALTH_INTERVAL: Duration = Duration::from_secs(15);
/// Replacement delays start here and double: 2, 4, then 8 seconds.
pub const RECOVERY_DELAY: Duration = Duration::from_secs(2);
const URL_TIMEOUT: Duration = Duration::from_secs(30);
const READY_TIMEOUT: Duration = Duration::from_secs(45);
const LISTEN_TIMEOUT: Duration = Duration::from_secs(15);
const RESTART_WINDOW: Duration = Duration::from_secs(600);
const MAX_RESTARTS: usize = 3;
const MAX_FAILURES: u32 = 6;
const RETAINED_OUTPUT: usize = 16384;

/// A service behind the tunnel: the bridge or the demo.
pub trait Service: Send + Sync {
    /// The `service` field that `/api/session` returns.
    fn name(&self) -> &'static str;
    fn listen(&self) -> BoxFuture<Result<()>>;
    fn close(&self) -> BoxFuture<()>;
    fn set_public_origin(&self, origin: &str);
    /// The bridge's QR payload. The demo has none.
    fn pairing(&self) -> Option<Value>;
    fn on_pairing_changed(&self, callback: Box<dyn Fn() + Send + Sync>);
}

/// A running tunnel process: its combined output, its exit, and a way to stop it.
pub struct Tunnel {
    pub output: mpsc::UnboundedReceiver<String>,
    pub exited: watch::Receiver<Option<i32>>,
    pub stop: Box<dyn FnMut() -> BoxFuture<bool> + Send>,
}

pub type SpawnFn = dyn Fn(Vec<String>, Vec<(String, String)>, PathBuf) -> Result<Tunnel> + Send + Sync;
pub type ReadyFn = dyn Fn(String, &'static str, Cancel) -> BoxFuture<Result<()>> + Send + Sync;
/// A public health probe: the HTTP status and the JSON `service` field.
pub type ProbeFn = dyn Fn(String, Cancel) -> BoxFuture<Result<(u16, Option<String>)>> + Send + Sync;

/// Terminal output. A failed write stops the service.
pub trait Output: Send + Sync {
    fn write(&self, text: &str) -> bool;
    fn columns(&self) -> Option<usize>;
}

pub struct LaunchDeps {
    pub spawn_tunnel: Box<SpawnFn>,
    pub ready: Box<ReadyFn>,
    pub probe: Box<ProbeFn>,
    pub output: Arc<dyn Output>,
    /// The caller's environment. The tunnel receives only PATH, HOME, TMPDIR, and LANG.
    pub environment: Vec<(String, String)>,
    pub health_interval: Duration,
    pub recovery_delay: Duration,
    /// SIGINT, SIGTERM, or a caller abort.
    pub stop: Cancel,
}

pub fn tunnel_origin(output: &str) -> Option<String> {
    let lower = output.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find("https://") {
        let start = from + i;
        let host: String =
            lower[start + 8..].chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
        let rest = &lower[start + 8 + host.len()..];
        if !host.is_empty() && rest.starts_with(".trycloudflare.com") {
            let after = rest[".trycloudflare.com".len()..].chars().next();
            // Match the TS pattern's word boundary after "com".
            if after.is_none_or(|c| !(c.is_ascii_alphanumeric() || c == '_')) {
                return Some(format!("https://{host}.trycloudflare.com"));
            }
        }
        from = start + 8;
    }
    None
}

/// Read the tunnel output until it names a Quick Tunnel URL. Keep the last 16384 characters only.
pub async fn wait_for_tunnel(tunnel: &mut Tunnel, timeout: Duration, stop: &Cancel) -> Result<String> {
    let mut seen = String::new();
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(code) = *tunnel.exited.borrow() {
            return Err(Error::new("internal", format!("The tunnel exited before startup ({code}).")));
        }
        tokio::select! {
            chunk = tunnel.output.recv() => {
                let Some(chunk) = chunk else {
                    let code = tunnel.exited.wait_for(Option::is_some).await.ok().and_then(|c| *c).unwrap_or(1);
                    return Err(Error::new("internal", format!("The tunnel exited before startup ({code}).")));
                };
                seen.push_str(&chunk);
                if seen.len() > RETAINED_OUTPUT {
                    let cut = seen.len() - RETAINED_OUTPUT;
                    let cut = (cut..seen.len()).find(|&i| seen.is_char_boundary(i)).unwrap_or(seen.len());
                    seen.drain(..cut);
                }
                if let Some(origin) = tunnel_origin(&seen) {
                    return Ok(origin);
                }
            }
            changed = tunnel.exited.changed() => {
                if changed.is_err() {
                    return Err(Error::new("internal", "The tunnel exited before startup (1)."));
                }
            }
            () = tokio::time::sleep_until(deadline) => {
                return Err(Error::new("internal", "The tunnel did not return a URL within 30 seconds."));
            }
            () = stop.cancelled() => return Err(stopped()),
        }
    }
}

pub fn stopped() -> Error {
    Error::new("service_stopped", "The service stopped.")
}

/// Poll the public URL until it answers as `service`, for at most 45 seconds.
pub async fn public_ready(origin: &str, service: &str, probe: &ProbeFn, stop: &Cancel) -> Result<()> {
    let deadline = Instant::now() + READY_TIMEOUT;
    let mut last = "no response".to_owned();
    while Instant::now() < deadline {
        if stop.is_cancelled() {
            return Err(stopped());
        }
        match probe(origin.to_owned(), stop.clone()).await {
            Ok((status, name)) => {
                last = format!("HTTP {status}");
                if status == 200 && name.as_deref() == Some(service) {
                    return Ok(());
                }
            }
            Err(e) => last = e.message,
        }
        tokio::select! {
            () = tokio::time::sleep(Duration::from_millis(350)) => {}
            () = stop.cancelled() => return Err(stopped()),
        }
    }
    Err(Error::new(
        "internal",
        format!(
            "The public site did not become ready ({last}). Check the Internet connection and run the command again."
        ),
    ))
}

fn tunnel_args(config: &Path, port: u16) -> Vec<String> {
    [
        "tunnel",
        "--config",
        &config.to_string_lossy(),
        "--url",
        &format!("http://127.0.0.1:{port}"),
        "--no-autoupdate",
        "--protocol",
        "http2",
        "--metrics",
        "127.0.0.1:0",
        "--grace-period",
        "1s",
        "--management-diagnostics=false",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// A private directory that removes itself. It holds the tunnel's empty configuration.
pub struct PrivateDir(pub PathBuf);

impl PrivateDir {
    pub fn new() -> Result<Self> {
        use std::os::unix::fs::DirBuilderExt;
        let parent = std::env::temp_dir();
        for _ in 0..8 {
            let dir =
                parent.join(format!("walleterm-tunnel-{}", crate::util::hex(&crate::util::random::<16>())));
            match std::fs::DirBuilder::new().mode(0o700).create(&dir) {
                Ok(()) => return Ok(Self(dir)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => break,
            }
        }
        Err(Error::new("internal", "The tunnel directory could not be created."))
    }
}

impl Drop for PrivateDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn write_private(path: &Path, text: &str) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| Error::new("internal", "The tunnel configuration could not be written."))?;
    file.write_all(text.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(|_| Error::new("internal", "The tunnel configuration could not be written."))
}

struct Shared {
    origin: Mutex<String>,
    tunnel: Mutex<Option<Tunnel>>,
    lost: AtomicBool,
    started: AtomicBool,
    spawns: AtomicU32,
}

/// A started service. `stop` ends it once and returns the exit code; `done` waits for that.
pub struct Running {
    shared: Arc<Shared>,
    finished: Arc<Notify>,
    code: Arc<Mutex<Option<i32>>>,
    stop_all: Arc<dyn Fn(i32) -> BoxFuture<i32> + Send + Sync>,
}

impl Running {
    pub fn origin(&self) -> String {
        self.shared.origin.lock().unwrap().clone()
    }
    pub fn spawns(&self) -> u32 {
        self.shared.spawns.load(Ordering::SeqCst)
    }
    pub async fn stop(&self, code: i32) -> i32 {
        (self.stop_all)(code).await
    }
    pub async fn done(&self) -> i32 {
        loop {
            let notified = self.finished.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if let Some(code) = *self.code.lock().unwrap() {
                return code;
            }
            notified.await;
        }
    }
}

fn filtered_env(environment: &[(String, String)]) -> Vec<(String, String)> {
    environment
        .iter()
        .filter(|(k, v)| matches!(k.as_str(), "PATH" | "HOME" | "TMPDIR" | "LANG") && !v.is_empty())
        .cloned()
        .collect()
}

/// Start the service and its public tunnel, print the connection, and monitor it until stopped.
pub async fn launch(
    label: &str,
    port: u16,
    service: Arc<dyn Service>,
    deps: LaunchDeps,
) -> std::result::Result<Running, (Error, i32)> {
    let deps = Arc::new(deps);
    let controller = Cancel::new();
    let shared = Arc::new(Shared {
        origin: Mutex::new(String::new()),
        tunnel: Mutex::new(None),
        lost: AtomicBool::new(false),
        started: AtomicBool::new(false),
        spawns: AtomicU32::new(0),
    });
    let temporary: Arc<Mutex<Option<PrivateDir>>> = Arc::default();
    let finished = Arc::new(Notify::new());
    let code: Arc<Mutex<Option<i32>>> = Arc::default();
    let stopping: Arc<tokio::sync::OnceCell<i32>> = Arc::default();
    let stop_all: Arc<dyn Fn(i32) -> BoxFuture<i32> + Send + Sync> = {
        let (controller, shared, service, temporary, finished, code, stopping) = (
            controller.clone(),
            shared.clone(),
            service.clone(),
            temporary.clone(),
            finished.clone(),
            code.clone(),
            stopping.clone(),
        );
        Arc::new(move |requested: i32| {
            let (controller, shared, service, temporary, finished, code, stopping) = (
                controller.clone(),
                shared.clone(),
                service.clone(),
                temporary.clone(),
                finished.clone(),
                code.clone(),
                stopping.clone(),
            );
            Box::pin(async move {
                *stopping
                    .get_or_init(|| async {
                        controller.cancel(stopped());
                        let mut result = requested;
                        let tunnel = shared.tunnel.lock().unwrap().take();
                        let stop_tunnel = async {
                            match tunnel {
                                Some(mut t) => (t.stop)().await,
                                None => true,
                            }
                        };
                        let close = tokio::time::timeout(Duration::from_millis(3500), service.close());
                        let (tunnel_stopped, closed) = tokio::join!(stop_tunnel, close);
                        if !tunnel_stopped || closed.is_err() {
                            result = 1;
                        }
                        temporary.lock().unwrap().take();
                        *code.lock().unwrap() = Some(result);
                        finished.notify_waiters();
                        result
                    })
                    .await
            })
        })
    };
    // External stop requests (signals) and output failures end the service.
    {
        let (stop_all, external, controller) = (stop_all.clone(), deps.stop.clone(), controller.clone());
        tokio::spawn(async move {
            tokio::select! {
                () = external.cancelled() => { stop_all(0).await; }
                () = controller.cancelled() => {}
            }
        });
    }
    let running = Running { shared: shared.clone(), finished, code, stop_all: stop_all.clone() };
    let fail = |e: Error| {
        let stop_all = stop_all.clone();
        async move {
            let exit = stop_all(if e.code == "service_stopped" { 0 } else { 1 }).await;
            Err((e, exit))
        }
    };
    if deps.stop.is_cancelled() {
        return fail(stopped()).await;
    }
    let listening = tokio::select! {
        biased;
        () = controller.cancelled() => Err(stopped()),
        result = tokio::time::timeout(LISTEN_TIMEOUT, service.listen()) => result
            .unwrap_or_else(|_| Err(Error::new("internal", "The local service did not start. Try again."))),
    };
    if let Err(e) = listening {
        return fail(e).await;
    }
    if controller.is_cancelled() {
        // A listener that finished after a stop closes again, so nothing keeps serving.
        let outcome = fail(stopped()).await;
        service.close().await;
        return outcome;
    }
    let dir = match PrivateDir::new() {
        Ok(dir) => dir,
        Err(e) => return fail(e).await,
    };
    let config_file = dir.0.join("config.yml");
    if let Err(e) = write_private(&config_file, "{}\n") {
        return fail(e).await;
    }
    let cwd = dir.0.clone();
    *temporary.lock().unwrap() = Some(dir);
    let env = filtered_env(&deps.environment);
    let args = tunnel_args(&config_file, port);
    let connect = {
        let (deps, shared, service, controller, env, args, cwd) = (
            deps.clone(),
            shared.clone(),
            service.clone(),
            controller.clone(),
            env.clone(),
            args.clone(),
            cwd.clone(),
        );
        let stop_all = stop_all.clone();
        Arc::new(move || -> BoxFuture<Result<()>> {
            let (deps, shared, service, controller, env, args, cwd, stop_all) = (
                deps.clone(),
                shared.clone(),
                service.clone(),
                controller.clone(),
                env.clone(),
                args.clone(),
                cwd.clone(),
                stop_all.clone(),
            );
            Box::pin(async move {
                shared.lost.store(false, Ordering::SeqCst);
                shared.spawns.fetch_add(1, Ordering::SeqCst);
                let mut tunnel = (deps.spawn_tunnel)(args, env, cwd)?;
                let origin = wait_for_tunnel(&mut tunnel, URL_TIMEOUT, &controller).await;
                // Watch this tunnel's exit for the rest of its life.
                let mut exited = tunnel.exited.clone();
                *shared.tunnel.lock().unwrap() = Some(tunnel);
                let origin = origin?;
                {
                    let (shared, controller) = (shared.clone(), controller.clone());
                    tokio::spawn(async move {
                        if exited.wait_for(Option::is_some).await.is_ok() && !controller.is_cancelled() {
                            shared.lost.store(true, Ordering::SeqCst);
                            if !shared.started.load(Ordering::SeqCst) {
                                stop_all(1).await;
                            }
                        }
                    });
                }
                if controller.is_cancelled() {
                    return Err(stopped());
                }
                *shared.origin.lock().unwrap() = origin.clone();
                service.set_public_origin(&origin);
                let ready = tokio::time::timeout(
                    READY_TIMEOUT,
                    (deps.ready)(origin, service.name(), controller.clone()),
                );
                let ready = tokio::select! {
                    r = ready => r.unwrap_or_else(|_| Err(Error::new("internal", "The public tunnel did not become ready. Check the Internet connection and try again."))),
                    () = controller.cancelled() => Err(stopped()),
                };
                ready?;
                if controller.is_cancelled() {
                    return Err(stopped());
                }
                if shared.lost.load(Ordering::SeqCst) {
                    return Err(Error::new("internal", "The public tunnel stopped during startup."));
                }
                Ok(())
            })
        })
    };
    if let Err(e) = connect().await {
        let e = if controller.is_cancelled() { stopped() } else { e };
        return fail(e).await;
    }
    let print_connection = {
        let (deps, shared, service, label) =
            (deps.clone(), shared.clone(), service.clone(), label.to_owned());
        Arc::new(move || -> bool {
            let mut text = format!("{label} is ready on Stellar testnet.\n");
            match service.pairing() {
                Some(pairing) => text.push_str(&pairing_text(&pairing, deps.output.columns())),
                None => {
                    let origin = shared.origin.lock().unwrap().clone();
                    text.push_str(&format!(
                        "\nPublic URL: {origin}\nScan this QR code with your phone camera to open the site:\n{}\n",
                        crate::qr::for_terminal(&origin, deps.output.columns())
                    ));
                }
            }
            deps.output.write(&text)
        })
    };
    if controller.is_cancelled() || !print_connection() {
        return fail(if controller.is_cancelled() { stopped() } else { output_failed() }).await;
    }
    // The pairing callback reprints the connection code. Wire it with the service's own payload.
    {
        let (deps, controller, stop_all, service_ref) =
            (deps.clone(), controller.clone(), stop_all.clone(), Arc::downgrade(&service));
        service.on_pairing_changed(Box::new(move || {
            if controller.is_cancelled() {
                return;
            }
            let Some(pairing) = service_ref.upgrade().and_then(|s| s.pairing()) else { return };
            if !deps.output.write(&pairing_text(&pairing, deps.output.columns())) {
                let stop_all = stop_all.clone();
                tokio::spawn(async move { stop_all(1).await });
            }
        }));
    }
    if controller.is_cancelled() || !deps.output.write("Press Ctrl+C to stop this service.\n") {
        return fail(if controller.is_cancelled() { stopped() } else { output_failed() }).await;
    }
    shared.started.store(true, Ordering::SeqCst);
    let label = label.to_owned();
    tokio::spawn(monitor(label, deps, shared, service, controller, connect, print_connection, stop_all));
    Ok(running)
}

fn output_failed() -> Error {
    Error::new("internal", "The terminal output failed.")
}

fn pairing_text(pairing: &Value, columns: Option<usize>) -> String {
    let field = |name: &str| pairing[name].as_str().unwrap_or_default().to_owned();
    format!(
        "\nTunnel URL: {}\nConnection code: {}\nScan this QR code with the website's Scan tunnel button, not the phone camera:\n{}\nThis code expires at {}. It works once.\n",
        field("url"),
        field("code"),
        crate::qr::for_terminal(&pairing.to_string(), columns),
        field("expires_at"),
    )
}

#[allow(clippy::too_many_arguments)]
async fn monitor(
    label: String,
    deps: Arc<LaunchDeps>,
    shared: Arc<Shared>,
    service: Arc<dyn Service>,
    controller: Cancel,
    connect: Arc<dyn Fn() -> BoxFuture<Result<()>> + Send + Sync>,
    print_connection: Arc<dyn Fn() -> bool + Send + Sync>,
    stop_all: Arc<dyn Fn(i32) -> BoxFuture<i32> + Send + Sync>,
) {
    let (mut failures, mut paused, mut needs_connection) = (0u32, false, false);
    let mut last_status = Instant::now();
    let mut restarts: Vec<Instant> = Vec::new();
    let pairing = service.pairing().is_some();
    let connection_message = if pairing {
        "Use the new public URL. Reconnect the website with the current code."
    } else {
        "Open the new public URL. Keep the previous page open if it has an unresolved transaction."
    };
    let report = |message: &str, last: &mut Instant| -> bool {
        *last = Instant::now();
        deps.output.write(&format!("[{}] {label}: {message}\n", iso_millis(now_ms() as i64)))
    };
    macro_rules! say {
        ($message:expr) => {
            if !report($message, &mut last_status) {
                stop_all(1).await;
                return;
            }
        };
    }
    loop {
        tokio::select! {
            () = tokio::time::sleep(deps.health_interval) => {}
            () = controller.cancelled() => return,
        }
        let healthy = if shared.lost.load(Ordering::SeqCst) {
            false
        } else {
            let origin = shared.origin.lock().unwrap().clone();
            matches!((deps.probe)(origin, controller.clone()).await, Ok((200, Some(name))) if name == service.name())
        };
        if controller.is_cancelled() {
            return;
        }
        if healthy {
            if needs_connection {
                if !print_connection() {
                    stop_all(1).await;
                    return;
                }
                say!(connection_message);
                needs_connection = false;
            }
            if failures > 0 {
                say!("The public connection recovered.");
            }
            failures = 0;
            continue;
        }
        failures += 1;
        if failures == 1 || last_status.elapsed() >= Duration::from_secs(60) {
            say!("The public connection is unavailable. Checking again.");
        }
        // Let cloudflared recover transient network failures before replacing its process.
        if !shared.lost.load(Ordering::SeqCst) && failures < MAX_FAILURES {
            continue;
        }
        loop {
            if controller.is_cancelled() {
                return;
            }
            restarts.retain(|t| t.elapsed() < RESTART_WINDOW);
            if restarts.len() >= MAX_RESTARTS {
                if !paused {
                    say!(
                        "Tunnel recovery is paused until the restart limit clears. The local service stays available."
                    );
                }
                paused = true;
                break;
            }
            paused = false;
            restarts.push(Instant::now());
            say!("Restarting the public tunnel. The public URL will change.");
            let old = shared.tunnel.lock().unwrap().take();
            if let Some(mut old) = old {
                (old.stop)().await;
            }
            let delay = deps.recovery_delay * 2u32.pow(restarts.len() as u32 - 1);
            tokio::select! {
                () = tokio::time::sleep(delay) => {}
                () = controller.cancelled() => return,
            }
            needs_connection = true;
            match connect().await {
                Ok(()) if !controller.is_cancelled() => {
                    if !print_connection() {
                        stop_all(1).await;
                        return;
                    }
                    say!(connection_message);
                    needs_connection = false;
                    failures = 0;
                    break;
                }
                _ if controller.is_cancelled() => return,
                _ => say!("The replacement tunnel did not become ready."),
            }
        }
    }
}

/// Start `walleterm tunnel-child` from this same executable as a process-group leader.
/// The parent owns its standard input. When the supervisor exits for any reason, its whole group is killed once.
pub fn spawn_supervisor(args: Vec<String>, env: Vec<(String, String)>, cwd: PathBuf) -> Result<Tunnel> {
    let binary = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|_| Error::new("internal", "The tunnel supervisor could not start."))?;
    spawn_supervisor_from(&binary, args, env, cwd)
}

/// `spawn_supervisor` with an explicit executable. Only tests pass another path.
pub fn spawn_supervisor_from(
    binary: &Path,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
) -> Result<Tunnel> {
    use tokio::io::AsyncReadExt;
    let failed = || Error::new("internal", "The tunnel supervisor could not start.");
    let mut child = tokio::process::Command::new(binary)
        .arg("tunnel-child")
        .args(&args)
        .env_clear()
        .envs(env)
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|_| failed())?;
    let group = child.id().ok_or_else(failed)?;
    let (output_tx, output) = mpsc::unbounded_channel();
    for mut pipe in [
        Box::new(child.stdout.take().ok_or_else(failed)?) as Box<dyn tokio::io::AsyncRead + Send + Unpin>,
        Box::new(child.stderr.take().ok_or_else(failed)?),
    ] {
        let tx = output_tx.clone();
        tokio::spawn(async move {
            let mut buffer = [0u8; 4096];
            while let Ok(n) = pipe.read(&mut buffer).await {
                if n == 0 || tx.send(String::from_utf8_lossy(&buffer[..n]).into_owned()).is_err() {
                    break;
                }
            }
        });
    }
    let stdin = child.stdin.take();
    let (exit_tx, exited) = watch::channel(None);
    let (stop_tx, mut stop_rx) = mpsc::unbounded_channel::<tokio::sync::oneshot::Sender<bool>>();
    tokio::spawn(async move {
        let mut stdin = stdin;
        let mut waiters = Vec::new();
        let status = tokio::select! {
            status = child.wait() => status,
            Some(waiter) = stop_rx.recv() => {
                waiters.push(waiter);
                drop(stdin.take());
                let stopped = crate::process::stop_child(&mut child, Duration::from_secs(3)).await;
                if !stopped {
                    crate::process::kill_group(group);
                }
                child.wait().await
            }
        };
        // A supervisor killed before its own cleanup leaves cloudflared in its group. Stop that group once.
        crate::process::kill_group(group);
        let code = status.ok().and_then(|s| s.code()).unwrap_or(1);
        let _ = exit_tx.send(Some(code));
        while let Ok(waiter) = stop_rx.try_recv() {
            waiters.push(waiter);
        }
        for waiter in waiters {
            let _ = waiter.send(true);
        }
        drop(stdin);
    });
    let stop = Box::new(move || -> BoxFuture<bool> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let sent = stop_tx.send(tx).is_ok();
        Box::pin(async move { !sent || rx.await.unwrap_or(true) })
    });
    Ok(Tunnel { output, exited, stop })
}

/// `walleterm tunnel-child`: run cloudflared, forward its output, and stop it when the parent's pipe closes.
/// Kernel EOF on standard input also arrives when the parent crashes.
pub async fn run_supervisor(args: Vec<String>) -> i32 {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let spawned = tokio::process::Command::new("cloudflared")
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(_) => {
            let _ = std::io::Write::write_all(
                &mut std::io::stderr(),
                b"Cloudflared could not start. Check its installation.\n",
            );
            return 1;
        }
    };
    let record = serde_json::json!({
        // SAFETY: getppid has no preconditions.
        "parent_pid": unsafe { libc::getppid() },
        "supervisor_pid": std::process::id(),
        "cloudflared_pid": child.id(),
    });
    let written = write_private(Path::new("child.json"), &record.to_string()).is_ok();
    let failed = Cancel::new();
    let forward = |pipe: Option<Box<dyn tokio::io::AsyncRead + Send + Unpin>>,
                   mut sink: Box<dyn tokio::io::AsyncWrite + Send + Unpin>,
                   failed: Cancel| async move {
        let Some(mut pipe) = pipe else { return };
        let mut buffer = [0u8; 4096];
        while let Ok(n) = pipe.read(&mut buffer).await {
            if n == 0 {
                break;
            }
            if sink.write_all(&buffer[..n]).await.and(sink.flush().await).is_err() {
                failed.abort();
                break;
            }
        }
    };
    let stdout = child.stdout.take().map(|p| Box::new(p) as Box<dyn tokio::io::AsyncRead + Send + Unpin>);
    let stderr = child.stderr.take().map(|p| Box::new(p) as Box<dyn tokio::io::AsyncRead + Send + Unpin>);
    tokio::spawn(forward(stdout, Box::new(crate::process::StdoutSink), failed.clone()));
    tokio::spawn(forward(stderr, Box::new(crate::process::StderrSink), failed.clone()));
    let parent_gone = crate::process::stdin_closed();
    let mut interrupt = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt()).ok();
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
    let mut code = if written { 0 } else { 1 };
    if written {
        tokio::select! {
            status = child.wait() => return status.ok().and_then(|s| s.code()).unwrap_or(1),
            () = parent_gone => {}
            () = failed.cancelled() => code = 1,
            Some(()) = async { match interrupt.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
            Some(()) = async { match terminate.as_mut() { Some(s) => s.recv().await, None => std::future::pending().await } } => {}
        }
    }
    if !crate::process::stop_child(&mut child, Duration::from_secs(1)).await {
        code = 1;
    }
    code
}

/// Probe `origin/api/session` over HTTPS: 2.5 seconds, 4096 response bytes, the JSON `service` field.
pub async fn public_probe<C>(
    client: &hyper_util::client::legacy::Client<C, http_body_util::Full<bytes::Bytes>>,
    origin: &str,
    cancel: &Cancel,
) -> Result<(u16, Option<String>)>
where
    C: hyper_util::client::legacy::connect::Connect + Clone + Send + Sync + 'static,
{
    let unavailable = |m: &str| Error::new("internal", m);
    let url: hyper::Uri =
        format!("{origin}/api/session").parse().map_err(|_| unavailable("The public URL is invalid."))?;
    let work = async {
        let response = client.get(url).await.map_err(|_| unavailable("The public request failed."))?;
        let status = response.status().as_u16();
        let body = crate::ledger::capped(response.into_body(), 4096)
            .await
            .map_err(|_| unavailable("The response is too large."))?;
        let value: Value =
            serde_json::from_slice(&body).map_err(|_| unavailable("The public response is not JSON."))?;
        Ok((status, value["service"].as_str().map(str::to_owned)))
    };
    let bounded = async {
        tokio::time::timeout(Duration::from_millis(2500), work)
            .await
            .unwrap_or_else(|_| Err(unavailable("The public request timed out.")))
    };
    cancel.run(bounded).await
}
