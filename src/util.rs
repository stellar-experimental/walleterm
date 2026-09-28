use sha2::{Digest, Sha256};

pub fn sha256(data: &[u8]) -> [u8; 32] {
    Sha256::digest(data).into()
}

/// Lowercase hexadecimal.
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}

/// Decode exactly `N` bytes from lowercase hexadecimal. Uppercase and other lengths fail.
pub fn lower_hex<const N: usize>(text: &str) -> Option<[u8; N]> {
    let digits = text.as_bytes();
    if digits.len() != N * 2 {
        return None;
    }
    let value = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    let mut out = [0u8; N];
    for (i, pair) in digits.chunks_exact(2).enumerate() {
        out[i] = value(pair[0])? << 4 | value(pair[1])?;
    }
    Some(out)
}

/// JavaScript `String#length`: UTF-16 code units.
pub fn js_length(text: &str) -> usize {
    text.encode_utf16().count()
}

/// JavaScript `String#trim` whitespace: Unicode White_Space plus U+FEFF, without U+0085.
pub fn js_blank(text: &str) -> bool {
    text.chars().all(|c| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

/// The network passphrase check shared by every signing path.
pub fn valid_passphrase(text: &str) -> bool {
    !js_blank(text) && js_length(text) <= 256
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips_every_byte() {
        let all: Vec<u8> = (0..=255).collect();
        let text = hex(&all);
        assert_eq!(text.len(), 512);
        for (i, chunk) in text.as_bytes().chunks(2).enumerate() {
            assert_eq!(lower_hex::<1>(std::str::from_utf8(chunk).unwrap()), Some([i as u8]));
        }
    }

    #[test]
    fn lower_hex_rejects_other_forms() {
        assert_eq!(lower_hex::<1>("AB"), None);
        assert_eq!(lower_hex::<1>("a"), None);
        assert_eq!(lower_hex::<1>("abc"), None);
        assert_eq!(lower_hex::<1>("zz"), None);
        assert_eq!(lower_hex::<1>("é"), None);
        assert_eq!(lower_hex::<2>("00ff"), Some([0, 255]));
    }

    #[test]
    fn passphrase_uses_javascript_rules() {
        assert!(!valid_passphrase(""));
        assert!(!valid_passphrase(" \t\n\u{feff}\u{a0}\u{2028}\u{3000}"));
        assert!(valid_passphrase("\u{85}"));
        assert!(valid_passphrase("Test SDF Network ; September 2015"));
        assert!(valid_passphrase(&"a".repeat(256)));
        assert!(!valid_passphrase(&"a".repeat(257)));
        // One astral character counts as two UTF-16 units.
        assert!(valid_passphrase(&"😀".repeat(128)));
        assert!(!valid_passphrase(&format!("{}a", "😀".repeat(128))));
    }
}
