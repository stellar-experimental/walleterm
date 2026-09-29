//! The install command with fake `bun` and `cargo` programs. A real build is not needed to prove the links,
//! the content-addressed releases, and that a failed build leaves the installed command unchanged.

use std::path::{Path, PathBuf};
use std::process::Command;

struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn dir(name: &str) -> Dir {
    let path = PathBuf::from(format!("/private/tmp/wtt-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).unwrap();
    Dir(path)
}

fn script(path: &Path, body: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(path, format!("#!/bin/sh\nset -eu\nhere=$(dirname \"$0\")\n{body}")).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// `bun` makes the asset directory. `cargo build` writes `$here/content` as the binary, or fails when
/// `$here/fail` exists. `cargo metadata` lists only the walleterm package.
fn fakes(root: &Path) -> PathBuf {
    let bin = root.join("fake");
    std::fs::create_dir_all(&bin).unwrap();
    script(&bin.join("bun"), "mkdir -p \"$3\"\n");
    script(
        &bin.join("cargo"),
        r#"case "$1" in
metadata) printf '%s' '{"packages":[{"id":"w","name":"walleterm","version":"0.0.0","license":"MIT","manifest_path":"/nowhere/Cargo.toml"}],"resolve":{"nodes":[{"id":"w","deps":[]}]}}' ;;
build) [ ! -e "$here/fail" ]; mkdir -p "$CARGO_TARGET_DIR/release"; cp "$here/content" "$CARGO_TARGET_DIR/release/walleterm" ;;
*) exit 9 ;;
esac
"#,
    );
    bin
}

fn install(fake: &Path, prefix: &Path) -> (bool, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_walleterm-tools"))
        .args(["install", &prefix.to_string_lossy()])
        .env_clear()
        .env("PATH", format!("{}:/usr/bin:/bin", fake.display()))
        .env("HOME", std::env::var("HOME").unwrap())
        .output()
        .unwrap();
    (
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string() + &String::from_utf8_lossy(&output.stderr),
    )
}

fn installed(prefix: &Path) -> String {
    std::fs::read_to_string(prefix.join("bin/walleterm")).unwrap()
}

fn releases(prefix: &Path) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(prefix.join("share/walleterm/releases"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    names.sort();
    names
}

#[test]
fn install_switches_links_and_keeps_the_old_version_after_a_failed_build() {
    let work = dir("install");
    let fake = fakes(&work.0);
    let prefix = work.0.join("prefix");
    std::fs::write(fake.join("content"), "first").unwrap();

    let (ok, output) = install(&fake, &prefix);
    assert!(ok, "{output}");
    assert_eq!(installed(&prefix), "first");
    assert_eq!(std::fs::read_link(prefix.join("bin/stellar-walleterm")).unwrap(), Path::new("walleterm"));
    let notices = std::fs::read_to_string(
        prefix.join("bin/walleterm").canonicalize().unwrap().with_file_name("NOTICES.txt"),
    )
    .unwrap();
    assert!(notices.contains("== demo syntax highlighter (demo/site/vendor) =="));
    assert!(notices.contains("@stellar/stellar-sdk 17.2.0"));
    let first = releases(&prefix);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].len(), 24);

    // The same content maps to the same release directory.
    let (ok, output) = install(&fake, &prefix);
    assert!(ok, "{output}");
    assert_eq!(releases(&prefix), first);

    // A failed build leaves the links, the releases, and no stage directory behind.
    std::fs::write(fake.join("content"), "second").unwrap();
    std::fs::write(fake.join("fail"), "").unwrap();
    let (ok, output) = install(&fake, &prefix);
    assert!(!ok);
    assert!(output.contains("The build failed. The installed version did not change."), "{output}");
    assert_eq!(installed(&prefix), "first");
    assert_eq!(releases(&prefix), first);

    // An oversized executable must fail before the installed links can change.
    std::fs::remove_file(fake.join("fail")).unwrap();
    std::fs::File::create(fake.join("content")).unwrap().set_len(10_000_001).unwrap();
    let (ok, output) = install(&fake, &prefix);
    assert!(!ok, "{output}");
    assert_eq!(installed(&prefix), "first");
    assert_eq!(releases(&prefix), first);

    // A new build adds a release and keeps the old one for running processes and rollback.
    std::fs::write(fake.join("content"), "second").unwrap();
    let (ok, output) = install(&fake, &prefix);
    assert!(ok, "{output}");
    assert_eq!(installed(&prefix), "second");
    assert_eq!(releases(&prefix).len(), 2);
}

#[test]
fn install_refuses_to_replace_a_regular_alias_file() {
    let work = dir("alias");
    let fake = fakes(&work.0);
    let prefix = work.0.join("prefix");
    std::fs::write(fake.join("content"), "first").unwrap();
    std::fs::create_dir_all(prefix.join("bin")).unwrap();
    std::fs::write(prefix.join("bin/stellar-walleterm"), "keep me").unwrap();

    let (ok, output) = install(&fake, &prefix);
    assert!(!ok);
    assert!(output.contains("stellar-walleterm already exists."), "{output}");
    assert_eq!(std::fs::read_to_string(prefix.join("bin/stellar-walleterm")).unwrap(), "keep me");
    assert!(!prefix.join("bin/walleterm").exists());
}

#[test]
fn bad_arguments_print_the_usage() {
    for args in [
        &[][..],
        &["package"][..],
        &["release", "1.2"][..],
        &["release", "1.2.3", "--publish", "--no-notarize"][..],
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_walleterm-tools")).args(args).output().unwrap();
        assert_eq!(output.status.code(), Some(1), "{args:?}");
        assert!(String::from_utf8_lossy(&output.stderr).starts_with("Use walleterm-tools"), "{args:?}");
    }
}
