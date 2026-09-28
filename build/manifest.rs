//! The demo asset manifest (`routes.tsv`): route, MIME type, SHA-256, and file path on each line.
//! `build.rs` embeds only files whose bytes match their recorded digest. `src/demo.rs` tests the same code.

use sha2::{Digest, Sha256};

#[derive(Debug)]
pub struct Entry {
    pub route: String,
    pub mime: String,
    pub sha256: String,
    pub path: String,
}

/// Parse the manifest and check each file with `read`. Any malformed line, missing file, or changed file fails.
pub fn verify(
    text: &str,
    read: impl Fn(&str) -> std::io::Result<Vec<u8>>,
) -> Result<Vec<(Entry, Vec<u8>)>, String> {
    let mut entries = Vec::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let fields: Vec<&str> = line.split('\t').collect();
        let [route, mime, sha256, path] = fields[..] else {
            return Err(format!("routes.tsv has a malformed line: {line}"));
        };
        let hex = |b: &u8| b.is_ascii_digit() || (b'a'..=b'f').contains(b);
        if !route.starts_with('/') || sha256.len() != 64 || !sha256.bytes().all(|b| hex(&b)) {
            return Err(format!("routes.tsv has a malformed line: {line}"));
        }
        let bytes = read(path).map_err(|e| format!("The demo asset {path} is unreadable: {e}"))?;
        let actual: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        if actual != sha256 {
            return Err(format!(
                "The demo asset {path} changed after its manifest was written. Build the assets again."
            ));
        }
        let entry =
            Entry { route: route.into(), mime: mime.into(), sha256: sha256.into(), path: path.into() };
        entries.push((entry, bytes));
    }
    if entries.is_empty() {
        return Err("routes.tsv lists no demo files".into());
    }
    Ok(entries)
}
