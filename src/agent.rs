//! The 1Password SSH agent protocol (RFC 9987): list identities and sign one 32-byte digest.
//! Parsing is pure. The blocking client below serves the CLI; the bridge adds its own async IO.

use std::io::{self, Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Instant;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use serde::Serialize;

use crate::authorization::verify;
use crate::error::{Error, Result};
use crate::platform::{current_uid, wait_ready};
use crate::stellar::account_address;
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

/// One connection that lists and signs, bounded by one absolute deadline.
/// The socket is non-blocking; `poll` waits for each step, so no step can outlive the deadline.
pub struct Agent {
    stream: UnixStream,
    deadline: Instant,
}

impl Agent {
    pub fn connect(path: &Path, deadline: Instant) -> Result<Self> {
        check_socket(path)?;
        if Instant::now() >= deadline {
            return Err(timeout());
        }
        let stream = UnixStream::connect(path).map_err(|_| unavailable())?;
        stream.set_nonblocking(true).map_err(|_| unavailable())?;
        Ok(Self { stream, deadline })
    }

    /// Wait for the socket. `Ok(false)` means the deadline passed.
    fn wait(&self, events: libc::c_short) -> Result<()> {
        match wait_ready(self.stream.as_raw_fd(), events, self.deadline) {
            Ok(true) => Ok(()),
            Ok(false) => Err(timeout()),
            Err(_) => Err(unavailable()),
        }
    }

    fn read_full(&mut self, buf: &mut [u8]) -> Result<()> {
        let mut filled = 0;
        while filled < buf.len() {
            match self.stream.read(&mut buf[filled..]) {
                Ok(0) => return Err(protocol("The agent returned a truncated frame.")),
                Ok(n) => filled += n,
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => self.wait(libc::POLLIN)?,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Err(protocol("The agent returned a truncated frame.")),
            }
        }
        Ok(())
    }

    /// Send one request frame and read one response frame.
    pub fn exchange(&mut self, body: &[u8]) -> Result<Vec<u8>> {
        let out = frame(body);
        let mut sent = 0;
        while sent < out.len() {
            match self.stream.write(&out[sent..]) {
                Ok(0) => return Err(unavailable()),
                Ok(n) => sent += n,
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => self.wait(libc::POLLOUT)?,
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Err(unavailable()),
            }
        }
        let mut header = [0u8; 4];
        self.read_full(&mut header)?;
        let mut response = vec![0u8; frame_length(header)?];
        self.read_full(&mut response)?;
        Ok(response)
    }

    pub fn list(&mut self) -> Result<Vec<Signer>> {
        let body = self.exchange(&identities_request())?;
        parse_identities(&body)
    }

    /// Sign once and verify. This never retries the signing exchange.
    pub fn sign(&mut self, signer: &Signer, digest: &[u8; 32]) -> Result<[u8; 64]> {
        let body = self.exchange(&sign_request(&signer.blob, digest))?;
        let signature = parse_signature(&body)?;
        verify_signature(signer, digest, &signature)?;
        Ok(signature)
    }
}
