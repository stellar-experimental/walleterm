//! The trusted ledger client against a loopback mock RPC. Ported from bridge/auth-ledger.test.ts.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::{Request, Response};
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioIo};
use serde_json::{Value, json};
use walleterm::cancel::Cancel;
use walleterm::ledger::read_health;

type Reply = (u16, Vec<(&'static str, &'static str)>, Vec<u8>);

/// Serve each request with the next reply. Records each request body.
async fn mock(replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<Value>>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (replies, record) = (Arc::new(Mutex::new(replies)), seen.clone());
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let (replies, record) = (replies.clone(), record.clone());
            tokio::spawn(async move {
                let service = hyper::service::service_fn(move |req: Request<Incoming>| {
                    let (replies, record) = (replies.clone(), record.clone());
                    async move {
                        let body = req.into_body().collect().await.unwrap().to_bytes();
                        record.lock().unwrap().push(serde_json::from_slice(&body).unwrap_or(Value::Null));
                        let (status, headers, bytes) = replies.lock().unwrap().remove(0);
                        let mut response = Response::builder().status(status);
                        for (name, value) in headers {
                            response = response.header(name, value);
                        }
                        Ok::<_, Infallible>(response.body(Full::new(Bytes::from(bytes))).unwrap())
                    }
                });
                let _ = hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service)
                    .await;
            });
        }
    });
    (url, seen)
}

fn client() -> Client<HttpConnector, Full<Bytes>> {
    Client::builder(TokioExecutor::new()).build(HttpConnector::new())
}

fn health() -> Value {
    json!({"jsonrpc": "2.0", "id": 1, "result": {
        "status": "healthy", "latestLedger": 76772, "latestLedgerCloseTime": "1790467200",
        "oldestLedger": 75000, "oldestLedgerCloseTime": "1790458340", "ledgerRetentionWindow": 17280
    }})
}

async fn read(url: &str) -> walleterm::error::Result<u32> {
    read_health(&client(), url, Duration::from_secs(5), &Cancel::new()).await
}

#[tokio::test]
async fn get_health_is_pinned_healthy_and_its_ledger_validated() {
    let mut cases = vec![(health(), true)];
    let mut with = |f: &dyn Fn(&mut Value)| {
        let mut v = health();
        f(&mut v);
        cases.push((v, false));
    };
    with(&|v| v["id"] = json!(2));
    for bad in [json!(0), json!(-1), json!(1.5), json!("76772"), Value::Null, json!(4_294_967_296u64)] {
        let bad = bad.clone();
        with(&move |v| v["result"]["latestLedger"] = bad.clone());
    }
    for status in [json!("unhealthy"), json!("HEALTHY"), Value::Null] {
        with(&move |v| v["result"]["status"] = status.clone());
    }
    with(&|v| {
        v["result"].as_object_mut().unwrap().remove("status");
    });
    with(&|v| v["result"] = json!({"status": "healthy", "sequence": 76772}));
    with(&|v| v["error"] = json!({"code": -32603, "message": "Unhealthy"}));
    for (response, valid) in cases {
        let (url, seen) = mock(vec![(200, vec![], response.to_string().into_bytes())]).await;
        let result = read(&url).await;
        assert_eq!(seen.lock().unwrap()[0], json!({"jsonrpc": "2.0", "id": 1, "method": "getHealth"}));
        if valid {
            assert_eq!(result, Ok(76772));
        } else {
            assert!(result.unwrap_err().message.contains("invalid"), "{response}");
        }
    }
}

#[tokio::test]
async fn padded_health_json_is_bounded_at_16384_bytes() {
    let json = health().to_string();
    for size in [16384usize, 16385, 76772] {
        let body = format!("{json}{}", " ".repeat(size - json.len()));
        let (url, _) = mock(vec![(200, vec![], body.into_bytes())]).await;
        let result = read(&url).await;
        if size == 16384 {
            assert_eq!(result, Ok(76772));
        } else {
            let e = result.unwrap_err();
            assert_eq!(
                (e.code, e.message.as_str()),
                ("ledger_unavailable", "The trusted ledger response is too large.")
            );
        }
    }
}

#[tokio::test]
async fn redirects_errors_and_malformed_bodies_fail() {
    for reply in [
        (302, vec![("location", "https://example.com/")], Vec::new()),
        (200, vec![], b"not JSON".to_vec()),
        (503, vec![], Vec::new()),
    ] {
        let (url, seen) = mock(vec![reply.clone()]).await;
        let e = read(&url).await.unwrap_err();
        assert_eq!(e.code, "ledger_unavailable");
        assert_eq!(seen.lock().unwrap().len(), 1, "no redirect was followed for {:?}", reply.0);
    }
    let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    assert_eq!(read(&url).await.unwrap_err().message, "The trusted testnet ledger is unavailable.");
}

#[tokio::test]
async fn a_stalled_rpc_times_out_and_cancellation_stops_it() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            held.push(stream);
        }
    });
    let start = std::time::Instant::now();
    let e = read_health(&client(), &url, Duration::from_millis(150), &Cancel::new()).await.unwrap_err();
    assert_eq!(e.code, "ledger_unavailable");
    assert!(start.elapsed() < Duration::from_secs(2));
    let cancel = Cancel::new();
    let stopper = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        stopper.abort();
    });
    let e = read_health(&client(), &url, Duration::from_secs(30), &cancel).await.unwrap_err();
    assert_eq!(e.message, "This operation was aborted.");
}

#[test]
fn the_production_client_is_https_only() {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    runtime.block_on(async {
        let client = walleterm::ledger::https_client().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let e = read_health(&client, &url, Duration::from_secs(2), &Cancel::new()).await.unwrap_err();
        assert_eq!(e.code, "ledger_unavailable");
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.accept()).await.is_err(),
            "no plain HTTP connection"
        );
    });
}
