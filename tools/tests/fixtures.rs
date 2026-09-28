//! `fixtures/build.sh` with fake `stellar` and `cargo` programs and an isolated Git source.
//! A tracked change in the OpenZeppelin checkout stops the build before any compiler or manifest call.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn script(path: &Path, body: &str) {
    std::fs::write(path, format!("#!/bin/sh\n{body}")).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
}

fn git(source: &Path, hooks: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(source)
        .args(["-c", "commit.gpgsign=false", "-c"])
        .arg(format!("core.hooksPath={}", hooks.display()))
        .args(["-c", "user.name=Fixture Test", "-c", "user.email=fixture@example.invalid"])
        .args(args)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn lines(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path).map(|t| t.lines().map(str::to_owned).collect()).unwrap_or_default()
}

fn run(state: &str) {
    let root = Dir(PathBuf::from(format!("/private/tmp/wtf-{state}-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&root.0);
    let (source, tools, hooks, output) =
        (root.0.join(".oz-src"), root.0.join("tools"), root.0.join("hooks"), root.0.join("wasm"));
    for dir in [&source, &tools, &hooks, &output, &root.0.join("contracts")] {
        std::fs::create_dir_all(dir).unwrap();
    }
    let (compiler_log, manifest_log) = (root.0.join("compiler.log"), root.0.join("manifest.log"));
    let (artifact, manifest) = (output.join("existing.wasm"), output.join("manifest.json"));
    git(&source, &hooks, &["init", "-q"]);
    let contract = source.join("contract.rs");
    std::fs::write(&contract, "reviewed source\n").unwrap();
    git(&source, &hooks, &["add", "contract.rs"]);
    git(&source, &hooks, &["commit", "-qm", "isolated fixture source"]);
    let head = git(&source, &hooks, &["rev-parse", "HEAD"]).trim().to_owned();
    // The copied script uses the synthetic commit instead of fetching upstream.
    let original = std::fs::read_to_string(walleterm_root().join("fixtures/build.sh")).unwrap();
    let pinned = original.lines().find(|l| l.starts_with("OZ_COMMIT=\"")).unwrap();
    std::fs::write(root.0.join("build.sh"), original.replace(pinned, &format!("OZ_COMMIT=\"{head}\"")))
        .unwrap();
    script(
        &tools.join("stellar"),
        &format!(
            "printf '%s\\n' \"$*\" >> '{}'\nprintf rebuilt > '{}'\n",
            compiler_log.display(),
            artifact.display()
        ),
    );
    script(
        &tools.join("cargo"),
        &format!(
            "printf '%s\\n' \"$*\" >> '{}'\nprintf 'new manifest' > '{}'\n",
            manifest_log.display(),
            manifest.display()
        ),
    );
    std::fs::write(&artifact, "existing artifact").unwrap();
    std::fs::write(&manifest, "existing manifest").unwrap();
    if state != "clean" {
        std::fs::write(&contract, "developer change\n").unwrap();
    }
    if state == "staged" {
        git(&source, &hooks, &["add", "contract.rs"]);
    }
    let index = std::fs::read(source.join(".git/index")).unwrap();

    let result = Command::new("sh")
        .arg(root.0.join("build.sh"))
        .env("PATH", format!("{}:{}", tools.display(), std::env::var("PATH").unwrap()))
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&result.stderr);
    assert_eq!(result.status.code(), Some(if state == "clean" { 0 } else { 1 }), "{state}: {stderr}");
    assert_eq!(std::fs::read(source.join(".git/index")).unwrap(), index, "{state}");
    assert_eq!(git(&source, &hooks, &["rev-parse", "HEAD"]).trim(), head, "{state}");
    if state == "clean" {
        assert_eq!(lines(&compiler_log).len(), 5);
        let calls = lines(&manifest_log);
        assert_eq!(calls.len(), 1);
        assert!(calls[0].contains("-p walleterm-tools -- fixture-manifest"), "{calls:?}");
        assert!(calls[0].ends_with(&head), "{calls:?}");
        assert_eq!(std::fs::read_to_string(&artifact).unwrap(), "rebuilt");
        assert_eq!(std::fs::read_to_string(&manifest).unwrap(), "new manifest");
    } else {
        assert!(stderr.to_lowercase().contains("tracked changes"), "{state}: {stderr}");
        assert!(!compiler_log.exists() && !manifest_log.exists(), "{state}");
        assert_eq!(std::fs::read_to_string(&artifact).unwrap(), "existing artifact");
        assert_eq!(std::fs::read_to_string(&manifest).unwrap(), "existing manifest");
    }
}

fn walleterm_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

#[test]
fn the_fixture_build_accepts_clean_source() {
    run("clean");
}

#[test]
fn the_fixture_build_rejects_unstaged_tracked_changes() {
    run("unstaged");
}

#[test]
fn the_fixture_build_rejects_staged_tracked_changes() {
    run("staged");
}
