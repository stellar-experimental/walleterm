//! Offline bridge test support: mock dependencies, a mock-key signer, and a raw HTTP/1.1 client.
//! Nothing here reads a real key, opens the 1Password socket, or reaches a network.
#![allow(dead_code)]

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::{Value, json};
use stellar_xdr::{
    DataValue, Hash, ManageDataOp, Memo, MuxedAccount, Operation, OperationBody, Preconditions,
    SequenceNumber, String64, TimeBounds, TimePoint, Transaction, TransactionEnvelope, TransactionExt,
    TransactionV1Envelope, Uint256,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use walleterm::bridge::{BoxFuture, Bridge, Deps, ReviewRequest, SignerInfo};
use walleterm::cancel::Cancel;
use walleterm::error::Error;
use walleterm::stellar::{account_address, encode};
use walleterm::util::{hex, now_ms};

pub const TESTNET: &str = "Test SDF Network ; September 2015";

pub fn mock_key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

pub fn address(key: &SigningKey) -> String {
    account_address(&key.verifying_key().to_bytes())
}

pub struct Decision {
    pub request: ReviewRequest,
    pub cancel: Cancel,
    answer: oneshot::Sender<bool>,
}

impl Decision {
    pub fn decide(self, value: bool) -> ReviewRequest {
        let _ = self.answer.send(value);
        self.request
    }
}

/// Shared controls for one bridge under test.
#[derive(Clone)]
pub struct Controls {
    pub signers: Arc<Mutex<Result<Vec<SignerInfo>, Error>>>,
    pub listings: Arc<AtomicUsize>,
    pub listing_delay: Arc<Mutex<Option<oneshot::Receiver<()>>>>,
    /// Held listings that saw cancellation and finished their cleanup, as vault discovery does.
    pub listing_cleanups: Arc<AtomicUsize>,
    pub signs: Arc<AtomicUsize>,
    pub sign_gate: Arc<Mutex<Option<oneshot::Receiver<()>>>>,
    pub sign_result: Arc<Mutex<Option<String>>>,
    pub sign_cancels: Arc<Mutex<Vec<Cancel>>>,
    pub decisions: Arc<Mutex<VecDeque<Decision>>>,
    pub reviews: Arc<AtomicUsize>,
    pub logs: Arc<Mutex<Vec<String>>>,
    pub clock: Arc<AtomicU64>,
}

impl Controls {
    pub fn now(&self) -> u64 {
        self.clock.load(Ordering::SeqCst)
    }
    pub fn advance(&self, ms: u64) {
        self.clock.fetch_add(ms, Ordering::SeqCst);
    }
    pub fn logs(&self) -> Vec<String> {
        self.logs.lock().unwrap().clone()
    }
    /// Hold the next signer listing until the returned sender fires.
    pub fn hold_listing(&self) -> oneshot::Sender<()> {
        let (tx, rx) = oneshot::channel();
        *self.listing_delay.lock().unwrap() = Some(rx);
        tx
    }
    /// Hold the next signing call until the returned sender fires.
    pub fn hold_signing(&self) -> oneshot::Sender<()> {
        let (tx, rx) = oneshot::channel();
        *self.sign_gate.lock().unwrap() = Some(rx);
        tx
    }
    pub async fn next_decision(&self) -> Decision {
        for _ in 0..400 {
            if let Some(d) = self.decisions.lock().unwrap().pop_front() {
                return d;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("no review arrived");
    }
    pub async fn decide(&self, value: bool) -> ReviewRequest {
        self.next_decision().await.decide(value)
    }
}

pub struct Options {
    pub review: bool,
    pub key: SigningKey,
}

impl Default for Options {
    fn default() -> Self {
        Self { review: true, key: mock_key(7) }
    }
}

pub fn deps(controls: &Controls, options: &Options) -> Deps {
    let c = controls.clone();
    let list_signers =
        Box::new(move |cancel: Cancel| -> BoxFuture<walleterm::error::Result<Vec<SignerInfo>>> {
            let c = c.clone();
            Box::pin(async move {
                c.listings.fetch_add(1, Ordering::SeqCst);
                let gate = c.listing_delay.lock().unwrap().take();
                if let Some(gate) = gate {
                    tokio::select! {
                        _ = gate => {}
                        () = cancel.cancelled() => {
                            // Stop like the vault CLI children: a short cleanup, then the reason.
                            tokio::time::sleep(Duration::from_millis(50)).await;
                            c.listing_cleanups.fetch_add(1, Ordering::SeqCst);
                            return Err(cancel.reason());
                        }
                    }
                }
                c.signers.lock().unwrap().clone()
            })
        });
    let (c, key) = (controls.clone(), options.key.clone());
    let sign = Box::new(
        move |_public_key: String,
              digest: [u8; 32],
              cancel: Cancel|
              -> BoxFuture<walleterm::error::Result<String>> {
            let (c, key) = (c.clone(), key.clone());
            Box::pin(async move {
                c.signs.fetch_add(1, Ordering::SeqCst);
                c.sign_cancels.lock().unwrap().push(cancel.clone());
                let gate = c.sign_gate.lock().unwrap().take();
                if let Some(gate) = gate {
                    let _ = gate.await;
                }
                if let Some(forced) = c.sign_result.lock().unwrap().clone() {
                    return Ok(forced);
                }
                Ok(hex(&key.sign(&digest).to_bytes()))
            })
        },
    );
    let c = controls.clone();
    let review = options.review.then(|| {
        Box::new(move |request: ReviewRequest, cancel: Cancel| -> BoxFuture<walleterm::error::Result<bool>> {
            let c = c.clone();
            Box::pin(async move {
                c.reviews.fetch_add(1, Ordering::SeqCst);
                let (answer, wait) = oneshot::channel();
                c.decisions.lock().unwrap().push_back(Decision { request, cancel: cancel.clone(), answer });
                tokio::select! {
                    value = wait => Ok(value.unwrap_or(false)),
                    () = cancel.cancelled() => Err(cancel.reason()),
                }
            })
        })
            as Box<dyn Fn(ReviewRequest, Cancel) -> BoxFuture<walleterm::error::Result<bool>> + Send + Sync>
    });
    let c = controls.clone();
    let log = Box::new(move |line: &str| c.logs.lock().unwrap().push(line.to_owned()));
    let c = controls.clone();
    let now = Box::new(move || c.now());
    Deps { list_signers, sign, review, log, now }
}

pub struct Response {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Value,
}

impl Response {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// Send raw bytes and read one `Connection: close` response.
pub async fn raw(port: u16, request: &[u8]) -> Response {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(request).await.unwrap();
    let mut bytes = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(20), stream.read_to_end(&mut bytes)).await;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let mut lines = head.lines();
    let status = lines.next().and_then(|l| l.split(' ').nth(1)).and_then(|s| s.parse().ok()).unwrap_or(0);
    let headers =
        lines.filter_map(|l| l.split_once(": ").map(|(a, b)| (a.to_owned(), b.to_owned()))).collect();
    let body = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(body).unwrap_or(Value::String(body.to_owned()))
    };
    Response { status, headers, body }
}

pub struct Fixture {
    pub bridge: Arc<Bridge>,
    pub port: u16,
    pub controls: Controls,
    pub key: SigningKey,
    pub public_key: String,
    stop: Cancel,
}

#[derive(Clone)]
pub struct Site {
    pub origin: String,
    pub token: Option<String>,
}

impl Site {
    pub fn new(origin: &str) -> Self {
        Self { origin: origin.to_owned(), token: None }
    }
}

impl Fixture {
    pub async fn new(options: Options) -> Self {
        let controls = Controls {
            signers: Arc::new(Mutex::new(Ok(vec![]))),
            listings: Arc::default(),
            listing_cleanups: Arc::default(),
            listing_delay: Arc::default(),
            signs: Arc::default(),
            sign_gate: Arc::default(),
            sign_result: Arc::default(),
            sign_cancels: Arc::default(),
            decisions: Arc::default(),
            reviews: Arc::default(),
            logs: Arc::default(),
            clock: Arc::new(AtomicU64::new(now_ms())),
        };
        let public_key = address(&options.key);
        *controls.signers.lock().unwrap() = Ok(vec![SignerInfo {
            public_key: public_key.clone(),
            fingerprint: None,
            comment: Some("Mock key".into()),
        }]);
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let bridge = Bridge::new(deps(&controls, &options), port);
        bridge.set_public_origin(&format!("http://127.0.0.1:{port}")).unwrap();
        let stop = Cancel::new();
        let handler_bridge = bridge.clone();
        let handler: walleterm::http::Handler = Arc::new(move |req, body| {
            let bridge = handler_bridge.clone();
            Box::pin(async move { bridge.handle(req, body).await })
        });
        tokio::spawn(walleterm::http::serve(listener, handler, Duration::from_secs(150), stop.clone()));
        Self { bridge, port, controls, key: options.key, public_key, stop }
    }

    pub async fn request(&self, method: &str, path: &str, data: Option<&Value>, site: &Site) -> Response {
        let body = data.map(Value::to_string).unwrap_or_default();
        let mut head = format!(
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\nOrigin: {}\r\n",
            self.port, site.origin
        );
        if let Some(token) = &site.token {
            head.push_str(&format!("Authorization: Bearer {token}\r\n"));
        }
        if data.is_some() {
            head.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", body.len()));
        }
        head.push_str("\r\n");
        raw(self.port, format!("{head}{body}").as_bytes()).await
    }

    pub async fn get(&self, path: &str, site: &Site) -> Response {
        self.request("GET", path, None, site).await
    }

    pub async fn post(&self, path: &str, data: Value, site: &Site) -> Response {
        self.request("POST", path, Some(&data), site).await
    }

    pub fn code(&self) -> String {
        self.bridge.pairing()["code"].as_str().unwrap().to_owned()
    }

    /// Connect with a scope. The token is stored on the returned site.
    pub async fn open(&self, origin: &str, scope: &str) -> Site {
        let mut site = Site::new(origin);
        let r = self.post("/v1/connect", json!({ "code": self.code(), "wallet_scope": scope }), &site).await;
        assert_eq!(r.status, 201, "{}", r.body);
        site.token = Some(r.body["token"].as_str().unwrap().to_owned());
        site
    }

    /// Connect and select the mock key in the `selected` scope.
    pub async fn connect(&self, origin: &str) -> Site {
        let site = self.open(origin, "selected").await;
        let r = self.post("/v1/select", json!({ "public_key": self.public_key }), &site).await;
        assert_eq!(r.status, 200, "{}", r.body);
        site
    }

    /// Poll until the request leaves its active states.
    pub async fn result(&self, site: &Site, id: &str) -> Response {
        for _ in 0..400 {
            let r = self.get(&format!("/v1/requests/{id}"), site).await;
            let state = r.body["state"].as_str().unwrap_or_default();
            if !["pending", "approved", "signing"].contains(&state) {
                return r;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("request {id} stayed active");
    }

    pub async fn close(&self) {
        self.stop.abort();
        self.bridge.close().await;
    }
}

/// A V1 testnet envelope with one manageData operation, valid now for `timeout` seconds.
pub fn transaction(source: &SigningKey, now_ms: u64, timeout: u64) -> String {
    let now = now_ms / 1000;
    let tx = Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(source.verifying_key().to_bytes())),
        fee: 100,
        seq_num: SequenceNumber(11),
        cond: Preconditions::Time(TimeBounds { min_time: TimePoint(0), max_time: TimePoint(now + timeout) }),
        memo: Memo::None,
        operations: vec![Operation {
            source_account: None,
            body: OperationBody::ManageData(ManageDataOp {
                data_name: String64("test".try_into().unwrap()),
                data_value: Some(DataValue(b"hello".to_vec().try_into().unwrap())),
            }),
        }]
        .try_into()
        .unwrap(),
        ext: TransactionExt::V0,
    };
    encode(&TransactionEnvelope::Tx(TransactionV1Envelope { tx, signatures: vec![].try_into().unwrap() }))
}

pub fn transaction_request(id: &str, fixture: &Fixture) -> Value {
    json!({
        "id": id,
        "kind": "transaction",
        "address": fixture.public_key,
        "network_passphrase": TESTNET,
        "xdr": transaction(&fixture.key, fixture.controls.now(), 180),
    })
}

pub fn unused_hash() -> Hash {
    Hash([0; 32])
}

pub mod tx {
    //! Small XDR builders for bridge tests. Testnet only.
    use ed25519_dalek::{Signer as _, SigningKey};
    use stellar_xdr::*;
    use walleterm::stellar::{encode, xdr_bytes};
    use walleterm::util::sha256;

    pub fn ed(key: &SigningKey) -> MuxedAccount {
        MuxedAccount::Ed25519(Uint256(key.verifying_key().to_bytes()))
    }

    pub fn muxed(key: &SigningKey, id: u64) -> MuxedAccount {
        MuxedAccount::MuxedEd25519(MuxedAccountMed25519 {
            id,
            ed25519: Uint256(key.verifying_key().to_bytes()),
        })
    }

    pub fn data(name: &str, source: Option<MuxedAccount>) -> Operation {
        Operation {
            source_account: source,
            body: OperationBody::ManageData(ManageDataOp {
                data_name: String64(name.try_into().unwrap()),
                data_value: Some(DataValue(b"x".to_vec().try_into().unwrap())),
            }),
        }
    }

    pub fn payment(to: &SigningKey, source: Option<MuxedAccount>) -> Operation {
        Operation {
            source_account: source,
            body: OperationBody::Payment(PaymentOp {
                destination: ed(to),
                asset: Asset::Native,
                amount: 10_000_000,
            }),
        }
    }

    pub fn home_domain() -> Operation {
        Operation {
            source_account: None,
            body: OperationBody::SetOptions(SetOptionsOp {
                inflation_dest: None,
                clear_flags: None,
                set_flags: None,
                master_weight: None,
                low_threshold: None,
                med_threshold: None,
                high_threshold: None,
                home_domain: Some(String32("example.com".try_into().unwrap())),
                signer: None,
            }),
        }
    }

    pub fn change_trust(issuer: &SigningKey) -> Operation {
        Operation {
            source_account: None,
            body: OperationBody::ChangeTrust(ChangeTrustOp {
                line: ChangeTrustAsset::CreditAlphanum4(AlphaNum4 {
                    asset_code: AssetCode4(*b"USD\0"),
                    issuer: AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
                        issuer.verifying_key().to_bytes(),
                    ))),
                }),
                limit: i64::MAX,
            }),
        }
    }

    /// A transaction valid from 0 until `now + timeout` seconds, or unbounded when `timeout` is 0.
    pub fn build(
        source: MuxedAccount,
        operations: Vec<Operation>,
        fee: u32,
        now_ms: u64,
        timeout: u64,
    ) -> TransactionEnvelope {
        let cond = if timeout == 0 {
            Preconditions::Time(TimeBounds { min_time: TimePoint(0), max_time: TimePoint(0) })
        } else {
            Preconditions::Time(TimeBounds {
                min_time: TimePoint(0),
                max_time: TimePoint(now_ms / 1000 + timeout),
            })
        };
        TransactionEnvelope::Tx(TransactionV1Envelope {
            tx: Transaction {
                source_account: source,
                fee,
                seq_num: SequenceNumber(11),
                cond,
                memo: Memo::None,
                operations: operations.try_into().unwrap(),
                ext: TransactionExt::V0,
            },
            signatures: VecM::default(),
        })
    }

    pub fn hash(envelope: &TransactionEnvelope) -> [u8; 32] {
        let tagged = match envelope {
            TransactionEnvelope::Tx(v1) => TransactionSignaturePayloadTaggedTransaction::Tx(v1.tx.clone()),
            TransactionEnvelope::TxFeeBump(f) => {
                TransactionSignaturePayloadTaggedTransaction::TxFeeBump(f.tx.clone())
            }
            TransactionEnvelope::TxV0(_) => panic!("V0"),
        };
        let payload = TransactionSignaturePayload {
            network_id: Hash(sha256(super::TESTNET.as_bytes())),
            tagged_transaction: tagged,
        };
        sha256(&xdr_bytes(&payload))
    }

    pub fn sign(mut envelope: TransactionEnvelope, key: &SigningKey) -> TransactionEnvelope {
        let signature = key.sign(&hash(&envelope)).to_bytes();
        let public = key.verifying_key().to_bytes();
        let decorated = DecoratedSignature {
            hint: SignatureHint([public[28], public[29], public[30], public[31]]),
            signature: Signature(signature.to_vec().try_into().unwrap()),
        };
        let list = match &mut envelope {
            TransactionEnvelope::Tx(v1) => &mut v1.signatures,
            TransactionEnvelope::TxFeeBump(f) => &mut f.signatures,
            TransactionEnvelope::TxV0(_) => panic!("V0"),
        };
        let mut all = list.to_vec();
        all.push(decorated);
        *list = all.try_into().unwrap();
        envelope
    }

    pub fn sign_many(mut envelope: TransactionEnvelope, count: u8) -> TransactionEnvelope {
        for i in 0..count {
            envelope = sign(envelope, &SigningKey::from_bytes(&[100 + i; 32]));
        }
        envelope
    }

    pub fn fee_bump(fee_source: MuxedAccount, inner: TransactionEnvelope) -> TransactionEnvelope {
        let TransactionEnvelope::Tx(inner) = inner else { panic!("a V1 inner transaction") };
        TransactionEnvelope::TxFeeBump(FeeBumpTransactionEnvelope {
            tx: FeeBumpTransaction {
                fee_source,
                fee: 400,
                inner_tx: FeeBumpTransactionInnerTx::Tx(inner),
                ext: FeeBumpTransactionExt::V0,
            },
            signatures: VecM::default(),
        })
    }

    /// A V0 envelope has the same bytes after its type, without the muxed key type.
    pub fn v0(v1: &TransactionEnvelope) -> String {
        use base64::Engine as _;
        let bytes = xdr_bytes(v1);
        let mut out = vec![0, 0, 0, 0];
        out.extend(&bytes[8..]);
        base64::engine::general_purpose::STANDARD.encode(out)
    }

    pub fn text(envelope: &TransactionEnvelope) -> String {
        encode(envelope)
    }
}

pub mod auth {
    //! AddressV2 entries and CAP-71 preimages for bridge tests.
    use stellar_xdr::*;
    use walleterm::stellar::encode;
    use walleterm::util::sha256;

    pub fn contract(n: u8) -> String {
        stellar_strkey::Contract([n; 32]).to_string()
    }

    pub fn invocation() -> SorobanAuthorizedInvocation {
        SorobanAuthorizedInvocation {
            function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
                contract_address: ScAddress::Contract(ContractId(Hash([2; 32]))),
                function_name: ScSymbol("ping".try_into().unwrap()),
                args: VecM::default(),
            }),
            sub_invocations: VecM::default(),
        }
    }

    pub fn entry(address: &str, expiration: u32) -> String {
        let credentials = SorobanAddressCredentials {
            address: address.parse().unwrap(),
            nonce: 7,
            signature_expiration_ledger: expiration,
            signature: ScVal::Void,
        };
        encode(&SorobanAuthorizationEntry {
            credentials: SorobanCredentials::AddressV2(credentials),
            root_invocation: invocation(),
        })
    }

    pub fn preimage(address: &str, expiration: u32) -> String {
        encode(&HashIdPreimage::SorobanAuthorizationWithAddress(
            HashIdPreimageSorobanAuthorizationWithAddress {
                network_id: Hash(sha256(super::TESTNET.as_bytes())),
                nonce: 55,
                signature_expiration_ledger: expiration,
                address: address.parse().unwrap(),
                invocation: invocation(),
            },
        ))
    }
}
