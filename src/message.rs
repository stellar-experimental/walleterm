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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_limit_counts_utf8_bytes_and_refuses_empty_text() {
        assert!(inspect(&"a".repeat(1024)).is_ok());
        assert!(inspect(&"é".repeat(512)).is_ok());
        for text in [String::new(), "a".repeat(1025), "é".repeat(513)] {
            let e = inspect(&text).unwrap_err();
            assert_eq!(
                (e.code, e.message.as_str()),
                ("invalid_request", "The message must contain 1 to 1024 UTF-8 bytes.")
            );
        }
        assert_eq!(inspect("Hello, World!").unwrap(), digest(b"Hello, World!"));
    }
}
