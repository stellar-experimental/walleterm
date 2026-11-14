//! A mock risk scorer on loopback HTTP. Tests reach it only through `walleterm::risk::Gate::loopback`.
//! It records each request and answers as the test sets. It runs on its own thread, so sync CLI tests can use it.
#![allow(dead_code)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};

pub const TOKEN: &str = "mock-risk-token-0123456789abcdef-0123";

#[derive(Clone, Debug)]
pub struct Hit {
    pub path: String,
    pub authorization: Option<String>,
    pub body: Value,
}

/// How the scorer answers `/v1/score`.
#[derive(Clone, Debug)]
pub enum Mode {
    /// A valid reply with this decision. It echoes the request ID.
    Decision(&'static str),
    Status(u16),
    Raw(&'static str),
    /// Answer after this delay.
    Slow(Duration),
}

#[derive(Clone)]
pub struct Scorer {
    pub port: u16,
    pub hits: Arc<Mutex<Vec<Hit>>>,
    pub mode: Arc<Mutex<Mode>>,
}

impl Scorer {
    pub fn start(mode: Mode) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let scorer = Self { port, hits: Arc::default(), mode: Arc::new(Mutex::new(mode)) };
        let shared = scorer.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let shared = shared.clone();
                std::thread::spawn(move || shared.serve(stream));
            }
        });
        scorer
    }

    pub fn gate(&self) -> walleterm::risk::Gate {
        walleterm::risk::Gate::loopback(self.port, TOKEN).unwrap()
    }

    pub fn hits(&self) -> Vec<Hit> {
        self.hits.lock().unwrap().clone()
    }

    pub fn paths(&self) -> Vec<String> {
        self.hits().into_iter().map(|h| h.path).collect()
    }

    fn serve(&self, stream: TcpStream) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            return;
        }
        let path = line.split(' ').nth(1).unwrap_or_default().to_owned();
        let (mut length, mut authorization) = (0, None);
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header).is_err() || header == "\r\n" || header.is_empty() {
                break;
            }
            let (name, value) = header.trim_end().split_once(": ").unwrap_or_default();
            match name.to_ascii_lowercase().as_str() {
                "content-length" => length = value.parse().unwrap_or(0),
                "authorization" => authorization = Some(value.to_owned()),
                _ => {}
            }
        }
        let mut body = vec![0; length];
        if reader.read_exact(&mut body).is_err() {
            return;
        }
        let body: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        let request_id = body["request_id"].clone();
        self.hits.lock().unwrap().push(Hit { path: path.clone(), authorization, body });
        let mode = self.mode.lock().unwrap().clone();
        let (status, text) = match (path.as_str(), mode) {
            ("/v1/answer", _) => (200, json!({ "ok": true }).to_string()),
            (_, Mode::Decision(decision)) => (200, verdict(decision, &request_id).to_string()),
            (_, Mode::Status(status)) => (status, json!({ "error": { "code": "x" } }).to_string()),
            (_, Mode::Raw(raw)) => (200, raw.to_owned()),
            (_, Mode::Slow(delay)) => {
                std::thread::sleep(delay);
                (200, verdict("deny", &request_id).to_string())
            }
        };
        let mut stream = stream;
        let _ = write!(
            stream,
            "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
            text.len()
        );
    }
}

pub fn verdict(decision: &str, request_id: &Value) -> Value {
    let vetoes = if decision == "deny" {
        json!([{ "code": "SIGNER_AUTHORITY_CHANGE", "source": "T0" }])
    } else {
        json!([])
    };
    json!({
        "request_id": request_id, "score_id": "score-1", "decision": decision, "would_approve": null,
        "p_unsafe": null, "tier": "T0", "judge": null, "vetoes": vetoes,
        "reasons": [{ "code": "PHASE0_ADVISORY_ONLY", "source": "service" }],
        "evidence": {}, "versions": {}, "latency_ms": 1,
    })
}
