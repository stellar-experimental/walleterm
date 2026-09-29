//! One internal path for every artifact: inspect, sign 32 bytes, then finish. The CLI and the bridge share it.
//! The bridge adds its website rules at admission. The CLI adds none. No path reads a ledger.

use serde_json::{Value, json};

use crate::authorization::{CheckedAuth, attach_auth_signature, inspect_auth_entry};
use crate::error::{Result, fail};
use crate::stellar::{self, account_key, verify};
use crate::transaction::{self, CheckedTransaction};
use crate::util::hex;
use crate::{message, preimage};

#[derive(Clone, Debug)]
pub enum Artifact {
    Transaction(String),
    Preimage(String),
    Authorization { entry_xdr: String, address: String, adapter: Value },
    Message(String),
}

/// The signer and its context. `passphrase` is `None` only for a message, which binds no network.
pub struct Scope<'a> {
    /// The selected G-address.
    pub key: &'a str,
    pub passphrase: Option<&'a str>,
    /// Unix milliseconds, for an expired `max_time`.
    pub now_ms: u64,
}

pub struct Checked {
    pub key: [u8; 32],
    /// The 32 bytes that the key signs.
    pub digest: [u8; 32],
    /// The review details. The bridge shows them to its review hook; the CLI notice reads them.
    pub details: Value,
}

pub enum Signed {
    /// The raw signature is the result.
    Raw,
    Transaction(String),
    AuthEntry(String),
}

enum Parsed {
    Transaction(CheckedTransaction),
    Authorization(CheckedAuth),
    Raw,
}

fn passphrase<'a>(scope: &Scope<'a>) -> Result<&'a str> {
    scope.passphrase.map_or_else(|| fail("invalid_request", "Provide the exact network passphrase."), Ok)
}

fn parse(artifact: &Artifact, scope: &Scope) -> Result<(Checked, Parsed)> {
    let Some(key) = account_key(scope.key) else {
        return fail("address_mismatch", "Select a valid G-address.");
    };
    let checked = |digest: [u8; 32], details: Value| Checked { key, digest, details };
    Ok(match artifact {
        Artifact::Transaction(xdr) => {
            let network = passphrase(scope)?;
            let tx = transaction::inspect(xdr, &key, network, scope.now_ms)?;
            let details = transaction::details(&tx, xdr, network);
            (checked(tx.hash, details), Parsed::Transaction(tx))
        }
        Artifact::Preimage(xdr) => {
            let network = passphrase(scope)?;
            let p = preimage::inspect(xdr, network)?;
            let details = json!({
                "kind": "auth_entry",
                "hash": hex(&p.digest),
                "address": p.address,
                "public_key": scope.key,
                "network_passphrase": network,
                "nonce": p.preimage.nonce.to_string(),
                "expiration_ledger": p.preimage.signature_expiration_ledger,
                "invocation_xdr": stellar::encode(&p.preimage.invocation),
                "preimage_xdr": xdr,
            });
            (checked(p.digest, details), Parsed::Raw)
        }
        Artifact::Authorization { entry_xdr, address, adapter } => {
            let network = passphrase(scope)?;
            let auth = inspect_auth_entry(entry_xdr, network, address, adapter, &key)?;
            let details = json!({
                "kind": "authorization",
                "hash": hex(&auth.digest),
                "address": address,
                "public_key": scope.key,
                "network_passphrase": network,
                "credential_type": "sorobanCredentialsAddressV2",
                "nonce": auth.nonce.to_string(),
                "expiration_ledger": auth.expiration_ledger,
                "invocation_xdr": stellar::encode(&auth.entry.root_invocation),
                "adapter": adapter,
            });
            (checked(auth.digest, details), Parsed::Authorization(auth))
        }
        Artifact::Message(text) => {
            let digest = message::inspect(text)?;
            let details = json!({
                "kind": "message",
                "hash": hex(&digest),
                "public_key": scope.key,
                "bytes": text.len(),
                "message": text,
            });
            (checked(digest, details), Parsed::Raw)
        }
    })
}

/// Parse the artifact, apply the shared rules, and compute the digest.
pub fn inspect(artifact: &Artifact, scope: &Scope) -> Result<Checked> {
    parse(artifact, scope).map(|(checked, _)| checked)
}

/// Inspect again, verify the signature strictly, then attach it. No other byte changes.
pub fn finish(artifact: &Artifact, scope: &Scope, signature: &[u8; 64]) -> Result<Signed> {
    let (checked, parsed) = parse(artifact, scope)?;
    if !verify(&checked.key, &checked.digest, signature) {
        return fail("invalid_signature", "The signature failed independent verification.");
    }
    Ok(match parsed {
        Parsed::Transaction(tx) => Signed::Transaction(transaction::attach_signature(&tx, signature)),
        Parsed::Authorization(auth) => Signed::AuthEntry(attach_auth_signature(&auth, signature)),
        Parsed::Raw => Signed::Raw,
    })
}
