//! `OP_VAULT` from the shell or the working directory's `.env`. No other variable is read from a file.

use std::io;
use std::path::Path;

/// Bun's other `.env` files. The tunnel reports an `OP_VAULT` in them and ignores it.
pub const IGNORED: [&str; 5] =
    [".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"];

pub struct VaultSetting {
    /// `None` or an empty value lists every Ed25519 agent key.
    pub vault: Option<String>,
    /// Other `.env` files that set `OP_VAULT`.
    pub ignored: Vec<&'static str>,
}

/// Bun's `node:util.parseEnv` rules, byte for byte. `fixtures/parity/dotenv.json` freezes them.
/// Lines end at LF or CR. Keys use `[A-Za-z0-9_.-]`, an optional `export`, then `=` or `:` and a blank.
struct Parser<'a> {
    src: &'a [u8],
    pos: usize,
}

fn blank(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | 0x0b | 0x0c)
}

impl<'a> Parser<'a> {
    fn skip_blank(&mut self) {
        while self.src.get(self.pos).is_some_and(|&b| blank(b)) {
            self.pos += 1;
        }
    }

    /// Between a key and its `=` or `:`, line breaks count as blanks too.
    fn skip_space(&mut self) {
        while self.src.get(self.pos).is_some_and(|&b| blank(b) || b == b'\n' || b == b'\r') {
            self.pos += 1;
        }
    }

    fn skip_line(&mut self) {
        self.pos = match self.src[self.pos..].iter().position(|&b| b == b'\n' || b == b'\r') {
            Some(i) => self.pos + i + 1,
            None => self.src.len(),
        };
    }

    fn key(&mut self, check_export: bool) -> Option<&'a [u8]> {
        if check_export {
            self.skip_blank();
        }
        let start = self.pos;
        let mut end = start;
        while self.src.get(end).is_some_and(|&b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
        {
            end += 1;
        }
        if check_export && end < self.src.len() && &self.src[start..end] == b"export" {
            self.pos = end;
            self.skip_blank();
            if let Some(key) = self.key(false) {
                return Some(key);
            }
        }
        if start < end && end < self.src.len() {
            self.pos = end;
            self.skip_space();
            match self.src.get(self.pos) {
                Some(b'=') => {
                    self.pos += 1;
                    return Some(&self.src[start..end]);
                }
                Some(b':')
                    if self.src.get(self.pos + 1).is_some_and(|&b| blank(b) || b == b'\n' || b == b'\r') =>
                {
                    self.pos += 2;
                    return Some(&self.src[start..end]);
                }
                _ => {}
            }
        }
        self.pos = start;
        None
    }

    /// A quoted value, or `None` without its closing quote. The rest of the line after the quote is ignored.
    fn quoted(&mut self, quote: u8) -> Option<Vec<u8>> {
        let start = self.pos + 1;
        let mut end = start;
        while end < self.src.len() && self.src[end] != quote {
            end += if self.src[end] == b'\\' { 2 } else { 1 };
        }
        if end >= self.src.len() {
            return None;
        }
        let mut value = Vec::with_capacity(end - start);
        let mut i = start;
        while i < end {
            match self.src[i] {
                // Only double quotes treat a backslash as an escape. It keeps its next byte unchanged.
                b'\\' if quote == b'"' && i + 1 < end => {
                    match self.src[i + 1] {
                        b'n' => value.push(b'\n'),
                        b'r' => value.push(b'\r'),
                        next => value.extend([b'\\', next]),
                    }
                    i += 2;
                    continue;
                }
                b'\r' if self.src.get(i + 1) != Some(&b'\n') || i + 1 == end => value.push(b'\n'),
                b'\r' => {}
                b => value.push(b),
            }
            i += 1;
        }
        self.pos = end + 1;
        self.skip_line();
        Some(value)
    }

    fn value(&mut self) -> Vec<u8> {
        let start = self.pos;
        // A quote can open on a later line. An unquoted value starts where the assignment ended.
        self.skip_space();
        if let Some(&quote @ (b'"' | b'\'' | b'`')) = self.src.get(self.pos)
            && let Some(value) = self.quoted(quote)
        {
            return value;
        }
        let mut end = start;
        while end < self.src.len() && !matches!(self.src[end], b'#' | b'\r' | b'\n') {
            end += 1;
        }
        self.pos = end;
        let mut value = &self.src[start..end];
        while let [first, rest @ ..] = value
            && blank(*first)
        {
            value = rest;
        }
        while let [rest @ .., last] = value
            && blank(*last)
        {
            value = rest;
        }
        value.to_vec()
    }
}

/// Every assignment in dotenv text, in order. A later assignment of the same key wins.
pub fn parse_env(text: &str) -> Vec<(String, String)> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut parser = Parser { src: text.as_bytes(), pos: 0 };
    let mut pairs: Vec<(String, String)> = Vec::new();
    while parser.pos < parser.src.len() {
        let Some(key) = parser.key(true) else {
            parser.skip_line();
            continue;
        };
        let key = String::from_utf8_lossy(key).into_owned();
        let value = String::from_utf8_lossy(&parser.value()).into_owned();
        pairs.retain(|(k, _)| *k != key);
        pairs.push((key, value));
    }
    pairs
}

/// The value of `key` in dotenv text.
pub fn env_value(text: &str, key: &str) -> Option<String> {
    parse_env(text).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

fn read(dir: &Path, name: &str) -> io::Result<Option<String>> {
    match std::fs::read_to_string(dir.join(name)) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// The shell value wins, even when empty. Otherwise `.env` in `dir` supplies it.
pub fn load_vault(dir: &Path, shell: Option<String>) -> io::Result<VaultSetting> {
    let mut ignored = Vec::new();
    for name in IGNORED {
        if read(dir, name)?.is_some_and(|text| env_value(&text, "OP_VAULT").is_some()) {
            ignored.push(name);
        }
    }
    let vault = match shell {
        Some(value) => Some(value),
        None => read(dir, ".env")?.and_then(|text| env_value(&text, "OP_VAULT")),
    };
    Ok(VaultSetting { vault, ignored })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dotenv_values_follow_node_parse_env() {
        let cases = [
            ("OP_VAULT=Private\n", Some("Private")),
            ("# vault\nOP_VAULT=\"Private Keys\"\nOTHER=value\n", Some("Private Keys")),
            ("OP_VAULT='single # not a comment'", Some("single # not a comment")),
            ("OP_VAULT=plain # comment", Some("plain")),
            ("export OP_VAULT=Exported", Some("Exported")),
            ("  OP_VAULT  =  spaced  \r\n", Some("spaced")),
            ("OP_VAULT=first\nOP_VAULT=second", Some("second")),
            ("OP_VAULT=", Some("")),
            ("OP_VAULTX=no\nX_OP_VAULT=no", None),
            ("#OP_VAULT=commented", None),
            ("OP_VAULT=\"line\\nbreak\"", Some("line\nbreak")),
            ("OP_VAULT=\"multi\nline\"\nNEXT=1", Some("multi\nline")),
            // Review P3-S1: each of these once removed the vault filter.
            ("\u{feff}OP_VAULT=Private\n", Some("Private")),
            ("export\tOP_VAULT=Private\n", Some("Private")),
            ("OP_VAULT=Private\nNOTE=\"example\nOP_VAULT=\n\"\n", Some("Private")),
        ];
        for (text, want) in cases {
            assert_eq!(env_value(text, "OP_VAULT").as_deref(), want, "{text:?}");
        }
    }

    #[test]
    fn the_shell_wins_and_other_files_are_reported() {
        let dir = std::env::temp_dir().join(format!("walleterm-env-{}", crate::util::uuid()));
        std::fs::create_dir(&dir).unwrap();
        let setting = load_vault(&dir, None).unwrap();
        assert!(setting.vault.is_none() && setting.ignored.is_empty());
        std::fs::write(dir.join(".env"), "# vault\nOP_VAULT=\"Private Keys\"\nOTHER=value\n").unwrap();
        std::fs::write(dir.join(".env.local"), "OP_VAULT=Other\n").unwrap();
        std::fs::write(dir.join(".env.example"), "OP_VAULT=Example\n").unwrap();
        let setting = load_vault(&dir, None).unwrap();
        assert_eq!(setting.vault.as_deref(), Some("Private Keys"));
        assert_eq!(setting.ignored, vec![".env.local"]);
        assert_eq!(load_vault(&dir, Some(String::new())).unwrap().vault.as_deref(), Some(""));
        std::fs::remove_file(dir.join(".env")).unwrap();
        std::fs::create_dir(dir.join(".env")).unwrap();
        assert!(load_vault(&dir, None).is_err(), "an unreadable .env is an error, not an unset value");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
