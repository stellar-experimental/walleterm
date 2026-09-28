//! Browser-test host: the real Rust bridge with every dependency forwarded to a test harness.
//! Built only with `--features test-host`. Release packages never contain it.
//!
//! Standard input and output carry one JSON object per line.
//! Host to harness: `{"ready":{...}}`, `{"call":N,"dep":...,"args":...}`, `{"abort":N,"reason":{...}}`,
//! `{"log":"..."}`, `{"pairing_changed":true}`, `{"reply":N,"value":...}`.
//! Harness to host: `{"result":N,"ok":...}` or `{"result":N,"error":{"code","message"}}` for a call,
//! and `{"request":N,"op":...}` for pairing, origin, clock, and close operations.
//! End of input stops the host.

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use std::io::BufRead;
use tokio::sync::oneshot;
use walleterm::bridge::{BoxFuture, Bridge, Deps, SignerInfo};
use walleterm::cancel::Cancel;
use walleterm::error::{Error, Result};

const MARKER: &str = "WALLETERM_TEST_HOST_ONLY_V1";

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<std::result::Result<Value, Error>>>>>;

#[derive(Clone)]
struct Rpc {
    next: Arc<AtomicU64>,
    pending: Pending,
}

fn send(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{value}").and_then(|()| out.flush());
}

fn leak(code: &str) -> &'static str {
    // Error codes are a small fixed set in tests; interning keeps the Error type unchanged.
    Box::leak(code.to_owned().into_boxed_str())
}

/// Tells the harness to abort a call that ended without a result. The bridge drops a canceled
/// dependency future, so the abort must come from `Drop`, not from a branch inside the future.
struct Abort<'a> {
    id: u64,
    pending: &'a Pending,
    cancel: Cancel,
    done: bool,
}

impl Drop for Abort<'_> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        self.pending.lock().unwrap().remove(&self.id);
        let reason =
            if self.cancel.is_cancelled() { self.cancel.reason() } else { walleterm::cancel::aborted() };
        send(&json!({ "abort": self.id, "reason": { "code": reason.code, "message": reason.message } }));
    }
}

impl Rpc {
    /// Forward one dependency call and relay its cancellation as an abort message.
    async fn call(&self, dep: &str, args: Value, cancel: Cancel) -> std::result::Result<Value, Error> {
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        let mut guard = Abort { id, pending: &self.pending, cancel: cancel.clone(), done: false };
        send(&json!({ "call": id, "dep": dep, "args": args }));
        tokio::select! {
            result = rx => {
                guard.done = true;
                result.unwrap_or_else(|_| Err(Error::new("internal", "The harness stopped.")))
            }
            () = cancel.cancelled() => Err(cancel.reason()),
        }
    }
}

fn deps(rpc: &Rpc, offset: Arc<AtomicI64>) -> Deps {
    let (a, b, c, d) = (rpc.clone(), rpc.clone(), rpc.clone(), rpc.clone());
    Deps {
        list_signers: Box::new(move |cancel| -> BoxFuture<Result<Vec<SignerInfo>>> {
            let rpc = a.clone();
            Box::pin(async move {
                let value = rpc.call("list_signers", Value::Null, cancel).await?;
                let items = value.as_array().cloned().unwrap_or_default();
                Ok(items
                    .iter()
                    .map(|v| SignerInfo {
                        public_key: v["public_key"].as_str().unwrap_or_default().to_owned(),
                        fingerprint: v["fingerprint"].as_str().map(str::to_owned),
                        comment: v["comment"].as_str().map(str::to_owned),
                    })
                    .collect())
            })
        }),
        sign: Box::new(move |public_key, digest, cancel| -> BoxFuture<Result<String>> {
            let rpc = b.clone();
            Box::pin(async move {
                let args = json!({ "public_key": public_key, "digest": walleterm::util::hex(&digest) });
                let value = rpc.call("sign", args, cancel).await?;
                Ok(value.as_str().unwrap_or_default().to_owned())
            })
        }),
        latest_ledger: Box::new(move |cancel| -> BoxFuture<Result<u32>> {
            let rpc = c.clone();
            Box::pin(async move {
                let value = rpc.call("latest_ledger", Value::Null, cancel).await?;
                value.as_u64().and_then(|v| u32::try_from(v).ok()).ok_or_else(|| {
                    Error::new("ledger_unavailable", "The trusted testnet ledger is unavailable.")
                })
            })
        }),
        review: std::env::var_os("WALLETERM_TEST_HOST_REVIEW").map(|_| {
            Box::new(move |request, cancel| -> BoxFuture<Result<bool>> {
                let rpc = d.clone();
                Box::pin(async move {
                    let value = rpc.call("review", serde_json::to_value(request).unwrap(), cancel).await?;
                    Ok(value.as_bool().unwrap_or(false))
                })
            }) as Box<walleterm::bridge::ReviewFn>
        }),
        log: Box::new(|line| send(&json!({ "log": line }))),
        now: Box::new(move || {
            (walleterm::util::now_ms() as i64 + offset.load(Ordering::SeqCst)).max(0) as u64
        }),
    }
}

/// With WALLETERM_TEST_HOST_PRODUCTION, the live harnesses get the production signer, `OP_VAULT` discovery,
/// and ledger, as `walleterm tunnel` wires them, on loopback without a tunnel. Log lines still reach the harness.
fn dependencies(rpc: &Rpc, offset: Arc<AtomicI64>) -> Deps {
    if std::env::var_os("WALLETERM_TEST_HOST_PRODUCTION").is_none() {
        return deps(rpc, offset);
    }
    let socket = walleterm::platform::agent_socket().expect("the 1Password SSH agent socket");
    let directory = std::env::current_dir().expect("a working directory");
    let vault =
        walleterm::config::load_vault(&directory, std::env::var("OP_VAULT").ok()).expect("a readable .env");
    let client = walleterm::ledger::https_client().expect("an HTTPS client");
    let mut production = walleterm::bridge::production(socket, vault.vault, client);
    production.log = Box::new(|line| send(&json!({ "log": line })));
    production
}

fn main() {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("a runtime");
    runtime.block_on(async {
        let rpc = Rpc { next: Arc::new(AtomicU64::new(1)), pending: Arc::default() };
        let offset = Arc::new(AtomicI64::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("a loopback port");
        let port = listener.local_addr().unwrap().port();
        let bridge = Bridge::new(dependencies(&rpc, offset.clone()), port);
        bridge.set_public_origin(&format!("http://127.0.0.1:{port}")).unwrap();
        bridge.on_pairing_changed(Box::new(|| send(&json!({ "pairing_changed": true }))));
        let stop = Cancel::new();
        let served = bridge.clone();
        let handler: walleterm::http::Handler = Arc::new(move |req, body| {
            let bridge = served.clone();
            Box::pin(async move { bridge.handle(req, body).await })
        });
        tokio::spawn(walleterm::http::serve(listener, handler, Duration::from_secs(150), stop.clone()));
        // With WALLETERM_TEST_HOST_DEMO, also serve the embedded demo website on its own port.
        let mut demo_port = Value::Null;
        if std::env::var_os("WALLETERM_TEST_HOST_DEMO").is_some() {
            let demo_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("a loopback port");
            let port = demo_listener.local_addr().unwrap().port();
            let demo = walleterm::demo::Demo::new(port);
            tokio::spawn(walleterm::demo::serve(demo, demo_listener, stop.clone()));
            demo_port = json!(port);
        }
        send(&json!({ "ready": { "marker": MARKER, "port": port, "demo_port": demo_port, "pairing": bridge.pairing() } }));
        // Tokio's standard input needs a feature the application does not use. A thread reads lines instead.
        let (tx, mut lines) = tokio::sync::mpsc::unbounded_channel::<String>();
        std::thread::spawn(move || {
            for line in std::io::stdin().lock().lines().map_while(std::result::Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        while let Some(line) = lines.recv().await {
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            if let Some(id) = message["result"].as_u64() {
                let sender = rpc.pending.lock().unwrap().remove(&id);
                if let Some(sender) = sender {
                    let result = match message.get("error") {
                        Some(e) => Err(Error::new(
                            leak(e["code"].as_str().unwrap_or("internal")),
                            e["message"].as_str().unwrap_or_default(),
                        )),
                        None => Ok(message["ok"].clone()),
                    };
                    let _ = sender.send(result);
                }
                continue;
            }
            let id = message["request"].clone();
            let value = match message["op"].as_str() {
                Some("pairing") => bridge.pairing(),
                Some("set_public_origin") => {
                    json!(bridge.set_public_origin(message["origin"].as_str().unwrap_or_default()).is_ok())
                }
                Some("advance") => {
                    offset.fetch_add(message["ms"].as_i64().unwrap_or(0), Ordering::SeqCst);
                    json!(true)
                }
                Some("close") => {
                    stop.abort();
                    bridge.close().await;
                    send(&json!({ "reply": id, "value": true }));
                    return;
                }
                _ => Value::Null,
            };
            send(&json!({ "reply": id, "value": value }));
        }
        stop.abort();
        bridge.close().await;
    });
}
