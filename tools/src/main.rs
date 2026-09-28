//! Maintainer tools: `package`, `install`, `release`, and the contract fixture manifests. They call Bun, Cargo, and the macOS signing tools
//! with argument lists and checked exits. Nothing here ships in a release.

mod fixtures;
mod install;
mod notices;
mod package;
mod release;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub type Result<T> = std::result::Result<T, String>;

/// The repository root: the parent of this package.
pub fn repository() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().expect("tools lives in the repository").to_path_buf()
}

/// A minimal environment. Shell settings such as RUSTFLAGS, CARGO_*, or a loaded .env cannot change a build.
pub fn environment(extra: &[(&str, &str)]) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = ["PATH", "HOME", "TMPDIR", "LANG", "USER", "RUSTUP_HOME"]
        .iter()
        .filter_map(|name| std::env::var(name).ok().map(|value| (name.to_string(), value)))
        .collect();
    env.extend(extra.iter().map(|(k, v)| (k.to_string(), v.to_string())));
    env
}

/// Run a command with the given environment. Returns trimmed standard output.
pub fn run(program: &str, args: &[&str], cwd: &Path, env: &[(String, String)]) -> Result<String> {
    let output = Command::new(program)
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs(env.iter().map(|(k, v)| (k, v)))
        .stdin(Stdio::null())
        .stderr(Stdio::inherit())
        .output()
        .map_err(|e| format!("{program} could not start: {e}"))?;
    if !output.status.success() {
        return Err(format!("{program} {} failed.", args.first().unwrap_or(&"")));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

/// A new private directory under `parent` that removes itself unless kept.
pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new(parent: &Path, prefix: &str) -> Result<Self> {
        use std::os::unix::fs::DirBuilderExt;
        std::fs::create_dir_all(parent).map_err(|e| format!("{}: {e}", parent.display()))?;
        for attempt in 0..16u32 {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |d| d.subsec_nanos());
            let dir = parent.join(format!("{prefix}{}-{nanos:08x}{attempt}", std::process::id()));
            match std::fs::DirBuilder::new().mode(0o700).create(&dir) {
                Ok(()) => return Ok(Self(dir)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(format!("{}: {e}", dir.display())),
            }
        }
        Err("A private directory could not be created.".into())
    }
    /// Keep the directory: it moved or it is the result.
    pub fn keep(mut self) -> PathBuf {
        std::mem::take(&mut self.0)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        if !self.0.as_os_str().is_empty() {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

const USAGE: &str = "Use walleterm-tools package <directory> [version], install <prefix>, \
release <major.minor.patch> [--publish | --no-notarize], fixture-manifest <wasm directory> <OpenZeppelin commit>, \
or cap85-manifest <fixtures/cap85 directory>.";

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    let root = repository();
    let result = match args.as_slice() {
        ["package", out] => {
            package::package(&root, Path::new(out), None).map(|v| format!("Built walleterm {v} in {out}."))
        }
        ["package", out, version] => package::package(&root, Path::new(out), Some(version))
            .map(|v| format!("Built walleterm {v} in {out}.")),
        ["install", prefix] => install::install(&root, Path::new(prefix)),
        ["release", version, flags @ ..] => release::release(&root, version, flags),
        ["fixture-manifest", out, commit] => fixtures::write_fixture_manifest(Path::new(out), commit),
        ["cap85-manifest", here] => fixtures::write_cap85_manifest(Path::new(here)),
        _ => Err(USAGE.into()),
    };
    match result {
        Ok(message) => println!("{message}"),
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    }
}
