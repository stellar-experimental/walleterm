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

/// The value of `key` in dotenv text, with Node `util.parseEnv` rules. A later assignment wins.
pub fn env_value(text: &str, key: &str) -> Option<String> {
    let mut found = None;
    let mut rest = text;
    while !rest.is_empty() {
        let (line, after) = rest.split_once('\n').unwrap_or((rest, ""));
        rest = after;
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").map_or(line, str::trim_start);
        let Some((name, value)) = line.split_once('=') else { continue };
        if name.trim() != key {
            continue;
        }
        let value = value.trim_start();
        let quote = value.chars().next().filter(|c| matches!(c, '"' | '\'' | '`'));
        found = Some(match quote {
            Some(q) => {
                // A quoted value can continue on later lines until its closing quote.
                let body = &value[1..];
                if let Some(end) = body.find(q) {
                    let inside = &body[..end];
                    if q == '"' { inside.replace("\\n", "\n") } else { inside.to_owned() }
                } else if let Some(end) = rest.find(q) {
                    let inside = format!("{body}\n{}", &rest[..end]);
                    rest = rest[end + 1..].split_once('\n').map_or("", |(_, next)| next);
                    if q == '"' { inside.replace("\\n", "\n") } else { inside }
                } else {
                    value.trim_end().to_owned()
                }
            }
            None => value.split('#').next().unwrap_or_default().trim_end().to_owned(),
        });
    }
    found
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
