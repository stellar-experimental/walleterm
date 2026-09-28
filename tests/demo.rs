//! The embedded demo website. Ported from the demo cases in bridge/code-view.test.ts and scripts/package.test.ts.

mod support;

use std::sync::Arc;
use std::time::Duration;

use support::raw;
use walleterm::cancel::Cancel;
use walleterm::demo::{ASSETS, Demo, asset};

async fn start() -> (u16, Arc<Demo>, Cancel) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let demo = Demo::new(port);
    let stop = Cancel::new();
    tokio::spawn(walleterm::demo::serve(demo.clone(), listener, stop.clone()));
    (port, demo, stop)
}

fn get(target: &str, host: &str) -> Vec<u8> {
    format!("GET {target} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").into_bytes()
}

#[tokio::test]
async fn every_embedded_route_matches_its_manifest_hash_and_source() {
    let routes = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/dist/routes.tsv"));
    for file in ASSETS {
        assert_eq!(walleterm::util::hex(&walleterm::util::sha256(file.bytes)), file.sha256, "{}", file.route);
    }
    // The build embeds exactly the routes that its manifest lists.
    if let Ok(routes) = routes {
        let listed: Vec<&str> = routes.lines().map(|l| l.split('\t').next().unwrap()).collect();
        let embedded: Vec<&str> = ASSETS.iter().map(|a| a.route).collect();
        assert_eq!(listed, embedded);
    }
    for route in [
        "/",
        "/app.js",
        "/sdk/connect.js",
        "/sdk/connect.css",
        "/fixtures/walleterm_auth_target.wasm",
        "/vendor/syntax.LICENSE",
    ] {
        assert!(asset(route).is_some(), "{route}");
    }
    assert!(ASSETS.iter().all(|a| !a.route.contains("..") && !a.route.ends_with(".map")));
}

#[tokio::test]
async fn the_demo_serves_each_file_with_its_exact_bytes_and_strict_headers() {
    let (port, _demo, stop) = start().await;
    for file in ASSETS {
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        stream.write_all(&get(file.route, &format!("127.0.0.1:{port}"))).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        let split = response.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        let head = String::from_utf8_lossy(&response[..split]).to_lowercase();
        assert!(head.starts_with("http/1.1 200"), "{}", file.route);
        assert!(head.contains(&format!("content-type: {}; charset=utf-8", file.mime)), "{}", file.route);
        assert!(head.contains("content-security-policy: default-src 'none'; script-src 'self';"));
        assert!(head.contains("cache-control: no-store") && head.contains("referrer-policy: no-referrer"));
        assert!(head.contains("x-content-type-options: nosniff"));
        assert_eq!(&response[split + 4..], file.bytes, "{}", file.route);
    }
    stop.abort();
}

#[tokio::test]
async fn the_demo_rejects_other_hosts_methods_and_malformed_targets() {
    let (port, demo, stop) = start().await;
    let host = format!("127.0.0.1:{port}");
    assert_eq!(raw(port, &get("//%25", &host)).await.status, 400);
    assert_eq!(raw(port, &get("/api/session", "unlisted.invalid")).await.status, 403);
    let session = raw(port, &get("/api/session", &format!("localhost:{port}"))).await;
    assert_eq!(
        (session.status, session.body.clone()),
        (200, serde_json::json!({"service": "walleterm-demo"}))
    );
    let post = format!("POST / HTTP/1.1\r\nHost: {host}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    assert_eq!(raw(port, post.as_bytes()).await.status, 405);
    let missing = raw(port, &get("/missing.js", &host)).await;
    assert_eq!(
        (missing.status, missing.body.clone()),
        (404, serde_json::Value::String("Page not found.".into()))
    );
    // Traversal targets resolve as a browser URL does, and no filesystem path exists to reach.
    assert_eq!(raw(port, &get("/../../etc/passwd", &host)).await.status, 404);
    demo.set_public_origin("https://demo-name.trycloudflare.com");
    assert_eq!(raw(port, &get("/api/session", "demo-name.trycloudflare.com")).await.status, 200);
    demo.close();
    assert_eq!(raw(port, &get("/api/session", &host)).await.status, 403);
    stop.abort();
    tokio::time::sleep(Duration::from_millis(10)).await;
}
