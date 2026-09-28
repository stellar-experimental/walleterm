//! `fixture-manifest` and `cap85-manifest`: record the contract fixtures that `fixtures/build.sh` and
//! `fixtures/cap85/build.sh` build. Keys keep the order of the committed manifests. No network. No keys.

use std::path::Path;
use std::process::Command;

use crate::{Result, sha256_hex};

/// A JSON value that keeps its key order, printed like `JSON.stringify(value, null, 2)`.
pub enum Json {
    Str(String),
    Num(u64),
    Obj(Vec<(String, Json)>),
}

impl Json {
    fn obj<const N: usize>(pairs: [(&str, Json); N]) -> Self {
        Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
    }

    fn str(value: &str) -> Self {
        Json::Str(value.to_owned())
    }

    pub fn pretty(&self) -> String {
        let mut out = String::new();
        self.write(&mut out, 0);
        out
    }

    fn write(&self, out: &mut String, depth: usize) {
        match self {
            Json::Str(s) => out.push_str(&serde_json::to_string(s).expect("a string serializes")),
            Json::Num(n) => out.push_str(&n.to_string()),
            Json::Obj(pairs) if pairs.is_empty() => out.push_str("{}"),
            Json::Obj(pairs) => {
                out.push('{');
                for (i, (key, value)) in pairs.iter().enumerate() {
                    out.push_str(if i == 0 { "\n" } else { ",\n" });
                    out.push_str(&"  ".repeat(depth + 1));
                    out.push_str(&serde_json::to_string(key).expect("a string serializes"));
                    out.push_str(": ");
                    value.write(out, depth + 1);
                }
                out.push('\n');
                out.push_str(&"  ".repeat(depth));
                out.push('}');
            }
        }
    }
}

/// The current time as `Date#toISOString` prints it.
fn now_iso() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis())
        as i64;
    let (days, rest) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let (h, m, s, milli) = (rest / 3_600_000, rest / 60_000 % 60, rest / 1000 % 60, rest % 1000);
    format!("{year:04}-{month:02}-{day:02}T{h:02}:{m:02}:{s:02}.{milli:03}Z")
}

fn read(path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The `.wasm` files in `dir`, sorted by name.
fn wasm_files(dir: &Path) -> Result<Vec<String>> {
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .map_err(|e| format!("{}: {e}", dir.display()))?
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|name| name.ends_with(".wasm"))
        .collect();
    files.sort();
    Ok(files)
}

fn artifact(path: &Path, extra: Vec<(String, Json)>) -> Result<Json> {
    let bytes = read(path)?;
    let mut pairs = vec![
        ("sha256".to_owned(), Json::Str(sha256_hex(&bytes))),
        ("bytes".to_owned(), Json::Num(bytes.len() as u64)),
    ];
    pairs.extend(extra);
    Ok(Json::Obj(pairs))
}

/// The OpenZeppelin and local fixture manifest.
pub fn fixture_manifest(out: &Path, commit: &str, built_at: &str) -> Result<Json> {
    let mut artifacts = Vec::new();
    for name in wasm_files(out)? {
        let source = if name.starts_with("multisig_") {
            vec![
                ("repo".to_owned(), Json::str("OpenZeppelin/stellar-contracts")),
                ("commit".to_owned(), Json::str(commit)),
                ("path".to_owned(), Json::str("examples/multisig-smart-account")),
            ]
        } else {
            vec![
                ("repo".to_owned(), Json::str("local")),
                ("path".to_owned(), Json::str("fixtures/contracts")),
            ]
        };
        artifacts.push((name.clone(), artifact(&out.join(&name), source)?));
    }
    Ok(Json::obj([
        ("built_at", Json::str(built_at)),
        ("oz_commit", Json::str(commit)),
        ("artifacts", Json::Obj(artifacts)),
    ]))
}

/// The locked soroban-sdk version of one workspace.
fn sdk_version(lock: &str) -> Option<String> {
    let start =
        lock.find("name = \"soroban-sdk\"\nversion = \"")? + "name = \"soroban-sdk\"\nversion = \"".len();
    Some(lock[start..].split('"').next()?.to_owned())
}

/// The first output line of a toolchain command.
fn version(program: &str) -> Result<String> {
    let output = Command::new(program).arg("--version").output().map_err(|e| format!("{program}: {e}"))?;
    if !output.status.success() {
        return Err(format!("{program} --version failed."));
    }
    Ok(String::from_utf8_lossy(&output.stdout).lines().next().unwrap_or_default().trim().to_owned())
}

/// The CAP-85 manifest. `toolchain` holds rustc, cargo, and Stellar CLI versions.
pub fn cap85_manifest(here: &Path, built_at: &str, toolchain: [String; 3]) -> Result<Json> {
    const WORKSPACES: [(&str, &[&str]); 2] = [
        ("contracts", &["manager", "target-v1", "target-v2", "account"]),
        ("contracts-sdk27", &["legacy-account"]),
    ];
    let mut sources = Vec::new();
    let mut workspaces = Vec::new();
    for (workspace, crates) in WORKSPACES {
        let hash = |path: &str| read(&here.join(workspace).join(path)).map(|b| Json::Str(sha256_hex(&b)));
        sources.push((format!("{workspace}/Cargo.toml"), hash("Cargo.toml")?));
        sources.push((format!("{workspace}/Cargo.lock"), hash("Cargo.lock")?));
        for krate in crates {
            for file in ["Cargo.toml", "src/lib.rs"] {
                sources.push((format!("{workspace}/{krate}/{file}"), hash(&format!("{krate}/{file}"))?));
            }
        }
        let lock = String::from_utf8_lossy(&read(&here.join(workspace).join("Cargo.lock"))?).into_owned();
        // JSON.stringify leaves out an undefined value, so a missing version leaves out its key.
        let sdk: Vec<(String, Json)> =
            sdk_version(&lock).map(|v| ("soroban_sdk".to_owned(), Json::Str(v))).into_iter().collect();
        workspaces.push((workspace.to_owned(), Json::Obj(sdk)));
    }
    let mut artifacts = Vec::new();
    for name in wasm_files(&here.join("wasm"))? {
        let sdk = if name.contains("legacy") { "soroban-sdk 27" } else { "soroban-sdk 28" };
        artifacts.push((
            name.clone(),
            artifact(&here.join("wasm").join(&name), vec![("sdk".to_owned(), Json::str(sdk))])?,
        ));
    }
    let [rustc, cargo, stellar] = toolchain;
    Ok(Json::obj([
        ("built_at", Json::str(built_at)),
        ("cap", Json::str("CAP-0085 externally managed contract executables")),
        ("workspaces", Json::Obj(workspaces)),
        (
            "toolchain",
            Json::obj([
                ("rustc", Json::Str(rustc)),
                ("cargo", Json::Str(cargo)),
                ("stellar_cli", Json::Str(stellar)),
            ]),
        ),
        ("target", Json::str("wasm32v1-none")),
        (
            "profile",
            Json::str("release (opt-level z, lto, panic abort), stellar contract build default optimize"),
        ),
        ("sources", Json::Obj(sources)),
        ("artifacts", Json::Obj(artifacts)),
    ]))
}

fn write(path: &Path, manifest: &Json) -> Result<String> {
    let text = manifest.pretty();
    std::fs::write(path, format!("{text}\n")).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(text)
}

pub fn write_fixture_manifest(out: &Path, commit: &str) -> Result<String> {
    write(&out.join("manifest.json"), &fixture_manifest(out, commit, &now_iso())?)
}

pub fn write_cap85_manifest(here: &Path) -> Result<String> {
    let toolchain = [version("rustc")?, version("cargo")?, version("stellar")?];
    write(&here.join("wasm/manifest.json"), &cap85_manifest(here, &now_iso(), toolchain)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn committed(path: &str) -> (String, serde_json::Value) {
        let text = std::fs::read_to_string(crate::repository().join(path)).unwrap();
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        (text, value)
    }

    fn text(value: &serde_json::Value, key: &str) -> String {
        value[key].as_str().unwrap().to_owned()
    }

    #[test]
    fn the_fixture_manifest_reproduces_the_committed_file() {
        let (text_before, value) = committed("fixtures/wasm/manifest.json");
        let manifest = fixture_manifest(
            &crate::repository().join("fixtures/wasm"),
            &text(&value, "oz_commit"),
            &text(&value, "built_at"),
        )
        .unwrap();
        assert_eq!(manifest.pretty() + "\n", text_before);
    }

    #[test]
    fn the_cap85_manifest_reproduces_the_committed_file() {
        let (text_before, value) = committed("fixtures/cap85/wasm/manifest.json");
        let tool = |k: &str| value["toolchain"][k].as_str().unwrap().to_owned();
        let toolchain = [tool("rustc"), tool("cargo"), tool("stellar_cli")];
        let manifest =
            cap85_manifest(&crate::repository().join("fixtures/cap85"), &text(&value, "built_at"), toolchain)
                .unwrap();
        assert_eq!(manifest.pretty() + "\n", text_before);
    }

    #[test]
    fn times_match_date_to_iso_string() {
        let now = now_iso();
        assert_eq!(now.len(), 24);
        assert!(now.starts_with("20") && now.ends_with('Z') && now.as_bytes()[10] == b'T');
    }
}
