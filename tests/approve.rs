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

// Not covered: a connection from another macOS user gets no reply (`peer_cred` in `src/approve.rs`).
// That check needs a second account. It is skipped for now. See docs/LIVE-TESTS.md.
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

/// `walleterm approve --port <port>` against `dir`. The command runs its own runtime, so it runs on another thread.
async fn command(dir: &std::path::Path, port: u16) -> String {
    let dir = dir.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        walleterm::approve::command_in(Some(dir), &["--port", &port.to_string()], &mut out);
        String::from_utf8(out).unwrap()
    })
    .await
    .unwrap()
}

fn signer(key: &str, comment: &str) -> walleterm::bridge::SignerInfo {
    walleterm::bridge::SignerInfo {
        public_key: key.to_owned(),
        fingerprint: None,
        comment: Some(comment.to_owned()),
    }
}

#[tokio::test]
async fn a_wallet_change_or_shutdown_during_the_wait_ends_it_unsigned() {
    // A wallet change in the `available` scope denies the waiting request.
    let f = Fixture::new(Options { network: mainnet(), ..Default::default() }).await;
    let second = address(&mock_key(9));
    *f.controls.signers.lock().unwrap() = Ok(vec![signer(&f.public_key, "First"), signer(&second, "Second")]);
    let site = f.open(SITE, "available").await;
    let grant = f.get("/v1/signers", &site).await.body["grant_id"].clone();
    let body = json!({"public_key": f.public_key, "expected_revision": 0, "grant_id": grant});
    assert_eq!(f.post("/v1/select", body, &site).await.status, 200);
    let mut first = request(&f, "request-1", mainnet());
    first["selection_revision"] = json!(1);
    assert_eq!(f.post("/v1/requests", first, &site).await.status, 201);
    until(|| !f.bridge.waiting().is_null()).await;
    let id = f.bridge.waiting()["id"].as_str().unwrap().to_owned();
    let switch = json!({"public_key": second, "expected_revision": 1});
    assert_eq!(f.post("/v1/select", switch, &site).await.status, 200);
    assert_eq!(f.result(&site, "request-1").await.body["state"], "denied");
    until(|| f.bridge.waiting().is_null()).await;
    assert_eq!(f.bridge.answer(&id, true).unwrap_err().code, "not_found");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
    // Shutdown ends the wait too.
    let (f, _site, shown) = waiting(mainnet(), false).await;
    f.bridge.close().await;
    until(|| f.bridge.waiting().is_null()).await;
    assert_eq!(f.bridge.answer(shown["id"].as_str().unwrap(), true).unwrap_err().code, "not_found");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test]
async fn an_old_id_never_answers_the_next_waiting_request() {
    let (f, site, first) = waiting(mainnet(), false).await;
    assert_eq!(f.post("/v1/requests/request-1/cancel", json!({}), &site).await.status, 200);
    assert_eq!(f.post("/v1/requests", request(&f, "request-2", mainnet()), &site).await.status, 201);
    until(|| f.bridge.waiting()["id"] != first["id"] && !f.bridge.waiting().is_null()).await;
    let second = f.bridge.waiting();
    // Both requests have the same body, so the same hash. Only the ID tells them apart.
    assert_eq!(second["hash"], first["hash"]);
    assert_eq!(f.bridge.answer(first["id"].as_str().unwrap(), true).unwrap_err().code, "not_found");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.bridge.answer(second["id"].as_str().unwrap(), true).unwrap();
    assert_eq!(f.result(&site, "request-2").await.body["state"], "signed");
    f.close().await;
}

#[tokio::test]
async fn preimages_and_adapter_entries_show_their_decode() {
    // A test network with --approve takes the testnet fixtures.
    let f = Fixture::new(Options { approve: true, ..Default::default() }).await;
    let site = f.connect(SITE).await;
    let preimage = json!({
        "id": "preimage-1",
        "kind": "auth_entry",
        "preimage_xdr": support::auth::preimage(&f.public_key, 100),
        "network_passphrase": network::TESTNET,
        "address": f.public_key,
    });
    let contract = support::auth::contract(1);
    let entry = json!({
        "id": "entry-1",
        "kind": "authorization",
        "auth_entry_xdr": support::auth::entry(&contract, 100),
        "auth_address": contract,
        "adapter": {"type": "contract-ed25519"},
        "network_passphrase": network::TESTNET,
        "address": f.public_key,
    });
    for (body, kind) in [(preimage, "auth_entry"), (entry, "authorization")] {
        let id = body["id"].as_str().unwrap().to_owned();
        assert_eq!(f.post("/v1/requests", body, &site).await.status, 201);
        until(|| f.bridge.waiting()["kind"] == kind).await;
        let shown = f.bridge.waiting();
        let decoded = &shown["decoded"];
        match kind {
            "auth_entry" => {
                assert!(decoded["soroban_authorization_with_address"]["invocation"].is_object(), "{decoded}")
            }
            _ => {
                assert_eq!(decoded["address"], json!(contract));
                assert_eq!(decoded["adapter"], json!({"type": "contract-ed25519"}));
                assert!(decoded["entry"]["root_invocation"].is_object(), "{decoded}");
            }
        }
        f.bridge.answer(shown["id"].as_str().unwrap(), true).unwrap();
        assert_eq!(f.result(&site, &id).await.body["state"], "signed");
    }
    f.close().await;
}

/// A transaction whose one contract argument nests `levels` vectors deep. Valid XDR, far below the XDR depth limit.
fn nested_call(f: &Fixture, levels: usize) -> String {
    use stellar_xdr::*;
    let mut value = ScVal::Void;
    for _ in 0..levels {
        value = ScVal::Vec(Some(ScVec(vec![value].try_into().unwrap())));
    }
    let call = InvokeContractArgs {
        contract_address: ScAddress::Contract(ContractId(Hash([2; 32]))),
        function_name: ScSymbol("deep".try_into().unwrap()),
        args: vec![value].try_into().unwrap(),
    };
    let tx = Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(f.key.verifying_key().to_bytes())),
        fee: 100,
        seq_num: SequenceNumber(11),
        cond: Preconditions::None,
        memo: Memo::None,
        operations: vec![Operation {
            source_account: None,
            body: OperationBody::InvokeHostFunction(InvokeHostFunctionOp {
                host_function: HostFunction::InvokeContract(call),
                auth: VecM::default(),
            }),
        }]
        .try_into()
        .unwrap(),
        ext: TransactionExt::V0,
    };
    walleterm::stellar::encode(&TransactionEnvelope::Tx(TransactionV1Envelope {
        tx,
        signatures: VecM::default(),
    }))
}

#[tokio::test]
async fn an_artifact_too_deep_to_show_can_only_be_denied() {
    let f = Fixture::new(Options { network: mainnet(), ..Default::default() }).await;
    let site = f.connect(SITE).await;
    let mut body = request(&f, "deep", mainnet());
    body["xdr"] = json!(nested_call(&f, 60));
    assert_eq!(f.post("/v1/requests", body, &site).await.status, 201);
    until(|| !f.bridge.waiting().is_null()).await;
    let shown = f.bridge.waiting();
    assert!(shown["decoded"].is_null());
    assert!(shown["decode_error"].as_str().unwrap().contains("too deeply"));
    let id = shown["id"].as_str().unwrap();
    assert_eq!(f.bridge.answer(id, true).unwrap_err().code, "not_reviewable");
    f.bridge.answer(id, false).unwrap();
    assert_eq!(f.result(&site, "deep").await.body["state"], "denied");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    // A shallow call still shows.
    let mut body = request(&f, "shallow", mainnet());
    body["xdr"] = json!(nested_call(&f, 10));
    assert_eq!(f.post("/v1/requests", body, &site).await.status, 201);
    until(|| !f.bridge.waiting().is_null()).await;
    assert!(f.bridge.waiting()["decoded"].is_object());
    f.close().await;
}

#[tokio::test]
async fn the_command_escapes_display_characters_and_refuses_long_lines_and_links() {
    let f = Fixture::new(Options { network: mainnet(), ..Default::default() }).await;
    let site = f.connect(SITE).await;
    let message = json!({
        "id": "message-rtl",
        "kind": "message",
        "message": "pay \u{202e}0001 xlm",
        "network_passphrase": mainnet().passphrase,
        "address": f.public_key,
    });
    assert_eq!(f.post("/v1/requests", message, &site).await.status, 201);
    until(|| !f.bridge.waiting().is_null()).await;
    let dir = private_dir("escape");
    let server = walleterm::approve::Server::start(&dir, f.port, f.bridge.clone()).unwrap();
    let text = command(&dir, f.port).await;
    assert!(!text.contains('\u{202e}'), "the raw override character never reaches the terminal");
    assert!(text.contains("\\u202e"), "{text}");
    let parsed: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed["request"]["decoded"], "pay \u{202e}0001 xlm");
    // A request line over 4096 bytes gets an error, not a hang.
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let path = walleterm::approve::socket_path(&dir, f.port);
    let mut stream = tokio::net::UnixStream::connect(&path).await.unwrap();
    stream.write_all(format!("{}\n", "a".repeat(5000)).as_bytes()).await.unwrap();
    let mut reply = String::new();
    stream.read_to_string(&mut reply).await.unwrap();
    assert_eq!(serde_json::from_str::<Value>(&reply).unwrap()["error"]["code"], "invalid_input");
    // A symbolic link at the socket path is refused before any connection.
    let other = private_dir("linked");
    std::os::unix::fs::symlink(&path, walleterm::approve::socket_path(&other, f.port)).unwrap();
    let refused = walleterm::approve::call_in(&other, f.port, &json!({ "op": "show" })).await.unwrap_err();
    assert_eq!(refused.code, "tunnel_unavailable");
    // No socket at all names the port.
    let missing: Value = serde_json::from_str(&command(&other, 1).await).unwrap();
    assert_eq!(missing["error"]["code"], "tunnel_unavailable");
    assert!(missing["error"]["message"].as_str().unwrap().contains("port 1."));
    drop(server);
    f.close().await;
    for dir in [&dir, &other] {
        std::fs::remove_dir_all(dir).unwrap();
    }
}
