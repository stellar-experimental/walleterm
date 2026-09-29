//! The release command against fake external programs: git, gh, bun, cargo, rustc, security, codesign,
//! ditto, and xcrun. Nothing here signs, notarizes, tags, uploads, or opens a pull request.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

const COMMIT: &str = "1234567890abcdef1234567890abcdef12345678";

/// One dispatcher for every fake program. It logs each call and reads its fault mode from `mode`.
const FAKE: &str = r#"#!/bin/sh
here=$(cd "$(dirname "$0")/.." && pwd)
name=$(basename "$0")
mode=$(cat "$here/mode")
echo "$name $*" >> "$here/calls"
case "$name" in
git)
  case "$1" in
  rev-parse) echo 1234567890abcdef1234567890abcdef12345678 ;;
  worktree)
    if [ "$2" = add ]; then
      source="$5"
      mkdir -p "$source/demo/site/vendor" "$source/Casks"
      echo '{"dependencies":{}}' > "$source/package.json"
      printf '[[package]]\nname = "walleterm"\nversion = "0.0.0"\n' > "$source/Cargo.lock"
      echo 'Mock license text.' > "$source/demo/site/vendor/syntax.LICENSE"
      printf 'cask "walleterm" do\n  version "0.0.0"\n  sha256 "0000"\nend\n' > "$source/Casks/walleterm.rb"
    else
      rm -rf "$4"
    fi ;;
  status|tag|ls-remote|fetch|switch|commit|push) ;;
  *) exit 90 ;;
  esac ;;
bun)
  case "$1" in
  --version) echo 1.4.2 ;;
  install) ;;
  --no-env-file) mkdir -p "$3" ;;
  *) exit 90 ;;
  esac ;;
rustc) echo 'rustc 1.93.0 (mock)' ;;
security) echo '  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Developer ID Application: Mock (T4GBHCYB7P)"' ;;
cargo)
  case "$1" in
  build)
    mkdir -p "$CARGO_TARGET_DIR/release"
    printf '#!/bin/sh\ncase "$1" in\n--version) echo "walleterm %s" ;;\nsign) cat >/dev/null; echo %s; exit 2 ;;\n*) exit 99 ;;\nesac\n' \
      "$WALLETERM_VERSION" "'{\"ok\":false,\"error\":{\"code\":\"invalid_input\"}}'" > "$CARGO_TARGET_DIR/release/walleterm"
    chmod 700 "$CARGO_TARGET_DIR/release/walleterm" ;;
  metadata)
    echo '{"packages":[{"id":"w","name":"walleterm","version":"0.0.0","manifest_path":"/nowhere/Cargo.toml","license":"MIT"}],"resolve":{"nodes":[{"id":"w","deps":[]}]}}' ;;
  *) exit 90 ;;
  esac ;;
codesign)
  case "$1" in
  -dvv)
    printf 'Authority=Developer ID Application: Mock\nTeamIdentifier=T4GBHCYB7P\nflags=0x10000(runtime)\n' >&2
    if [ "$mode" = details-error ]; then exit 7; fi ;;
  -d)
    if [ "$mode" = entitlements-error ]; then echo 'Mock entitlement read failed' >&2; exit 7; fi
    if [ "$mode" = unexpected-entitlement ]; then
      echo '<plist><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>'
    fi ;;
  --verify|--force) ;;
  *) exit 90 ;;
  esac ;;
ditto) for last; do :; done; echo 'MOCK ARCHIVE. NOT A RELEASE.' > "$last" ;;
xcrun)
  case "$2" in
  submit) echo '{"status":"Accepted","id":"mock-notary"}' ;;
  log) ;;
  *) exit 90 ;;
  esac ;;
gh)
  case "$1 $2" in
  "run list") echo '[{"conclusion":"success"}]' ;;
  "release create") cp "$4" "$here/upload"; basename "$4" > "$here/archive-name" ;;
  "release download")
    dir=""; prev=""; for a; do [ "$prev" = --dir ] && dir="$a"; prev="$a"; done
    cp "$here/upload" "$dir/$(cat "$here/archive-name")" ;;
  "pr create") echo https://example.invalid/mock-pr ;;
  *) exit 90 ;;
  esac ;;
*) exit 91 ;;
esac
"#;

struct Dir(PathBuf);

impl Drop for Dir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

/// Run `release 0.0.999 --publish` in a scratch root with the fake programs in `mode`.
fn release(mode: &str) -> (bool, String, Vec<String>, Dir) {
    let base = Dir(PathBuf::from(format!("/private/tmp/wtr-{mode}-{}", std::process::id())));
    let _ = std::fs::remove_dir_all(&base.0);
    let (bin, root, tmp) = (base.0.join("bin"), base.0.join("root"), base.0.join("tmp"));
    for dir in [&bin, &root.join(".github/workflows"), &tmp] {
        std::fs::create_dir_all(dir).unwrap();
    }
    for file in [".github/workflows/test.yml", "rust-toolchain.toml"] {
        std::fs::copy(repository().join(file), root.join(file)).unwrap();
    }
    std::fs::write(base.0.join("fake"), FAKE).unwrap();
    std::fs::set_permissions(base.0.join("fake"), std::fs::Permissions::from_mode(0o700)).unwrap();
    for name in ["git", "gh", "bun", "cargo", "rustc", "security", "codesign", "ditto", "xcrun"] {
        std::os::unix::fs::symlink(base.0.join("fake"), bin.join(name)).unwrap();
    }
    std::fs::write(base.0.join("mode"), mode).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_walleterm-tools"))
        .args(["release", "0.0.999", "--publish"])
        .env_clear()
        .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
        .env("HOME", &base.0)
        .env("TMPDIR", &tmp)
        .env("WALLETERM_TOOLS_ROOT", &root)
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&output.stdout).to_string() + &String::from_utf8_lossy(&output.stderr);
    let calls = std::fs::read_to_string(base.0.join("calls"))
        .unwrap_or_default()
        .lines()
        .map(str::to_owned)
        .collect();
    (output.status.success(), text, calls, base)
}

fn called(calls: &[String], prefix: &str) -> bool {
    calls.iter().any(|c| c.starts_with(prefix))
}

#[test]
fn a_clean_release_signs_notarizes_publishes_and_proposes_the_cask() {
    let (ok, text, calls, base) = release("ok");
    assert!(ok, "{text}");
    assert!(text.contains("Published v0.0.999. Merge https://example.invalid/mock-pr"), "{text}");
    for step in [
        "codesign --force",
        "codesign -dvv",
        "codesign -d --entitlements",
        "ditto",
        "xcrun notarytool submit",
    ] {
        assert!(called(&calls, step), "{step}: {calls:?}");
    }
    for step in
        ["git tag --annotate v0.0.999", "gh release create v0.0.999", "gh release download", "gh pr create"]
    {
        assert!(called(&calls, step), "{step}: {calls:?}");
    }
    assert!(calls.iter().any(|c| c.contains(COMMIT)));
    assert!(called(&calls, "git worktree remove"), "the source worktree is removed");
    let checksums = std::fs::read_to_string(base.0.join("root/release/0.0.999/checksums.txt")).unwrap();
    assert!(checksums.ends_with("  walleterm-0.0.999-darwin-arm64.zip\n"));
}

/// Review P4-S1: a failed inspection is never read as "no entitlements".
#[test]
fn a_failed_signature_inspection_stops_before_any_archive_or_publication() {
    for mode in ["details-error", "entitlements-error"] {
        let (ok, text, calls, _base) = release(mode);
        assert!(!ok, "{mode}: {text}");
        assert!(
            text.contains("The signature inspection failed. Nothing was archived or published."),
            "{mode}: {text}"
        );
        for step in ["ditto", "xcrun", "git tag --annotate", "git push", "gh release", "gh pr"] {
            assert!(!called(&calls, step), "{mode} reached {step}: {calls:?}");
        }
        assert!(called(&calls, "git worktree remove"), "{mode}: the source worktree is removed");
    }
}

#[test]
fn an_unexpected_entitlement_stops_before_any_archive_or_publication() {
    let (ok, text, calls, _base) = release("unexpected-entitlement");
    assert!(!ok);
    assert!(text.contains("walleterm does not have the expected signature or entitlements."), "{text}");
    assert!(!called(&calls, "ditto") && !called(&calls, "gh release"), "{calls:?}");
}
