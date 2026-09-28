//! A CAP-71 address-bound authorization preimage, as SEP-43 `signAuthEntry` and the SDK callbacks pass it.

use stellar_xdr::{HashIdPreimage, HashIdPreimageSorobanAuthorizationWithAddress};

use crate::authorization::{count_auth_contexts, expiration_set};
use crate::error::{Result, fail};
use crate::stellar::{self, Decode};
use crate::util::sha256;

pub const MAX_PREIMAGE_XDR: usize = 32768;

fn invalid<T>(message: &str) -> Result<T> {
    fail("invalid_request", message)
}

pub struct CheckedPreimage {
    pub preimage: HashIdPreimageSorobanAuthorizationWithAddress,
    pub address: String,
    pub digest: [u8; 32],
}

/// Validate one preimage and compute the digest that the key signs.
/// The bound address can be any G- or C-address. The bridge limits it to the selected G-address or a C-address.
pub fn inspect(preimage_xdr: &str, network_passphrase: &str) -> Result<CheckedPreimage> {
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
    if stellar::account_key(&address).is_none() && !stellar::is_contract(&address) {
        return invalid("The authorization address must be a G-address or a C-address.");
    }
    count_auth_contexts(&preimage.invocation)?;
    expiration_set(preimage.signature_expiration_ledger).or_else(|e| invalid(&e.message))?;
    let digest =
        sha256(&stellar::xdr_bytes(&HashIdPreimage::SorobanAuthorizationWithAddress(preimage.clone())));
    Ok(CheckedPreimage { preimage, address, digest })
}
