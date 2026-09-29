//! `walleterm demo`: an independent example website served from embedded files.
//! It has no signing route. It answers GET only, for its own origin and loopback.

use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use serde_json::json;

use crate::bridge::{BodyReader, BoxFuture, HttpRequest, Reply};
use crate::cancel::Cancel;
use crate::error::{Error, Result};

/// One embedded file and the route that serves it.
pub struct Asset {
    pub route: &'static str,
    pub mime: &'static str,
    pub sha256: &'static str,
    pub bytes: &'static [u8],
}

include!(concat!(env!("OUT_DIR"), "/assets.rs"));

const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src https: http://127.0.0.1:* http://localhost:*; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
/// Demo connections close after 15 seconds without traffic.
pub const IDLE: Duration = Duration::from_secs(15);

pub fn asset(route: &str) -> Option<&'static Asset> {
    ASSETS.iter().find(|a| a.route == route)
}

fn empty(status: u16) -> Reply {
    Reply { status, headers: Vec::new(), body: None, raw: Some(Bytes::new()) }
}

pub struct Demo {
    origin: Mutex<String>,
    port: AtomicU16,
    closing: AtomicBool,
}

impl Demo {
    pub fn new(port: u16) -> Arc<Self> {
        Arc::new(Self {
            origin: Mutex::new(format!("http://127.0.0.1:{port}")),
            port: AtomicU16::new(port),
            closing: AtomicBool::new(false),
        })
    }

    pub fn set_port(&self, port: u16) {
        self.port.store(port, Ordering::SeqCst);
        let mut origin = self.origin.lock().unwrap();
        if origin.starts_with("http://127.0.0.1:") {
            *origin = format!("http://127.0.0.1:{port}");
        }
    }

    pub fn set_public_origin(&self, origin: &str) {
        *self.origin.lock().unwrap() = origin.to_owned();
    }

    pub fn close(&self) {
        self.closing.store(true, Ordering::SeqCst);
    }

    pub fn handle(&self, req: &HttpRequest) -> Reply {
        let origin = self.origin.lock().unwrap().clone();
        let base = url::Url::parse(&origin).expect("the demo origin is valid");
        let port = u64::from(self.port.load(Ordering::SeqCst));
        if self.closing.load(Ordering::SeqCst) || !crate::http::allowed_host(&base, port, req.host.as_deref())
        {
            return empty(403);
        }
        let Ok(path) = base.join(&req.target).map(|u| u.path().to_owned()) else {
            return empty(400);
        };
        if req.method != "GET" {
            return empty(405);
        }
        if path == "/api/session" {
            return Reply {
                status: 200,
                headers: Vec::new(),
                body: Some(json!({ "service": "walleterm-demo" })),
                raw: None,
            };
        }
        let Some(file) = asset(&path) else {
            return Reply {
                status: 404,
                headers: Vec::new(),
                body: None,
                raw: Some(Bytes::from_static(b"Page not found.")),
            };
        };
        Reply {
            status: 200,
            headers: vec![
                ("Content-Type", format!("{}; charset=utf-8", file.mime)),
                ("Cache-Control", "no-store".into()),
                ("Referrer-Policy", "no-referrer".into()),
                ("X-Content-Type-Options", "nosniff".into()),
                ("Content-Security-Policy", CSP.into()),
            ],
            body: None,
            raw: Some(Bytes::from_static(file.bytes)),
        }
    }
}

/// The demo as a tunnel service.
pub struct DemoService {
    demo: Arc<Demo>,
    port: u16,
    stop: Cancel,
}

impl DemoService {
    pub fn new(port: u16) -> Self {
        Self { demo: Demo::new(port), port, stop: Cancel::new() }
    }
}

/// Serve the demo on a listener until `stop` cancels.
pub fn serve(demo: Arc<Demo>, listener: tokio::net::TcpListener, stop: Cancel) -> impl Future<Output = ()> {
    let handler: crate::http::Handler = Arc::new(move |req: HttpRequest, _body: BodyReader| {
        let demo = demo.clone();
        Box::pin(async move { demo.handle(&req) }) as BoxFuture<Reply>
    });
    crate::http::serve(listener, handler, IDLE, stop)
}

impl crate::tunnel::Service for DemoService {
    fn name(&self) -> &'static str {
        "walleterm-demo"
    }
    fn listen(&self) -> BoxFuture<Result<()>> {
        let (demo, port, stop) = (self.demo.clone(), self.port, self.stop.clone());
        Box::pin(async move {
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await.map_err(|e| {
                if e.kind() == std::io::ErrorKind::AddrInUse {
                    Error::new("address_in_use", "The local port is in use. Choose another --port.")
                } else {
                    Error::new("internal", "The local service did not start. Try again.")
                }
            })?;
            tokio::spawn(serve(demo, listener, stop));
            Ok(())
        })
    }
    fn close(&self) -> BoxFuture<()> {
        self.demo.close();
        self.stop.abort();
        Box::pin(async {})
    }
    fn set_public_origin(&self, origin: &str) {
        self.demo.set_public_origin(origin);
    }
    fn pairing(&self) -> Option<serde_json::Value> {
        None
    }
    fn on_pairing_changed(&self, _callback: Box<dyn Fn() + Send + Sync>) {}
}

#[cfg(test)]
#[path = "../build/manifest.rs"]
mod manifest;

#[cfg(test)]
mod tests {
    use super::manifest::verify;

    fn digest(bytes: &[u8]) -> String {
        crate::util::hex(&crate::util::sha256(bytes))
    }

    /// Review P4-S6: the build embeds a file only when it still matches its manifest digest.
    #[test]
    fn the_build_manifest_rejects_changed_missing_and_malformed_assets() {
        let files = |name: &str| match name {
            "/a/index.html" => Ok(b"<html>built</html>".to_vec()),
            _ => Err(std::io::Error::from(std::io::ErrorKind::NotFound)),
        };
        let good = format!("/\ttext/html\t{}\t/a/index.html\n", digest(b"<html>built</html>"));
        let entries = verify(&good, files).unwrap();
        assert_eq!(entries.len(), 1);
        let entry = &entries[0].0;
        assert_eq!(
            (entry.route.as_str(), entry.mime.as_str(), entry.path.as_str()),
            ("/", "text/html", "/a/index.html")
        );
        assert_eq!(entry.sha256, digest(b"<html>built</html>"));
        assert_eq!(entries[0].1, b"<html>built</html>");

        let stale = format!("/\ttext/html\t{}\t/a/index.html\n", digest(b"<html>older</html>"));
        assert!(verify(&stale, files).unwrap_err().contains("changed after its manifest was written"));
        let missing = format!("/\ttext/html\t{}\t/a/other.html\n", digest(b""));
        assert!(verify(&missing, files).unwrap_err().contains("is unreadable"));
        for bad in [
            "/\ttext/html\t/a/index.html\n".to_owned(),
            format!("index\ttext/html\t{}\t/a/index.html\n", digest(b"<html>built</html>")),
            format!("/\ttext/html\t{}\t/a/index.html\n", digest(b"<html>built</html>").to_uppercase()),
        ] {
            assert!(verify(&bad, files).unwrap_err().contains("malformed"), "{bad}");
        }
        assert_eq!(verify("\n", files).unwrap_err(), "routes.tsv lists no demo files");
    }
}
