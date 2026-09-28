//! SEP-53 messages: UTF-8 text of 1 to 1024 bytes. The signer hashes the text itself.
//! https://github.com/stellar/stellar-protocol/blob/9cd703075d87a6ce293752b1532e7b68efe12ae1/ecosystem/sep-0053.md

use crate::error::{Result, fail};
use crate::util::sha256;

pub const PREFIX: &[u8] = b"Stellar Signed Message:\n";
pub const MAX_MESSAGE: usize = 1024;

/// SHA-256 of the SEP-53 prefix and the message bytes.
pub fn digest(message: &[u8]) -> [u8; 32] {
    let mut payload = PREFIX.to_vec();
    payload.extend_from_slice(message);
    sha256(&payload)
}

/// Check the text length in bytes, then compute the digest. There is no binary or precomputed-hash input.
pub fn inspect(text: &str) -> Result<[u8; 32]> {
    if text.is_empty() || text.len() > MAX_MESSAGE {
        return fail("invalid_request", "The message must contain 1 to 1024 UTF-8 bytes.");
    }
    Ok(digest(text.as_bytes()))
}
