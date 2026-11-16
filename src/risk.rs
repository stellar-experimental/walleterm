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
use serde::de::{Deserialize, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value, json};

use crate::artifact::Artifact;
use crate::error::{Error, Result};

pub const URL_VARIABLE: &str = "WALLETERM_RISK_URL";
pub const TOKEN_VARIABLE: &str = "WALLETERM_RISK_TOKEN";
/// The scorer refuses a shorter token.
const MIN_TOKEN: usize = 32;
const MAX_TOKEN: usize = 4096;
/// One hard limit for a score: connection, request, response, and body.
const SCORE_TIMEOUT: Duration = Duration::from_secs(5);
/// One hard limit for a best-effort answer label.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_RESPONSE: usize = 1024 * 1024;
/// Response strings are untrusted. Each one is 1–128 characters from a small set.
const MAX_TEXT: usize = 128;
/// At most this many vetoes and this many reasons.
const MAX_CODES: usize = 64;
/// Walleterm marks its own reasons with this source. A scorer code cannot use it.
const OWN_SOURCE: &str = "walleterm";

type ScorerClient = Client<HttpsConnector<HttpConnector>, Full<Bytes>>;

/// A configured scorer. `Debug` shows neither the URL nor the token.
pub struct Gate {
    base: String,
    host: String,
    authorization: HeaderValue,
    client: ScorerClient,
}

impl fmt::Debug for Gate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Gate").finish_non_exhaustive()
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
    let Some((url, host)) = url.and_then(|u| Some((u.clone(), u.host_str()?.to_owned()))) else {
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
    Gate::new(url.as_str().trim_end_matches('/'), host, &token, true).map(Some)
}

impl Gate {
    fn new(base: &str, host: String, token: &str, https_only: bool) -> Result<Self> {
        let mut authorization = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|_| config("WALLETERM_RISK_TOKEN must have 32 to 4096 visible ASCII characters."))?;
        authorization.set_sensitive(true);
        let mut http = HttpConnector::new();
        http.enforce_http(false);
        let tls = native_tls::TlsConnector::new()
            .map_err(|_| Error::new("internal", "TLS is unavailable for the risk scorer."))?;
        let mut https = HttpsConnector::from((http, tls.into()));
        https.https_only(https_only);
        // Hyper follows no redirect and reads no proxy setting.
        let client = Client::builder(TokioExecutor::new()).pool_timer(TokioTimer::new()).build(https);
        Ok(Self { base: base.to_owned(), host, authorization, client })
    }

    /// A gate for a plain HTTP scorer on loopback. Only tests and the test host build it.
    /// No environment variable selects it.
    #[cfg(any(test, feature = "test-host"))]
    #[doc(hidden)]
    pub fn loopback(port: u16, token: &str) -> Result<Self> {
        Self::new(&format!("http://127.0.0.1:{port}"), "127.0.0.1".into(), token, false)
    }

    /// The scorer host name. Terminal notices show it. The path can hold a secret, so nothing shows the path.
    pub fn host(&self) -> &str {
        &self.host
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
                .map_err(|too_large| if too_large { "too_large" } else { "bad_response" }.to_owned())
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

    /// Record an answer as a label. Best effort: a failure changes nothing.
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

/// Build the score request for a checked artifact. `details` is the inspection detail of the artifact.
/// `hash` is the lowercase hexadecimal digest that 1Password signs.
/// A message travels as Base64 of its exact bytes. An entry and a preimage add their address.
/// An entry adds its full adapter object.
pub fn request(
    artifact: &Artifact,
    passphrase: Option<&str>,
    signer: &str,
    details: &Value,
    hash: &str,
    origin: Option<&str>,
) -> Request {
    let request_id = crate::util::uuid();
    let (kind, xdr, address, adapter) = match artifact {
        Artifact::Transaction(xdr) => ("transaction", xdr.clone(), None, None),
        Artifact::Preimage(xdr) => {
            ("preimage", xdr.clone(), details["address"].as_str().map(str::to_owned), None)
        }
        Artifact::Authorization { entry_xdr, address, adapter } => {
            ("auth_entry", entry_xdr.clone(), Some(address.clone()), Some(adapter.clone()))
        }
        Artifact::Message(text) => ("message", STANDARD.encode(text.as_bytes()), None, None),
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
    if let Some(adapter) = adapter {
        body.insert("adapter".into(), adapter);
    }
    body.insert("hash".into(), json!(hash));
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
    pub vetoes: Vec<Code>,
    pub reasons: Vec<Code>,
}

/// The gate result. Phase 0 has no approval: `escalate` continues as before, and `deny` stops.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Escalate(Verdict),
    Deny(Verdict),
    /// A short code: `unreachable`, `timeout`, `http_<status>`, `too_large`, `bad_response`, or
    /// `unexpected_decision`.
    Error(String),
}

fn codes_json(codes: &[Code]) -> Value {
    Value::Array(codes.iter().map(|c| json!({ "code": c.code, "source": c.source })).collect())
}

impl Outcome {
    /// The `risk` object of the output. `request_id` is the ID that walleterm sent.
    pub fn json(&self, request_id: &str) -> Value {
        let (decision, v) = match self {
            Outcome::Escalate(v) => ("escalate", v),
            Outcome::Deny(v) => ("deny", v),
            Outcome::Error(code) => return json!({ "error": code }),
        };
        json!({
            "decision": decision,
            "score_id": v.score_id,
            "request_id": request_id,
            "vetoes": codes_json(&v.vetoes),
            "reasons": codes_json(&v.reasons),
        })
    }

    /// The scorer gave a verdict. Only a scored request gets an answer label.
    pub fn scored(&self) -> bool {
        !matches!(self, Outcome::Error(_))
    }

    /// The `risk_denied` error of a denial, with the vetoes and the score ID. Only local output shows it.
    pub fn denial(&self) -> Option<Error> {
        let Outcome::Deny(v) = self else { return None };
        let vetoes: Vec<&str> = v.vetoes.iter().map(|c| c.code.as_str()).collect();
        let vetoes = if vetoes.is_empty() { "none".to_owned() } else { vetoes.join(", ") };
        let score_id = if v.score_id.is_empty() { "none" } else { &v.score_id };
        Some(Error::new("risk_denied", format!("{DENIED} Vetoes: {vetoes}. Score ID: {score_id}.")))
    }
}

/// The denial message for a website. It names no veto and no score ID.
pub const DENIED: &str = "The risk scorer denied this request.";

/// The reason that marks a denial with malformed fields.
const MALFORMED: &str = "RISK_RESPONSE_MALFORMED";

/// A response string that is safe to print without escapes.
fn safe(text: &str) -> bool {
    (1..=MAX_TEXT).contains(&text.len())
        && text.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
}

/// A JSON value, or `None` when an object inside it repeats a key.
struct Strict(Option<Value>);

impl<'de> Deserialize<'de> for Strict {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        deserializer.deserialize_any(Strict(None))
    }
}

impl<'de> Visitor<'de> for Strict {
    type Value = Strict;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("JSON")
    }
    fn visit_bool<E>(self, b: bool) -> std::result::Result<Self, E> {
        Ok(Strict(Some(Value::Bool(b))))
    }
    fn visit_i64<E>(self, n: i64) -> std::result::Result<Self, E> {
        Ok(Strict(Some(n.into())))
    }
    fn visit_u64<E>(self, n: u64) -> std::result::Result<Self, E> {
        Ok(Strict(Some(n.into())))
    }
    fn visit_f64<E>(self, n: f64) -> std::result::Result<Self, E> {
        Ok(Strict(Some(n.into())))
    }
    fn visit_str<E>(self, s: &str) -> std::result::Result<Self, E> {
        Ok(Strict(Some(s.into())))
    }
    fn visit_unit<E>(self) -> std::result::Result<Self, E> {
        Ok(Strict(Some(Value::Null)))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<Self, A::Error> {
        let (mut items, mut clean) = (Vec::new(), true);
        while let Some(Strict(item)) = seq.next_element()? {
            match item {
                Some(item) => items.push(item),
                None => clean = false,
            }
        }
        Ok(Strict(clean.then_some(Value::Array(items))))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> std::result::Result<Self, A::Error> {
        let (mut object, mut clean) = (Map::new(), true);
        while let Some(key) = map.next_key::<String>()? {
            let Strict(value) = map.next_value()?;
            match value {
                Some(value) if !object.contains_key(&key) => {
                    object.insert(key, value);
                }
                _ => clean = false,
            }
        }
        Ok(Strict(clean.then_some(Value::Object(object))))
    }
}

/// The top-level fields that walleterm reads, in order. A repeated key keeps each value.
/// The parse skips every other field unread, so its size, depth, and repeated keys change nothing.
#[derive(Default)]
struct Response(Vec<(&'static str, Option<Value>)>);

const READ: [&str; 5] = ["decision", "request_id", "score_id", "vetoes", "reasons"];

impl<'de> Deserialize<'de> for Response {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        deserializer.deserialize_map(Response::default())
    }
}

impl<'de> Visitor<'de> for Response {
    type Value = Response;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a JSON object")
    }
    fn visit_map<A: MapAccess<'de>>(mut self, mut map: A) -> std::result::Result<Self, A::Error> {
        while let Some(key) = map.next_key::<String>()? {
            match READ.iter().find(|name| **name == key) {
                Some(name) => self.0.push((*name, map.next_value::<Strict>()?.0)),
                None => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(self)
    }
}

impl Response {
    fn all(&self, name: &str) -> Vec<Option<&Value>> {
        self.0.iter().filter(|(n, _)| *n == name).map(|(_, v)| v.as_ref()).collect()
    }

    /// A safe string field that appears once.
    fn text(&self, name: &str) -> Option<String> {
        match self.all(name)[..] {
            [Some(Value::String(text))] if safe(text) => Some(text.clone()),
            _ => None,
        }
    }

    /// The valid codes of a list, at most 64, and whether the list was one clean array.
    /// A scorer code with the source `walleterm` is not valid.
    fn codes(&self, name: &str) -> (Vec<Code>, bool) {
        let values = self.all(name);
        let items: Vec<&Value> = values.iter().flatten().filter_map(|v| v.as_array()).flatten().collect();
        let valid: Vec<Code> = items
            .iter()
            .filter_map(|item| {
                let field =
                    |n: &str| item.get(n).and_then(Value::as_str).filter(|t| safe(t)).map(str::to_owned);
                Some(Code { code: field("code")?, source: field("source").filter(|s| s != OWN_SOURCE)? })
            })
            .take(MAX_CODES)
            .collect();
        let clean = matches!(values[..], [Some(Value::Array(_))]) && valid.len() == items.len();
        (valid, clean)
    }
}

/// Read a score response. Every field is untrusted.
/// A malformed field makes an escalation `bad_response`. Any `deny` stops, even a repeated `decision` that also
/// says `escalate`. A malformed denial keeps the valid codes, at most 64 of each, and adds the reason
/// `RISK_RESPONSE_MALFORMED` from `walleterm`.
fn parse(bytes: &[u8], sent: &str) -> Outcome {
    let bad = || Outcome::Error("bad_response".into());
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let Ok(response) = serde_json::from_slice::<Response>(bytes) else { return bad() };
    let decisions = response.all("decision");
    let deny = decisions.contains(&Some(&Value::String("deny".into())));
    if !deny {
        match decisions[..] {
            [Some(Value::String(d))] if d == "escalate" => {}
            [] | [_] => return Outcome::Error("unexpected_decision".into()),
            _ => return bad(),
        }
    }
    let (vetoes, clean_vetoes) = response.codes("vetoes");
    let (mut reasons, clean_reasons) = response.codes("reasons");
    let score_id = response.text("score_id");
    let request_id = response.text("request_id").filter(|id| id == sent);
    if let (Some(score_id), Some(_), true, true, 1) =
        (&score_id, request_id, clean_vetoes, clean_reasons, decisions.len())
    {
        let verdict = Verdict { score_id: score_id.clone(), vetoes, reasons };
        return if deny { Outcome::Deny(verdict) } else { Outcome::Escalate(verdict) };
    }
    if !deny {
        return bad();
    }
    // A malformed denial still stops. Keep what is valid and say that the rest was not.
    reasons.truncate(MAX_CODES - 1);
    reasons.push(Code { code: MALFORMED.into(), source: OWN_SOURCE.into() });
    Outcome::Deny(Verdict { score_id: score_id.unwrap_or_default(), vetoes, reasons })
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
        let gate = configured(Some("https://scorer.example/secret-path/"), Some(TOKEN)).unwrap().unwrap();
        assert_eq!(gate.base, "https://scorer.example/secret-path");
        assert_eq!(gate.host(), "scorer.example", "the host only, never the path");
        let shown = format!("{gate:?}");
        assert!(!shown.contains(TOKEN) && !shown.contains("scorer.example"), "{shown}");
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

    fn response(decision: &str, request_id: &str) -> Value {
        json!({
            "request_id": request_id, "score_id": "4f1c-a", "decision": decision, "would_approve": null,
            "reasons": [{ "code": "PHASE0_ADVISORY_ONLY", "source": "service" }],
            "vetoes": [{ "code": "PREIMAGE_NETWORK_MISMATCH", "source": "service" }],
            "evidence": {}, "versions": {}, "latency_ms": 1,
        })
    }

    fn parsed(value: &Value) -> Outcome {
        parse(value.to_string().as_bytes(), "r1")
    }

    #[test]
    fn only_escalate_and_deny_are_verdicts() {
        let deny = parsed(&response("deny", "r1"));
        assert!(deny.scored());
        let error = deny.denial().unwrap();
        assert_eq!(error.code, "risk_denied");
        assert!(error.message.contains("PREIMAGE_NETWORK_MISMATCH") && error.message.contains("4f1c-a"));
        assert_eq!(deny.json("r1")["vetoes"][0]["source"], "service");
        assert_eq!(deny.json("r1")["request_id"], "r1");
        assert!(matches!(parsed(&response("escalate", "r1")), Outcome::Escalate(_)));
        for decision in ["approve", "ESCALATE", ""] {
            assert_eq!(parsed(&response(decision, "r1")), Outcome::Error("unexpected_decision".into()));
        }
        assert_eq!(parsed(&response("escalate", "r2")), Outcome::Error("bad_response".into()));
        assert_eq!(parse(b"not json", "r1"), Outcome::Error("bad_response".into()));
        assert_eq!(parse(b"[]", "r1"), Outcome::Error("bad_response".into()));
        let mut odd = response("escalate", "r1");
        odd["vetoes"] = json!([{ "code": "\u{202e}EVIL", "source": "T0" }]);
        assert_eq!(parsed(&odd), Outcome::Error("bad_response".into()));
        let twice = br#"{"decision":"escalate","decision":"escalate"}"#;
        assert_eq!(parse(twice, "r1"), Outcome::Error("bad_response".into()));
        assert!(!Outcome::Error("timeout".into()).scored());
        assert_eq!(Outcome::Error("timeout".into()).json("r1"), json!({ "error": "timeout" }));
    }

    #[test]
    fn unread_fields_change_nothing() {
        // Oversize, repeated, or deeply nested content in a field that walleterm never reads.
        let mut big = response("deny", "r1");
        big["evidence"] = json!({ "trace": "x".repeat(900 * 1024) });
        assert!(big.to_string().len() > 64 * 1024 && big.to_string().len() < MAX_RESPONSE);
        assert!(matches!(parsed(&big), Outcome::Deny(ref v) if v.score_id == "4f1c-a"));
        let text = response("deny", "r1").to_string();
        let repeated = text.replacen("\"evidence\":{}", r#""evidence":{"a":1,"a":{"b":2,"b":3}}"#, 1);
        assert_ne!(repeated, text);
        assert_eq!(parse(repeated.as_bytes(), "r1"), parsed(&response("deny", "r1")));
        let top = text.replacen("\"versions\":{}", r#""versions":{},"versions":[1]"#, 1);
        assert_eq!(parse(top.as_bytes(), "r1"), parsed(&response("deny", "r1")));
        let mut bom = b"\xEF\xBB\xBF".to_vec();
        bom.extend_from_slice(text.as_bytes());
        assert_eq!(parse(&bom, "r1"), parsed(&response("deny", "r1")));
    }

    fn flagged(o: &Outcome) -> Verdict {
        let Outcome::Deny(v) = o else { panic!("{o:?}") };
        assert_eq!(v.reasons.last().unwrap(), &Code { code: MALFORMED.into(), source: OWN_SOURCE.into() });
        v.clone()
    }

    #[test]
    fn any_deny_stops_even_beside_a_repeated_decision() {
        for body in [
            r#"{"decision":"escalate","decision":"deny"}"#,
            r#"{"decision":"deny","decision":"escalate"}"#,
            r#"{"decision":"deny","decision":"approve"}"#,
            r#"{"decision":"deny","decision":"deny"}"#,
        ] {
            flagged(&parse(body.as_bytes(), "r1"));
        }
        let text = response("escalate", "r1").to_string();
        flagged(&parse(text.replacen('{', r#"{"decision":"deny","#, 1).as_bytes(), "r1"));
    }

    #[test]
    fn a_scorer_code_cannot_claim_the_walleterm_source() {
        let mut escalate = response("escalate", "r1");
        escalate["reasons"] = json!([{ "code": "LOCAL_CHECKS_PASSED", "source": "walleterm" }]);
        assert_eq!(parsed(&escalate), Outcome::Error("bad_response".into()));
        let mut deny = response("deny", "r1");
        deny["reasons"] =
            json!([{ "code": MALFORMED, "source": "walleterm" }, { "code": "OK", "source": "T0" }]);
        let v = flagged(&parsed(&deny));
        assert_eq!(v.reasons[0], Code { code: "OK".into(), source: "T0".into() });
        assert_eq!(v.reasons.len(), 2);
    }

    #[test]
    fn a_malformed_deny_still_denies() {
        let malformed = |change: &dyn Fn(&mut Value)| {
            let mut value = response("deny", "r1");
            change(&mut value);
            parsed(&value)
        };
        flagged(&malformed(&|v| v["request_id"] = json!("r2")));
        let v = flagged(&malformed(&|v| v["score_id"] = json!("bad id")));
        assert_eq!(v.score_id, "");
        assert!(
            malformed(&|v| v["score_id"] = json!(null)).denial().unwrap().message.contains("Score ID: none.")
        );
        let v = flagged(&malformed(&|v| {
            v["vetoes"] =
                json!([{ "code": "\u{202e}EVIL", "source": "T0" }, { "code": "OK_CODE", "source": "T0" }])
        }));
        assert_eq!(v.vetoes, [Code { code: "OK_CODE".into(), source: "T0".into() }]);
        let many: Vec<Value> = (0..100).map(|i| json!({ "code": format!("C{i}"), "source": "T0" })).collect();
        let v = flagged(&malformed(&|v| {
            v["vetoes"] = json!(many);
            v["reasons"] = json!(many);
        }));
        assert_eq!((v.vetoes.len(), v.reasons.len()), (64, 64));
        flagged(&malformed(&|v| {
            v.as_object_mut().unwrap().remove("vetoes");
        }));
        // A repeated key inside a list that walleterm reads makes it malformed.
        let text = response("deny", "r1").to_string();
        let inner = text.replacen(r#""source":"service"}]"#, r#""source":"service","code":"X"}]"#, 1);
        assert_ne!(inner, text);
        flagged(&parse(inner.as_bytes(), "r1"));
    }

    #[test]
    fn the_request_holds_only_the_listed_fields() {
        let message = request(&Artifact::Message("hi".into()), None, "GKEY", &Value::Null, "ab", None);
        let body = message.body.as_object().unwrap();
        let keys: Vec<&str> = body.keys().map(String::as_str).collect();
        assert_eq!(keys.len(), 5);
        assert_eq!(body["hash"], "ab");
        assert_eq!(body["xdr"], "aGk=");
        assert_eq!(body["request_id"], json!(message.request_id));
        let preimage = request(
            &Artifact::Preimage("AAAA".into()),
            Some("Test SDF Network ; September 2015"),
            "GKEY",
            &json!({ "address": "CADDR", "digest": "x" }),
            "cd",
            Some("https://site.example"),
        );
        let mut keys: Vec<&str> = preimage.body.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(
            keys,
            ["address", "hash", "kind", "network_passphrase", "origin", "request_id", "signer", "xdr"]
        );
        let adapter = json!({ "type": "openzeppelin-ed25519", "verifier": "CVER", "context_rule_ids": [0] });
        let entry = request(
            &Artifact::Authorization {
                entry_xdr: "AAAA".into(),
                address: "CACC".into(),
                adapter: adapter.clone(),
            },
            Some("Test SDF Network ; September 2015"),
            "GKEY",
            &Value::Null,
            "ef",
            None,
        );
        assert_eq!(entry.body["kind"], "auth_entry");
        assert_eq!(entry.body["adapter"], adapter, "the full adapter, so the scorer can recompute the hash");
        assert_eq!(entry.body["address"], "CACC");
        assert_eq!(entry.body["hash"], "ef");
        assert_eq!(preimage.body["kind"], "preimage");
        assert_ne!(preimage.request_id, message.request_id);
    }
}
