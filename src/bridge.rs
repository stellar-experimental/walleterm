//! Bridge protocol version 3 (`docs/BRIDGE-PROTOCOL.md`): sessions, wallet grants, selection revisions,
//! and one signing queue. State stays in memory under one mutex that no await ever holds.
//! The shared core (`artifact.rs`) checks and finishes each artifact. This module adds only the website rules.

use std::collections::{HashMap, HashSet};
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{Map, Value, json};
use subtle::ConstantTimeEq;
use tokio::sync::{Notify, OnceCell, mpsc};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::artifact::{self, Artifact, Signed};
use crate::cancel::Cancel;
use crate::error::{Error, Result};
use crate::transaction::{TESTNET, signer_role};
use crate::util::{hex, iso_millis, lower_hex, random_below, token, uuid};

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

pub const PROTOCOL: u32 = 3;
const CODE_LIFETIME_MS: u64 = 300_000;
const CODE_LOCKOUT_MS: u64 = 60_000;
const UNSELECTED_SESSION_MS: u64 = 300_000;
const SELECTED_SESSION_MS: u64 = 3_600_000;
const REQUEST_MS: u64 = 300_000;
const MAX_SESSIONS: usize = 64;
const MAX_ACTIVE: usize = 32;
const MAX_PER_SESSION: usize = 1000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SignerInfo {
    pub public_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReviewRequest {
    pub origin: String,
    pub signer: SignerInfo,
    pub details: Value,
}

pub type ListFn = dyn Fn(Cancel) -> BoxFuture<Result<Vec<SignerInfo>>> + Send + Sync;
/// Signs a public key's digest. Returns the raw signature as lowercase hexadecimal.
pub type SignFn = dyn Fn(String, [u8; 32], Cancel) -> BoxFuture<Result<String>> + Send + Sync;
pub type ReviewFn = dyn Fn(ReviewRequest, Cancel) -> BoxFuture<Result<bool>> + Send + Sync;
type Listing = Arc<OnceCell<Result<Vec<SignerInfo>>>>;

/// Everything the bridge reaches outside its own memory. Tests replace each one.
pub struct Deps {
    pub list_signers: Box<ListFn>,
    /// The bridge verifies each returned signature independently.
    pub sign: Box<SignFn>,
    /// The approval hook. `None` approves every structurally valid request.
    pub review: Option<Box<ReviewFn>>,
    pub log: Box<dyn Fn(&str) + Send + Sync>,
    /// Unix milliseconds.
    pub now: Box<dyn Fn() -> u64 + Send + Sync>,
}

/// A failed HTTP request: its status and SEP-43 error object.
#[derive(Debug, Clone, PartialEq)]
pub struct Fail {
    pub status: u16,
    pub error: Value,
}

/// SEP-43 codes and default HTTP statuses for each stable reason.
fn reason_info(reason: &str) -> Option<(i32, u16)> {
    Some(match reason {
        "not_connected" => (-3, 401),
        "network_unsupported" | "address_mismatch" | "invalid_request" | "unsupported" => (-3, 400),
        "conflict" | "expired" => (-3, 409),
        "rate_limited" => (-3, 429),
        "rejected" => (-4, 409),
        "bridge_unavailable" => (-2, 503),
        "result_unknown" => (-1, 502),
        "internal" => (-1, 500),
        _ => return None,
    })
}

/// The SEP-43 object for an error code. `invalid_input` becomes `invalid_request`; unknown codes are internal.
pub fn sep43(error: &Error, request_state: Option<RequestState>) -> Value {
    let reason = match error.code {
        "invalid_input" => "invalid_request",
        code if reason_info(code).is_some() => code,
        _ => "internal",
    };
    let (reason, code) = if request_state == Some(RequestState::Unknown) {
        ("result_unknown", -1)
    } else {
        (reason, reason_info(reason).unwrap().0)
    };
    let mut value = json!({ "code": code, "message": error.message, "ext": [format!("walleterm:{reason}")] });
    if let Some(state @ (RequestState::Denied | RequestState::Expired | RequestState::Unknown)) =
        request_state
    {
        value["requestState"] = json!(state.as_str());
    }
    value
}

pub fn fail(reason: &'static str, message: &str, status: Option<u16>) -> Fail {
    let error = Error::new(reason, message);
    Fail {
        status: status.unwrap_or_else(|| reason_info(reason).map_or(500, |i| i.1)),
        error: sep43(&error, None),
    }
}

/// An inspection error from the signing core as an HTTP failure.
fn rejected(e: Error) -> Fail {
    let status = match e.code {
        "invalid_input" => 400,
        code => reason_info(code).map_or(500, |i| i.1),
    };
    Fail { status, error: sep43(&e, None) }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestState {
    Pending,
    Approved,
    Signing,
    Signed,
    Denied,
    Expired,
    Unknown,
}

impl RequestState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Signing => "signing",
            Self::Signed => "signed",
            Self::Denied => "denied",
            Self::Expired => "expired",
            Self::Unknown => "unknown",
        }
    }
    fn active(self) -> bool {
        matches!(self, Self::Pending | Self::Approved | Self::Signing)
    }
    fn started(self) -> bool {
        matches!(self, Self::Signing | Self::Signed)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Scope {
    Selected,
    Available,
}

impl Scope {
    fn as_str(self) -> &'static str {
        if self == Scope::Selected { "selected" } else { "available" }
    }
}

struct Offer {
    id: String,
    keys: HashSet<String>,
}

struct Session {
    id: String,
    token: String,
    origin: String,
    public_key: Option<String>,
    scope: Scope,
    selection_revision: u64,
    allowed: Option<HashSet<String>>,
    expires: u64,
    revoked: bool,
    canceled: HashSet<String>,
    key: Option<SignerInfo>,
    offered: Option<Offer>,
}

/// The protocol name of each request kind.
fn kind(artifact: &Artifact) -> &'static str {
    match artifact {
        Artifact::Transaction(_) => "transaction",
        Artifact::Preimage(_) => "auth_entry",
        Artifact::Authorization { .. } => "authorization",
        Artifact::Message(_) => "message",
    }
}

struct Record {
    seq: u64,
    record_id: String,
    session_id: String,
    origin: String,
    id: String,
    public_key: String,
    signer: SignerInfo,
    artifact: Artifact,
    network_passphrase: String,
    /// The request without its ID, with numbers normalized. An identical retry must match it.
    identity: Value,
    details: Value,
    hash: String,
    expires: u64,
    state: RequestState,
    logged: Option<RequestState>,
    delivered: bool,
    result: Option<(&'static str, String)>,
    error: Option<Value>,
}

struct Pairing {
    code: String,
    expires: u64,
    attempts: u32,
    locked_until: u64,
}

struct State {
    sessions: HashMap<String, Session>,
    tokens: HashMap<String, String>,
    records: HashMap<String, Record>,
    reviews: HashMap<String, Cancel>,
    pairing: Pairing,
    origin: String,
    closing: bool,
    next_seq: u64,
}

pub struct Bridge {
    state: Mutex<State>,
    deps: Deps,
    global: Cancel,
    queue: mpsc::UnboundedSender<(String, String)>,
    listing: tokio::sync::Mutex<Option<Listing>>,
    pairing_changed: Mutex<Option<Box<dyn Fn() + Send + Sync>>>,
    pending_jobs: AtomicUsize,
    idle: Notify,
    timer_generation: AtomicU64,
    port: AtomicU64,
}

fn new_code() -> String {
    format!("{:08}", random_below(100_000_000))
}

fn equal(a: &str, b: &str) -> bool {
    a.len() == b.len() && bool::from(a.as_bytes().ct_eq(b.as_bytes()))
}

/// An exact HTTPS origin, or a loopback HTTP origin for development.
pub fn valid_origin(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else { return false };
    let serialized = url.origin().ascii_serialization();
    serialized == value
        && (url.scheme() == "https"
            || (url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))))
}

/// JavaScript integer semantics for comparison: a JSON number with an integral value compares as that integer.
fn normalize(value: &Value) -> Value {
    match value {
        Value::Number(n) if n.as_i64().is_none() && n.as_u64().is_none() => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 => json!(f as i64),
            _ => value.clone(),
        },
        Value::Array(items) => Value::Array(items.iter().map(normalize).collect()),
        Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), normalize(v))).collect()),
        _ => value.clone(),
    }
}

/// `Number.isSafeInteger` for a JSON value.
fn safe_integer(value: Option<&Value>) -> Option<u64> {
    match normalize(value?) {
        Value::Number(n) => n.as_u64().filter(|&v| v <= 9_007_199_254_740_991),
        _ => None,
    }
}

/// One request body: an object, parsed only when a route needs it.
pub type BodyReader = Box<dyn FnOnce() -> BoxFuture<std::result::Result<Vec<u8>, Fail>> + Send>;

pub struct HttpRequest {
    pub method: String,
    pub target: String,
    pub host: Option<String>,
    pub origin: Option<String>,
    pub authorization: Option<String>,
    pub content_type: Option<String>,
}

pub struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    /// A JSON body. `raw` sends bytes instead, with only the listed headers.
    pub body: Option<Value>,
    pub raw: Option<bytes::Bytes>,
}

impl Reply {
    /// A failure as a response, with the SEP-43 error under `error`.
    pub fn failure(fail: Fail) -> Self {
        Reply {
            status: fail.status,
            headers: Vec::new(),
            body: Some(json!({ "error": fail.error })),
            raw: None,
        }
    }
}

fn reply(status: u16, body: Value) -> std::result::Result<Reply, Fail> {
    Ok(Reply { status, headers: Vec::new(), body: Some(body), raw: None })
}

/// Read and parse a JSON object body. Invalid UTF-8 and duplicate keys fail.
async fn object(
    content_type: &Option<String>,
    read: BodyReader,
) -> std::result::Result<Map<String, Value>, Fail> {
    let json = content_type.as_deref().is_some_and(|t| {
        let lower = t.to_ascii_lowercase();
        lower == "application/json" || lower.starts_with("application/json;")
    });
    if !json {
        return Err(fail("invalid_request", "Use application/json.", Some(415)));
    }
    let bytes = read().await?;
    // A lossy conversion would sign replacement characters in place of the message bytes that the website sent.
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return Err(fail("invalid_request", "The request body must be valid UTF-8.", None));
    };
    match crate::json::strict_object(text) {
        Some(object) => Ok(object),
        None => Err(fail("invalid_request", "Send one JSON object.", None)),
    }
}

impl Bridge {
    /// Create the bridge and start its signing worker and code timer. `origin` starts as loopback.
    pub fn new(deps: Deps, port: u16) -> Arc<Self> {
        let (queue, mut jobs) = mpsc::unbounded_channel::<(String, String)>();
        let now = (deps.now)();
        let bridge = Arc::new(Self {
            state: Mutex::new(State {
                sessions: HashMap::new(),
                tokens: HashMap::new(),
                records: HashMap::new(),
                reviews: HashMap::new(),
                pairing: Pairing {
                    code: new_code(),
                    expires: now + CODE_LIFETIME_MS,
                    attempts: 0,
                    locked_until: 0,
                },
                origin: format!("http://127.0.0.1:{port}"),
                closing: false,
                next_seq: 0,
            }),
            deps,
            global: Cancel::new(),
            queue,
            listing: tokio::sync::Mutex::new(None),
            pairing_changed: Mutex::new(None),
            pending_jobs: AtomicUsize::new(0),
            idle: Notify::new(),
            timer_generation: AtomicU64::new(0),
            port: AtomicU64::new(u64::from(port)),
        });
        let worker = Arc::downgrade(&bridge);
        tokio::spawn(async move {
            while let Some((key, session_id)) = jobs.recv().await {
                let Some(bridge) = worker.upgrade() else { break };
                bridge.review_and_sign(&key, &session_id).await;
                if bridge.pending_jobs.fetch_sub(1, Ordering::SeqCst) == 1 {
                    bridge.idle.notify_waiters();
                }
            }
        });
        bridge.restart_code_timer();
        bridge
    }

    fn now(&self) -> u64 {
        (self.deps.now)()
    }

    fn log(&self, line: &str) {
        (self.deps.log)(line);
    }

    pub fn set_port(&self, port: u16) {
        self.port.store(u64::from(port), Ordering::SeqCst);
        let mut state = self.state.lock().unwrap();
        if state.origin.starts_with("http://127.0.0.1:") {
            state.origin = format!("http://127.0.0.1:{port}");
        }
    }

    pub fn set_public_origin(self: &Arc<Self>, value: &str) -> Result<()> {
        if !valid_origin(value) {
            return Err(Error::new("invalid_input", "Use an HTTPS or loopback origin."));
        }
        self.state.lock().unwrap().origin = value.to_owned();
        self.restart_code_timer();
        Ok(())
    }

    /// The QR payload: `{"walleterm":3,"url":...,"code":...,"expires_at":...}`.
    pub fn pairing(&self) -> Value {
        let state = self.state.lock().unwrap();
        json!({
            "walleterm": PROTOCOL,
            "url": state.origin,
            "code": state.pairing.code,
            "expires_at": iso_millis(state.pairing.expires as i64),
        })
    }

    pub fn on_pairing_changed(&self, callback: Box<dyn Fn() + Send + Sync>) {
        *self.pairing_changed.lock().unwrap() = Some(callback);
    }

    fn restart_code_timer(self: &Arc<Self>) {
        let generation = self.timer_generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.state.lock().unwrap().pairing.expires = self.now() + CODE_LIFETIME_MS;
        let bridge = Arc::downgrade(self);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(CODE_LIFETIME_MS)).await;
            if let Some(bridge) = bridge.upgrade()
                && bridge.timer_generation.load(Ordering::SeqCst) == generation
            {
                bridge.rotate_code();
            }
        });
    }

    fn rotate_code(self: &Arc<Self>) {
        {
            let mut state = self.state.lock().unwrap();
            state.pairing.code = new_code();
            state.pairing.attempts = 0;
        }
        self.restart_code_timer();
        if let Some(callback) = self.pairing_changed.lock().unwrap().as_ref() {
            callback();
        }
    }

    /// The terminal records each produced or withheld signature once per state.
    /// A signature that the bridge already sent was not withheld. Its later ending prints no line.
    fn log_result(&self, r: &mut Record) {
        if r.logged == Some(r.state) {
            return;
        }
        r.logged = Some(r.state);
        let about = match &r.artifact {
            Artifact::Transaction(_) => format!(
                "{} (account {}, sequence {})",
                r.hash,
                r.public_key,
                r.details["sequence"].as_str().unwrap_or_default()
            ),
            Artifact::Message(_) => format!("{} (signer {}, SEP-53 message)", r.hash, r.public_key),
            _ => format!(
                "{} (signer {}, authorization {})",
                r.hash,
                r.public_key,
                r.details["address"].as_str().unwrap_or_default()
            ),
        };
        match r.state {
            RequestState::Signed => self.log(&format!("Signed {about} for {}.\n", r.origin)),
            RequestState::Unknown if !r.delivered => {
                let message = r.error.as_ref().and_then(|e| e["message"].as_str()).unwrap_or_default();
                self.log(&format!("Signature withheld or stopped for {about}: {message}\n"));
            }
            _ => {}
        }
    }

    /// End a request with its SEP-43 error. A request that started signing always ends unknown.
    fn end(&self, r: &mut Record, mut state: RequestState, message: &str, error: Option<Value>) {
        let error = if r.state.started() {
            state = RequestState::Unknown;
            None
        } else {
            error
        };
        r.state = state;
        r.error = Some(match error {
            Some(mut e) => {
                e["requestState"] = json!(state.as_str());
                e
            }
            None => {
                let reason = match state {
                    RequestState::Unknown => "result_unknown",
                    RequestState::Expired => "expired",
                    _ => "rejected",
                };
                sep43(&Error::new(reason, message), Some(state))
            }
        });
        r.result = None;
        self.log_result(r);
    }

    fn end_key(
        &self,
        state: &mut State,
        key: &str,
        target: RequestState,
        message: &str,
        error: Option<Value>,
    ) {
        if let Some(mut r) = state.records.remove(key) {
            self.end(&mut r, target, message, error);
            state.records.insert(key.to_owned(), r);
        }
    }

    fn keys_in_order(state: &State, filter: impl Fn(&Record) -> bool) -> Vec<String> {
        let mut keys: Vec<(u64, String)> =
            state.records.iter().filter(|(_, r)| filter(r)).map(|(k, r)| (r.seq, k.clone())).collect();
        keys.sort();
        keys.into_iter().map(|(_, k)| k).collect()
    }

    /// Withhold or deny every live request of a session. Signing or signed requests become unknown.
    fn end_session_requests(&self, state: &mut State, session_id: &str, message: impl Fn(&Record) -> String) {
        let keys = Self::keys_in_order(state, |r| {
            r.session_id == session_id && (r.state.active() || r.state == RequestState::Signed)
        });
        for key in keys {
            let r = state.records.get(&key).unwrap();
            let target = if r.state.started() { RequestState::Unknown } else { RequestState::Denied };
            let (text, record_id) = (message(r), r.record_id.clone());
            self.end_key(state, &key, target, &text, None);
            if let Some(cancel) = state.reviews.get(&record_id) {
                cancel.abort();
            }
        }
    }

    fn revoke(&self, state: &mut State, session_id: &str) {
        if let Some(s) = state.sessions.get_mut(session_id) {
            s.revoked = true;
        }
        self.end_session_requests(state, session_id, |_| "The website connection was revoked.".into());
    }

    fn expire(&self, state: &mut State) {
        let now = self.now();
        let keys = Self::keys_in_order(state, |r| r.state == RequestState::Pending && now >= r.expires);
        for key in keys {
            self.end_key(state, &key, RequestState::Expired, "The signing request expired.", None);
            let record_id = state.records[&key].record_id.clone();
            if let Some(cancel) = state.reviews.get(&record_id) {
                cancel.abort();
            }
        }
        // Memory keeps live sessions and records that are active or belong to them.
        let ended: Vec<String> =
            state.sessions.values().filter(|s| s.revoked || now >= s.expires).map(|s| s.id.clone()).collect();
        for id in &ended {
            self.revoke(state, id);
            if let Some(s) = state.sessions.remove(id) {
                state.tokens.remove(&s.token);
            }
        }
        let live: HashSet<&String> = state.sessions.keys().collect();
        let stale: Vec<String> = state
            .records
            .iter()
            .filter(|(_, r)| !r.state.active() && !live.contains(&r.session_id))
            .map(|(k, _)| k.clone())
            .collect();
        for key in stale {
            state.records.remove(&key);
        }
    }

    fn session_live(&self, state: &State, id: &str) -> bool {
        state.sessions.get(id).is_some_and(|s| !s.revoked && self.now() < s.expires)
    }

    /// The caller's session was removed during an await, such as a body read.
    fn disconnected() -> Fail {
        fail("not_connected", "Connect this website with a new code from the tunnel terminal.", None)
    }

    /// The website's session: its bearer token, its connected Origin, not revoked, not expired.
    fn website(&self, state: &State, req: &HttpRequest) -> std::result::Result<String, Fail> {
        let presented = req.authorization.as_deref().unwrap_or_default();
        let presented = presented.strip_prefix("Bearer ").unwrap_or(presented);
        let session = state.tokens.get(presented).and_then(|id| state.sessions.get(id));
        match session {
            Some(s) if !s.revoked && req.origin.as_deref() == Some(&s.origin) && self.now() < s.expires => {
                Ok(s.id.clone())
            }
            _ => Err(Self::disconnected()),
        }
    }

    fn summary(r: &mut Record) -> Value {
        if r.state == RequestState::Signed {
            r.delivered = true;
        }
        let mut value = json!({
            "id": r.id,
            "kind": kind(&r.artifact),
            "state": r.state.as_str(),
            "hash": r.hash,
            "expires_at": iso_millis(r.expires as i64),
        });
        if let Some(error) = &r.error {
            value["error"] = error.clone();
        }
        if r.state == RequestState::Signed
            && let Some((field, artifact)) = &r.result
        {
            value["signer_address"] = json!(r.public_key);
            value[*field] = json!(artifact);
        }
        value
    }

    /// Concurrent website calls share one agent and vault lookup.
    async fn keys(&self) -> Result<Vec<SignerInfo>> {
        let cell = {
            let mut slot = self.listing.lock().await;
            slot.get_or_insert_with(|| Arc::new(OnceCell::new())).clone()
        };
        let result = cell.get_or_init(|| (self.deps.list_signers)(self.global.clone())).await.clone();
        let mut slot = self.listing.lock().await;
        if slot.as_ref().is_some_and(|current| Arc::ptr_eq(current, &cell)) {
            *slot = None;
        }
        drop(slot);
        // Shutdown waits for this lookup and its cleanup to end.
        self.idle.notify_waiters();
        result
    }

    /// Verify and attach with the scope of the last check before signing. Returns the result field and value.
    fn finish(
        artifact: &Artifact,
        passphrase: &str,
        key: &str,
        now: u64,
        signature: &str,
    ) -> Result<(&'static str, String)> {
        let Some(raw) = lower_hex::<64>(signature) else {
            return Err(Error::new("internal", "The signer returned an invalid signature."));
        };
        let scope = artifact::Scope { key, passphrase: Some(passphrase), now_ms: now };
        Ok(match (artifact::finish(artifact, &scope, &raw)?, artifact) {
            (Signed::Transaction(xdr), _) => ("signed_tx_xdr", xdr),
            (Signed::AuthEntry(xdr), _) => ("signed_auth_entry_xdr", xdr),
            (Signed::Raw, Artifact::Message(_)) => ("signed_message", STANDARD.encode(raw)),
            (Signed::Raw, _) => ("signed_auth_entry", STANDARD.encode(raw)),
        })
    }

    /// Review, then sign one request. One job runs at a time. Every await is followed by a fresh check.
    async fn review_and_sign(self: &Arc<Self>, key: &str, session_id: &str) {
        let setup = {
            let mut state = self.state.lock().unwrap();
            self.expire(&mut state);
            let now = self.now();
            let session_expires = state.sessions.get(session_id).map_or(0, |s| s.expires);
            let live = !state.closing && self.session_live(&state, session_id);
            match state.records.get(key) {
                Some(r) if r.state == RequestState::Pending && live => {
                    let review_cancel = state.reviews.get(&r.record_id).cloned().unwrap_or_default();
                    let left = r.expires.min(session_expires).saturating_sub(now).max(1);
                    let signal = Cancel::any(&[&self.global, &review_cancel], Duration::from_millis(left));
                    let request = ReviewRequest {
                        origin: r.origin.clone(),
                        signer: r.signer.clone(),
                        details: r.details.clone(),
                    };
                    Some((signal, request, r.record_id.clone()))
                }
                Some(r) => {
                    let record_id = r.record_id.clone();
                    state.reviews.remove(&record_id);
                    if state.records[key].state == RequestState::Pending {
                        self.end_key(
                            &mut state,
                            key,
                            RequestState::Expired,
                            "The signing request expired.",
                            None,
                        );
                    }
                    None
                }
                None => None,
            }
        };
        let Some((signal, request, record_id)) = setup else { return };
        let outcome = self.sign_steps(key, session_id, &signal, request).await;
        let mut state = self.state.lock().unwrap();
        let now = self.now();
        if let (Err(error), Some(r)) = (&outcome, state.records.get(key)) {
            let (current, expires) = (r.state, r.expires);
            if current.started() {
                self.end_key(&mut state, key, RequestState::Unknown, &error.message, None);
            } else if matches!(current, RequestState::Pending | RequestState::Approved) {
                if now >= expires {
                    self.end_key(&mut state, key, RequestState::Expired, &error.message, None);
                } else {
                    let object = sep43(error, None);
                    self.end_key(&mut state, key, RequestState::Denied, &error.message, Some(object));
                }
            }
        }
        if let Some(r) = state.records.get(key)
            && r.state == RequestState::Pending
        {
            let target = if now >= r.expires { RequestState::Expired } else { RequestState::Denied };
            self.end_key(&mut state, key, target, "The signing request ended before review.", None);
        }
        state.reviews.remove(&record_id);
    }

    /// Check that the request and its session still allow the next step. Shutdown ends every step at once,
    /// before the cancellation signal reaches this worker.
    fn eligible(
        &self,
        state: &State,
        key: &str,
        session_id: &str,
        signal: &Cancel,
        expected: RequestState,
    ) -> bool {
        let now = self.now();
        !signal.is_cancelled()
            && !state.closing
            && self.session_live(state, session_id)
            && state.records.get(key).is_some_and(|r| r.state == expected && now < r.expires)
    }

    fn still(&self, key: &str, session_id: &str, signal: &Cancel, expected: RequestState) -> bool {
        self.eligible(&self.state.lock().unwrap(), key, session_id, signal, expected)
    }

    fn set_state(&self, key: &str, next: RequestState) {
        let mut state = self.state.lock().unwrap();
        if let Some(mut r) = state.records.remove(key) {
            r.state = next;
            self.log_result(&mut r);
            state.records.insert(key.to_owned(), r);
        }
    }

    async fn sign_steps(
        &self,
        key: &str,
        session_id: &str,
        signal: &Cancel,
        request: ReviewRequest,
    ) -> Result<()> {
        let approved = match &self.deps.review {
            Some(review) => signal.run(review(request, signal.clone())).await?,
            None => true,
        };
        let (artifact, passphrase, address, public_key) = {
            let mut state = self.state.lock().unwrap();
            if !self.eligible(&state, key, session_id, signal, RequestState::Pending) {
                return Ok(());
            }
            if !approved {
                self.end_key(&mut state, key, RequestState::Denied, "The review denied this request.", None);
                return Ok(());
            }
            let r = &state.records[key];
            (r.artifact.clone(), r.network_passphrase.clone(), address_of(r), r.public_key.clone())
        };
        // A transaction can reach its max_time while it waits. The same scope finishes the signature.
        let checked_at = self.now();
        admit(&artifact, &passphrase, &address, &public_key, checked_at)?;
        self.set_state(key, RequestState::Approved);
        // Vault discovery stops its CLI children before it returns, so it is awaited, not dropped.
        let keys = (self.deps.list_signers)(signal.clone()).await;
        if signal.is_cancelled() {
            return Err(signal.reason());
        }
        let keys = keys?;
        if !self.still(key, session_id, signal, RequestState::Approved) {
            return Err(Error::new("internal", "The signing approval expired or was canceled."));
        }
        let allowed = {
            let state = self.state.lock().unwrap();
            let session = state.sessions.get(session_id);
            session.and_then(|s| s.allowed.as_ref()).is_none_or(|a| a.contains(&public_key))
        };
        if !allowed || !keys.iter().any(|k| k.public_key == public_key) {
            return Err(Error::new("internal", "The selected key is no longer available."));
        }
        let hash = {
            // The last check and the move to Signing share one lock.
            let mut state = self.state.lock().unwrap();
            if !self.eligible(&state, key, session_id, signal, RequestState::Approved) {
                return Err(Error::new("internal", "The signing approval expired or was canceled."));
            }
            let r = state.records.get_mut(key).unwrap();
            r.state = RequestState::Signing;
            let mut r = state.records.remove(key).unwrap();
            self.log_result(&mut r);
            let hash = r.hash.clone();
            state.records.insert(key.to_owned(), r);
            hash
        };
        let digest = crate::util::lower_hex::<32>(&hash).expect("a stored hash is 32 bytes");
        let signature = signal.run((self.deps.sign)(public_key.clone(), digest, signal.clone())).await?;
        let still_signing =
            self.state.lock().unwrap().records.get(key).is_some_and(|r| r.state == RequestState::Signing);
        if !still_signing {
            self.log(&format!("1Password returned a signature after cancellation. Withheld {hash}.\n"));
        }
        let result = Self::finish(&artifact, &passphrase, &public_key, checked_at, &signature)?;
        let mut state = self.state.lock().unwrap();
        if !self.eligible(&state, key, session_id, signal, RequestState::Signing) {
            return Err(Error::new(
                "internal",
                "The signing result is withheld because approval expired or was canceled.",
            ));
        }
        if let Some(mut r) = state.records.remove(key) {
            r.result = Some(result);
            r.state = RequestState::Signed;
            self.log_result(&mut r);
            state.records.insert(key.to_owned(), r);
        }
        Ok(())
    }

    fn port(&self) -> u64 {
        self.port.load(Ordering::SeqCst)
    }

    /// Handle one HTTP request. Every failure becomes a SEP-43 error object with its status.
    pub async fn handle(self: &Arc<Self>, req: HttpRequest, body: BodyReader) -> Reply {
        self.dispatch(req, body).await.unwrap_or_else(Reply::failure)
    }

    async fn dispatch(
        self: &Arc<Self>,
        req: HttpRequest,
        body: BodyReader,
    ) -> std::result::Result<Reply, Fail> {
        let (origin, route) = {
            let state = self.state.lock().unwrap();
            let origin = state.origin.clone();
            let base = url::Url::parse(&origin).expect("the bridge origin is valid");
            let route = base.join(&req.target).map(|u| u.path().to_owned()).unwrap_or_default();
            (origin, route)
        };
        let public_host = url::Url::parse(&origin).ok().map(|u| {
            let host = u.host_str().unwrap_or_default().to_owned();
            u.port().map_or(host.clone(), |p| format!("{host}:{p}"))
        });
        let port = self.port();
        let allowed =
            [public_host.unwrap_or_default(), format!("127.0.0.1:{port}"), format!("localhost:{port}")];
        if !req.host.as_ref().is_some_and(|h| allowed.contains(h)) {
            return Err(fail("invalid_request", "The request host is invalid.", Some(403)));
        }
        {
            let mut state = self.state.lock().unwrap();
            if state.closing {
                return Err(fail("bridge_unavailable", "The bridge is stopping.", None));
            }
            self.expire(&mut state);
        }
        if route == "/api/session" && req.method == "GET" {
            return reply(200, json!({ "service": "walleterm", "protocol": PROTOCOL }));
        }
        if !route.starts_with("/v1/") {
            return Err(fail(
                "invalid_request",
                "Use this tunnel URL in a Walleterm-compatible website.",
                Some(404),
            ));
        }
        let site = req.origin.clone().unwrap_or_default();
        if !valid_origin(&site) || site == origin {
            return Err(fail("invalid_request", "Use a separate website Origin.", Some(403)));
        }
        let cors = vec![("Access-Control-Allow-Origin", site.clone()), ("Vary", "Origin".to_owned())];
        let with_cors = |result: std::result::Result<Reply, Fail>| {
            let mut r = result.unwrap_or_else(Reply::failure);
            r.headers.extend(cors.clone());
            Ok(r)
        };
        if req.method == "OPTIONS" {
            return with_cors(Ok(Reply {
                status: 204,
                headers: vec![
                    ("Access-Control-Allow-Methods", "GET, POST, OPTIONS".into()),
                    ("Access-Control-Allow-Headers", "Content-Type, Authorization".into()),
                    ("Access-Control-Max-Age", "300".into()),
                ],
                body: None,
                raw: None,
            }));
        }
        with_cors(self.route(&req, &route, &site, body).await)
    }

    async fn route(
        self: &Arc<Self>,
        req: &HttpRequest,
        route: &str,
        site: &str,
        body: BodyReader,
    ) -> std::result::Result<Reply, Fail> {
        let method = req.method.as_str();
        if route == "/v1/connect" && method == "POST" {
            return self.connect(req, site, body).await;
        }
        let session_id = self.website(&self.state.lock().unwrap(), req)?;
        match (route, method) {
            ("/v1/signers", "GET") => return self.signers(req, &session_id).await,
            ("/v1/select", "POST") => return self.select(req, &session_id, body).await,
            ("/v1/account", "GET") => {
                let state = self.state.lock().unwrap();
                let s = state.sessions.get(&session_id).ok_or_else(Self::disconnected)?;
                return reply(
                    200,
                    json!({
                        "connection_id": s.id,
                        "address": s.public_key,
                        "network": "TESTNET",
                        "network_passphrase": TESTNET,
                        "expires_at": iso_millis(s.expires as i64),
                        "wallet_scope": s.scope.as_str(),
                        "selection_revision": s.selection_revision,
                    }),
                );
            }
            ("/v1/disconnect", "POST") => {
                object(&req.content_type, body).await?;
                let mut state = self.state.lock().unwrap();
                self.revoke(&mut state, &session_id);
                return reply(200, json!({ "disconnected": true }));
            }
            ("/v1/requests", "POST") => return self.create(req, &session_id, body).await,
            _ => {}
        }
        let request = route.strip_prefix("/v1/requests/").and_then(|rest| {
            let (id, cancel) = match rest.strip_suffix("/cancel") {
                Some(id) => (id, true),
                None => (rest, false),
            };
            let valid = !id.is_empty()
                && id.len() <= 64
                && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
            valid.then(|| (id.to_owned(), cancel))
        });
        if let Some((id, cancel)) = request {
            let key = format!("{session_id}:{id}");
            if cancel && method == "POST" {
                object(&req.content_type, body).await?;
                let mut state = self.state.lock().unwrap();
                self.website(&state, req)?;
                return self.cancel(&mut state, &session_id, &key, &id);
            }
            let mut state = self.state.lock().unwrap();
            let Some(r) = state.records.get_mut(&key) else {
                return Err(fail(
                    "invalid_request",
                    "The request does not exist in this website session.",
                    Some(404),
                ));
            };
            if method == "GET" {
                return reply(200, Self::summary(r));
            }
        }
        Err(fail("invalid_request", "The route does not exist.", Some(404)))
    }

    async fn connect(
        self: &Arc<Self>,
        req: &HttpRequest,
        site: &str,
        body: BodyReader,
    ) -> std::result::Result<Reply, Fail> {
        let data = object(&req.content_type, body).await?;
        let now = self.now();
        let mut state = self.state.lock().unwrap();
        if now < state.pairing.locked_until {
            return Err(fail(
                "rate_limited",
                "Too many incorrect codes. Wait one minute, then use the new code in the tunnel terminal.",
                None,
            ));
        }
        if now >= state.pairing.expires {
            drop(state);
            self.rotate_code();
            return Err(fail(
                "invalid_request",
                "The connection code expired. Use the new code in the tunnel terminal.",
                Some(403),
            ));
        }
        let scope = match data.get("wallet_scope").and_then(Value::as_str) {
            Some("selected") => Scope::Selected,
            Some("available") => Scope::Available,
            _ => return Err(fail("invalid_request", "The connection fields are invalid.", None)),
        };
        if data.keys().any(|k| k != "code" && k != "wallet_scope") {
            return Err(fail("invalid_request", "The connection fields are invalid.", None));
        }
        let code_matches =
            data.get("code").and_then(Value::as_str).is_some_and(|c| equal(c, &state.pairing.code));
        if !code_matches {
            // Five failures replace the code and pause connection for one minute.
            state.pairing.attempts += 1;
            if state.pairing.attempts >= 5 {
                state.pairing.locked_until = now + CODE_LOCKOUT_MS;
                drop(state);
                self.rotate_code();
            }
            return Err(fail("invalid_request", "The connection code is incorrect.", Some(403)));
        }
        if state.sessions.len() >= MAX_SESSIONS {
            return Err(fail(
                "rate_limited",
                "The connection limit was reached. Disconnect a website or restart the tunnel.",
                None,
            ));
        }
        let session = Session {
            id: uuid(),
            token: token(),
            origin: site.to_owned(),
            public_key: None,
            scope,
            selection_revision: 0,
            allowed: None,
            expires: now + UNSELECTED_SESSION_MS,
            revoked: false,
            canceled: HashSet::new(),
            key: None,
            offered: None,
        };
        let body = json!({
            "token": session.token,
            "connection_id": session.id,
            "expires_at": iso_millis(session.expires as i64),
            "wallet_scope": scope.as_str(),
            "selection_revision": 0,
        });
        state.tokens.insert(session.token.clone(), session.id.clone());
        state.sessions.insert(session.id.clone(), session);
        drop(state);
        self.rotate_code();
        reply(201, body)
    }

    async fn signers(
        self: &Arc<Self>,
        req: &HttpRequest,
        session_id: &str,
    ) -> std::result::Result<Reply, Fail> {
        let signers = self.keys().await.map_err(listing_failure)?;
        let mut state = self.state.lock().unwrap();
        self.website(&state, req)?;
        let s = state.sessions.get_mut(session_id).ok_or_else(Self::disconnected)?;
        if s.scope == Scope::Available && s.allowed.is_none() {
            s.offered =
                Some(Offer { id: token(), keys: signers.iter().map(|k| k.public_key.clone()).collect() });
        }
        let visible: Vec<&SignerInfo> = match &s.allowed {
            Some(allowed) => signers.iter().filter(|k| allowed.contains(&k.public_key)).collect(),
            None => signers.iter().collect(),
        };
        let mut body = json!({ "signers": visible });
        if s.allowed.is_none()
            && let Some(offer) = &s.offered
        {
            body["grant_id"] = json!(offer.id);
        }
        reply(200, body)
    }

    fn valid_revision(s: &Session, data: &Map<String, Value>) -> std::result::Result<(), Fail> {
        let scoped = s.scope == Scope::Available;
        if scoped && safe_integer(data.get("expected_revision")) != Some(s.selection_revision) {
            return Err(fail("conflict", "The wallet selection changed. Refresh the active wallet.", None));
        }
        if !scoped && s.public_key.is_some() {
            return Err(fail(
                "conflict",
                "This connection already has a wallet. Disconnect to select another wallet.",
                None,
            ));
        }
        Ok(())
    }

    async fn select(
        self: &Arc<Self>,
        req: &HttpRequest,
        session_id: &str,
        body: BodyReader,
    ) -> std::result::Result<Reply, Fail> {
        let data = object(&req.content_type, body).await?;
        let (offer_id, offer_keys) = {
            let state = self.state.lock().unwrap();
            // The body read can outlast the session. Check again under this lock before any use.
            let s = state.sessions.get(session_id).ok_or_else(Self::disconnected)?;
            let scoped = s.scope == Scope::Available;
            let mut fields = vec!["public_key"];
            if scoped {
                fields.push("expected_revision");
                if s.allowed.is_none() {
                    fields.push("grant_id");
                }
            }
            if data.keys().any(|k| !fields.contains(&k.as_str())) {
                return Err(fail("invalid_request", "The selection fields are invalid.", None));
            }
            self.website(&state, req)?;
            Self::valid_revision(s, &data)?;
            let offered = s.offered.as_ref().map(|o| (o.id.clone(), o.keys.clone()));
            if scoped && s.allowed.is_none() {
                let presented = data.get("grant_id").and_then(Value::as_str);
                match &offered {
                    Some((id, _)) if presented.is_some_and(|p| equal(p, id)) => {}
                    _ => {
                        return Err(fail(
                            "conflict",
                            "Refresh the wallet list before selecting a wallet.",
                            None,
                        ));
                    }
                }
            }
            offered.unzip()
        };
        let signers = self.keys().await.map_err(listing_failure)?;
        let mut state = self.state.lock().unwrap();
        self.website(&state, req)?;
        let s = state.sessions.get(session_id).ok_or_else(Self::disconnected)?;
        Self::valid_revision(s, &data)?;
        let scoped = s.scope == Scope::Available;
        if scoped && s.allowed.is_none() && s.offered.as_ref().map(|o| &o.id) != offer_id.as_ref() {
            return Err(fail("conflict", "The wallet list changed. Review it again.", None));
        }
        let requested = data.get("public_key").and_then(Value::as_str);
        let key = signers.iter().find(|k| {
            Some(k.public_key.as_str()) == requested
                && (!scoped
                    || s.allowed
                        .as_ref()
                        .or(offer_keys.as_ref())
                        .is_some_and(|set| set.contains(&k.public_key)))
        });
        let Some(key) = key.cloned() else {
            return Err(fail("invalid_request", "Select an available key from this connection.", None));
        };
        if s.public_key.as_deref() != Some(&key.public_key) {
            // Cancel and replace the selection together. No await can admit an old request between them.
            self.end_session_requests(&mut state, session_id, |r| {
                if r.delivered {
                    "The bridge sent the signature before the wallet changed.".into()
                } else {
                    "The active wallet changed.".into()
                }
            });
            let now = self.now();
            let s = state.sessions.get_mut(session_id).ok_or_else(Self::disconnected)?;
            if s.public_key.is_none() {
                s.allowed = match (&offer_keys, scoped) {
                    (Some(offered), true) => Some(
                        signers
                            .iter()
                            .filter(|k| offered.contains(&k.public_key))
                            .map(|k| k.public_key.clone())
                            .collect(),
                    ),
                    _ => None,
                };
                s.offered = None;
                s.expires = now + SELECTED_SESSION_MS;
            }
            s.public_key = Some(key.public_key.clone());
            s.key = Some(key.clone());
            s.selection_revision += 1;
        }
        let s = state.sessions.get(session_id).ok_or_else(Self::disconnected)?;
        reply(
            200,
            json!({
                "address": s.public_key,
                "network": "TESTNET",
                "network_passphrase": TESTNET,
                "selection_revision": s.selection_revision,
                "expires_at": iso_millis(s.expires as i64),
            }),
        )
    }

    async fn create(
        self: &Arc<Self>,
        req: &HttpRequest,
        session_id: &str,
        body: BodyReader,
    ) -> std::result::Result<Reply, Fail> {
        let selected = self.state.lock().unwrap().sessions.get(session_id).map(|s| s.public_key.is_some());
        if !selected.ok_or_else(Self::disconnected)? {
            return Err(fail("not_connected", "Select a wallet first.", Some(409)));
        }
        let input = object(&req.content_type, body).await?;
        let mut state = self.state.lock().unwrap();
        self.website(&state, req)?;
        let s = state.sessions.get(session_id).ok_or_else(Self::disconnected)?;
        let (scoped, revision, origin) =
            (s.scope == Scope::Available, s.selection_revision, s.origin.clone());
        let (public_key, signer, canceled_ids) = (s.public_key.clone(), s.key.clone(), s.canceled.clone());
        let kind = input.get("kind").and_then(Value::as_str);
        let fields: &[&str] = match kind {
            Some("transaction") => &["xdr"],
            Some("auth_entry") => &["preimage_xdr"],
            Some("authorization") => &["auth_entry_xdr", "auth_address", "adapter"],
            Some("message") => &["message"],
            _ => &[],
        };
        let id = input.get("id").and_then(Value::as_str).unwrap_or_default().to_owned();
        let valid_id = !id.is_empty()
            && id.len() <= 64
            && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
        let known = |k: &str| {
            ["id", "kind", "network_passphrase", "address"].contains(&k)
                || fields.contains(&k)
                || (scoped && k == "selection_revision")
        };
        if !valid_id || fields.is_empty() || input.keys().any(|k| !known(k)) {
            return Err(fail("invalid_request", "The signing request fields are invalid.", None));
        }
        if scoped && safe_integer(input.get("selection_revision")) != Some(revision) {
            return Err(fail("conflict", "The wallet selection changed. Build a new signing request.", None));
        }
        let key = format!("{session_id}:{id}");
        if canceled_ids.contains(&id) {
            return Err(fail("rejected", "The website canceled this request before it arrived.", Some(409)));
        }
        let mut identity = normalize(&Value::Object(input.clone()));
        identity.as_object_mut().unwrap().remove("id");
        if let Some(prior) = state.records.get_mut(&key) {
            if prior.identity != identity {
                return Err(fail(
                    "conflict",
                    "This request ID already identifies a different request.",
                    None,
                ));
            }
            return reply(200, Self::summary(prior));
        }
        if state.records.values().filter(|r| r.session_id == session_id).count() >= MAX_PER_SESSION {
            return Err(fail(
                "rate_limited",
                "This connection reached its request limit. Disconnect and connect again.",
                None,
            ));
        }
        if state.records.values().filter(|r| r.state.active()).count() >= MAX_ACTIVE {
            return Err(fail("rate_limited", "The signing request limit was reached.", None));
        }
        let text = |name: &str| input.get(name).and_then(Value::as_str).map(str::to_owned);
        let strings_ok = fields.iter().all(|f| *f == "adapter" || text(f).is_some())
            && text("network_passphrase").is_some()
            && text("address").is_some();
        if !strings_ok {
            return Err(fail("invalid_request", "The signing request fields are invalid.", None));
        }
        let artifact = match kind {
            Some("transaction") => Artifact::Transaction(text("xdr").unwrap()),
            Some("auth_entry") => Artifact::Preimage(text("preimage_xdr").unwrap()),
            Some("message") => Artifact::Message(text("message").unwrap()),
            _ => Artifact::Authorization {
                entry_xdr: text("auth_entry_xdr").unwrap(),
                address: text("auth_address").unwrap(),
                adapter: input.get("adapter").cloned().unwrap_or(Value::Null),
            },
        };
        let (passphrase, address) = (text("network_passphrase").unwrap(), text("address").unwrap());
        let public_key = public_key.unwrap();
        let now = self.now();
        let (details, hash) = admit(&artifact, &passphrase, &address, &public_key, now).map_err(rejected)?;
        // No display shows a message except this line. The signature binds nothing that the text does not name.
        if let Artifact::Message(text) = &artifact {
            self.log(&format!(
                "Message request from {origin} for {public_key} ({} bytes, digest {hash}, no network, site, or expiry binding): {}\n",
                text.len(),
                crate::cli::go_quote(text)
            ));
        }
        // A transaction request never outlives the transaction's max_time.
        let max_time = details["max_time"].as_str().and_then(|t| t.parse::<u64>().ok()).filter(|&t| t != 0);
        let expires = max_time.map_or(now + REQUEST_MS, |t| t.saturating_mul(1000).min(now + REQUEST_MS));
        let seq = state.next_seq;
        state.next_seq += 1;
        let mut record = Record {
            seq,
            record_id: uuid(),
            session_id: session_id.to_owned(),
            origin,
            id,
            public_key,
            signer: signer.unwrap(),
            artifact,
            network_passphrase: passphrase,
            identity,
            details,
            hash,
            expires,
            state: RequestState::Pending,
            logged: None,
            delivered: false,
            result: None,
            error: None,
        };
        self.log_result(&mut record);
        let summary = Self::summary(&mut record);
        state.reviews.insert(record.record_id.clone(), Cancel::new());
        state.records.insert(key.clone(), record);
        drop(state);
        self.pending_jobs.fetch_add(1, Ordering::SeqCst);
        if self.queue.send((key, session_id.to_owned())).is_err() {
            self.pending_jobs.fetch_sub(1, Ordering::SeqCst);
        }
        reply(201, summary)
    }

    fn cancel(
        &self,
        state: &mut State,
        session_id: &str,
        key: &str,
        id: &str,
    ) -> std::result::Result<Reply, Fail> {
        if !state.records.contains_key(key) {
            // A cancel can arrive before a delayed create. Block that ID for this session.
            let s = state.sessions.get_mut(session_id).ok_or_else(Self::disconnected)?;
            if s.canceled.len() >= MAX_PER_SESSION {
                return Err(fail(
                    "rate_limited",
                    "This connection reached its request limit. Disconnect and connect again.",
                    None,
                ));
            }
            s.canceled.insert(id.to_owned());
            let error = sep43(
                &Error::new("rejected", "The website canceled this request."),
                Some(RequestState::Denied),
            );
            return reply(200, json!({ "id": id, "state": "denied", "error": error }));
        }
        let r = &state.records[key];
        if r.state.active() || r.state == RequestState::Signed {
            // A signed result can race the cancellation. Withhold it, as a revocation does.
            let target = if r.state.started() { RequestState::Unknown } else { RequestState::Denied };
            let message = if r.delivered {
                "The bridge sent the signature, then the website canceled."
            } else {
                "The website canceled this request."
            };
            let record_id = r.record_id.clone();
            self.end_key(state, key, target, message, None);
            if let Some(cancel) = state.reviews.get(&record_id) {
                cancel.abort();
            }
        }
        reply(200, Self::summary(state.records.get_mut(key).unwrap()))
    }

    /// Stop admitting requests, abort active work, and wait for queued jobs to end.
    /// Stop the bridge. It returns after the signing worker and any website lookup finish their cleanup.
    pub async fn close(&self) {
        self.state.lock().unwrap().closing = true;
        self.global.abort();
        loop {
            let idle = self.idle.notified();
            tokio::pin!(idle);
            idle.as_mut().enable();
            if self.pending_jobs.load(Ordering::SeqCst) == 0 && self.listing.lock().await.is_none() {
                return;
            }
            idle.await;
        }
    }

    pub fn closing(&self) -> bool {
        self.state.lock().unwrap().closing
    }
}

/// The shared inspection with the website rules: testnet only, the selected key as `address`,
/// the transaction signer role, and the selected G-address or a C-address as the preimage bound address.
/// A message binds no network. Its testnet passphrase is a session check only.
pub fn admit(
    artifact: &Artifact,
    passphrase: &str,
    address: &str,
    key: &str,
    now: u64,
) -> Result<(Value, String)> {
    if passphrase != TESTNET {
        return Err(Error::new("network_unsupported", "Walleterm signs only on Stellar testnet."));
    }
    if address != key {
        return Err(Error::new(
            "address_mismatch",
            "The requested account differs from the selected account.",
        ));
    }
    let checked =
        artifact::inspect(artifact, &artifact::Scope { key, passphrase: Some(passphrase), now_ms: now })?;
    match artifact {
        Artifact::Transaction(xdr) => signer_role(xdr, &checked.key)?,
        Artifact::Preimage(_) => {
            let bound = checked.details["address"].as_str().unwrap_or_default();
            if bound != key && !crate::stellar::is_contract(bound) {
                return Err(Error::new(
                    "address_mismatch",
                    "The authorization address must be the selected G-address or a C-address.",
                ));
            }
        }
        Artifact::Authorization { .. } | Artifact::Message(_) => {}
    }
    Ok((checked.details, hex(&checked.digest)))
}

fn address_of(r: &Record) -> String {
    r.identity.get("address").and_then(Value::as_str).unwrap_or_default().to_owned()
}

/// A discovery failure during a website call is an external service error.
fn listing_failure(e: Error) -> Fail {
    let reason =
        if e.code == "bridge_unavailable" || e.code == "internal" { "bridge_unavailable" } else { e.code };
    let reason = if reason_info(reason).is_some() { reason } else { "bridge_unavailable" };
    Fail { status: 502, error: sep43(&Error::new(reason, &e.message), None) }
}

/// The production dependencies: the 1Password agent and `--vault` discovery.
pub fn production(socket: std::path::PathBuf, vault: Option<String>) -> Deps {
    let socket = Arc::new(socket);
    let (list_socket, sign_socket) = (socket.clone(), socket);
    let vault = Arc::new(vault);
    Deps {
        list_signers: Box::new(move |cancel| {
            let (socket, vault) = (list_socket.clone(), vault.clone());
            Box::pin(async move {
                crate::vault::discover(&socket, vault.as_deref(), std::ffi::OsStr::new("op"), &cancel).await
            })
        }),
        sign: Box::new(move |public_key, digest, cancel| {
            let socket = sign_socket.clone();
            Box::pin(async move {
                let limit = Duration::from_secs(125);
                let signature = crate::agent::sign(&socket, &public_key, &digest, limit, &cancel).await?;
                Ok(hex(&signature))
            })
        }),
        review: None,
        log: Box::new(|line| {
            use std::io::Write;
            let mut out = std::io::stdout().lock();
            let _ = out.write_all(line.as_bytes()).and_then(|()| out.flush());
        }),
        now: Box::new(crate::util::now_ms),
    }
}
