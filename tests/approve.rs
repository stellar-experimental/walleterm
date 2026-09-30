//! Approval before each signature: the bridge wait, `Bridge::waiting` and `Bridge::answer`, and the private socket.
//! Isolated mock keys only.

mod support;

use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde_json::{Value, json};
use support::*;
use walleterm::network::{self, Network};

const SITE: &str = "https://approve.example";

fn mainnet() -> Network {
    network::named("mainnet").unwrap()
}

/// A transaction request for the fixture's key on `network`.
fn request(f: &Fixture, id: &str, network: Network) -> Value {
    let mut request = transaction_request(id, f);
    request["network_passphrase"] = json!(network.passphrase);
    request
}

async fn until(check: impl Fn() -> bool) {
    for _ in 0..2000 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("the condition did not hold");
}

/// Connect, send one request, and wait until the bridge shows it for approval.
async fn waiting(network: Network, approve: bool) -> (Fixture, Site, Value) {
    let f = Fixture::new(Options { network, approve, ..Default::default() }).await;
    let site = f.connect(SITE).await;
    assert_eq!(f.post("/v1/requests", request(&f, "request-1", network), &site).await.status, 201);
    until(|| !f.bridge.waiting().is_null()).await;
    let shown = f.bridge.waiting();
    (f, site, shown)
}

#[tokio::test]
async fn mainnet_signs_only_after_an_approval_of_the_shown_request() {
    let (f, site, shown) = waiting(mainnet(), false).await;
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    assert_eq!(f.get("/v1/requests/request-1", &site).await.body["state"], "pending");
    assert_eq!(shown["kind"], "transaction");
    assert_eq!(shown["origin"], SITE);
    assert_eq!(shown["public_key"], json!(f.public_key));
    assert_eq!(shown["network"], "mainnet");
    assert_eq!(shown["network_passphrase"], mainnet().passphrase);
    // The decode is the `stellar tx decode` JSON of the exact envelope.
    assert!(shown["decoded"]["tx"]["tx"]["operations"].is_array(), "{shown}");
    assert!(shown["decode_error"].is_null());
    let lines = f.controls.logs.lock().unwrap().join("");
    assert!(lines.contains("Waiting for approval: transaction"), "{lines}");
    assert!(lines.contains("on Stellar mainnet"), "{lines}");
    // A port other than 8787 appears in the command.
    assert!(lines.contains(&format!("Review it with: walleterm approve --port {}\n", f.port)), "{lines}");
    // The terminal line never carries the ID, so nobody approves an artifact that they did not see.
    assert!(!lines.contains(shown["id"].as_str().unwrap()));
    let id = shown["id"].as_str().unwrap();
    let wrong = "00000000-0000-4000-8000-000000000000";
    assert_eq!(f.bridge.answer(wrong, true).unwrap_err().code, "not_found");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.bridge.answer(id, true).unwrap();
    let done = f.result(&site, "request-1").await;
    assert_eq!(done.body["state"], "signed", "{}", done.body);
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 1);
    assert!(f.bridge.waiting().is_null());
    // An ID answers once.
    assert_eq!(f.bridge.answer(id, true).unwrap_err().code, "not_found");
    f.close().await;
}

#[tokio::test]
async fn a_denial_ends_the_request_denied_and_never_signs() {
    let (f, site, shown) = waiting(mainnet(), false).await;
    f.bridge.answer(shown["id"].as_str().unwrap(), false).unwrap();
    let done = f.result(&site, "request-1").await;
    assert_eq!(done.body["state"], "denied");
    assert_eq!(done.body["error"]["code"], -4);
    assert_eq!(done.body["error"]["ext"], json!(["walleterm:rejected"]));
    assert_eq!(done.body["error"]["message"], "The approval was declined.");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    assert!(f.bridge.waiting().is_null());
    f.close().await;
}

#[tokio::test]
async fn no_answer_before_the_request_expires_ends_it_expired() {
    let (f, site, shown) = waiting(mainnet(), false).await;
    // The request expires at its max_time, 180 seconds after it was built.
    f.controls.advance(181_000);
    let done = f.result(&site, "request-1").await;
    assert_eq!(done.body["state"], "expired");
    assert_eq!(done.body["error"]["code"], -3);
    assert_eq!(f.bridge.answer(shown["id"].as_str().unwrap(), true).unwrap_err().code, "not_found");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    assert!(f.bridge.waiting().is_null());
    f.close().await;
}

#[tokio::test]
async fn a_cancel_or_a_disconnection_during_the_wait_ends_it_and_a_late_approval_fails() {
    for disconnect in [false, true] {
        let (f, site, shown) = waiting(mainnet(), false).await;
        let path = if disconnect { "/v1/disconnect" } else { "/v1/requests/request-1/cancel" };
        assert_eq!(f.post(path, json!({}), &site).await.status, 200);
        until(|| f.bridge.waiting().is_null()).await;
        assert_eq!(f.bridge.answer(shown["id"].as_str().unwrap(), true).unwrap_err().code, "not_found");
        // The worker is free for the next request, and nothing was signed.
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0, "disconnect {disconnect}");
        f.close().await;
    }
}

#[tokio::test]
async fn approval_follows_the_passphrase_and_the_option_can_only_add_it() {
    // A custom passphrase always waits. So does a test network with --approve.
    let custom = network::custom("Walleterm ; offline").unwrap();
    for (network, approve) in
        [(custom, false), (network::DEFAULT, true), (network::named("local").unwrap(), true)]
    {
        let (f, _site, shown) = waiting(network, approve).await;
        assert_eq!(shown["network_passphrase"], network.passphrase);
        assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
        f.close().await;
    }
    // A test network without the option signs at once, as before.
    let f = Fixture::new(Options::default()).await;
    let site = f.connect(SITE).await;
    assert_eq!(f.post("/v1/requests", request(&f, "direct", network::DEFAULT), &site).await.status, 201);
    assert_eq!(f.result(&site, "direct").await.body["state"], "signed");
    assert!(f.bridge.waiting().is_null());
    assert!(!f.bridge.approval());
    f.close().await;
}

#[tokio::test]
async fn each_request_kind_shows_its_decode() {
    let f = Fixture::new(Options { network: mainnet(), ..Default::default() }).await;
    let site = f.connect(SITE).await;
    let message = json!({
        "id": "message-1",
        "kind": "message",
        "message": "Sign in to approve.example",
        "network_passphrase": mainnet().passphrase,
        "address": f.public_key,
    });
    assert_eq!(f.post("/v1/requests", message, &site).await.status, 201);
    until(|| !f.bridge.waiting().is_null()).await;
    let shown = f.bridge.waiting();
    assert_eq!(shown["kind"], "message");
    assert_eq!(shown["decoded"], "Sign in to approve.example");
    f.bridge.answer(shown["id"].as_str().unwrap(), true).unwrap();
    assert_eq!(f.result(&site, "message-1").await.body["state"], "signed");
    f.close().await;
}

/// A short private directory. macOS limits a socket path to 104 bytes.
fn private_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("wt-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir(&dir).unwrap();
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    dir
}

#[tokio::test]
async fn the_socket_shows_and_answers_the_waiting_request() {
    let (f, site, shown) = waiting(mainnet(), false).await;
    let dir = private_dir("socket");
    let server = walleterm::approve::Server::start(&dir, f.port, f.bridge.clone()).unwrap();
    let call = |request: Value| {
        let (dir, port) = (dir.clone(), f.port);
        async move { walleterm::approve::call_in(&dir, port, &request).await }
    };
    let reply = call(json!({ "op": "show" })).await.unwrap();
    assert_eq!(reply["ok"], true);
    assert_eq!(reply["request"]["id"], shown["id"]);
    let wrong = json!({ "op": "answer", "id": "00000000-0000-4000-8000-000000000000", "approved": true });
    assert_eq!(call(wrong).await.unwrap()["error"]["code"], "not_found");
    for bad in [json!({ "op": "answer", "id": shown["id"], "approved": "yes" }), json!({ "op": "list" })] {
        assert_eq!(call(bad).await.unwrap()["error"]["code"], "invalid_input");
    }
    let approved = call(json!({ "op": "answer", "id": shown["id"], "approved": true })).await.unwrap();
    assert_eq!(approved, json!({ "ok": true, "approved": true }));
    assert_eq!(f.result(&site, "request-1").await.body["state"], "signed");
    let path = walleterm::approve::socket_path(&dir, f.port);
    assert!(path.exists());
    drop(server);
    assert!(!path.exists(), "the tunnel removes its socket");
    assert_eq!(call(json!({ "op": "show" })).await.unwrap_err().code, "tunnel_unavailable");
    f.close().await;
    std::fs::remove_dir_all(&dir).unwrap();
}

#[tokio::test]
async fn the_socket_needs_a_private_directory_and_replaces_only_a_stale_socket() {
    let f = Fixture::new(Options { network: mainnet(), ..Default::default() }).await;
    let start = |dir: &std::path::Path| walleterm::approve::Server::start(dir, f.port, f.bridge.clone());
    // A directory that others can open is refused.
    let open = private_dir("open");
    std::fs::set_permissions(&open, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(start(&open).is_err());
    // A symbolic link is refused, even to a private directory.
    let real = private_dir("real");
    let link = std::env::temp_dir().join(format!("wt-link-{}", std::process::id()));
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(&real, &link).unwrap();
    assert!(start(&link).is_err());
    // A file at the socket path is not a socket, so it stays and startup fails.
    let path = walleterm::approve::socket_path(&real, f.port);
    std::fs::write(&path, b"keep").unwrap();
    assert!(start(&real).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"keep");
    std::fs::remove_file(&path).unwrap();
    // A stale socket from a crash is replaced.
    drop(std::os::unix::net::UnixListener::bind(&path).unwrap());
    let server = start(&real).unwrap();
    let reply = walleterm::approve::call_in(&real, f.port, &json!({ "op": "show" })).await.unwrap();
    assert_eq!(reply, json!({ "ok": true, "request": null }));
    drop(server);
    f.close().await;
    for dir in [&open, &real] {
        std::fs::remove_dir_all(dir).unwrap();
    }
    std::fs::remove_file(&link).unwrap();
}
