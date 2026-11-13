//! The opt-in advisory risk gate. When `WALLETERM_RISK_URL` and `WALLETERM_RISK_TOKEN` are both set, walleterm
//! sends each checked artifact to the risk scorer before it asks 1Password or waits for `walleterm approve`.
//! Only `deny` changes the flow: it stops the request. Every other answer and every failure continues as before.
//! The token goes only into the Authorization header. No output, error, or terminal line holds it.

use std::ffi::OsString;
use std::fmt;
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use bytes::Bytes;
use http_body_util::Full;
use hyper::header::{AUTHORIZATION, CONTENT_TYPE, HeaderValue};
use hyper_tls::HttpsConnector;
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioTimer};
use serde_json::{Map, Value, json};

use crate::artifact::Artifact;
use crate::error::{Error, Result};

pub const URL_VARIABLE: &str = "WALLETERM_RISK_URL";
pub const TOKEN_VARIABLE: &str = "WALLETERM_RISK_TOKEN";
/// The scorer refuses a shorter token.
pub const MIN_TOKEN: usize = 32;
const MAX_TOKEN: usize = 4096;
/// One hard limit for a score: connection, request, response, and body.
pub const SCORE_TIMEOUT: Duration = Duration::from_secs(5);
/// One hard limit for a best-effort answer label.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(2);
pub const MAX_RESPONSE: usize = 64 * 1024;
/// Response strings are untrusted. Each one is 1–128 characters from a small set.
const MAX_TEXT: usize = 128;
/// At most this many vetoes and this many reasons.
const MAX_CODES: usize = 64;

type ScorerClient = Client<HttpsConnector<HttpConnector>, Full<Bytes>>;

/// A configured scorer. `Debug` never shows the token.
pub struct Gate {
    base: String,
    authorization: HeaderValue,
    client: ScorerClient,
}

impl fmt::Debug for Gate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Gate").field("base", &self.base).finish_non_exhaustive()
    }
}

fn config(message: &str) -> Error {
    Error::new("invalid_config", message)
}

/// The gate from the environment. Neither variable set: no gate and no network call.
pub fn from_env() -> Result<Option<Gate>> {
    configure(std::env::var_os(URL_VARIABLE), std::env::var_os(TOKEN_VARIABLE))
}

/// The gate from the two variable values. A partial or invalid configuration is an error.
/// Error messages never repeat a value, because the URL or the token can hold a secret.
pub fn configure(url: Option<OsString>, token: Option<OsString>) -> Result<Option<Gate>> {
    let (url, token) = match (url, token) {
        (None, None) => return Ok(None),
        (Some(url), Some(token)) => (url, token),
        _ => return Err(config("Set both WALLETERM_RISK_URL and WALLETERM_RISK_TOKEN, or neither.")),
    };
    let url = url.into_string().ok().and_then(|u| url::Url::parse(&u).ok()).filter(|u| {
        u.scheme() == "https"
            && u.host_str().is_some()
            && u.username().is_empty()
            && u.password().is_none()
            && u.query().is_none()
            && u.fragment().is_none()
    });
    let Some(url) = url else {
        return Err(config(
            "WALLETERM_RISK_URL must be an https URL without a user name, password, query, or fragment.",
        ));
    };
    let token = token
        .into_string()
        .ok()
        .filter(|t| (MIN_TOKEN..=MAX_TOKEN).contains(&t.len()) && t.bytes().all(|b| b.is_ascii_graphic()));
    let Some(token) = token else {
        return Err(config("WALLETERM_RISK_TOKEN must have 32 to 4096 visible ASCII characters."));
    };
    Gate::new(url.as_str().trim_end_matches('/'), &token, true).map(Some)
}

impl Gate {
    fn new(base: &str, token: &str, https_only: bool) -> Result<Self> {
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| config("WALLETERM_RISK_TOKEN must have 32 to 4096 visible ASCII characters."))?;
        authorization.set_sensitive(true);
        let mut http = HttpConnector::new();
        http.enforce_http(false);
        http.set_connect_timeout(Some(SCORE_TIMEOUT));
        let tls = native_tls::TlsConnector::new()
            .map_err(|_| Error::new("internal", "TLS is unavailable for the risk scorer."))?;
        let mut https = HttpsConnector::from((http, tls.into()));
        https.https_only(https_only);
        // Hyper follows no redirect and reads no proxy setting.
        let client = Client::builder(TokioExecutor::new()).pool_timer(TokioTimer::new()).build(https);
        Ok(Self { base: base.to_owned(), authorization, client })
    }

    /// A gate for a plain HTTP scorer on loopback. Only tests call it. No environment variable selects it.
    #[doc(hidden)]
    pub fn loopback(port: u16, token: &str) -> Result<Self> {
        Self::new(&format!("http://127.0.0.1:{port}"), token, false)
    }

    /// POST one JSON body. The result is the response body of a 2xx reply, or a short error code.
    async fn post(&self, path: &str, body: &Value, limit: Duration) -> std::result::Result<Vec<u8>, String> {
        let request = hyper::Request::post(format!("{}{path}", self.base))
            .header(AUTHORIZATION, self.authorization.clone())
            .header(CONTENT_TYPE, "application/json")
            .body(Full::new(Bytes::from(body.to_string())))
            .map_err(|_| "unreachable".to_owned())?;
        let exchange = async {
            // The client error can name the host. It never reaches output.
            let response = self.client.request(request).await.map_err(|_| "unreachable".to_owned())?;
            let status = response.status().as_u16();
            if !(200..300).contains(&status) {
                return Err(format!("http_{status}"));
            }
            crate::http::capped(response.into_body(), MAX_RESPONSE)
                .await
                .map_err(|_| "bad_response".to_owned())
        };
        tokio::time::timeout(limit, exchange).await.unwrap_or_else(|_| Err("timeout".to_owned()))
    }

    /// Score one request. A failure is an `Outcome::Error`, never a stop.
    pub async fn score(&self, request: &Request) -> Outcome {
        match self.post("/v1/score", &request.body, SCORE_TIMEOUT).await {
            Ok(bytes) => parse(&bytes, &request.request_id),
            Err(code) => Outcome::Error(code),
        }
    }

    /// Record the human answer as a label. Best effort: a failure changes nothing.
    pub async fn answer(&self, request_id: &str, approved: bool) {
        let body = json!({ "request_id": request_id, "approved": approved });
        let _ = self.post("/v1/answer", &body, ANSWER_TIMEOUT).await;
    }
}

/// One score request: a fresh random ID and the body. The body holds only the listed fields.
#[derive(Clone, Debug)]
pub struct Request {
    pub request_id: String,
    body: Value,
}

impl Request {
    pub fn body(&self) -> &Value {
        &self.body
    }
}

/// Build the score request for a checked artifact. `details` is the inspection detail of the artifact.
/// A message travels as Base64 of its exact bytes. An entry and a preimage add their address.
pub fn request(
    artifact: &Artifact,
    passphrase: Option<&str>,
    signer: &str,
    details: &Value,
    origin: Option<&str>,
) -> Request {
    let request_id = crate::util::uuid();
    let (kind, xdr, address) = match artifact {
        Artifact::Transaction(xdr) => ("transaction", xdr.clone(), None),
        Artifact::Preimage(xdr) => ("preimage", xdr.clone(), details["address"].as_str().map(str::to_owned)),
        Artifact::Authorization { entry_xdr, address, .. } => {
            ("auth_entry", entry_xdr.clone(), Some(address.clone()))
        }
        Artifact::Message(text) => ("message", STANDARD.encode(text.as_bytes()), None),
    };
    let mut body = Map::new();
    body.insert("kind".into(), json!(kind));
    if let Some(passphrase) = passphrase {
        body.insert("network_passphrase".into(), json!(passphrase));
    }
    body.insert("xdr".into(), json!(xdr));
    body.insert("signer".into(), json!(signer));
    if let Some(address) = address {
        body.insert("address".into(), json!(address));
    }
    if let Some(origin) = origin {
        body.insert("origin".into(), json!(origin));
    }
    body.insert("request_id".into(), json!(request_id));
    Request { request_id, body: Value::Object(body) }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Code {
    pub code: String,
    pub source: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    pub score_id: String,
    pub request_id: String,
    pub vetoes: Vec<Code>,
    pub reasons: Vec<Code>,
}

/// The gate result. Phase 0 has no approval: `escalate` continues as before, and `deny` stops.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Escalate(Verdict),
    Deny(Verdict),
    /// A short code: `unreachable`, `timeout`, `http_<status>`, `bad_response`, or `unexpected_decision`.
    Error(String),
}

fn codes_json(codes: &[Code]) -> Value {
    Value::Array(codes.iter().map(|c| json!({ "code": c.code, "source": c.source })).collect())
}

impl Outcome {
    /// The `risk` object of the output.
    pub fn json(&self) -> Value {
        let (decision, v) = match self {
            Outcome::Escalate(v) => ("escalate", v),
            Outcome::Deny(v) => ("deny", v),
            Outcome::Error(code) => return json!({ "error": code }),
        };
        json!({
            "decision": decision,
            "score_id": v.score_id,
            "request_id": v.request_id,
            "vetoes": codes_json(&v.vetoes),
            "reasons": codes_json(&v.reasons),
        })
    }

    /// The scorer's request ID, for the answer label. A failed score has none.
    pub fn request_id(&self) -> Option<&str> {
        match self {
            Outcome::Escalate(v) | Outcome::Deny(v) => Some(&v.request_id),
            Outcome::Error(_) => None,
        }
    }

    /// The `risk_denied` error of a denial.
    pub fn denial(&self) -> Option<Error> {
        let Outcome::Deny(v) = self else { return None };
        let vetoes: Vec<&str> = v.vetoes.iter().map(|c| c.code.as_str()).collect();
        let vetoes = if vetoes.is_empty() { "none".to_owned() } else { vetoes.join(", ") };
        Some(Error::new(
            "risk_denied",
            format!("The risk scorer denied this request. Vetoes: {vetoes}. Score ID: {}.", v.score_id),
        ))
    }
}

/// A response string that is safe to print without escapes.
fn safe(text: &str) -> bool {
    (1..=MAX_TEXT).contains(&text.len())
        && text.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
}

/// Read a score response. Every field is untrusted. A malformed field makes the whole response `bad_response`.
fn parse(bytes: &[u8], sent: &str) -> Outcome {
    let bad = || Outcome::Error("bad_response".into());
    let Some(object) = std::str::from_utf8(bytes).ok().and_then(crate::json::strict_object) else {
        return bad();
    };
    let deny = match object.get("decision").and_then(Value::as_str) {
        Some("deny") => true,
        Some("escalate") => false,
        _ => return Outcome::Error("unexpected_decision".into()),
    };
    let text = |name: &str| object.get(name).and_then(Value::as_str).filter(|t| safe(t)).map(str::to_owned);
    let codes = |name: &str| -> Option<Vec<Code>> {
        let items = object.get(name)?.as_array()?;
        if items.len() > MAX_CODES {
            return None;
        }
        items
            .iter()
            .map(|item| {
                let field =
                    |n: &str| item.get(n).and_then(Value::as_str).filter(|t| safe(t)).map(str::to_owned);
                Some(Code { code: field("code")?, source: field("source")? })
            })
            .collect()
    };
    let (Some(score_id), Some(request_id), Some(vetoes), Some(reasons)) =
        (text("score_id"), text("request_id"), codes("vetoes"), codes("reasons"))
    else {
        return bad();
    };
    if request_id != sent {
        return bad();
    }
    let verdict = Verdict { score_id, request_id, vetoes, reasons };
    if deny { Outcome::Deny(verdict) } else { Outcome::Escalate(verdict) }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn configured(url: Option<&str>, token: Option<&str>) -> Result<Option<Gate>> {
        configure(url.map(OsString::from), token.map(OsString::from))
    }

    #[test]
    fn the_gate_needs_both_variables_an_https_url_and_a_long_token() {
        assert!(configured(None, None).unwrap().is_none());
        let gate = configured(Some("https://scorer.example/"), Some(TOKEN)).unwrap().unwrap();
        assert_eq!(gate.base, "https://scorer.example");
        assert!(!format!("{gate:?}").contains(TOKEN));
        let short = &TOKEN[1..];
        for (url, token) in [
            (Some("https://scorer.example"), None),
            (None, Some(TOKEN)),
            (Some("http://scorer.example"), Some(TOKEN)),
            (Some("https://user:pass@scorer.example"), Some(TOKEN)),
            (Some("https://scorer.example/?token=x"), Some(TOKEN)),
            (Some("https://scorer.example/#x"), Some(TOKEN)),
            (Some("scorer.example"), Some(TOKEN)),
            (Some(""), Some(TOKEN)),
            (Some("https://scorer.example"), Some(short)),
            (Some("https://scorer.example"), Some("0123456789abcdef 0123456789abcdef")),
            (Some("https://scorer.example"), Some("")),
        ] {
            let e = configured(url, token).unwrap_err();
            assert_eq!(e.code, "invalid_config", "{url:?}");
            assert!(!e.message.contains(TOKEN) && !e.message.contains(short));
        }
    }

    fn response(decision: &str, request_id: &str) -> Vec<u8> {
        json!({
            "request_id": request_id, "score_id": "4f1c-a", "decision": decision, "would_approve": null,
            "reasons": [{ "code": "PHASE0_ADVISORY_ONLY", "source": "service" }],
            "vetoes": [{ "code": "PREIMAGE_NETWORK_MISMATCH", "source": "service" }],
            "evidence": {}, "versions": {}, "latency_ms": 1,
        })
        .to_string()
        .into_bytes()
    }

    #[test]
    fn only_escalate_and_deny_are_verdicts() {
        let deny = parse(&response("deny", "r1"), "r1");
        assert_eq!(deny.request_id(), Some("r1"));
        let error = deny.denial().unwrap();
        assert_eq!(error.code, "risk_denied");
        assert!(error.message.contains("PREIMAGE_NETWORK_MISMATCH") && error.message.contains("4f1c-a"));
        assert_eq!(deny.json()["vetoes"][0]["source"], "service");
        assert!(matches!(parse(&response("escalate", "r1"), "r1"), Outcome::Escalate(_)));
        for decision in ["approve", "ESCALATE", ""] {
            assert_eq!(parse(&response(decision, "r1"), "r1"), Outcome::Error("unexpected_decision".into()));
        }
        assert_eq!(parse(&response("deny", "r2"), "r1"), Outcome::Error("bad_response".into()));
        assert_eq!(parse(b"not json", "r1"), Outcome::Error("bad_response".into()));
        let mut odd: Value = serde_json::from_slice(&response("deny", "r1")).unwrap();
        odd["vetoes"][0]["code"] = json!("\u{202e}EVIL");
        assert_eq!(parse(odd.to_string().as_bytes(), "r1"), Outcome::Error("bad_response".into()));
        let duplicate = br#"{"decision":"escalate","decision":"deny"}"#;
        assert_eq!(parse(duplicate, "r1"), Outcome::Error("bad_response".into()));
        assert_eq!(Outcome::Error("timeout".into()).json(), json!({ "error": "timeout" }));
    }

    #[test]
    fn the_request_holds_only_the_listed_fields() {
        let message = request(&Artifact::Message("hi".into()), None, "GKEY", &Value::Null, None);
        let body = message.body().as_object().unwrap();
        let keys: Vec<&str> = body.keys().map(String::as_str).collect();
        assert_eq!(keys.len(), 4);
        assert_eq!(body["xdr"], "aGk=");
        assert_eq!(body["request_id"], json!(message.request_id));
        let preimage = request(
            &Artifact::Preimage("AAAA".into()),
            Some("Test SDF Network ; September 2015"),
            "GKEY",
            &json!({ "address": "CADDR", "digest": "x" }),
            Some("https://site.example"),
        );
        let mut keys: Vec<&str> = preimage.body().as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, ["address", "kind", "network_passphrase", "origin", "request_id", "signer", "xdr"]);
        assert_eq!(preimage.body()["kind"], "preimage");
        assert_ne!(preimage.request_id, message.request_id);
    }
}
