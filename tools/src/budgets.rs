//! The release binary limit. The package tool checks it before it copies the binary.

use std::path::Path;

use crate::Result;

const MAX_BINARY_BYTES: u64 = 10_000_000;

/// Check the complete executable before the package tool copies it into its output directory.
pub fn binary(path: &Path) -> Result<()> {
    let bytes = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?.len();
    if bytes > MAX_BINARY_BYTES {
        return Err(format!("The walleterm binary has {bytes} bytes; the limit is {MAX_BINARY_BYTES}."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_complete_binary_must_fit_before_packaging() {
        let scratch = crate::Scratch::new(&std::env::temp_dir(), "walleterm-budget-").unwrap();
        let path = scratch.0.join("walleterm");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_BINARY_BYTES).unwrap();
        assert!(binary(&path).is_ok());
        file.set_len(MAX_BINARY_BYTES + 1).unwrap();
        assert!(binary(&path).unwrap_err().contains("10000001"));
        assert!(binary(&scratch.0.join("missing")).is_err());
    }
}
