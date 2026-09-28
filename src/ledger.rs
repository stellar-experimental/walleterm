//! The trusted testnet ledger. The endpoint is fixed: a website cannot supply a ledger or redirect the bridge.
//! getHealth reports the latest ledger without getLatestLedger's full metadata.
//! https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth (checked 2026-09-26)

use std::time::Duration;

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::Request;
use hyper_tls::HttpsConnector;
use hyper_util::client::legacy::Client;
use hyper_util::client::legacy::connect::HttpConnector;
use hyper_util::rt::{TokioExecutor, TokioTimer};
use serde_json::Value;

use crate::cancel::Cancel;
use crate::error::{Error, Result};

pub const ENDPOINT: &str = "https://soroban-testnet.stellar.org";
const MAX_RESPONSE: usize = 16384;
const LIMIT: Duration = Duration::from_secs(10);

pub type HttpsClient = Client<HttpsConnector<HttpConnector>, Full<Bytes>>;

fn unavailable(message: &str) -> Error {
    Error::new("ledger_unavailable", message)
}

/// An HTTPS-only client with platform certificate and hostname checks. Hyper follows no redirects and reads no proxy settings.
pub fn https_client() -> Result<HttpsClient> {
    let mut http = HttpConnector::new();
    http.enforce_http(false);
    http.set_connect_timeout(Some(LIMIT));
    let tls = native_tls::TlsConnector::new().map_err(|_| Error::new("internal", "TLS is unavailable."))?;
    let mut https = HttpsConnector::from((http, tls.into()));
    https.https_only(true);
    Ok(Client::builder(TokioExecutor::new()).pool_timer(TokioTimer::new()).build(https))
}

/// Read a response body, counting each frame before it enters the buffer.
pub async fn capped(body: hyper::body::Incoming, cap: usize) -> std::result::Result<Vec<u8>, bool> {
    let mut body = body;
    let mut bytes = Vec::new();
    while let Some(frame) = body.frame().await {
        let frame = frame.map_err(|_| false)?;
        if let Ok(data) = frame.into_data() {
            if data.len() > cap - bytes.len() {
                return Err(true);
            }
            bytes.extend_from_slice(&data);
        }
    }
    Ok(bytes)
}

/// Validate a getHealth response body.
pub fn parse_health(body: &[u8]) -> Result<u32> {
    let invalid = || unavailable("The trusted testnet ledger response is invalid.");
    let value: Value = serde_json::from_slice(body)
        .map_err(|_| unavailable("The trusted testnet ledger is unavailable."))?;
    let result = &value["result"];
    let sequence = result["latestLedger"]
        .as_f64()
        .filter(|v| v.fract() == 0.0 && *v >= 1.0 && *v <= f64::from(u32::MAX));
    let valid = value["id"].as_f64() == Some(1.0)
        && (value.get("error").is_none_or(|e| matches!(e, Value::Null | Value::Bool(false))))
        && result["status"] == "healthy";
    match sequence {
        Some(sequence) if valid => Ok(sequence as u32),
        _ => Err(invalid()),
    }
}

/// The latest testnet ledger from the fixed endpoint, within ten seconds.
pub async fn latest_ledger(client: &HttpsClient, cancel: &Cancel) -> Result<u32> {
    read_health(client, ENDPOINT, LIMIT, cancel).await
}

/// Query getHealth at `endpoint`. Only tests pass another endpoint, over a plain loopback client.
pub async fn read_health<C>(
    client: &Client<C, Full<Bytes>>,
    endpoint: &str,
    limit: Duration,
    cancel: &Cancel,
) -> Result<u32>
where
    C: hyper_util::client::legacy::connect::Connect + Clone + Send + Sync + 'static,
{
    let unreachable = || unavailable("The trusted testnet ledger is unavailable.");
    let work = async {
        let body = r#"{"jsonrpc":"2.0","id":1,"method":"getHealth"}"#;
        let request = Request::post(endpoint)
            .header("Content-Type", "application/json")
            .body(Full::new(Bytes::from_static(body.as_bytes())))
            .map_err(|_| unreachable())?;
        let response = client.request(request).await.map_err(|_| unreachable())?;
        if !response.status().is_success() {
            return Err(unreachable());
        }
        match capped(response.into_body(), MAX_RESPONSE).await {
            Ok(bytes) => parse_health(&bytes),
            Err(true) => Err(unavailable("The trusted ledger response is too large.")),
            Err(false) => Err(unreachable()),
        }
    };
    cancel.run(async { tokio::time::timeout(limit, work).await.unwrap_or_else(|_| Err(unreachable())) }).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_responses_are_strict() {
        let ok = br#"{"jsonrpc":"2.0","id":1,"result":{"status":"healthy","latestLedger":12345}}"#;
        assert_eq!(parse_health(ok), Ok(12345));
        let float_id = br#"{"id":1.0,"result":{"status":"healthy","latestLedger":7}}"#;
        assert_eq!(parse_health(float_id), Ok(7));
        for bad in [
            &br#"{"id":2,"result":{"status":"healthy","latestLedger":7}}"#[..],
            br#"{"id":1,"error":{"code":1},"result":{"status":"healthy","latestLedger":7}}"#,
            br#"{"id":1,"result":{"status":"unhealthy","latestLedger":7}}"#,
            br#"{"id":1,"result":{"status":"healthy","latestLedger":0}}"#,
            br#"{"id":1,"result":{"status":"healthy","latestLedger":4294967296}}"#,
            br#"{"id":1,"result":{"status":"healthy","latestLedger":1.5}}"#,
            br#"{"id":1,"result":{"status":"healthy","latestLedger":"7"}}"#,
        ] {
            assert_eq!(
                parse_health(bad).unwrap_err().message,
                "The trusted testnet ledger response is invalid."
            );
        }
        assert_eq!(
            parse_health(b"not json").unwrap_err().message,
            "The trusted testnet ledger is unavailable."
        );
    }
}
