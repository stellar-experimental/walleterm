//! The 1Password SSH agent protocol (RFC 9987): list identities and sign one 32-byte digest.
//! The CLI and bridge use the same asynchronous client and pure wire parser.

use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::path::Path;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use serde::Serialize;

use crate::cancel::Cancel;
use crate::error::{Error, Result};
use crate::platform::current_uid;
use crate::stellar::{account_address, verify};
use crate::util::sha256;

pub const MAX_FRAME: u32 = 1 << 20;
pub const MAX_IDENTITIES: u32 = 1024;
const REQUEST_IDENTITIES: u8 = 11;
const IDENTITIES_ANSWER: u8 = 12;
const SIGN_REQUEST: u8 = 13;
const SIGN_RESPONSE: u8 = 14;
const FAILURE: u8 = 5;

fn protocol(message: &str) -> Error {
    Error::new("agent_protocol", message)
}

fn truncated() -> Error {
    protocol("The agent returned a truncated frame.")
}

/// A sign response that ends before its first byte. On 2026-09-28, an unanswered prompt while 1Password was locked
/// ended this way after 60 seconds. A Deny returns type 5 instead.
fn closed() -> Error {
    protocol(
        "The agent closed the connection without a signature. The 1Password approval prompt may have timed out.",
    )
}

pub fn timeout() -> Error {
    Error::new("timeout", "The agent operation timed out.")
}

pub fn unavailable() -> Error {
    Error::new("agent_unavailable", "The 1Password socket is unavailable.")
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Signer {
    pub public_key: String,
    pub fingerprint: String,
    pub comment: String,
    #[serde(skip)]
    pub blob: Vec<u8>,
    #[serde(skip)]
    pub key: [u8; 32],
}

struct Parser<'a>(&'a [u8]);

impl<'a> Parser<'a> {
    fn byte(&mut self) -> Option<u8> {
        let (&first, rest) = self.0.split_first()?;
        self.0 = rest;
        Some(first)
    }

    fn uint32(&mut self) -> Option<u32> {
        let (head, rest) = self.0.split_first_chunk::<4>()?;
        self.0 = rest;
        Some(u32::from_be_bytes(*head))
    }

    fn string(&mut self) -> Option<&'a [u8]> {
        let n = self.uint32()? as usize;
        let (value, rest) = self.0.split_at_checked(n)?;
        self.0 = rest;
        Some(value)
    }
}

fn put_string(out: &mut Vec<u8>, value: &[u8]) {
    out.extend((value.len() as u32).to_be_bytes());
    out.extend(value);
}

/// One length-prefixed frame.
pub fn frame(body: &[u8]) -> Vec<u8> {
    let mut out = (body.len() as u32).to_be_bytes().to_vec();
    out.extend(body);
    out
}

pub fn identities_request() -> Vec<u8> {
    vec![REQUEST_IDENTITIES]
}

/// Request type 13: key blob, the exact 32 digest bytes, and flags zero.
pub fn sign_request(blob: &[u8], digest: &[u8; 32]) -> Vec<u8> {
    let mut out = vec![SIGN_REQUEST];
    put_string(&mut out, blob);
    put_string(&mut out, digest);
    out.extend(0u32.to_be_bytes());
    out
}

/// A frame length from its 4-byte header.
pub fn frame_length(header: [u8; 4]) -> Result<usize> {
    let n = u32::from_be_bytes(header);
    if n == 0 || n > MAX_FRAME {
        return Err(protocol("The agent returned an invalid frame length."));
    }
    Ok(n as usize)
}

/// `Ok(None)` marks a well-formed identity of another algorithm, which is skipped.
fn parse_key_blob(blob: &[u8]) -> std::result::Result<Option<[u8; 32]>, ()> {
    let mut p = Parser(blob);
    let algorithm = p.string().filter(|a| !a.is_empty()).ok_or(())?;
    if algorithm != b"ssh-ed25519" {
        return Ok(None);
    }
    let key = p.string().ok_or(())?;
    if !p.0.is_empty() {
        return Err(());
    }
    key.try_into().map(Some).map_err(|_| ())
}

pub fn parse_identities(body: &[u8]) -> Result<Vec<Signer>> {
    let mut p = Parser(body);
    if p.byte() != Some(IDENTITIES_ANSWER) {
        return Err(protocol("The agent returned an invalid identities response."));
    }
    let count = p.uint32().filter(|&n| n <= MAX_IDENTITIES);
    let Some(count) = count else {
        return Err(protocol("The agent returned too many identities."));
    };
    let mut signers: Vec<Signer> = Vec::new();
    for _ in 0..count {
        let (Some(blob), Some(comment)) = (p.string(), p.string()) else {
            return Err(protocol("The agent returned an invalid identity."));
        };
        let Ok(comment) = std::str::from_utf8(comment) else {
            return Err(protocol("The agent returned an invalid identity."));
        };
        let Ok(key) = parse_key_blob(blob) else {
            return Err(protocol("The agent returned an invalid key blob."));
        };
        let Some(key) = key else { continue };
        let public_key = account_address(&key);
        if signers.iter().any(|s| s.public_key == public_key) {
            return Err(protocol("The agent returned a duplicate Ed25519 identity."));
        }
        let fingerprint = format!("SHA256:{}", STANDARD_NO_PAD.encode(sha256(blob)));
        signers.push(Signer {
            public_key,
            fingerprint,
            comment: comment.to_owned(),
            blob: blob.to_vec(),
            key,
        });
    }
    if !p.0.is_empty() {
        return Err(protocol("The agent returned trailing identities data."));
    }
    Ok(signers)
}

/// The raw signature from a type-14 response. A bare type-5 response is a refusal.
pub fn parse_signature(body: &[u8]) -> Result<[u8; 64]> {
    let mut p = Parser(body);
    let kind = p.byte().ok_or_else(|| protocol("The agent returned an invalid sign response."))?;
    if kind == FAILURE && p.0.is_empty() {
        return Err(Error::new(
            "signing_refused",
            "The agent returned SSH_AGENT_FAILURE for the signing request.",
        ));
    }
    if kind != SIGN_RESPONSE {
        return Err(protocol("The agent returned an invalid sign response."));
    }
    let wrapped = p.string().filter(|_| p.0.is_empty());
    let Some(wrapped) = wrapped else {
        return Err(protocol("The agent returned an invalid signature wrapper."));
    };
    let mut s = Parser(wrapped);
    let (algorithm, signature) = (s.string(), s.string());
    match (algorithm, signature) {
        (Some(b"ssh-ed25519"), Some(signature)) if s.0.is_empty() => {
            signature.try_into().map_err(|_| protocol("The agent returned an invalid Ed25519 signature."))
        }
        _ => Err(protocol("The agent returned an invalid Ed25519 signature.")),
    }
}

/// Accept only a socket that the current user owns with no group or other permissions.
pub fn check_socket(path: &Path) -> Result<()> {
    let Ok(info) = std::fs::symlink_metadata(path) else {
        return Err(unavailable());
    };
    if !info.file_type().is_socket() || info.permissions().mode() & 0o077 != 0 || info.uid() != current_uid()
    {
        return Err(Error::new(
            "agent_unavailable",
            "The 1Password socket has an invalid type, owner, or mode.",
        ));
    }
    Ok(())
}

/// Verify the agent's signature before any caller sees it.
pub fn verify_signature(signer: &Signer, digest: &[u8; 32], signature: &[u8; 64]) -> Result<()> {
    if verify(&signer.key, digest, signature) {
        Ok(())
    } else {
        Err(Error::new("invalid_signature", "The agent signature failed Ed25519 verification."))
    }
}

/// One connection shared by CLI and bridge callers. Every exchange uses the same absolute deadline.
/// Dropping a pending operation closes its owned connection; signing is never retried.
pub struct Agent {
    stream: UnixStream,
    deadline: Instant,
}

/// Check both sides of the await. A buffered response must not defeat an expired deadline.
async fn bounded<T>(deadline: Instant, work: impl Future<Output = Result<T>>) -> Result<T> {
    if Instant::now() >= deadline {
        return Err(timeout());
    }
    let result = tokio::time::timeout_at(deadline.into(), work).await.unwrap_or_else(|_| Err(timeout()));
    if Instant::now() >= deadline { Err(timeout()) } else { result }
}

impl Agent {
    pub async fn connect(path: &Path, deadline: Instant) -> Result<Self> {
        check_socket(path)?;
        let stream =
            bounded(deadline, async { UnixStream::connect(path).await.map_err(|_| unavailable()) }).await?;
        Ok(Self { stream, deadline })
    }

    /// Send once. Only a close before any response bytes uses the operation-specific error.
    async fn exchange(&mut self, body: &[u8], closed: fn() -> Error) -> Result<Vec<u8>> {
        let out = frame(body);
        bounded(self.deadline, async { self.stream.write_all(&out).await.map_err(|_| unavailable()) })
            .await?;
        let mut header = [0u8; 4];
        bounded(self.deadline, async {
            let first = self.stream.read(&mut header).await.map_err(|_| truncated())?;
            if first == 0 {
                return Err(closed());
            }
            self.stream.read_exact(&mut header[first..]).await.map_err(|_| truncated())?;
            Ok(())
        })
        .await?;
        let mut response = vec![0u8; frame_length(header)?];
        bounded(self.deadline, async {
            self.stream.read_exact(&mut response).await.map_err(|_| truncated())?;
            Ok(())
        })
        .await?;
        Ok(response)
    }

    pub async fn list(&mut self) -> Result<Vec<Signer>> {
        parse_identities(&self.exchange(&identities_request(), truncated).await?)
    }

    pub async fn sign(&mut self, signer: &Signer, digest: &[u8; 32]) -> Result<[u8; 64]> {
        let body = self.exchange(&sign_request(&signer.blob, digest), closed).await?;
        let signature = parse_signature(&body)?;
        verify_signature(signer, digest, &signature)?;
        Ok(signature)
    }
}

/// List within one deadline. Cancellation drops the connection.
pub async fn list(path: &Path, limit: Duration, cancel: &Cancel) -> Result<Vec<Signer>> {
    let deadline = Instant::now() + limit;
    cancel.run(async { Agent::connect(path, deadline).await?.list().await }).await
}

/// List and sign on one connection. Cancellation cannot prove that 1Password stopped signing.
pub async fn sign(
    path: &Path,
    public_key: &str,
    digest: &[u8; 32],
    limit: Duration,
    cancel: &Cancel,
) -> Result<[u8; 64]> {
    let deadline = Instant::now() + limit;
    cancel
        .run(async {
            let mut agent = Agent::connect(path, deadline).await?;
            let signers = agent.list().await?;
            let Some(signer) = signers.iter().find(|s| s.public_key == public_key) else {
                return Err(Error::new(
                    "key_not_found",
                    "The selected public key is not available from the agent.",
                ));
            };
            agent.sign(signer, digest).await
        })
        .await
}
