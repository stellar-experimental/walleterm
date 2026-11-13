//! The advisory risk gate in the bridge and in the binary's configuration. A mock scorer on loopback only.
//! Isolated mock keys only. Nothing here reaches a real scorer or the 1Password socket.

mod support;

use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde_json::{Value, json};
use support::scorer::{Mode, Scorer, TOKEN};
use support::*;
use walleterm::network::{self, Network};

const SITE: &str = "https://risk.example";

fn mainnet() -> Network {
    network::named("mainnet").unwrap()
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

/// A fixture on `network` with the scorer as its gate, or with no gate.
async fn fixture(network: Network, scorer: Option<&Scorer>) -> (Fixture, Site) {
    let risk = scorer.map(|s| Arc::new(s.gate()));
    let f = Fixture::new(Options { network, risk, ..Default::default() }).await;
    let site = f.connect(SITE).await;
    (f, site)
}

async fn send(f: &Fixture, site: &Site, network: Network) {
    let mut request = transaction_request("request-1", f);
    request["network_passphrase"] = json!(network.passphrase);
    assert_eq!(f.post("/v1/requests", request, site).await.status, 201);
}

/// No output, terminal line, or website reply holds the token.
fn assert_no_token(f: &Fixture, texts: &[&Value]) {
    let lines = f.controls.logs.lock().unwrap().join("");
    assert!(!lines.contains(TOKEN), "{lines}");
    for text in texts {
        assert!(!text.to_string().contains(TOKEN), "{text}");
    }
}

#[tokio::test]
async fn without_a_gate_the_bridge_makes_no_call_and_shows_no_risk() {
    let scorer = Scorer::start(Mode::Decision("deny"));
    let (f, site) = fixture(mainnet(), None).await;
    send(&f, &site, mainnet()).await;
    until(|| !f.bridge.waiting().is_null()).await;
    let shown = f.bridge.waiting();
    assert!(shown.get("risk").is_none(), "{shown}");
    f.bridge.answer(shown["id"].as_str().unwrap(), true).unwrap();
    assert_eq!(f.result(&site, "request-1").await.body["state"], "signed");
    assert!(scorer.hits().is_empty());
    f.close().await;
}

#[tokio::test]
async fn a_deny_stops_the_request_before_the_approval_wait_and_1password() {
    let scorer = Scorer::start(Mode::Decision("deny"));
    let (f, site) = fixture(mainnet(), Some(&scorer)).await;
    send(&f, &site, mainnet()).await;
    let done = f.result(&site, "request-1").await;
    assert_eq!(done.body["state"], "denied", "{}", done.body);
    assert_eq!(done.body["error"]["code"], -4);
    assert_eq!(done.body["error"]["ext"], json!(["walleterm:risk_denied"]));
    // The website learns only that the scorer denied it. The terminal names the vetoes and the score ID.
    assert_eq!(done.body["error"]["message"], "The risk scorer denied this request.");
    assert!(
        !done.body.to_string().contains("SIGNER_AUTHORITY_CHANGE")
            && !done.body.to_string().contains("score-1")
    );
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    assert_eq!(f.controls.listings.load(Ordering::SeqCst), 1, "only the connection listed signers");
    assert!(f.bridge.waiting().is_null());
    let lines = f.controls.logs().join("");
    assert!(!lines.contains("Waiting for approval"), "{lines}");
    assert!(lines.contains("Risk gate: transaction "), "{lines}");
    assert!(lines.contains("Vetoes: SIGNER_AUTHORITY_CHANGE. Score ID: score-1."), "{lines}");
    // One score and no label: nobody answered.
    tokio::time::sleep(Duration::from_millis(100)).await;
    let hits = scorer.hits();
    assert_eq!(scorer.paths(), ["/v1/score"]);
    let hit = &hits[0];
    assert_eq!(hit.authorization.as_deref(), Some(format!("Bearer {TOKEN}").as_str()));
    let mut keys: Vec<&str> = hit.body.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort();
    assert_eq!(keys, ["hash", "kind", "network_passphrase", "origin", "request_id", "signer", "xdr"]);
    assert_eq!(hit.body["kind"], "transaction");
    assert_eq!(hit.body["hash"], done.body["hash"], "the hash is the digest that 1Password would sign");
    assert_eq!(hit.body["origin"], SITE);
    assert_eq!(hit.body["signer"], json!(f.public_key));
    assert_eq!(hit.body["network_passphrase"], mainnet().passphrase);
    assert_no_token(&f, &[&done.body]);
    f.close().await;
}

#[tokio::test]
async fn an_escalation_still_waits_for_approval_and_each_answer_is_a_label() {
    for approved in [true, false] {
        let scorer = Scorer::start(Mode::Decision("escalate"));
        let (f, site) = fixture(mainnet(), Some(&scorer)).await;
        send(&f, &site, mainnet()).await;
        until(|| !f.bridge.waiting().is_null()).await;
        let shown = f.bridge.waiting();
        let request_id = scorer.hits()[0].body["request_id"].clone();
        assert_eq!(
            shown["risk"],
            json!({
                "decision": "escalate", "score_id": "score-1", "request_id": request_id, "vetoes": [],
                "reasons": [{ "code": "PHASE0_ADVISORY_ONLY", "source": "service" }],
            })
        );
        assert_ne!(shown["id"], request_id, "the scorer gets a fresh ID, not the approval ID");
        assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
        f.bridge.answer(shown["id"].as_str().unwrap(), approved).unwrap();
        let done = f.result(&site, "request-1").await;
        assert_eq!(done.body["state"], if approved { "signed" } else { "denied" });
        let hits = scorer.wait_for(2);
        assert_eq!(hits[1].path, "/v1/answer");
        assert_eq!(hits[1].body, json!({ "request_id": request_id, "approved": approved }));
        assert_eq!(hits[1].authorization.as_deref(), Some(format!("Bearer {TOKEN}").as_str()));
        assert_no_token(&f, &[&shown, &done.body]);
        f.close().await;
    }
}

#[tokio::test]
async fn an_escalation_on_a_test_network_signs_as_before() {
    let scorer = Scorer::start(Mode::Decision("escalate"));
    let (f, site) = fixture(network::DEFAULT, Some(&scorer)).await;
    send(&f, &site, network::DEFAULT).await;
    assert_eq!(f.result(&site, "request-1").await.body["state"], "signed");
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 1);
    assert_eq!(scorer.paths(), ["/v1/score"]);
    f.close().await;
}

#[tokio::test]
async fn a_scorer_failure_or_an_unknown_decision_continues_and_shows_its_code() {
    for (mode, code) in [
        (Mode::Status(503), "http_503"),
        (Mode::Status(302), "http_302"),
        (Mode::Raw("not json"), "bad_response"),
        (Mode::Decision("approve"), "unexpected_decision"),
    ] {
        let scorer = Scorer::start(mode);
        let (f, site) = fixture(mainnet(), Some(&scorer)).await;
        send(&f, &site, mainnet()).await;
        until(|| !f.bridge.waiting().is_null()).await;
        let shown = f.bridge.waiting();
        assert_eq!(shown["risk"], json!({ "error": code }));
        // `approve` is not an approval. The request still waits for a person.
        assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
        f.bridge.answer(shown["id"].as_str().unwrap(), true).unwrap();
        assert_eq!(f.result(&site, "request-1").await.body["state"], "signed", "{code}");
        // A failed score has no request ID for a label.
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(scorer.paths(), ["/v1/score"], "{code}");
        f.close().await;
    }
}

#[tokio::test]
async fn an_unreachable_or_slow_scorer_is_an_error_within_the_hard_limit() {
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let request = walleterm::risk::request(
        &walleterm::artifact::Artifact::Message("hi".into()),
        None,
        "GKEY",
        &Value::Null,
        "00",
        None,
    );
    let gate = walleterm::risk::Gate::loopback(port, TOKEN).unwrap();
    assert_eq!(gate.score(&request).await, walleterm::risk::Outcome::Error("unreachable".into()));
    let slow = Scorer::start(Mode::Slow(Duration::from_secs(8)));
    let start = Instant::now();
    assert_eq!(slow.gate().score(&request).await, walleterm::risk::Outcome::Error("timeout".into()));
    let took = start.elapsed();
    assert!(took >= Duration::from_millis(4900) && took < Duration::from_secs(7), "{took:?}");
}

fn walleterm(args: &[&str], env: &[(&str, &str)], stdin: &[u8]) -> (i32, String) {
    use std::io::Write;
    let mut command = Command::new(env!("CARGO_BIN_EXE_walleterm"));
    command.args(args).env_remove("WALLETERM_RISK_URL").env_remove("WALLETERM_RISK_TOKEN");
    command.envs(env.iter().copied());
    command.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    let mut child = command.spawn().unwrap();
    child.stdin.take().unwrap().write_all(stdin).unwrap();
    let output = child.wait_with_output().unwrap();
    let text = String::from_utf8(output.stdout).unwrap() + &String::from_utf8(output.stderr).unwrap();
    (output.status.code().unwrap(), text)
}

#[test]
fn a_partial_or_invalid_configuration_stops_sign_and_tunnel_with_exit_2() {
    let url = ("WALLETERM_RISK_URL", "https://scorer.example");
    let token = ("WALLETERM_RISK_TOKEN", TOKEN);
    for env in [
        &[url][..],
        &[token],
        &[("WALLETERM_RISK_URL", "http://scorer.example"), token],
        &[url, ("WALLETERM_RISK_TOKEN", "short-token")],
    ] {
        let (code, out) = walleterm(&["sign"], env, b"{}");
        assert_eq!(code, 2, "{out}");
        let value: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(value["error"]["code"], "invalid_config", "{out}");
        assert!(!out.contains(TOKEN) && !out.contains("short-token"), "{out}");
        let (code, out) = walleterm(&["tunnel"], env, b"");
        assert_eq!(code, 2, "{out}");
        assert!(out.starts_with("invalid_config: "), "{out}");
        assert!(!out.contains(TOKEN) && !out.contains("short-token"), "{out}");
    }
    // Neither variable: the sign input rules apply as before.
    let (code, out) = walleterm(&["sign"], &[], b"{}");
    assert_eq!(code, 2);
    assert!(out.contains("\"invalid_input\""), "{out}");
}

#[tokio::test]
async fn a_malformed_deny_still_stops_the_request() {
    let scorer = Scorer::start(Mode::Raw(r#"{"decision":"deny","vetoes":"not a list"}"#));
    let (f, site) = fixture(mainnet(), Some(&scorer)).await;
    send(&f, &site, mainnet()).await;
    let done = f.result(&site, "request-1").await;
    assert_eq!(done.body["state"], "denied", "{}", done.body);
    assert_eq!(done.body["error"]["ext"], json!(["walleterm:risk_denied"]));
    assert_eq!(f.controls.signs.load(Ordering::SeqCst), 0);
    let lines = f.controls.logs().join("");
    assert!(lines.contains("Vetoes: none. Score ID: none."), "{lines}");
    f.close().await;
}

#[tokio::test]
async fn an_entry_sends_its_adapter_type_and_the_signed_hash() {
    let scorer = Scorer::start(Mode::Decision("escalate"));
    let (f, site) = fixture(network::DEFAULT, Some(&scorer)).await;
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
    assert_eq!(f.post("/v1/requests", entry, &site).await.status, 201);
    let done = f.result(&site, "entry-1").await;
    assert_eq!(done.body["state"], "signed", "{}", done.body);
    let body = &scorer.hits()[0].body;
    assert_eq!(body["kind"], "auth_entry");
    assert_eq!(body["adapter"], "contract-ed25519");
    assert_eq!(body["address"], json!(contract));
    assert_eq!(body["hash"], done.body["hash"]);
    f.close().await;
}
