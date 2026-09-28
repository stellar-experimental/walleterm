//! SEP-43 `signAuthEntry` input: a CAP-71 address-bound authorization preimage.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use stellar_xdr::{HashIdPreimage, HashIdPreimageSorobanAuthorizationWithAddress};

use crate::authorization::{count_auth_contexts, verify};
use crate::error::{Result, fail};
use crate::stellar::{self, Decode};
use crate::util::{lower_hex, sha256};

pub const MAX_PREIMAGE_XDR: usize = 32768;
/// The SDK contract client defaults to the latest ledger plus 100. Keep slack for RPC differences.
pub const MAX_PREIMAGE_LEDGER_WINDOW: u32 = 120;

fn invalid<T>(message: &str) -> Result<T> {
    fail("invalid_request", message)
}

pub struct CheckedPreimage {
    pub preimage: HashIdPreimageSorobanAuthorizationWithAddress,
    pub address: String,
    pub digest: [u8; 32],
    pub key: [u8; 32],
}

/// Validate one preimage and compute the digest that the key signs.
/// Without `latest_ledger`, only the structure is checked. The bridge supplies a trusted ledger.
pub fn inspect_auth_preimage(
    preimage_xdr: &str,
    public_key: &str,
    network_passphrase: &str,
    latest_ledger: Option<u32>,
) -> Result<CheckedPreimage> {
    let Some(key) = stellar::account_key(public_key) else {
        return fail("address_mismatch", "Select a valid G-address.");
    };
    if preimage_xdr.is_empty() || preimage_xdr.len() > MAX_PREIMAGE_XDR {
        return invalid("The authorization preimage is invalid or too large.");
    }
    let preimage: HashIdPreimage = match stellar::decode(preimage_xdr) {
        Ok(value) => value,
        Err(Decode::NonCanonical) => return invalid("Use canonical authorization preimage XDR."),
        Err(Decode::Invalid) => {
            return invalid("Use Base64 HashIdPreimage XDR from buildAuthorizationEntryPreimage.");
        }
    };
    let preimage = match preimage {
        HashIdPreimage::SorobanAuthorizationWithAddress(value) => value,
        HashIdPreimage::SorobanAuthorization(_) => {
            return fail(
                "unsupported",
                "Use an address-bound (CAP-71) preimage. The legacy preimage permits cross-address replay.",
            );
        }
        _ => return invalid("The preimage is not a Soroban authorization preimage."),
    };
    if preimage.network_id.0 != sha256(network_passphrase.as_bytes()) {
        return fail("network_unsupported", "The authorization is for a different network.");
    }
    let address = preimage.address.to_string();
    if address != public_key && !stellar::is_contract(&address) {
        return fail(
            "address_mismatch",
            "The authorization address must be the selected G-address or a C-address.",
        );
    }
    count_auth_contexts(&preimage.invocation)?;
    let expiration = preimage.signature_expiration_ledger;
    if let Some(latest) = latest_ledger
        && (expiration <= latest
            || u64::from(expiration) > u64::from(latest) + u64::from(MAX_PREIMAGE_LEDGER_WINDOW))
    {
        return invalid("The authorization must expire within the next 120 ledgers.");
    }
    let digest =
        sha256(&stellar::xdr_bytes(&HashIdPreimage::SorobanAuthorizationWithAddress(preimage.clone())));
    Ok(CheckedPreimage { preimage, address, digest, key })
}

/// Verify the raw signature, then return it as canonical Base64.
pub fn attach_preimage_signature(
    preimage_xdr: &str,
    public_key: &str,
    network_passphrase: &str,
    latest_ledger: u32,
    signature: &str,
) -> Result<String> {
    let checked = inspect_auth_preimage(preimage_xdr, public_key, network_passphrase, Some(latest_ledger))?;
    let Some(raw) = lower_hex::<64>(signature) else {
        return fail("internal", "The signer returned an invalid signature.");
    };
    if !verify(&checked.key, &checked.digest, &raw) {
        return invalid("The authorization signature failed independent verification.");
    }
    Ok(STANDARD.encode(raw))
}
