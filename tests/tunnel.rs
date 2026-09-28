//! The service launcher with mock tunnels, and the real supervisor with a mock cloudflared.
//! Ported from bridge/launch.test.ts and bridge/tunnel-child.test.ts in the legacy TypeScript tests at 52a7fc3. Nothing here reaches Cloudflare.

mod support;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::sync::{mpsc, watch};
use walleterm::bridge::BoxFuture;
use walleterm::cancel::Cancel;
use walleterm::error::{Error, Result};
use walleterm::tunnel::{
    LaunchDeps, Output, Service, Tunnel, launch, public_ready, tunnel_origin, wait_for_tunnel,
};

struct MockService {
    listening: AtomicBool,
    closed: AtomicBool,
    origin: Mutex<String>,
    pairing: Mutex<Value>,
    changed: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    listen_gate: Mutex<Option<tokio::sync::oneshot::Receiver<()>>>,
}

impl MockService {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            listening: AtomicBool::new(false),
            closed: AtomicBool::new(false),
            origin: Mutex::default(),
            pairing: Mutex::new(
                json!({"walleterm": 3, "url": "https://bridge-name.trycloudflare.com", "code": "01234567", "expires_at": "2026-09-25T00:00:00.000Z"}),
            ),
            changed: Mutex::default(),
            listen_gate: Mutex::default(),
        })
    }
    fn rotate(&self, code: &str) {
        self.pairing.lock().unwrap()["code"] = json!(code);
        (self.changed.lock().unwrap().as_ref().expect("the launcher watches pairing changes"))();
    }
}

impl Service for MockService {
    fn name(&self) -> &'static str {
        "walleterm"
    }
    fn listen(&self) -> BoxFuture<Result<()>> {
        let gate = self.listen_gate.lock().unwrap().take();
        let listening = std::ptr::addr_of!(self.listening) as usize;
        Box::pin(async move {
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            // SAFETY: the service outlives the launcher in every test.
            unsafe { &*(listening as *const AtomicBool) }.store(true, Ordering::SeqCst);
            Ok(())
        })
    }
    fn close(&self) -> BoxFuture<()> {
        self.closed.store(true, Ordering::SeqCst);
        self.listening.store(false, Ordering::SeqCst);
        Box::pin(async {})
    }
    fn set_public_origin(&self, origin: &str) {
        *self.origin.lock().unwrap() = origin.to_owned();
        self.pairing.lock().unwrap()["url"] = json!(origin);
    }
    fn pairing(&self) -> Option<Value> {
        Some(self.pairing.lock().unwrap().clone())
    }
    fn on_pairing_changed(&self, callback: Box<dyn Fn() + Send + Sync>) {
        *self.changed.lock().unwrap() = Some(callback);
    }
}

#[derive(Default)]
struct Lines {
    lines: Mutex<Vec<String>>,
    columns: Option<usize>,
}

impl Lines {
    fn text(&self) -> String {
        self.lines.lock().unwrap().concat()
    }
    fn count(&self) -> usize {
        self.lines.lock().unwrap().len()
    }
}

impl Output for Lines {
    fn write(&self, text: &str) -> bool {
        self.lines.lock().unwrap().push(text.to_owned());
        true
    }
    fn columns(&self) -> Option<usize> {
        self.columns
    }
}

/// A controllable fake tunnel process.
struct MockTunnel {
    output: mpsc::UnboundedSender<String>,
    exit: watch::Sender<Option<i32>>,
    killed: Arc<AtomicBool>,
}

impl MockTunnel {
    fn new() -> (Self, Tunnel) {
        let (output, rx) = mpsc::unbounded_channel();
        let (exit, exited) = watch::channel(None);
        let killed = Arc::new(AtomicBool::new(false));
        let (k, e) = (killed.clone(), exit.clone());
        let tunnel = Tunnel {
            output: rx,
            exited,
            stop: Box::new(move || {
                k.store(true, Ordering::SeqCst);
                let _ = e.send(Some(0));
                Box::pin(async { true })
            }),
        };
        (Self { output, exit, killed }, tunnel)
    }
    fn exit(&self) {
        let _ = self.exit.send(Some(1));
    }
}

/// One recorded tunnel spawn: arguments, environment, and working directory.
type Spawned = (Vec<String>, Vec<(String, String)>, PathBuf);

struct Harness {
    service: Arc<MockService>,
    output: Arc<Lines>,
    spawns: Arc<AtomicUsize>,
    tunnels: Arc<Mutex<Vec<MockTunnel>>>,
    spawned: Arc<Mutex<Vec<Spawned>>>,
    probes: Arc<AtomicUsize>,
    readies: Arc<AtomicUsize>,
    stop: Cancel,
}

type ProbeResult = Result<(u16, Option<String>)>;

struct Plan {
    /// The URL each spawned tunnel prints, by spawn number from 1.
    url: Box<dyn Fn(usize) -> String + Send + Sync>,
    ready: Box<dyn Fn(usize, usize) -> Result<()> + Send + Sync>,
    probe: Box<dyn Fn(usize, usize) -> ProbeResult + Send + Sync>,
    columns: Option<usize>,
    health: Duration,
    recovery: Duration,
}

impl Default for Plan {
    fn default() -> Self {
        Self {
            url: Box::new(|_| "https://bridge-name.trycloudflare.com\n".into()),
            ready: Box::new(|_, _| Ok(())),
            probe: Box::new(|_, _| Ok((200, Some("walleterm".into())))),
            columns: None,
            health: Duration::from_millis(2),
            recovery: Duration::from_millis(1),
        }
    }
}

fn harness(plan: Plan) -> (Harness, LaunchDeps) {
    let h = Harness {
        service: MockService::new(),
        output: Arc::new(Lines { columns: plan.columns, ..Lines::default() }),
        spawns: Arc::default(),
        tunnels: Arc::default(),
        spawned: Arc::default(),
        probes: Arc::default(),
        readies: Arc::default(),
        stop: Cancel::new(),
    };
    let plan = Arc::new(plan);
    let (spawns, tunnels, spawned, p) =
        (h.spawns.clone(), h.tunnels.clone(), h.spawned.clone(), plan.clone());
    let spawn_tunnel =
        Box::new(move |args: Vec<String>, env: Vec<(String, String)>, cwd: PathBuf| -> Result<Tunnel> {
            let n = spawns.fetch_add(1, Ordering::SeqCst) + 1;
            spawned.lock().unwrap().push((args, env, cwd));
            let (mock, tunnel) = MockTunnel::new();
            let _ = mock.output.send((p.url)(n));
            tunnels.lock().unwrap().push(mock);
            Ok(tunnel)
        });
    let (readies, spawns, p) = (h.readies.clone(), h.spawns.clone(), plan.clone());
    let ready =
        Box::new(move |_origin: String, _name: &'static str, _cancel: Cancel| -> BoxFuture<Result<()>> {
            let n = readies.fetch_add(1, Ordering::SeqCst) + 1;
            let result = (p.ready)(n, spawns.load(Ordering::SeqCst));
            Box::pin(async move { result })
        });
    let (probes, spawns, p) = (h.probes.clone(), h.spawns.clone(), plan.clone());
    let probe = Box::new(move |_origin: String, _cancel: Cancel| -> BoxFuture<ProbeResult> {
        let n = probes.fetch_add(1, Ordering::SeqCst) + 1;
        let result = (p.probe)(n, spawns.load(Ordering::SeqCst));
        Box::pin(async move { result })
    });
    let deps = LaunchDeps {
        spawn_tunnel,
        ready,
        probe,
        output: h.output.clone(),
        environment: vec![
            ("PATH".into(), "/bin".into()),
            ("HOME".into(), "/mock".into()),
            ("TUNNEL_TOKEN".into(), "mock".into()),
            ("TUNNEL_LOGLEVEL".into(), "debug".into()),
            ("TUNNEL_METRICS".into(), "0.0.0.0:1234".into()),
        ],
        health_interval: plan.health,
        recovery_delay: plan.recovery,
        stop: h.stop.clone(),
    };
    (h, deps)
}

async fn until(check: impl Fn() -> bool) {
    until_for(check, 500).await;
}

async fn until_for(check: impl Fn() -> bool, steps: usize) {
    for _ in 0..steps {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(4)).await;
    }
    panic!("the service did not reach the expected state");
}

#[tokio::test]
async fn healthy_checks_stay_silent_and_keep_monitoring() {
    let (h, deps) = harness(Plan::default());
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    let startup = h.output.text();
    until(|| h.probes.load(Ordering::SeqCst) >= 3).await;
    assert_eq!(h.output.text(), startup);
    assert_eq!(h.spawns.load(Ordering::SeqCst), 1);
    running.stop(0).await;
}

#[tokio::test]
async fn public_failures_recover_without_replacing_a_healthy_tunnel() {
    let (h, deps) = harness(Plan {
        probe: Box::new(|n, _| {
            if n < 3 { Err(Error::new("internal", "Offline")) } else { Ok((200, Some("walleterm".into()))) }
        }),
        ..Plan::default()
    });
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    until(|| h.output.text().contains("public connection recovered")).await;
    assert_eq!(h.spawns.load(Ordering::SeqCst), 1);
    assert!(!h.service.closed.load(Ordering::SeqCst));
    assert!(h.output.text().contains("public connection is unavailable"));
    running.stop(0).await;
}

#[tokio::test]
async fn a_stopped_tunnel_gets_a_new_url_without_restarting_the_service() {
    let (h, deps) = harness(Plan {
        url: Box::new(|n| {
            format!("https://{}.trycloudflare.com", if n == 1 { "bridge-name" } else { "new-name" })
        }),
        ..Plan::default()
    });
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    h.tunnels.lock().unwrap()[0].exit();
    until(|| running.origin().contains("new-name") && h.output.text().contains("Use the new public URL"))
        .await;
    assert_eq!(h.spawns.load(Ordering::SeqCst), 2);
    assert!(!h.service.closed.load(Ordering::SeqCst));
    running.stop(0).await;
    assert!(h.tunnels.lock().unwrap()[1].killed.load(Ordering::SeqCst));
}

#[tokio::test]
async fn six_failed_health_checks_replace_an_unreachable_tunnel() {
    let (h, deps) = harness(Plan {
        probe: Box::new(|_, spawns| {
            Ok((200, Some(if spawns == 1 { "wrong-service" } else { "walleterm" }.into())))
        }),
        ..Plan::default()
    });
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    until(|| h.output.text().contains("Use the new public URL")).await;
    assert!(h.probes.load(Ordering::SeqCst) >= 6);
    assert_eq!(h.spawns.load(Ordering::SeqCst), 2);
    assert!(h.tunnels.lock().unwrap()[0].killed.load(Ordering::SeqCst));
    assert!(!h.service.closed.load(Ordering::SeqCst));
    running.stop(0).await;
}

#[tokio::test]
async fn recovery_pauses_after_three_replacements_and_preserves_the_service() {
    let (h, deps) = harness(Plan {
        ready: Box::new(|n, _| if n > 1 { Err(Error::new("internal", "Unavailable")) } else { Ok(()) }),
        ..Plan::default()
    });
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    h.tunnels.lock().unwrap()[0].exit();
    until(|| h.output.text().contains("recovery is paused")).await;
    assert_eq!(h.spawns.load(Ordering::SeqCst), 4);
    assert!(!h.service.closed.load(Ordering::SeqCst));
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(h.spawns.load(Ordering::SeqCst), 4);
    running.stop(0).await;
}

#[tokio::test]
async fn a_paused_replacement_prints_its_url_once_when_a_later_probe_succeeds() {
    let online = Arc::new(AtomicBool::new(false));
    let flag = online.clone();
    let (h, deps) = harness(Plan {
        url: Box::new(|n| format!("https://replacement-{n}.trycloudflare.com")),
        ready: Box::new(|n, _| if n > 1 { Err(Error::new("internal", "Unavailable")) } else { Ok(()) }),
        probe: Box::new(move |_, _| {
            Ok((if flag.load(Ordering::SeqCst) { 200 } else { 503 }, Some("walleterm".into())))
        }),
        ..Plan::default()
    });
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    h.tunnels.lock().unwrap()[0].exit();
    until(|| h.output.text().contains("recovery is paused")).await;
    let url = running.origin();
    let shown = |h: &Harness| h.output.text().matches(&format!("Tunnel URL: {url}")).count();
    assert_eq!(shown(&h), 0);
    online.store(true, Ordering::SeqCst);
    until(|| shown(&h) == 1).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(shown(&h), 1);
    assert_eq!(h.spawns.load(Ordering::SeqCst), 4);
    running.stop(0).await;
}

#[tokio::test(start_paused = true)]
async fn paused_recovery_resumes_after_the_oldest_restart_leaves_the_window() {
    let (h, deps) = harness(Plan {
        url: Box::new(|n| format!("https://replacement-{n}.trycloudflare.com")),
        ready: Box::new(|n, spawns| {
            if n > 1 && spawns < 5 { Err(Error::new("internal", "Unavailable")) } else { Ok(()) }
        }),
        probe: Box::new(|_, spawns| Ok((if spawns >= 5 { 200 } else { 503 }, Some("walleterm".into())))),
        health: Duration::from_secs(15),
        recovery: Duration::from_secs(2),
        ..Plan::default()
    });
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    h.tunnels.lock().unwrap()[0].exit();
    // Paused time: health checks every 15 s and delays of 2, 4, and 8 s pass virtually.
    until_for(|| h.output.text().contains("recovery is paused"), 50_000).await;
    assert_eq!(h.spawns.load(Ordering::SeqCst), 4);
    tokio::time::sleep(Duration::from_secs(300)).await;
    assert_eq!(h.spawns.load(Ordering::SeqCst), 4, "the ten-minute window has not cleared");
    tokio::time::sleep(Duration::from_secs(320)).await;
    until_for(
        || h.spawns.load(Ordering::SeqCst) == 5 && h.output.text().contains("Use the new public URL"),
        50_000,
    )
    .await;
    assert!(!h.service.closed.load(Ordering::SeqCst));
    running.stop(0).await;
}

#[tokio::test]
async fn shutdown_during_recovery_cannot_create_another_tunnel() {
    let (h, deps) = harness(Plan { recovery: Duration::from_secs(1), ..Plan::default() });
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    h.tunnels.lock().unwrap()[0].exit();
    until(|| h.output.text().contains("Restarting the public tunnel")).await;
    running.stop(0).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(h.spawns.load(Ordering::SeqCst), 1);
    assert!(h.service.closed.load(Ordering::SeqCst));
}

#[tokio::test]
async fn a_split_cloudflared_url_selects_only_the_tunnel_origin() {
    let (mock, mut tunnel) = MockTunnel::new();
    mock.output.send("Visit it at https://sample-name.trycloud".into()).unwrap();
    mock.output.send("flare.com/path\n".into()).unwrap();
    let origin = wait_for_tunnel(&mut tunnel, Duration::from_secs(1), &Cancel::new()).await.unwrap();
    assert_eq!(origin, "https://sample-name.trycloudflare.com");
    assert_eq!(tunnel_origin("https://example.com"), None);
    assert_eq!(tunnel_origin("https://a.trycloudflare.company"), None);
    assert_eq!(
        tunnel_origin("HTTPS://Up-Case.TryCloudflare.com"),
        Some("https://up-case.trycloudflare.com".into())
    );
}

#[tokio::test]
async fn the_service_owns_its_listener_and_an_isolated_tunnel_and_prints_the_code() {
    let (h, deps) = harness(Plan::default());
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    let (args, env, cwd) = h.spawned.lock().unwrap()[0].clone();
    let value = |flag: &str| args[args.iter().position(|a| a == flag).unwrap() + 1].clone();
    assert_eq!(args[0], "tunnel");
    assert_eq!(value("--url"), "http://127.0.0.1:8791");
    assert_eq!(value("--metrics"), "127.0.0.1:0");
    assert_eq!(std::fs::read_to_string(value("--config")).unwrap(), "{}\n");
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(std::fs::metadata(value("--config")).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::metadata(&cwd).unwrap().permissions().mode() & 0o777, 0o700);
    let mut names: Vec<String> = env.iter().map(|(k, _)| k.clone()).collect();
    names.sort();
    assert_eq!(names, vec!["HOME", "PATH"]);
    assert_eq!(*h.service.origin.lock().unwrap(), "https://bridge-name.trycloudflare.com");
    let text = h.output.text();
    assert!(text.contains("Walleterm tunnel is ready on Stellar testnet"));
    assert!(text.contains("Connection code: 01234567"));
    assert!(text.contains("Press Ctrl+C"));
    assert!(text.contains("\x1b[47m"), "the QR code prints with an explicit background");
    h.service.rotate("76543210");
    until(|| h.output.text().contains("Connection code: 76543210")).await;
    running.stop(0).await;
    assert!(h.tunnels.lock().unwrap()[0].killed.load(Ordering::SeqCst));
    assert!(h.service.closed.load(Ordering::SeqCst));
    assert!(!cwd.exists(), "the private tunnel directory is removed");
}

#[tokio::test]
async fn a_narrow_terminal_prints_fields_without_a_broken_qr_code() {
    let (h, deps) = harness(Plan { columns: Some(19), ..Plan::default() });
    let running = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    let text = h.output.text();
    assert!(text.contains("Tunnel URL: https://bridge-name.trycloudflare.com"));
    assert!(text.contains("Connection code: 01234567"));
    assert!(text.contains("QR code needs ") && text.contains(" terminal columns"));
    assert!(!text.contains("\x1b[47m"));
    running.stop(0).await;
}

#[tokio::test]
async fn a_readiness_failure_closes_the_listener_and_tunnel() {
    let (h, deps) = harness(Plan {
        ready: Box::new(|_, _| Err(Error::new("internal", "Invalid public response."))),
        ..Plan::default()
    });
    let Err((e, code)) = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await else {
        panic!("launch must fail")
    };
    assert_eq!((e.message.as_str(), code), ("Invalid public response.", 1));
    assert!(h.tunnels.lock().unwrap()[0].killed.load(Ordering::SeqCst));
    assert!(h.service.closed.load(Ordering::SeqCst));
    assert_eq!(h.output.count(), 0);
}

#[tokio::test]
async fn cancellation_during_listener_startup_starts_no_tunnel() {
    let (h, deps) = harness(Plan::default());
    let (open, gate) = tokio::sync::oneshot::channel();
    *h.service.listen_gate.lock().unwrap() = Some(gate);
    let stop = h.stop.clone();
    let service = h.service.clone();
    let pending = tokio::spawn(async move { launch("Walleterm tunnel", 8791, service, deps).await.err() });
    tokio::time::sleep(Duration::from_millis(10)).await;
    stop.abort();
    let _ = open.send(());
    let (e, code) = pending.await.unwrap().expect("launch must stop");
    assert_eq!((e.code, code), ("service_stopped", 0));
    assert_eq!(h.spawns.load(Ordering::SeqCst), 0);
    assert_eq!(h.output.count(), 0);
    assert!(!h.service.listening.load(Ordering::SeqCst));
}

#[tokio::test]
async fn cancellation_during_readiness_reports_no_readiness() {
    let (h, mut deps) = harness(Plan::default());
    let entered = Arc::new(tokio::sync::Notify::new());
    let signal = entered.clone();
    deps.ready = Box::new(move |_, _, _| {
        signal.notify_one();
        Box::pin(std::future::pending())
    });
    let (stop, service) = (h.stop.clone(), h.service.clone());
    let pending = tokio::spawn(async move { launch("Walleterm tunnel", 8791, service, deps).await.err() });
    entered.notified().await;
    stop.abort();
    let (e, _) = pending.await.unwrap().expect("launch must stop");
    assert_eq!(e.code, "service_stopped");
    assert_eq!(h.output.count(), 0);
    assert!(!h.service.listening.load(Ordering::SeqCst));
}

#[tokio::test]
async fn an_exit_right_after_the_url_closes_the_listener() {
    let (h, mut deps) = harness(Plan::default());
    let tunnels = h.tunnels.clone();
    deps.spawn_tunnel = Box::new(move |_, _, _| {
        let (mock, tunnel) = MockTunnel::new();
        mock.output.send("https://bridge-name.trycloudflare.com".into()).unwrap();
        mock.exit();
        tunnels.lock().unwrap().push(mock);
        Ok(tunnel)
    });
    let Err((e, code)) = launch("Walleterm tunnel", 8791, h.service.clone(), deps).await else {
        panic!("launch must fail")
    };
    assert!(e.message.contains("stopped") || e.message.contains("exited"), "{}", e.message);
    assert_eq!(code, 1);
    assert_eq!(h.output.count(), 0);
    assert!(!h.service.listening.load(Ordering::SeqCst));
}

#[tokio::test]
async fn readiness_requires_the_exact_service_name() {
    let seen = Arc::new(AtomicUsize::new(0));
    let counter = seen.clone();
    let probe: Box<walleterm::tunnel::ProbeFn> = Box::new(move |_, _| {
        let n = counter.fetch_add(1, Ordering::SeqCst);
        Box::pin(
            async move { Ok((200, Some(if n == 0 { "walleterm-demo" } else { "walleterm" }.to_owned()))) },
        )
    });
    public_ready("https://bridge-name.trycloudflare.com", "walleterm", &probe, &Cancel::new()).await.unwrap();
    assert_eq!(seen.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn an_html_error_page_fails_the_probe() {
    use http_body_util::Full;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let service = hyper::service::service_fn(|_req| async {
            Ok::<_, std::convert::Infallible>(
                hyper::Response::builder()
                    .status(530)
                    .body(Full::new(bytes::Bytes::from_static(b"<html>Cloudflare error</html>")))
                    .unwrap(),
            )
        });
        let _ = hyper::server::conn::http1::Builder::new()
            .serve_connection(hyper_util::rt::TokioIo::new(stream), service)
            .await;
    });
    let client = hyper_util::client::legacy::Client::builder(hyper_util::rt::TokioExecutor::new())
        .build(hyper_util::client::legacy::connect::HttpConnector::new());
    let e = walleterm::tunnel::public_probe(&client, &origin, &Cancel::new()).await.unwrap_err();
    assert_eq!(e.message, "The public response is not JSON.");
}

// ---------- The real supervisor ----------

fn alive(pid: i32) -> bool {
    // SAFETY: signal 0 only checks that the process exists.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// A cloudflared stand-in that ignores SIGTERM and records every run.
fn mock_cloudflared(dir: &std::path::Path) {
    let script = format!(
        "#!/bin/sh\ntrap '' TERM\necho $$ >> '{}/tunnels'\necho https://mock-tunnel.trycloudflare.com\nwhile :; do sleep 1; done\n",
        dir.display()
    );
    std::fs::write(dir.join("cloudflared"), script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir.join("cloudflared"), std::fs::Permissions::from_mode(0o700)).unwrap();
}

fn tunnels(dir: &std::path::Path) -> Vec<i32> {
    std::fs::read_to_string(dir.join("tunnels"))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.parse().ok())
        .collect()
}

fn scratch() -> PathBuf {
    let dir = PathBuf::from(format!("/private/tmp/wt-sup-{}", &walleterm::util::uuid()[..8]));
    std::fs::create_dir(&dir).unwrap();
    dir
}

#[tokio::test]
async fn a_closed_parent_pipe_stops_the_supervisor_and_its_stubborn_child() {
    let dir = scratch();
    mock_cloudflared(&dir);
    let mut supervisor = tokio::process::Command::new(env!("CARGO_BIN_EXE_walleterm"))
        .arg("tunnel-child")
        .env_clear()
        .env("PATH", format!("{}:/bin:/usr/bin", dir.display()))
        .current_dir(&dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    until(|| dir.join("child.json").exists() && !tunnels(&dir).is_empty()).await;
    let record: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("child.json")).unwrap()).unwrap();
    assert_eq!(record["parent_pid"], json!(std::process::id()));
    let cloudflared = record["cloudflared_pid"].as_i64().unwrap() as i32;
    assert!(alive(cloudflared));
    // The kernel closes the pipe when the parent crashes. Closing it here has the same effect.
    drop(supervisor.stdin.take());
    let status = tokio::time::timeout(Duration::from_secs(5), supervisor.wait()).await.unwrap().unwrap();
    assert_eq!(status.code(), Some(0));
    until(|| !alive(cloudflared)).await;
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn a_supervisor_sigkill_stops_its_tunnel_group_and_spares_bystanders() {
    let dir = scratch();
    mock_cloudflared(&dir);
    let bystanders: Vec<std::process::Child> = [false, true]
        .into_iter()
        .map(|own_group| {
            let mut command = std::process::Command::new("/bin/sleep");
            command.arg("60");
            if own_group {
                use std::os::unix::process::CommandExt;
                command.process_group(0);
            }
            command.spawn().unwrap()
        })
        .collect();
    let env = vec![("PATH".to_owned(), format!("{}:/bin:/usr/bin", dir.display()))];
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_walleterm"));
    let mut tunnel = walleterm::tunnel::spawn_supervisor_from(&binary, vec![], env, dir.clone()).unwrap();
    let origin = wait_for_tunnel(&mut tunnel, Duration::from_secs(5), &Cancel::new()).await.unwrap();
    assert_eq!(origin, "https://mock-tunnel.trycloudflare.com");
    let record: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("child.json")).unwrap()).unwrap();
    let (supervisor, cloudflared) = (
        record["supervisor_pid"].as_i64().unwrap() as i32,
        record["cloudflared_pid"].as_i64().unwrap() as i32,
    );
    // The supervisor leads its own process group.
    // SAFETY: getpgid only reads process state.
    assert_eq!(unsafe { libc::getpgid(supervisor) }, supervisor);
    unsafe { libc::kill(supervisor, libc::SIGKILL) };
    tunnel.exited.wait_for(Option::is_some).await.unwrap();
    until(|| !alive(cloudflared)).await;
    for mut bystander in bystanders {
        assert!(alive(bystander.id() as i32), "a process outside the tunnel group survives");
        let _ = bystander.kill();
        let _ = bystander.wait();
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn stopping_a_supervisor_stops_its_stubborn_child_within_the_grace_periods() {
    let dir = scratch();
    mock_cloudflared(&dir);
    let env = vec![("PATH".to_owned(), format!("{}:/bin:/usr/bin", dir.display()))];
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_walleterm"));
    let mut tunnel = walleterm::tunnel::spawn_supervisor_from(&binary, vec![], env, dir.clone()).unwrap();
    wait_for_tunnel(&mut tunnel, Duration::from_secs(5), &Cancel::new()).await.unwrap();
    let cloudflared = tunnels(&dir)[0];
    let started = std::time::Instant::now();
    assert!((tunnel.stop)().await);
    assert!(started.elapsed() < Duration::from_secs(5));
    until(|| !alive(cloudflared)).await;
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_tunnel_command_reports_a_busy_port_without_starting_cloudflared() {
    let dir = scratch();
    mock_cloudflared(&dir);
    let busy = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = busy.local_addr().unwrap().port();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_walleterm"))
        .args(["tunnel", "--port", &port.to_string()])
        .env_clear()
        .env("PATH", format!("{}:/bin:/usr/bin", dir.display()))
        .env("HOME", std::env::var("HOME").unwrap())
        .env("OP_VAULT", "Private")
        .current_dir(&dir)
        .output()
        .unwrap();
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert_eq!(output.status.code(), Some(1), "{stdout}");
    assert_eq!(
        stdout,
        "Website wallets: 1Password vault \"Private\".\nThe local port is in use. Choose another --port.\n"
    );
    assert!(tunnels(&dir).is_empty(), "cloudflared never started");
    drop(busy);
    let _ = std::fs::remove_dir_all(&dir);
}

// ---------- Review P4: supervisor generations, shutdown during startup, and bounded output ----------

/// A cloudflared stand-in that ignores SIGTERM. Runs listed in `url_runs` (from 1) print a Quick Tunnel URL.
fn scripted_cloudflared(dir: &std::path::Path, url_runs: &str) {
    let script = format!(
        "#!/bin/sh\ntrap '' TERM\necho $$ >> '{d}/tunnels'\nrun=$(wc -l < '{d}/tunnels' | tr -d ' ')\n\
         case \" {url_runs} \" in *\" $run \"*) echo https://mock-tunnel.trycloudflare.com ;; esac\n\
         while :; do sleep 1; done\n",
        d = dir.display()
    );
    std::fs::write(dir.join("cloudflared"), script).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir.join("cloudflared"), std::fs::Permissions::from_mode(0o700)).unwrap();
}

/// Launcher dependencies that start the real supervisor. Returns each supervisor's working directory.
fn real_supervisor(deps: &mut LaunchDeps, dir: &std::path::Path) -> Arc<Mutex<Vec<PathBuf>>> {
    let cwds: Arc<Mutex<Vec<PathBuf>>> = Arc::default();
    let (seen, binary) = (cwds.clone(), PathBuf::from(env!("CARGO_BIN_EXE_walleterm")));
    deps.spawn_tunnel = Box::new(move |args, env, cwd| {
        seen.lock().unwrap().push(cwd.clone());
        walleterm::tunnel::spawn_supervisor_from(&binary, args, env, cwd)
    });
    deps.environment = vec![("PATH".into(), format!("{}:/bin:/usr/bin", dir.display()))];
    cwds
}

fn record(cwd: &std::path::Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(cwd.join("child.json")).unwrap()).unwrap()
}

#[tokio::test]
async fn a_replacement_supervisor_records_its_own_processes_and_stays_alive() {
    let dir = scratch();
    scripted_cloudflared(&dir, "1 2");
    let (h, mut deps) = harness(Plan { health: Duration::from_millis(20), ..Plan::default() });
    let cwds = real_supervisor(&mut deps, &dir);
    let running = launch("Walleterm tunnel", 8793, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    let first = tunnels(&dir)[0];
    // The first tunnel dies. Recovery starts a second supervisor in the same launcher lifetime.
    // SAFETY: a test-owned mock process.
    unsafe { libc::kill(first, libc::SIGKILL) };
    until_for(|| h.output.text().contains("Reconnect the website with the current code."), 2000).await;
    let cwds = cwds.lock().unwrap().clone();
    assert_eq!(cwds.len(), 2);
    assert_ne!(cwds[0], cwds[1], "each supervisor owns its directory");
    let (old, new) = (record(&cwds[0]), record(&cwds[1]));
    let second = tunnels(&dir)[1];
    assert_eq!(old["cloudflared_pid"], json!(first));
    assert_eq!(new["cloudflared_pid"], json!(second));
    let supervisor = new["supervisor_pid"].as_i64().unwrap() as i32;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(alive(supervisor) && alive(second), "the replacement stays alive");
    assert_eq!(running.stop(0).await, 0);
    until(|| !alive(second) && !alive(supervisor)).await;
    assert!(!cwds[0].parent().unwrap().exists(), "shutdown removes the private directory");
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn shutdown_before_the_first_url_stops_the_starting_tunnel_first() {
    let dir = scratch();
    scripted_cloudflared(&dir, "");
    let (h, mut deps) = harness(Plan::default());
    let cwds = real_supervisor(&mut deps, &dir);
    let (stop, service) = (h.stop.clone(), h.service.clone());
    let launching = tokio::spawn(async move {
        launch("Walleterm tunnel", 8794, service, deps).await.map(|_| ()).map_err(|e| e.1)
    });
    until_for(|| tunnels(&dir).len() == 1, 1000).await;
    stop.abort();
    assert_eq!(launching.await.unwrap(), Err(0));
    // Shutdown returned only after the stubborn tunnel stopped and its directory went away.
    let child = tunnels(&dir)[0];
    until_for(|| !alive(child), 50).await;
    assert!(!cwds.lock().unwrap()[0].exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn shutdown_before_a_replacement_url_stops_the_replacement_first() {
    let dir = scratch();
    scripted_cloudflared(&dir, "1");
    let (h, mut deps) = harness(Plan { health: Duration::from_millis(20), ..Plan::default() });
    let cwds = real_supervisor(&mut deps, &dir);
    let running = launch("Walleterm tunnel", 8795, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    // SAFETY: a test-owned mock process.
    unsafe { libc::kill(tunnels(&dir)[0], libc::SIGKILL) };
    until_for(|| tunnels(&dir).len() == 2, 2000).await;
    assert_eq!(running.stop(0).await, 0);
    let replacement = tunnels(&dir)[1];
    until_for(|| !alive(replacement), 50).await;
    assert!(!cwds.lock().unwrap()[1].exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn tunnel_output_after_the_url_is_discarded_and_shutdown_stays_normal() {
    let dir = scratch();
    let body = "#!/bin/sh\necho https://mock-tunnel.trycloudflare.com\nsleep 0.2\n\
                dd if=/dev/zero bs=4096 count=1024 2>/dev/null\nwhile :; do sleep 1; done\n";
    std::fs::write(dir.join("cloudflared"), body).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(dir.join("cloudflared"), std::fs::Permissions::from_mode(0o700)).unwrap();
    let env = vec![("PATH".into(), format!("{}:/bin:/usr/bin", dir.display()))];
    let binary = PathBuf::from(env!("CARGO_BIN_EXE_walleterm"));
    let mut tunnel = walleterm::tunnel::spawn_supervisor_from(&binary, vec![], env, dir.clone()).unwrap();
    wait_for_tunnel(&mut tunnel, Duration::from_secs(5), &Cancel::new()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(900)).await;
    let mut queued = 0;
    while let Ok(text) = tunnel.output.try_recv() {
        queued += text.len();
    }
    assert_eq!(queued, 0, "4 MiB after the URL must not wait in memory");
    assert!(tunnel.exited.borrow().is_none(), "draining keeps the tunnel running");
    assert!((tunnel.stop)().await);
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn closed_output_keeps_the_url_deadline_and_the_stop_request() {
    let (mock, mut tunnel) = MockTunnel::new();
    drop(mock.output);
    let started = std::time::Instant::now();
    let never = Cancel::new();
    let waiting = wait_for_tunnel(&mut tunnel, Duration::from_millis(80), &never);
    let e = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .expect("the URL deadline holds")
        .unwrap_err();
    assert_eq!(e.message, "The tunnel did not return a URL within 30 seconds.");
    assert!(started.elapsed() < Duration::from_secs(2));
    let (mock, mut tunnel) = MockTunnel::new();
    drop(mock.output);
    let stop = Cancel::new();
    stop.abort();
    let waiting = wait_for_tunnel(&mut tunnel, Duration::from_secs(30), &stop);
    let e = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .expect("the stop request holds")
        .unwrap_err();
    assert_eq!(e.code, "service_stopped");
    drop(mock.exit);
}

/// Review P7-S1: shutdown during recovery waits until the old tunnel has stopped.
#[tokio::test]
async fn shutdown_while_recovery_stops_the_old_tunnel_waits_for_that_stop() {
    let dir = scratch();
    scripted_cloudflared(&dir, "1 2");
    let (h, mut deps) = harness(Plan {
        probe: Box::new(|_, _| Err(Error::new("internal", "Mock network failure"))),
        health: Duration::from_millis(20),
        ..Plan::default()
    });
    let cwds = real_supervisor(&mut deps, &dir);
    let running = launch("Walleterm tunnel", 8796, h.service.clone(), deps).await.map_err(|e| e.0).unwrap();
    let old = tunnels(&dir)[0];
    until_for(|| h.output.text().contains("Restarting the public tunnel."), 2000).await;
    assert_eq!(running.stop(0).await, 0);
    let (old_alive, record_kept) = (alive(old), cwds.lock().unwrap()[0].exists());
    until_for(|| !alive(old), 2000).await;
    let _ = std::fs::remove_dir_all(&dir);
    assert!(!old_alive, "shutdown returned before the old tunnel stopped");
    assert!(!record_kept, "shutdown removed the private directory last");
}

/// Review P7-FIX-S1: shutdown closes the bridge at once, even while recovery still owns the old tunnel.
/// A signature that arrives after shutdown starts never reaches the website.
#[tokio::test]
async fn shutdown_during_retirement_cancels_bridge_signing_first() {
    let dir = scratch();
    scripted_cloudflared(&dir, "1 2");
    let unhealthy = Arc::new(AtomicBool::new(false));
    let health = unhealthy.clone();
    let (h, mut deps) = harness(Plan {
        probe: Box::new(move |_, _| {
            if health.load(Ordering::SeqCst) {
                Err(Error::new("internal", "Mock network failure"))
            } else {
                Ok((200, Some("walleterm".into())))
            }
        }),
        health: Duration::from_millis(20),
        ..Plan::default()
    });
    let cwds = real_supervisor(&mut deps, &dir);
    // The fixture gives the mock signer and HTTP client. The launcher serves a new bridge on a free port.
    let options = support::Options { review: false, ..support::Options::default() };
    let mut f = support::Fixture::new(options).await;
    f.close().await;
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    f.port = listener.local_addr().unwrap().port();
    drop(listener);
    let options = support::Options { review: false, key: f.key.clone() };
    f.bridge = walleterm::bridge::Bridge::new(support::deps(&f.controls, &options), f.port);
    let service = Arc::new(walleterm::service::BridgeService::new(f.bridge.clone(), f.port));
    let running = launch("Walleterm tunnel", f.port, service, deps).await.map_err(|e| e.0).unwrap();
    let site = f.connect("https://review.example").await;
    let gate = f.controls.hold_signing();
    let body = json!({
        "id": "late",
        "kind": "transaction",
        "address": f.public_key,
        "network_passphrase": support::TESTNET,
        "xdr": support::transaction(&f.key, f.controls.now(), 180),
    });
    assert_eq!(f.post("/v1/requests", body, &site).await.status, 201);
    until(|| f.controls.signs.load(Ordering::SeqCst) == 1).await;
    unhealthy.store(true, Ordering::SeqCst);
    until_for(|| h.output.text().contains("Restarting the public tunnel."), 2000).await;
    let stopping = tokio::spawn(async move { running.stop(0).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let closing = f.bridge.closing();
    let canceled = f.controls.sign_cancels.lock().unwrap()[0].is_cancelled();
    let _ = gate.send(());
    let delivered = !closing && f.result(&site, "late").await.body["signed_tx_xdr"].is_string();
    assert_eq!(stopping.await.unwrap(), 0);
    let old = tunnels(&dir)[0];
    until_for(|| !alive(old), 2000).await;
    assert!(!cwds.lock().unwrap()[0].exists());
    f.close().await;
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        closing && canceled && !delivered,
        "closing {closing}, canceled {canceled}, delivered {delivered}"
    );
}
