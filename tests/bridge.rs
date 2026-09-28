//! Bridge protocol version 3 against mock dependencies over real loopback HTTP.
//! Ported from bridge/server.test.ts in the legacy TypeScript tests at 52a7fc3. Isolated mock keys only.

mod support;

use std::sync::atomic::Ordering;
use std::time::Duration;

use ed25519_dalek::Verifier;
use serde_json::{Value, json};
use stellar_xdr::{Limits, ReadXdr, TransactionEnvelope};
use support::*;
use walleterm::bridge::SignerInfo;

const SITE: &str = "https://site-one.example";
const SITE_TWO: &str = "https://site-two.example";

fn signer(key: &str, comment: &str) -> SignerInfo {
    SignerInfo { public_key: key.to_owned(), fingerprint: None, comment: Some(comment.to_owned()) }
}

#[tokio::test]
async fn short_codes_expire_rotate_once_and_pause_after_five_incorrect_attempts() {
    let f = Fixture::new(Options::default()).await;
    let original = f.code();
    assert!(original.len() == 8 && original.bytes().all(|b| b.is_ascii_digit()));
    f.connect(SITE).await;
    assert_ne!(f.code(), original);
    let site = Site::new(SITE);
    let status = |r: Response| r.status;
    assert_eq!(
        status(f.post("/v1/connect", json!({"code": original, "wallet_scope": "selected"}), &site).await),
        403
    );
    f.controls.advance(300_001);
    assert_eq!(
        status(f.post("/v1/connect", json!({"code": f.code(), "wallet_scope": "selected"}), &site).await),
        403
    );
    f.controls.clock.fetch_sub(300_001, Ordering::SeqCst);
    let before = f.code();
    for _ in 0..5 {
        assert_eq!(
            status(f.post("/v1/connect", json!({"code": "wrong", "wallet_scope": "selected"}), &site).await),
            403
        );
    }
    assert_ne!(f.code(), before);
    assert_eq!(
        status(f.post("/v1/connect", json!({"code": f.code(), "wallet_scope": "selected"}), &site).await),
        429
    );
    f.controls.advance(60_000);
    assert_eq!(
        status(f.post("/v1/connect", json!({"code": f.code(), "wallet_scope": "selected"}), &site).await),
        201
    );
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test(start_paused = true)]
async fn an_unused_code_rotates_at_expiry() {
    let controls = Fixture::new(Options::default()).await;
    let printed = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = printed.clone();
    controls.bridge.on_pairing_changed(Box::new(move || {
        counter.fetch_add(1, Ordering::SeqCst);
    }));
    let original = controls.code();
    tokio::time::sleep(Duration::from_millis(299_990)).await;
    assert_eq!(controls.code(), original);
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_ne!(controls.code(), original);
    assert_eq!(printed.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn ended_sessions_release_their_connection_slots() {
    let f = Fixture::new(Options::default()).await;
    for _ in 0..65 {
        let site = f.open(SITE, "selected").await;
        assert_eq!(f.post("/v1/disconnect", json!({}), &site).await.status, 200);
    }
    f.close().await;
}

#[tokio::test]
async fn two_origins_have_separate_authority_and_only_review_decides() {
    let f = Fixture::new(Options::default()).await;
    let (a, b) = (f.connect(SITE).await, f.connect(SITE_TWO).await);
    let initial = transaction_request("request-1", &f);
    assert_eq!(f.post("/v1/requests", initial.clone(), &a).await.status, 201);
    assert_eq!(f.get("/v1/requests/request-1", &b).await.status, 404);
    let crossed = Site { origin: SITE_TWO.into(), token: a.token.clone() };
    assert_eq!(f.get("/v1/account", &crossed).await.status, 401);
    for path in ["/api/pair", "/api/connect", "/api/approve", "/api/deny", "/v1/approve"] {
        let r = f.post(path, json!({"code": f.code(), "hash": "anything"}), &a).await;
        assert_eq!(r.status, 404, "{path}");
    }
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    let reviewed = f.controls.decide(true).await;
    assert_eq!(reviewed.origin, SITE);
    assert_eq!(reviewed.signer.public_key, f.public_key);
    assert_eq!(reviewed.signer.comment.as_deref(), Some("Mock key"));
    let approved = f.result(&a, "request-1").await;
    assert_eq!(approved.body["state"], "signed");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 1);
    let signed = approved.body["signed_tx_xdr"].as_str().unwrap();
    let TransactionEnvelope::Tx(envelope) =
        TransactionEnvelope::from_xdr_base64(signed, Limits::none()).unwrap()
    else {
        panic!("V1")
    };
    let hash = walleterm::util::lower_hex::<32>(approved.body["hash"].as_str().unwrap()).unwrap();
    let signature =
        ed25519_dalek::Signature::from_slice(envelope.signatures[0].signature.0.as_slice()).unwrap();
    assert!(f.key.verifying_key().verify(&hash, &signature).is_ok());
    assert_eq!(f.post("/v1/requests", initial.clone(), &a).await.body["state"], "signed");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 1);
    let mut changed = initial.clone();
    changed["xdr"] = json!(transaction(&f.key, f.controls.now(), 170));
    assert_eq!(f.post("/v1/requests", changed, &a).await.status, 409);
    assert_eq!(
        f.controls.logs(),
        vec![format!(
            "Signed {} (account {}, sequence 11) for {SITE}.\n",
            approved.body["hash"].as_str().unwrap(),
            f.public_key
        )]
    );
    f.close().await;
}

#[tokio::test]
async fn discovery_needs_a_session_and_a_selected_scope_wallet_cannot_change() {
    let f = Fixture::new(Options::default()).await;
    let other = address(&mock_key(9));
    assert_eq!(f.get("/v1/signers", &Site::new(SITE)).await.status, 401);
    let a = f.open(SITE, "selected").await;
    assert_eq!(f.get("/v1/signers", &a).await.body["signers"][0]["public_key"], json!(f.public_key));
    assert_eq!(f.post("/v1/requests", transaction_request("request-1", &f), &a).await.status, 409);
    assert_eq!(f.post("/v1/select", json!({"public_key": other}), &a).await.status, 400);
    assert_eq!(f.post("/v1/select", json!({"public_key": f.public_key}), &a).await.status, 200);
    assert_eq!(f.post("/v1/select", json!({"public_key": other}), &a).await.status, 409);
    f.post("/v1/disconnect", json!({}), &a).await;
    assert_eq!(f.get("/v1/signers", &a).await.status, 401);
    f.close().await;
}

#[tokio::test]
async fn responses_carry_cors_json_and_sep43_errors() {
    let f = Fixture::new(Options::default()).await;
    let site = Site::new(SITE);
    let r = f.get("/api/session", &site).await;
    assert_eq!((r.status, r.body.clone()), (200, json!({"service": "walleterm", "protocol": 3})));
    let r = f.get("/v1/account", &site).await;
    assert_eq!(r.status, 401);
    assert_eq!(r.header("access-control-allow-origin"), Some(SITE));
    assert_eq!(r.header("vary"), Some("Origin"));
    assert_eq!(r.header("cache-control"), Some("no-store"));
    assert_eq!(r.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(
        r.body,
        json!({"error": {"code": -3, "message": "Connect this website with a new code from the tunnel terminal.", "ext": ["walleterm:not_connected"]}})
    );
    let r = f.request("OPTIONS", "/v1/connect", None, &site).await;
    assert_eq!(r.status, 204);
    assert_eq!(r.header("access-control-allow-methods"), Some("GET, POST, OPTIONS"));
    assert_eq!(r.header("access-control-allow-headers"), Some("Content-Type, Authorization"));
    assert_eq!(r.header("access-control-max-age"), Some("300"));
    for origin in ["http://site.example", "https://site.example/", "null", "https://user@site.example"] {
        let r = f.get("/v1/account", &Site::new(origin)).await;
        assert_eq!(r.status, 403, "{origin}");
        assert_eq!(r.body["error"]["message"], "Use a separate website Origin.");
    }
    let own = format!("http://127.0.0.1:{}", f.port);
    assert_eq!(f.get("/v1/account", &Site::new(&own)).await.status, 403);
    for loopback in ["http://localhost:3000", "http://127.0.0.1:5173"] {
        assert_eq!(f.get("/v1/account", &Site::new(loopback)).await.status, 401, "{loopback}");
    }
    let r = f.get("/", &site).await;
    assert_eq!(r.status, 404);
    assert_eq!(r.body["error"]["message"], "Use this tunnel URL in a Walleterm-compatible website.");
    f.close().await;
}

#[tokio::test]
async fn hosts_bodies_and_targets_are_checked_on_the_raw_wire() {
    let f = Fixture::new(Options::default()).await;
    let port = f.port;
    let r = raw(port, b"GET /api/session HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n").await;
    assert_eq!((r.status, r.body["error"]["message"].clone()), (403, json!("The request host is invalid.")));
    let r = raw(
        port,
        format!("GET /api/session HTTP/1.1\r\nHost: localhost:{port}\r\nConnection: close\r\n\r\n")
            .as_bytes(),
    )
    .await;
    assert_eq!(r.status, 200);
    // Dot segments and absolute-form targets resolve as a browser URL does.
    let r = raw(
        port,
        format!("GET /v1/../api/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n")
            .as_bytes(),
    )
    .await;
    assert_eq!(r.body["service"], "walleterm");
    let r = raw(port, format!("GET http://other.example/api/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n").as_bytes()).await;
    assert_eq!(r.body["service"], "walleterm");
    let wrong_type = format!(
        "POST /v1/connect HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {SITE}\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
    );
    assert_eq!(raw(port, wrong_type.as_bytes()).await.status, 415);
    let large = "x".repeat(393_217);
    let too_large = format!(
        "POST /v1/connect HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {SITE}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{large}",
        large.len()
    );
    assert_eq!(raw(port, too_large.as_bytes()).await.status, 413);
    let chunk = "y".repeat(200_000);
    let chunked = format!(
        "POST /v1/connect HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {SITE}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{chunk}\r\n{:x}\r\n{chunk}\r\n0\r\n\r\n",
        chunk.len(),
        chunk.len()
    );
    assert_eq!(raw(port, chunked.as_bytes()).await.status, 413);
    let duplicate = format!(
        "POST /v1/connect HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {SITE}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: 45\r\nConnection: close\r\n\r\n{{\"code\":\"1\",\"code\":\"2\",\"wallet_scope\":\"selected\"}}"
    );
    let r = raw(port, duplicate.as_bytes()).await;
    assert_eq!((r.status, r.body["error"]["message"].clone()), (400, json!("Send one JSON object.")));
    f.close().await;
}

#[tokio::test]
async fn a_request_without_review_signs_with_no_terminal_step() {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let a = f.connect(SITE).await;
    assert_eq!(f.post("/v1/requests", transaction_request("request-1", &f), &a).await.status, 201);
    let done = f.result(&a, "request-1").await;
    assert_eq!(done.body["state"], "signed");
    assert_eq!(done.body["signer_address"], json!(f.public_key));
    assert_eq!(f.controls.reviews.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test]
async fn structurally_invalid_requests_never_invoke_review_or_signing() {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    let base = transaction_request("request-1", &f);
    let mut cases: Vec<(Value, u16)> = Vec::new();
    let mut with = |k: &str, v: Value, status: u16| {
        let mut c = base.clone();
        c[k] = v;
        cases.push((c, status));
    };
    with("network_passphrase", json!("Public Global Stellar Network ; September 2015"), 400);
    with("address", json!(address(&mock_key(9))), 400);
    with("xdr", json!("AAAA"), 400);
    // The only time rule: a max_time at or before now. Here it ended 220 seconds ago.
    with("xdr", json!(transaction(&f.key, f.controls.now() - 400_000, 180)), 400);
    with("xdr", json!(transaction(&mock_key(9), f.controls.now(), 180)), 400);
    with("kind", json!("message"), 400);
    with("id", json!("bad id"), 400);
    with("extra", json!(1), 400);
    with("selection_revision", json!(1), 400);
    with("xdr", json!(7), 400);
    for (case, status) in cases {
        let r = f.post("/v1/requests", case.clone(), &a).await;
        assert_eq!(r.status, status, "{case} -> {}", r.body);
        assert_eq!(r.body["error"]["code"], -3, "{}", r.body);
    }
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert_eq!(f.controls.reviews.load(Ordering::SeqCst), 0);
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test]
async fn denial_and_key_removal_never_sign() {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    f.post("/v1/requests", transaction_request("denied", &f), &a).await;
    f.controls.decide(false).await;
    let r = f.result(&a, "denied").await;
    assert_eq!(r.body["state"], "denied");
    assert_eq!(
        r.body["error"],
        json!({"code": -4, "message": "The review denied this request.", "ext": ["walleterm:rejected"], "requestState": "denied"})
    );
    f.post("/v1/requests", transaction_request("removed", &f), &a).await;
    *f.controls.signers.lock().unwrap() = Ok(vec![signer(&address(&mock_key(9)), "Other")]);
    f.controls.decide(true).await;
    let r = f.result(&a, "removed").await;
    assert_eq!(r.body["state"], "denied");
    assert_eq!(r.body["error"]["message"], "The selected key is no longer available.");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

fn both(f: &Fixture) -> Vec<SignerInfo> {
    vec![signer(&f.public_key, "First"), signer(&address(&mock_key(9)), "Second")]
}

/// Connect in the `available` scope and select the mock key with a fresh grant.
async fn scoped(f: &Fixture, origin: &str) -> Site {
    let site = f.open(origin, "available").await;
    let listing = f.get("/v1/signers", &site).await;
    let grant = listing.body["grant_id"].clone();
    let r = f
        .post(
            "/v1/select",
            json!({"public_key": f.public_key, "expected_revision": 0, "grant_id": grant}),
            &site,
        )
        .await;
    assert_eq!(r.status, 200, "{}", r.body);
    site
}

async fn select(f: &Fixture, site: &Site, key: &str, revision: u64) -> Response {
    f.post("/v1/select", json!({"public_key": key, "expected_revision": revision}), site).await
}

fn with_revision(mut request: Value, revision: u64) -> Value {
    request["selection_revision"] = json!(revision);
    request
}

async fn until(check: impl Fn() -> bool) {
    for _ in 0..400 {
        if check() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("the condition never held");
}

#[tokio::test]
async fn scoped_wallets_pin_the_displayed_list_and_never_renew_the_deadline() {
    let f = Fixture::new(Options::default()).await;
    let (first, second) = (both(&f)[0].clone(), both(&f)[1].clone());
    *f.controls.signers.lock().unwrap() = Ok(vec![first.clone()]);
    let a = f.open(SITE, "available").await;
    let offered = f.get("/v1/signers", &a).await.body["grant_id"].clone();
    *f.controls.signers.lock().unwrap() = Ok(vec![first.clone(), second.clone()]);
    let pick = |key: &str| json!({"public_key": key, "expected_revision": 0, "grant_id": offered});
    assert_eq!(f.post("/v1/select", pick(&second.public_key), &a).await.status, 400);
    assert_eq!(f.post("/v1/select", pick(&f.public_key), &a).await.status, 200);
    let before = f.get("/v1/account", &a).await.body;
    assert_eq!(f.get("/v1/signers", &a).await.body["signers"], json!([first]));
    assert_eq!(select(&f, &a, &second.public_key, 1).await.status, 400);
    f.controls.advance(5000);
    assert_eq!(select(&f, &a, &f.public_key, 1).await.body["selection_revision"], 1);
    assert_eq!(f.get("/v1/account", &a).await.body["expires_at"], before["expires_at"]);
    *f.controls.signers.lock().unwrap() = Ok(vec![]);
    assert_eq!(select(&f, &a, &f.public_key, 1).await.status, 400);
    assert_eq!(f.get("/v1/signers", &a).await.body["signers"], json!([]));
    f.close().await;
}

#[tokio::test]
async fn first_selection_rejects_a_replaced_grant_and_an_unknown_scope() {
    let f = Fixture::new(Options::default()).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let site = Site::new(SITE);
    assert_eq!(
        f.post("/v1/connect", json!({"code": f.code(), "wallet_scope": "all"}), &site).await.status,
        400
    );
    let a = f.open(SITE, "available").await;
    let old = f.get("/v1/signers", &a).await.body["grant_id"].clone();
    f.get("/v1/signers", &a).await;
    let r = f
        .post("/v1/select", json!({"public_key": f.public_key, "expected_revision": 0, "grant_id": old}), &a)
        .await;
    assert_eq!(r.status, 409);
    f.close().await;
}

#[tokio::test]
async fn switches_cancel_queued_reviews_preserve_other_sessions_and_reject_a_b_a() {
    let f = Fixture::new(Options::default()).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let other = address(&mock_key(9));
    let (a, b) = (scoped(&f, SITE).await, scoped(&f, "https://second.example").await);
    let old = with_revision(transaction_request("request-1", &f), 1);
    f.post("/v1/requests", old.clone(), &a).await;
    f.post("/v1/requests", with_revision(transaction_request("queued", &f), 1), &a).await;
    f.post("/v1/requests", with_revision(transaction_request("separate", &f), 1), &b).await;
    assert_eq!(select(&f, &a, &other, 1).await.body["selection_revision"], 2);
    assert_eq!(f.result(&a, "request-1").await.body["state"], "denied");
    assert_eq!(f.result(&a, "queued").await.body["state"], "denied");
    assert_eq!(select(&f, &a, &f.public_key, 2).await.body["selection_revision"], 3);
    assert_eq!(f.post("/v1/requests", old, &a).await.status, 409);
    assert_eq!(
        f.post("/v1/requests", with_revision(transaction_request("delayed", &f), 1), &a).await.status,
        409
    );
    assert_eq!(f.post("/v1/requests", transaction_request("missing-revision", &f), &a).await.status, 409);
    assert_eq!(select(&f, &a, &other, 1).await.status, 409);
    let first = f.controls.decide(true).await;
    assert_eq!(first.signer.public_key, f.public_key);
    f.controls.decide(true).await;
    assert_eq!(f.result(&b, "separate").await.body["state"], "signed");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 1);
    f.close().await;
}

#[tokio::test]
async fn simultaneous_switches_use_compare_and_set_after_one_delayed_listing() {
    let f = Fixture::new(Options::default()).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let other = address(&mock_key(9));
    let a = scoped(&f, SITE).await;
    let before = f.controls.listings.load(Ordering::SeqCst);
    let open = f.controls.hold_listing();
    let release = async {
        until(|| f.controls.listings.load(Ordering::SeqCst) > before).await;
        tokio::time::sleep(Duration::from_millis(20)).await;
        let _ = open.send(());
    };
    let (r1, r2, ()) = tokio::join!(select(&f, &a, &other, 1), select(&f, &a, &other, 1), release);
    let mut statuses = vec![r1.status, r2.status];
    statuses.sort();
    assert_eq!(statuses, vec![200, 409]);
    assert_eq!(f.controls.listings.load(Ordering::SeqCst), before + 1, "concurrent calls share one listing");
    f.close().await;
}

async fn switch_during(phase: &str) {
    let f = Fixture::new(Options::default()).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let other = address(&mock_key(9));
    let a = scoped(&f, SITE).await;
    let listings = f.controls.listings.load(Ordering::SeqCst);
    let release = match phase {
        "approved" => Some(f.controls.hold_listing()),
        "signing" => Some(f.controls.hold_signing()),
        _ => None,
    };
    f.post("/v1/requests", with_revision(transaction_request("request-1", &f), 1), &a).await;
    let decision = f.controls.next_decision().await;
    assert_eq!(decision.request.signer.public_key, f.public_key);
    decision.decide(true);
    match phase {
        "approved" => until(|| f.controls.listings.load(Ordering::SeqCst) > listings).await,
        "signing" => until(|| f.controls.signs.load(Ordering::SeqCst) > 0).await,
        _ => assert_eq!(f.result(&a, "request-1").await.body["state"], "signed"),
    }
    let changed = select(&f, &a, &other, 1).await;
    assert_eq!(changed.status, 200, "{}", changed.body);
    if let Some(release) = release {
        let _ = release.send(());
    }
    let result = f.result(&a, "request-1").await;
    assert_eq!(result.body["state"], if phase == "approved" { "denied" } else { "unknown" }, "{phase}");
    assert!(result.body.get("signed_tx_xdr").is_none());
    f.close().await;
}

#[tokio::test]
async fn a_switch_during_approval_denies_the_old_request() {
    switch_during("approved").await;
}

#[tokio::test]
async fn a_switch_during_signing_withholds_the_old_result() {
    switch_during("signing").await;
}

#[tokio::test]
async fn a_switch_after_signing_withholds_the_undelivered_result() {
    switch_during("signed").await;
}

#[tokio::test]
async fn a_delayed_request_body_fails_after_switching_away_and_back() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let f = Fixture::new(Options::default()).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let other = address(&mock_key(9));
    let a = scoped(&f, SITE).await;
    let data = with_revision(transaction_request("late-body", &f), 1).to_string();
    let head = format!(
        "POST /v1/requests HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nOrigin: {SITE}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        f.port,
        a.token.as_ref().unwrap(),
        data.len()
    );
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", f.port)).await.unwrap();
    stream.write_all(head.as_bytes()).await.unwrap();
    stream.write_all(&data.as_bytes()[..data.len() - 1]).await.unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    select(&f, &a, &other, 1).await;
    select(&f, &a, &f.public_key, 2).await;
    stream.write_all(&data.as_bytes()[data.len() - 1..]).await.unwrap();
    let mut reply = String::new();
    stream.read_to_string(&mut reply).await.unwrap();
    assert!(reply.starts_with("HTTP/1.1 409"), "{reply}");
    assert_eq!(f.controls.reviews.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test]
async fn expiry_aborts_active_signing_and_switching_never_extends_the_deadline() {
    let f = Fixture::new(Options::default()).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let other = address(&mock_key(9));
    let a = scoped(&f, SITE).await;
    let initial = f.get("/v1/account", &a).await.body;
    select(&f, &a, &other, 1).await;
    select(&f, &a, &f.public_key, 2).await;
    assert_eq!(f.get("/v1/account", &a).await.body["expires_at"], initial["expires_at"]);
    let _hold = f.controls.hold_signing();
    f.post("/v1/requests", with_revision(transaction_request("request-1", &f), 3), &a).await;
    f.controls.decide(true).await;
    until(|| f.controls.signs.load(Ordering::SeqCst) == 1).await;
    // Jump to the session expiry. The next website call ends the session.
    let expires = initial["expires_at"].as_str().unwrap();
    let session_ms = f.controls.now() + 3_600_000;
    assert!(expires.len() == 24);
    f.controls.clock.store(session_ms + 1, Ordering::SeqCst);
    assert_eq!(f.get("/v1/account", &a).await.status, 401);
    let cancel = f.controls.sign_cancels.lock().unwrap()[0].clone();
    tokio::time::timeout(Duration::from_secs(2), cancel.cancelled()).await.expect("the signer saw the abort");
    until(|| f.controls.logs().last().is_some_and(|l| l.contains("Signature withheld or stopped"))).await;
    f.close().await;
}

#[tokio::test]
async fn scoped_signing_fails_closed_after_a_key_is_removed_or_discovery_fails() {
    let f = Fixture::new(Options::default()).await;
    let keys = both(&f);
    *f.controls.signers.lock().unwrap() = Ok(keys.clone());
    let a = scoped(&f, SITE).await;
    for (id, broken) in [("removed", false), ("lookup-failed", true)] {
        *f.controls.signers.lock().unwrap() = Ok(keys.clone());
        f.post("/v1/requests", with_revision(transaction_request(id, &f), 1), &a).await;
        *f.controls.signers.lock().unwrap() = if broken {
            Err(walleterm::error::Error::new("bridge_unavailable", "Discovery failed"))
        } else {
            Ok(vec![keys[1].clone()])
        };
        f.controls.decide(true).await;
        assert_eq!(f.result(&a, id).await.body["state"], "denied", "{id}");
    }
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

fn request_with(f: &Fixture, id: &str, xdr: String) -> Value {
    let mut r = transaction_request(id, f);
    r["xdr"] = json!(xdr);
    r
}

#[tokio::test]
async fn invalid_requests_report_their_exact_reason_and_never_reach_review() {
    use support::tx::*;
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    let (key, other, now) = (f.key.clone(), mock_key(9), f.controls.now());
    let valid = || build(ed(&key), vec![data("a", None)], 100, now, 180);
    let mut cases: Vec<(Value, &str)> = vec![];
    let mut mainnet = transaction_request("mainnet", &f);
    mainnet["network_passphrase"] = json!("Public Global Stellar Network ; September 2015");
    cases.push((mainnet, "network_unsupported"));
    cases.push((
        request_with(&f, "ended", text(&build(ed(&key), vec![data("a", None)], 100, now - 10_000, 10))),
        "invalid_request",
    ));
    cases.push((
        request_with(&f, "wrong-source", text(&build(ed(&other), vec![data("a", None)], 100, now, 180))),
        "address_mismatch",
    ));
    cases.push((request_with(&f, "garbage", "garbage".into()), "invalid_request"));
    let mut wrong_address = transaction_request("address", &f);
    wrong_address["address"] = json!(address(&other));
    cases.push((wrong_address, "address_mismatch"));
    let mut extra = transaction_request("extra", &f);
    extra["extra"] = json!(true);
    cases.push((extra, "invalid_request"));
    let mut kindless = transaction_request("kindless", &f);
    kindless.as_object_mut().unwrap().remove("kind");
    cases.push((kindless, "invalid_request"));
    cases.push((request_with(&f, "signed", text(&sign(valid(), &key))), "invalid_request"));
    cases.push((request_with(&f, "v0", v0(&valid())), "invalid_request"));
    // The fee-bump fee source signs the outer envelope. The inner source alone is not a required signer.
    cases.push((request_with(&f, "inner-source", text(&fee_bump(ed(&other), valid()))), "address_mismatch"));
    // A fee bump uses its inner time bounds.
    let ended = build(ed(&other), vec![data("a", None)], 100, now - 10_000, 10);
    cases.push((request_with(&f, "ended-inner", text(&fee_bump(ed(&key), ended))), "invalid_request"));
    cases.push((request_with(&f, "twenty", text(&sign_many(valid(), 20))), "invalid_request"));
    for (item, reason) in cases {
        let r = f.post("/v1/requests", item.clone(), &a).await;
        assert_eq!(r.status, 400, "{}: {}", item["id"], r.body);
        assert_eq!(r.body["error"]["code"], -3, "{}", item["id"]);
        assert_eq!(
            r.body["error"]["ext"],
            json!([format!("walleterm:{reason}")]),
            "{}: {}",
            item["id"],
            r.body
        );
    }
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    assert_eq!(f.controls.reviews.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test]
async fn the_bridge_filters_no_operations_and_signs_only_for_a_required_signer() {
    use support::tx::*;
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let a = f.connect(SITE).await;
    let (key, other, now) = (f.key.clone(), mock_key(9), f.controls.now());
    let inner = sign(build(ed(&other), vec![payment(&key, None)], 100, now, 180), &other);
    let envelopes = [
        ("options", build(ed(&key), vec![home_domain()], 100_001, now, 180)),
        (
            "many",
            build(
                ed(&key),
                vec![data("a", None), change_trust(&other), payment(&other, Some(ed(&other)))],
                100,
                now,
                180,
            ),
        ),
        ("operation-source", sign(build(ed(&other), vec![data("a", Some(ed(&key)))], 100, now, 180), &other)),
        ("fee-bump", fee_bump(ed(&key), inner)),
        ("nineteen", sign_many(build(ed(&key), vec![data("n", None)], 100, now, 180), 19)),
        ("muxed", build(muxed(&key, 7), vec![data("m", None)], 100, now, 180)),
        ("muxed-operation-source", build(ed(&other), vec![data("m", Some(muxed(&key, 9)))], 100, now, 180)),
        // No time bounds and a long lifetime both sign. The network enforces max_time.
        ("no-time-bounds", build(ed(&key), vec![data("u", None)], 100, now, 0)),
        ("long", build(ed(&key), vec![data("l", None)], 100, now, 86_400)),
        ("unbounded-inner", fee_bump(ed(&key), build(ed(&other), vec![data("i", None)], 100, now, 0))),
    ];
    for (id, envelope) in envelopes {
        assert_eq!(
            f.post("/v1/requests", request_with(&f, id, text(&envelope)), &a).await.status,
            201,
            "{id}"
        );
        let signed = f.result(&a, id).await;
        assert_eq!(signed.body["state"], "signed", "{id}: {}", signed.body);
        let after = TransactionEnvelope::from_xdr_base64(
            signed.body["signed_tx_xdr"].as_str().unwrap(),
            Limits::none(),
        )
        .unwrap();
        let (before_sigs, after_sigs) = match (&envelope, &after) {
            (TransactionEnvelope::Tx(b), TransactionEnvelope::Tx(a)) => {
                assert_eq!(b.tx, a.tx, "{id}");
                (b.signatures.to_vec(), a.signatures.to_vec())
            }
            (TransactionEnvelope::TxFeeBump(b), TransactionEnvelope::TxFeeBump(a)) => {
                assert_eq!(b.tx, a.tx, "{id}");
                (b.signatures.to_vec(), a.signatures.to_vec())
            }
            _ => panic!("{id}: the envelope type changed"),
        };
        assert_eq!(after_sigs.len(), before_sigs.len() + 1, "{id}");
        assert_eq!(&after_sigs[..before_sigs.len()], &before_sigs[..], "{id}");
        let last =
            ed25519_dalek::Signature::from_slice(after_sigs.last().unwrap().signature.0.as_slice()).unwrap();
        assert!(key.verifying_key().verify(&hash(&after), &last).is_ok(), "{id}");
    }
    f.close().await;
}

#[tokio::test]
async fn review_receives_generic_details_and_the_exact_envelope() {
    use support::tx::*;
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    let envelope = build(ed(&f.key), vec![payment(&mock_key(9), None)], 100, f.controls.now(), 180);
    let request = request_with(&f, "pay", text(&envelope));
    f.post("/v1/requests", request.clone(), &a).await;
    let reviewed = f.controls.decide(false).await;
    let d = &reviewed.details;
    assert_eq!(d["transaction_xdr"], request["xdr"]);
    assert_eq!(d["envelope_type"], "transaction");
    assert_eq!(d["operations"], json!([{"type": "payment", "source": f.public_key}]));
    assert_eq!(d["hash"], json!(walleterm::util::hex(&hash(&envelope))));
    assert_eq!(d["sequence"], "11");
    f.close().await;
}

#[tokio::test]
async fn expiry_before_review_never_signs() {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    f.post("/v1/requests", transaction_request("first", &f), &a).await;
    f.post("/v1/requests", transaction_request("expired", &f), &a).await;
    f.controls.advance(181_000);
    f.controls.decide(true).await;
    assert_eq!(f.result(&a, "expired").await.body["state"], "expired");
    assert_eq!(f.result(&a, "first").await.body["state"], "expired");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

/// A request lasts at most five minutes, also when the transaction has no bounds or a distant max_time.
#[tokio::test]
async fn a_request_lasts_at_most_five_minutes_without_a_nearer_max_time() {
    use support::tx::*;
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    let (key, now) = (f.key.clone(), f.controls.now());
    let requests = [
        request_with(&f, "no-bounds", text(&build(ed(&key), vec![data("u", None)], 100, now, 0))),
        request_with(&f, "one-day", text(&build(ed(&key), vec![data("d", None)], 100, now, 86_400))),
        preimage_request(&f, "preimage", 220),
    ];
    let cap = walleterm::util::iso_millis((now + 300_000) as i64);
    for request in &requests {
        let r = f.post("/v1/requests", request.clone(), &a).await;
        assert_eq!(r.status, 201, "{}: {}", request["id"], r.body);
        assert_eq!(r.body["expires_at"], json!(cap), "{}", request["id"]);
    }
    f.controls.advance(300_001);
    // The first request is in review. The queue expires the others before their review starts.
    f.controls.decide(true).await;
    for request in &requests {
        let id = request["id"].as_str().unwrap();
        assert_eq!(f.result(&a, id).await.body["state"], "expired", "{id}");
    }
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test]
async fn canceling_a_queued_review_never_signs_and_one_review_runs_at_a_time() {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    f.post("/v1/requests", transaction_request("request-1", &f), &a).await;
    f.post("/v1/requests", transaction_request("second", &f), &a).await;
    until(|| f.controls.reviews.load(Ordering::SeqCst) == 1).await;
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(f.controls.reviews.load(Ordering::SeqCst), 1);
    f.post("/v1/requests/second/cancel", json!({}), &a).await;
    f.controls.decide(false).await;
    assert_eq!(f.result(&a, "request-1").await.body["state"], "denied");
    assert_eq!(f.result(&a, "second").await.body["state"], "denied");
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(f.controls.reviews.load(Ordering::SeqCst), 1);
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

async fn end_during_signing(revoke: bool) {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    let release = f.controls.hold_signing();
    f.post("/v1/requests", transaction_request("request-1", &f), &a).await;
    f.controls.decide(true).await;
    until(|| f.controls.signs.load(Ordering::SeqCst) == 1).await;
    assert_eq!(f.get("/v1/requests/request-1", &a).await.body["state"], "signing");
    let path = if revoke { "/v1/disconnect" } else { "/v1/requests/request-1/cancel" };
    f.post(path, json!({}), &a).await;
    let _ = release.send(());
    tokio::time::sleep(Duration::from_millis(30)).await;
    let r = f.get("/v1/requests/request-1", &a).await;
    if revoke {
        assert_eq!(r.status, 401);
    } else {
        assert_eq!(r.body["state"], "unknown");
        assert!(r.body.get("signed_tx_xdr").is_none());
        assert_eq!(r.body["error"]["ext"], json!(["walleterm:result_unknown"]));
        assert_eq!(r.body["error"]["code"], -1);
    }
    let logs = f.controls.logs();
    assert!(
        logs[0].starts_with("Signature withheld or stopped for ") && logs[0].contains(" (account G"),
        "{logs:?}"
    );
    // The job's own cancellation ends the wait on the signer, so the late-signature line may not appear.
    assert!(logs.len() <= 2, "{logs:?}");
    f.close().await;
}

#[tokio::test]
async fn cancellation_during_signing_withholds_the_signature() {
    end_during_signing(false).await;
}

#[tokio::test]
async fn revocation_during_signing_withholds_the_signature() {
    end_during_signing(true).await;
}

#[tokio::test]
async fn invalid_signatures_are_never_delivered() {
    let f = Fixture::new(Options::default()).await;
    *f.controls.sign_result.lock().unwrap() = Some("00".repeat(64));
    let a = f.connect(SITE).await;
    f.post("/v1/requests", transaction_request("request-1", &f), &a).await;
    f.controls.decide(true).await;
    let r = f.result(&a, "request-1").await;
    assert_eq!(r.body["state"], "unknown");
    assert!(r.body.get("signed_tx_xdr").is_none());
    f.close().await;
}

#[tokio::test]
async fn restart_invalidates_old_credentials_and_requests() {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    f.post("/v1/requests", transaction_request("request-1", &f), &a).await;
    f.close().await;
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    let restarted = Fixture::new(Options::default()).await;
    let moved = Site { origin: SITE.into(), token: a.token.clone() };
    assert_eq!(restarted.get("/v1/account", &moved).await.status, 401);
    restarted.close().await;
}

#[tokio::test]
async fn closing_the_bridge_aborts_signing_and_reports_it() {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    let _hold = f.controls.hold_signing();
    f.post("/v1/requests", transaction_request("request-1", &f), &a).await;
    f.controls.decide(true).await;
    until(|| f.controls.signs.load(Ordering::SeqCst) == 1).await;
    tokio::time::timeout(Duration::from_secs(5), f.close()).await.expect("close ends active signing");
    let cancel = f.controls.sign_cancels.lock().unwrap()[0].clone();
    assert!(cancel.is_cancelled(), "the signer saw the abort");
    let logs = f.controls.logs();
    assert_eq!(logs.len(), 1, "{logs:?}");
    assert!(logs[0].starts_with("Signature withheld or stopped for "));
}

/// main #27: the terminal reports a withheld signature only when the bridge never sent it.
async fn ended_signature(ending: &str, delivered: bool) {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let a = scoped(&f, SITE).await;
    let request = with_revision(transaction_request("ended", &f), 1);
    assert_eq!(f.post("/v1/requests", request.clone(), &a).await.status, 201);
    until(|| f.controls.logs().len() == 1).await;
    let envelope =
        TransactionEnvelope::from_xdr_base64(request["xdr"].as_str().unwrap(), Limits::none()).unwrap();
    let hash = walleterm::util::hex(&support::tx::hash(&envelope));
    let about = format!("{hash} (account {}, sequence 11)", f.public_key);
    let signed = format!("Signed {about} for {SITE}.\n");
    assert_eq!(f.controls.logs()[0], signed);
    if delivered {
        let sent = f.get("/v1/requests/ended", &a).await;
        assert_eq!(sent.body["state"], "signed");
        assert!(sent.body["signed_tx_xdr"].is_string());
    }
    match ending {
        "switch" => assert_eq!(select(&f, &a, &address(&mock_key(9)), 1).await.status, 200),
        "disconnect" => assert_eq!(f.post("/v1/disconnect", json!({}), &a).await.status, 200),
        _ => f.controls.advance(3_600_001),
    }
    let read = f.get("/v1/requests/ended", &a).await;
    assert!(read.body.get("signed_tx_xdr").is_none());
    if ending == "switch" {
        assert_eq!(read.status, 200);
        assert_eq!(read.body["state"], "unknown");
        assert_eq!(read.body["error"]["code"], -1);
        let message = if delivered {
            "The bridge sent the signature before the wallet changed."
        } else {
            "The active wallet changed."
        };
        assert_eq!(read.body["error"]["message"], message);
    } else {
        assert_eq!(read.status, 401);
    }
    let reason =
        if ending == "switch" { "The active wallet changed." } else { "The website connection was revoked." };
    let mut want = vec![signed];
    if !delivered {
        want.push(format!("Signature withheld or stopped for {about}: {reason}\n"));
    }
    assert_eq!(f.controls.logs(), want, "{ending}, delivered {delivered}");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 1);
    f.close().await;
}

#[tokio::test]
async fn endings_of_a_signed_request_log_a_withheld_line_only_when_undelivered() {
    for ending in ["switch", "disconnect", "expiry"] {
        for delivered in [false, true] {
            ended_signature(ending, delivered).await;
        }
    }
}

#[tokio::test]
async fn a_repeated_create_delivers_a_signature_and_a_later_switch_prints_no_withheld_line() {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let a = scoped(&f, SITE).await;
    let request = with_revision(transaction_request("repeated", &f), 1);
    assert_eq!(f.post("/v1/requests", request.clone(), &a).await.status, 201);
    until(|| f.controls.logs().len() == 1).await;
    // The website never polls. The repeated create alone returns the signature.
    let repeated = f.post("/v1/requests", request, &a).await;
    assert_eq!(repeated.status, 200);
    assert_eq!(repeated.body["state"], "signed");
    assert!(repeated.body["signed_tx_xdr"].is_string());
    assert_eq!(select(&f, &a, &address(&mock_key(9)), 1).await.status, 200);
    let read = f.get("/v1/requests/repeated", &a).await;
    assert_eq!(read.body["state"], "unknown");
    assert!(read.body.get("signed_tx_xdr").is_none());
    assert_eq!(read.body["error"]["message"], "The bridge sent the signature before the wallet changed.");
    let logs = f.controls.logs();
    assert_eq!(logs.len(), 1, "{logs:?}");
    assert!(logs[0].starts_with("Signed "));
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 1);
    f.close().await;
}

#[tokio::test]
async fn canceling_a_signed_request_logs_a_withheld_line_only_when_undelivered() {
    for delivered in [false, true] {
        let f = Fixture::new(Options::default()).await;
        let a = f.connect(SITE).await;
        f.post("/v1/requests", transaction_request("request-1", &f), &a).await;
        f.controls.decide(true).await;
        until(|| f.controls.logs().len() == 1).await;
        if delivered {
            assert_eq!(f.result(&a, "request-1").await.body["state"], "signed");
        }
        let canceled = f.post("/v1/requests/request-1/cancel", json!({}), &a).await;
        assert_eq!(canceled.body["state"], "unknown");
        assert!(canceled.body.get("signed_tx_xdr").is_none());
        let message = if delivered {
            "The bridge sent the signature, then the website canceled."
        } else {
            "The website canceled this request."
        };
        assert_eq!(canceled.body["error"]["message"], message);
        let logs = f.controls.logs();
        assert_eq!(logs.len(), if delivered { 1 } else { 2 }, "{logs:?}");
        assert!(logs[0].starts_with("Signed "));
        if !delivered {
            assert!(logs[1].starts_with("Signature withheld or stopped for "));
            assert!(logs[1].ends_with(": The website canceled this request.\n"), "{}", logs[1]);
        }
        f.close().await;
    }
}

#[tokio::test]
async fn a_cancel_before_its_create_blocks_that_request_id() {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    let early = f.post("/v1/requests/late/cancel", json!({}), &a).await;
    assert_eq!(early.status, 200);
    assert_eq!(
        early.body,
        json!({"id": "late", "state": "denied", "error": {"code": -4, "message": "The website canceled this request.", "ext": ["walleterm:rejected"], "requestState": "denied"}})
    );
    let late = f.post("/v1/requests", transaction_request("late", &f), &a).await;
    assert_eq!(late.status, 409);
    assert_eq!(late.body["error"]["ext"], json!(["walleterm:rejected"]));
    assert_eq!(f.controls.reviews.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test]
async fn concurrent_key_listings_share_one_discovery() {
    let f = Fixture::new(Options::default()).await;
    let a = f.open(SITE, "selected").await;
    let before = f.controls.listings.load(Ordering::SeqCst);
    let gate = f.controls.hold_listing();
    let calls = (0..20).map(|_| f.get("/v1/signers", &a));
    let release = async {
        tokio::time::sleep(Duration::from_millis(40)).await;
        let _ = gate.send(());
    };
    let (results, ()) = tokio::join!(futures_join_all(calls.collect()), release);
    assert!(results.iter().all(|r| r.status == 200));
    assert_eq!(f.controls.listings.load(Ordering::SeqCst) - before, 1);
    f.close().await;
}

/// Await every future concurrently, without an extra crate.
async fn futures_join_all<F: std::future::Future>(futures: Vec<F>) -> Vec<F::Output> {
    let mut pinned: Vec<_> = futures.into_iter().map(Box::pin).collect();
    let mut outputs: Vec<Option<F::Output>> = (0..pinned.len()).map(|_| None).collect();
    std::future::poll_fn(|cx| {
        let mut pending = false;
        for (i, f) in pinned.iter_mut().enumerate() {
            if outputs[i].is_none() {
                match f.as_mut().poll(cx) {
                    std::task::Poll::Ready(v) => outputs[i] = Some(v),
                    std::task::Poll::Pending => pending = true,
                }
            }
        }
        if pending { std::task::Poll::Pending } else { std::task::Poll::Ready(()) }
    })
    .await;
    outputs.into_iter().map(Option::unwrap).collect()
}

fn authorization_request(f: &Fixture, id: &str, adapter: Value, expiration: u32) -> Value {
    let auth_address = support::auth::contract(1);
    json!({
        "id": id,
        "kind": "authorization",
        "auth_entry_xdr": support::auth::entry(&auth_address, expiration),
        "auth_address": auth_address,
        "adapter": adapter,
        "network_passphrase": TESTNET,
        "address": f.public_key,
    })
}

fn preimage_request(f: &Fixture, id: &str, expiration: u32) -> Value {
    json!({
        "id": id,
        "kind": "auth_entry",
        "preimage_xdr": support::auth::preimage(&f.public_key, expiration),
        "network_passphrase": TESTNET,
        "address": f.public_key,
    })
}

/// The expected signed entry, attached independently through the shared core with the mock key.
fn expected_entry(f: &Fixture, request: &Value) -> String {
    use ed25519_dalek::Signer;
    use walleterm::artifact::{self, Artifact, Scope, Signed};
    let artifact = Artifact::Authorization {
        entry_xdr: request["auth_entry_xdr"].as_str().unwrap().into(),
        address: request["auth_address"].as_str().unwrap().into(),
        adapter: request["adapter"].clone(),
    };
    let scope = Scope { key: &f.public_key, passphrase: Some(TESTNET), now_ms: 0 };
    let checked = artifact::inspect(&artifact, &scope).unwrap();
    let Signed::AuthEntry(xdr) =
        artifact::finish(&artifact, &scope, &f.key.sign(&checked.digest).to_bytes()).unwrap()
    else {
        panic!("an entry")
    };
    xdr
}

#[tokio::test]
async fn authorization_signs_once_binds_adapters_on_retries_and_rejects_extra_fields() {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let a = scoped(&f, SITE).await;
    let adapter = json!({"type": "openzeppelin-ed25519", "verifier": support::auth::contract(3), "context_rule_ids": [0]});
    let body = with_revision(authorization_request(&f, "one", adapter.clone(), 160), 1);
    assert_eq!(f.post("/v1/requests", body.clone(), &a).await.status, 201);
    let signed = f.result(&a, "one").await;
    assert_eq!(signed.body["state"], "signed", "{}", signed.body);
    assert_eq!(signed.body["signed_auth_entry_xdr"], json!(expected_entry(&f, &body)));
    assert_eq!(
        f.post("/v1/requests", body.clone(), &a).await.body["signed_auth_entry_xdr"],
        signed.body["signed_auth_entry_xdr"]
    );
    let mut changed = body.clone();
    changed["adapter"]["verifier"] = json!(support::auth::contract(4));
    let r = f.post("/v1/requests", changed, &a).await;
    assert!(r.body["error"]["message"].as_str().unwrap().contains("different"));
    for extra in ["latest_ledger", "digest"] {
        let mut wrong = body.clone();
        wrong[extra] = json!(100);
        let r = f.post("/v1/requests", wrong, &a).await;
        assert_eq!(r.body["error"]["message"], "The signing request fields are invalid.", "{extra}");
    }
    // A rule ID written as an integral decimal is the same request.
    let mut decimal = body.to_string();
    decimal = decimal.replace("\"context_rule_ids\":[0]", "\"context_rule_ids\":[0.0]");
    let r =
        f.request("POST", "/v1/requests", Some(&serde_json::from_str::<Value>(&decimal).unwrap()), &a).await;
    assert_eq!(r.body["state"], "signed");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 1);
    f.close().await;
}

/// No request reads a ledger: the dependencies have no ledger function, and the network enforces expiry.
/// Expiration ledger 0 is the only expiry rule, because ledger 0 is always in the past.
#[tokio::test]
async fn authorization_has_no_expiry_window_and_refuses_only_expiration_zero() {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let a = f.connect(SITE).await;
    let adapter = json!({"type": "contract-ed25519"});
    for (id, expiration) in [("next", 1), ("far", 100_000), ("max", u32::MAX)] {
        let request = authorization_request(&f, id, adapter.clone(), expiration);
        assert_eq!(f.post("/v1/requests", request.clone(), &a).await.status, 201, "{id}");
        let r = f.result(&a, id).await;
        assert_eq!(r.body["state"], "signed", "{id}: {}", r.body);
        assert_eq!(r.body["signed_auth_entry_xdr"], json!(expected_entry(&f, &request)), "{id}");
    }
    for (id, request) in [
        ("entry-zero", authorization_request(&f, "entry-zero", adapter.clone(), 0)),
        ("preimage-zero", preimage_request(&f, "preimage-zero", 0)),
    ] {
        let r = f.post("/v1/requests", request, &a).await;
        assert_eq!(r.status, 400, "{id}: {}", r.body);
        assert_eq!(r.body["error"]["ext"], json!(["walleterm:invalid_request"]), "{id}");
        assert_eq!(
            r.body["error"]["message"],
            "Set the authorization expiration ledger. Ledger 0 is always in the past.",
            "{id}"
        );
    }
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 3);
    f.close().await;
}

/// The account adapter signs only for the selected G-address. Another G-account entry could be valid on chain
/// when the selected key is one of its co-signers, so the bridge refuses it before review.
#[tokio::test]
async fn the_account_adapter_refuses_another_g_address() {
    let f = Fixture::new(Options::default()).await;
    let a = f.connect(SITE).await;
    let other = address(&mock_key(9));
    let mut request = authorization_request(&f, "other-account", json!({"type": "account"}), 160);
    request["auth_entry_xdr"] = json!(support::auth::entry(&other, 160));
    request["auth_address"] = json!(other);
    let r = f.post("/v1/requests", request, &a).await;
    assert_eq!(r.status, 400, "{}", r.body);
    assert_eq!(r.body["error"]["ext"], json!(["walleterm:invalid_request"]));
    assert_eq!(r.body["error"]["message"], "The account authorization must match the selected G-address.");
    assert_eq!(f.controls.reviews.load(Ordering::SeqCst), 0);
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

#[tokio::test]
async fn malformed_signatures_produce_no_authorization() {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let a = f.connect(SITE).await;
    *f.controls.sign_result.lock().unwrap() = Some("00".repeat(64));
    f.post("/v1/requests", authorization_request(&f, "bad", json!({"type": "contract-ed25519"}), 160), &a)
        .await;
    let r = f.result(&a, "bad").await;
    assert_eq!(r.body["state"], "unknown");
    assert!(r.body.get("signed_auth_entry_xdr").is_none());
    f.close().await;
}

#[tokio::test]
async fn authorization_cancel_and_switch_withhold_a_late_signature() {
    for action in ["cancel", "switch", "revoke"] {
        let f = Fixture::new(Options { review: false, ..Options::default() }).await;
        *f.controls.signers.lock().unwrap() = Ok(both(&f));
        let a = scoped(&f, SITE).await;
        let release = f.controls.hold_signing();
        f.post(
            "/v1/requests",
            with_revision(authorization_request(&f, "late", json!({"type": "contract-ed25519"}), 160), 1),
            &a,
        )
        .await;
        until(|| f.controls.signs.load(Ordering::SeqCst) == 1).await;
        match action {
            "cancel" => {
                assert_eq!(f.post("/v1/requests/late/cancel", json!({}), &a).await.body["state"], "unknown")
            }
            "switch" => assert_eq!(select(&f, &a, &address(&mock_key(9)), 1).await.status, 200),
            _ => assert_eq!(f.post("/v1/disconnect", json!({}), &a).await.status, 200),
        }
        let _ = release.send(());
        tokio::time::sleep(Duration::from_millis(20)).await;
        let r = f.get("/v1/requests/late", &a).await;
        if action == "revoke" {
            assert_eq!(r.status, 401);
        } else {
            assert_eq!(r.body["state"], "unknown", "{action}");
            assert!(r.body.get("signed_auth_entry_xdr").is_none());
        }
        f.close().await;
    }
}

#[tokio::test]
async fn preimages_sign_without_a_window_for_the_selected_account_or_a_contract() {
    use base64::Engine as _;
    use ed25519_dalek::Signer;
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let a = f.connect(SITE).await;
    let contract = preimage_request(&f, "contract", 220);
    let mut bound_to_contract = contract.clone();
    bound_to_contract["preimage_xdr"] = json!(support::auth::preimage(&support::auth::contract(1), 220));
    for (id, request) in [
        ("preimage", preimage_request(&f, "preimage", 220)),
        ("far", preimage_request(&f, "far", u32::MAX)),
        ("contract", bound_to_contract),
    ] {
        f.post("/v1/requests", request.clone(), &a).await;
        let r = f.result(&a, id).await;
        assert_eq!(r.body["state"], "signed", "{id}: {}", r.body);
        let raw = base64::engine::general_purpose::STANDARD
            .decode(request["preimage_xdr"].as_str().unwrap())
            .unwrap();
        let digest = walleterm::util::sha256(&raw);
        assert_eq!(r.body["hash"], json!(walleterm::util::hex(&digest)));
        let expected = base64::engine::general_purpose::STANDARD.encode(f.key.sign(&digest).to_bytes());
        assert_eq!(r.body["signed_auth_entry"], json!(expected));
    }
    // The CLI signs a preimage bound to another G-address, for a multisig co-signer. The bridge does not.
    let mut other_signer = preimage_request(&f, "other", 220);
    other_signer["preimage_xdr"] = json!(support::auth::preimage(&address(&mock_key(9)), 220));
    let r = f.post("/v1/requests", other_signer, &a).await;
    assert_eq!(r.body["error"]["ext"], json!(["walleterm:address_mismatch"]));
    assert_eq!(
        r.body["error"]["message"],
        "The authorization address must be the selected G-address or a C-address."
    );
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 3);
    f.close().await;
}

#[tokio::test]
async fn a_selection_completes_after_its_client_disconnects() {
    use tokio::io::AsyncWriteExt;
    let f = Fixture::new(Options::default()).await;
    *f.controls.signers.lock().unwrap() = Ok(both(&f));
    let other = address(&mock_key(9));
    let a = scoped(&f, SITE).await;
    let before = f.controls.listings.load(Ordering::SeqCst);
    let release = f.controls.hold_listing();
    let body = json!({"public_key": other, "expected_revision": 1}).to_string();
    let request = format!(
        "POST /v1/select HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nOrigin: {SITE}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        f.port,
        a.token.as_ref().unwrap(),
        body.len()
    );
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", f.port)).await.unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    until(|| f.controls.listings.load(Ordering::SeqCst) > before).await;
    drop(stream);
    tokio::time::sleep(Duration::from_millis(20)).await;
    let _ = release.send(());
    for _ in 0..200 {
        if f.get("/v1/account", &a).await.body["selection_revision"] == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    let account = f.get("/v1/account", &a).await.body;
    assert_eq!((account["selection_revision"].clone(), account["address"].clone()), (json!(2), json!(other)));
    f.close().await;
}

/// Review P3-S3. The legacy bridge answered 401 and kept serving other requests.
#[tokio::test]
async fn a_selection_body_that_outlasts_its_session_fails_without_stopping_the_bridge() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let f = Fixture::new(Options::default()).await;
    let site = f.open(SITE, "selected").await;
    let data = json!({"public_key": f.public_key}).to_string();
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", f.port)).await.unwrap();
    let head = format!(
        "POST /v1/select HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nOrigin: {SITE}\r\nAuthorization: Bearer {}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{{",
        f.port,
        site.token.as_ref().unwrap(),
        data.len()
    );
    stream.write_all(head.as_bytes()).await.unwrap();
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(f.post("/v1/disconnect", json!({}), &site).await.status, 200);
    // The session sweep removes the disconnected session while the body is still open.
    assert_eq!(f.get("/api/session", &Site::new(SITE)).await.status, 200);
    stream.write_all(&data.as_bytes()[1..]).await.unwrap();
    let mut out = Vec::new();
    stream.read_to_end(&mut out).await.unwrap();
    assert!(String::from_utf8_lossy(&out).starts_with("HTTP/1.1 401"), "{}", String::from_utf8_lossy(&out));
    assert_eq!(f.get("/api/session", &Site::new(SITE)).await.status, 200);
    let other = f.connect(SITE_TWO).await;
    assert_eq!(f.get("/v1/account", &other).await.status, 200);
    f.close().await;
}

/// Review P3-S2, first schedule. The legacy bridge made no signing call.
#[tokio::test]
async fn shutdown_before_the_approved_listing_resumes_starts_no_signing() {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let site = f.connect(SITE).await;
    let before = f.controls.listings.load(Ordering::SeqCst);
    let release = f.controls.hold_listing();
    assert_eq!(f.post("/v1/requests", transaction_request("close-race", &f), &site).await.status, 201);
    until(|| f.controls.listings.load(Ordering::SeqCst) > before).await;
    release.send(()).unwrap();
    f.bridge.close().await;
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0, "{:?}", f.controls.logs());
    f.close().await;
}

/// Review P3-S2, second schedule. A signature that arrives after shutdown starts is withheld.
#[tokio::test]
async fn shutdown_before_the_signature_resumes_withholds_it() {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let site = f.connect(SITE).await;
    let release = f.controls.hold_signing();
    assert_eq!(f.post("/v1/requests", transaction_request("close-result", &f), &site).await.status, 201);
    until(|| f.controls.signs.load(Ordering::SeqCst) == 1).await;
    release.send(()).unwrap();
    f.bridge.close().await;
    let logs = f.controls.logs();
    assert!(logs.iter().all(|line| !line.starts_with("Signed ")), "{logs:?}");
    assert!(logs.iter().any(|line| line.starts_with("Signature withheld")), "{logs:?}");
    f.close().await;
}

/// Review P3-S4. Cancellation during signer discovery waits for the discovery cleanup to end.
#[tokio::test]
async fn shutdown_waits_for_signer_discovery_to_finish_its_cleanup() {
    let f = Fixture::new(Options { review: false, ..Options::default() }).await;
    let site = f.connect(SITE).await;
    let before = f.controls.listings.load(Ordering::SeqCst);
    let _release = f.controls.hold_listing();
    assert_eq!(f.post("/v1/requests", transaction_request("close-listing", &f), &site).await.status, 201);
    until(|| f.controls.listings.load(Ordering::SeqCst) > before).await;
    f.bridge.close().await;
    assert_eq!(f.controls.listing_cleanups.load(Ordering::SeqCst), 1, "close returned before cleanup ended");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    f.close().await;
}

/// Review P4-S5. A website's wallet lookup also finishes its cleanup before shutdown returns.
#[tokio::test]
async fn shutdown_waits_for_a_website_lookup_to_finish_its_cleanup() {
    let f = std::sync::Arc::new(Fixture::new(Options::default()).await);
    let site = f.connect(SITE).await;
    let before = f.controls.listings.load(Ordering::SeqCst);
    let _release = f.controls.hold_listing();
    let lookup = {
        let (f, site) = (f.clone(), site.clone());
        tokio::spawn(async move { f.get("/v1/signers", &site).await.status })
    };
    until(|| f.controls.listings.load(Ordering::SeqCst) > before).await;
    f.bridge.close().await;
    assert_eq!(f.controls.listing_cleanups.load(Ordering::SeqCst), 1, "close returned before cleanup ended");
    assert_ne!(lookup.await.unwrap(), 200);
}
