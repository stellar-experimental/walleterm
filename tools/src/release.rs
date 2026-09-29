//! `release <major.minor.patch> [--publish | --no-notarize]`: build, sign, and notarize on the maintainer's Mac.
//! The signing key stays in its keychain. Publication tags the source, uploads, checks the download,
//! and proposes the cask change as a pull request. Nothing pushes to main directly.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::{Result, Scratch, run, sha256_hex};

const TEAM_ID: &str = "4JWM8JNM37";
const NOTARY_PROFILE: &str = "walleterm-notary";
const REPOSITORY: &str = "stellar-experimental/walleterm";

fn env() -> Vec<(String, String)> {
    ["PATH", "HOME", "TMPDIR", "LANG", "USER", "SSH_AUTH_SOCK", "GH_TOKEN", "RUSTUP_HOME"]
        .iter()
        .filter_map(|name| std::env::var(name).ok().map(|value| (name.to_string(), value)))
        .collect()
}

pub fn valid_release_version(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
}

/// The cask with a new version and archive checksum. Other lines stay exact.
pub fn update_cask(cask: &str, version: &str, sha256: &str) -> String {
    cask.lines()
        .map(|line| {
            let trimmed = line.trim_start();
            let indent = &line[..line.len() - trimmed.len()];
            if trimmed.starts_with("version \"") {
                format!("{indent}version \"{version}\"")
            } else if trimmed.starts_with("sha256 \"") {
                format!("{indent}sha256 \"{sha256}\"")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

/// The pinned value `name: 'x'` from the CI workflow.
fn pinned(workflow: &str, name: &str) -> Option<String> {
    let start = workflow.find(&format!("{name}: '"))? + name.len() + 3;
    Some(workflow[start..].split('\'').next()?.to_owned())
}

pub fn release(root: &Path, version: &str, flags: &[&str]) -> Result<String> {
    let publish = flags.contains(&"--publish");
    let skip_notary = flags.contains(&"--no-notarize");
    if !valid_release_version(version)
        || flags.iter().any(|f| !matches!(*f, "--publish" | "--no-notarize"))
        || (publish && skip_notary)
    {
        return Err("Use walleterm-tools release <major.minor.patch> [--publish | --no-notarize].".into());
    }
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        return Err("Build releases on an Apple silicon Mac.".into());
    }
    let env = env();
    let tag = format!("v{version}");
    if !run("git", &["status", "--porcelain", "--untracked-files=no"], root, &env)?.is_empty() {
        return Err("Commit or stash tracked changes first.".into());
    }
    if !run("git", &["tag", "--list", &tag], root, &env)?.is_empty()
        || !run("git", &["ls-remote", "--tags", "origin", &tag], root, &env)?.is_empty()
    {
        return Err(format!("The tag {tag} already exists."));
    }
    let commit = run("git", &["rev-parse", "HEAD"], root, &env)?;
    if publish {
        run("git", &["fetch", "--quiet", "origin", "main"], root, &env)?;
        if commit != run("git", &["rev-parse", "origin/main"], root, &env)? {
            return Err("Publish from a checkout of origin/main.".into());
        }
        let runs = run(
            "gh",
            &[
                "run",
                "list",
                "--repo",
                REPOSITORY,
                "--commit",
                &commit,
                "--workflow",
                "test.yml",
                "--json",
                "conclusion",
            ],
            root,
            &env,
        )?;
        let runs: serde_json::Value = serde_json::from_str(&runs).map_err(|e| format!("gh run list: {e}"))?;
        if !runs.as_array().is_some_and(|runs| runs.iter().any(|r| r["conclusion"] == "success")) {
            return Err(format!("Wait for a passing Test workflow on {}.", &commit[..7]));
        }
    }
    // Use the exact toolchain that CI tests.
    let workflow =
        std::fs::read_to_string(root.join(".github/workflows/test.yml")).map_err(|e| e.to_string())?;
    let toolchain = std::fs::read_to_string(root.join("rust-toolchain.toml")).map_err(|e| e.to_string())?;
    let rust = toolchain
        .lines()
        .find_map(|l| l.trim().strip_prefix("channel = \"")?.strip_suffix('"').map(str::to_owned));
    let bun = run("bun", &["--version"], root, &env)?;
    let rustc = run("rustc", &["--version"], root, &env)?;
    if Some(bun.clone()) != pinned(&workflow, "bun-version")
        || rust.as_ref().is_none_or(|r| !rustc.starts_with(&format!("rustc {r} ")))
    {
        return Err(format!(
            "Use Bun {} and Rust {}, as CI does.",
            pinned(&workflow, "bun-version").unwrap_or_default(),
            rust.unwrap_or_default()
        ));
    }
    let identities = run("security", &["find-identity", "-v", "-p", "codesigning"], root, &env)?;
    let identity = identities
        .lines()
        .find(|l| l.contains("\"Developer ID Application:") && l.contains(&format!("({TEAM_ID})\"")))
        .and_then(|l| {
            l.split_whitespace().find(|w| w.len() == 40 && w.bytes().all(|b| b.is_ascii_hexdigit()))
        })
        .ok_or_else(|| format!("Install the Developer ID Application certificate for team {TEAM_ID}."))?
        .to_owned();

    // Build from a fresh worktree of HEAD. Ignored files and local dependencies cannot enter the release.
    let out = root.join("release").join(version);
    let stage = out.join("walleterm");
    let _ = std::fs::remove_dir_all(&out);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let parent = Scratch::new(&std::env::temp_dir(), "walleterm-release-")?;
    let source = parent.0.join("source");
    let source_text = source.to_string_lossy().to_string();
    run("git", &["worktree", "add", "--quiet", "--detach", &source_text, &commit], root, &env)?;
    let result = build_sign_publish(
        root,
        &source,
        &stage,
        &out,
        version,
        &commit,
        &identity,
        publish,
        skip_notary,
        &bun,
        &rustc,
    );
    let _ =
        Command::new("git").args(["worktree", "remove", "--force", &source_text]).current_dir(root).status();
    result
}

#[allow(clippy::too_many_arguments)]
fn build_sign_publish(
    root: &Path,
    source: &Path,
    stage: &Path,
    out: &Path,
    version: &str,
    commit: &str,
    identity: &str,
    publish: bool,
    skip_notary: bool,
    bun: &str,
    rustc: &str,
) -> Result<String> {
    let env = env();
    run("bun", &["install", "--frozen-lockfile", "--ignore-scripts"], source, &env)?;
    crate::package::package(source, stage, Some(version))?;
    // Hardened runtime is required for notarization. The native binary needs no entitlement.
    let binary = stage.join("walleterm");
    let path = binary.to_string_lossy().to_string();
    run(
        "codesign",
        &["--force", "--timestamp", "--options", "runtime", "--sign", identity, &path],
        root,
        &env,
    )?;
    run("codesign", &["--verify", "--strict", &path], root, &env)?;
    // Both inspections must succeed. An empty entitlement list is valid only from a successful read.
    let inspection = || "The signature inspection failed. Nothing was archived or published.".to_owned();
    let details = Command::new("codesign")
        .args(["-dvv", &path])
        .env_clear()
        .envs(env.iter().map(|(k, v)| (k, v)))
        .output()
        .map_err(|_| inspection())?;
    if !details.status.success() {
        return Err(inspection());
    }
    let details = String::from_utf8_lossy(&details.stderr).to_string();
    let entitlements = run("codesign", &["-d", "--entitlements", "-", "--xml", &path], root, &env)
        .map_err(|_| inspection())?;
    if !details.contains("Authority=Developer ID Application:")
        || !details.contains(&format!("TeamIdentifier={TEAM_ID}"))
        || !details.contains("flags=0x10000(runtime)")
        || entitlements.contains("<key>")
    {
        return Err("walleterm does not have the expected signature or entitlements.".into());
    }
    if run(&path, &["--version"], root, &env)? != format!("walleterm {version}") {
        return Err("The version check failed.".into());
    }
    let check = Command::new(&binary)
        .arg("sign")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().expect("piped").write_all(b"{}")?;
            child.wait_with_output()
        })
        .map_err(|e| e.to_string())?;
    if check.status.code() != Some(2) || !String::from_utf8_lossy(&check.stdout).contains("\"invalid_input\"")
    {
        return Err("The signed binary did not reject malformed input.".into());
    }
    let archive_name =
        format!("walleterm-{version}-darwin-arm64{}.zip", if skip_notary { "-unnotarized" } else { "" });
    let archive = out.join(&archive_name);
    let archive_text = archive.to_string_lossy().to_string();
    run("ditto", &["-c", "-k", "--norsrc", &stage.to_string_lossy(), &archive_text], root, &env)?;
    if !skip_notary {
        let submitted = run(
            "xcrun",
            &[
                "notarytool",
                "submit",
                &archive_text,
                "--keychain-profile",
                NOTARY_PROFILE,
                "--wait",
                "--output-format",
                "json",
            ],
            root,
            &env,
        )?;
        let submitted: serde_json::Value = serde_json::from_str(&submitted).map_err(|e| e.to_string())?;
        if submitted["status"] != "Accepted" {
            let id = submitted["id"].as_str().unwrap_or_default();
            let _ = Command::new("xcrun")
                .args(["notarytool", "log", id, "--keychain-profile", NOTARY_PROFILE])
                .status();
            return Err(format!("Apple notarization returned {}.", submitted["status"]));
        }
    }
    let sha256 = sha256_hex(&std::fs::read(&archive).map_err(|e| e.to_string())?);
    // site/install.sh reads this exact "<sha256>  <archive>" line from the latest release.
    let checksums = out.join("checksums.txt");
    std::fs::write(&checksums, format!("{sha256}  {archive_name}\n")).map_err(|e| e.to_string())?;
    std::fs::copy(stage.join("NOTICES.txt"), out.join("NOTICES.txt")).map_err(|e| e.to_string())?;
    let mut report =
        format!("Built {archive_name} ({sha256}) from {}.\nToolchain: Bun {bun}, {rustc}.", &commit[..7]);
    if !publish {
        report.push_str(if skip_notary {
            "\nApple did not notarize this archive. Do not publish it."
        } else {
            "\nApple notarized the archive."
        });
        report.push_str(&format!("\nPublish with: make release VERSION={version} PUBLISH=1"));
        return Ok(report);
    }
    // Publish the tagged source, then check the uploaded archive against the local checksum.
    let tag = format!("v{version}");
    run(
        "git",
        &["tag", "--annotate", &tag, "--message", &format!("walleterm {version}"), commit],
        root,
        &env,
    )?;
    run("git", &["push", "origin", &tag], root, &env)?;
    let notices = out.join("NOTICES.txt").to_string_lossy().to_string();
    let notes = format!(
        "Built from {commit} with Bun {bun} and {rustc}. Signed by Developer ID team {TEAM_ID} and notarized by Apple."
    );
    run(
        "gh",
        &[
            "release",
            "create",
            &tag,
            &archive_text,
            &checksums.to_string_lossy(),
            &notices,
            "--repo",
            REPOSITORY,
            "--title",
            &format!("walleterm {version}"),
            "--notes",
            &notes,
            "--generate-notes",
            "--verify-tag",
        ],
        root,
        &env,
    )?;
    let download = Scratch::new(&std::env::temp_dir(), "walleterm-download-")?;
    run(
        "gh",
        &[
            "release",
            "download",
            &tag,
            "--repo",
            REPOSITORY,
            "--pattern",
            &archive_name,
            "--dir",
            &download.0.to_string_lossy(),
        ],
        root,
        &env,
    )?;
    if sha256_hex(&std::fs::read(download.0.join(&archive_name)).map_err(|e| e.to_string())?) != sha256 {
        return Err("The uploaded archive does not match the local checksum.".into());
    }
    let branch = format!("cask-{version}");
    let cask_path: PathBuf = source.join("Casks/walleterm.rb");
    let cask = std::fs::read_to_string(&cask_path).map_err(|e| e.to_string())?;
    std::fs::write(&cask_path, update_cask(&cask, version, &sha256)).map_err(|e| e.to_string())?;
    run("git", &["switch", "--quiet", "--create", &branch], source, &env)?;
    let cask_text = cask_path.to_string_lossy().to_string();
    run(
        "git",
        &[
            "commit",
            "--quiet",
            "--message",
            &format!("Point the cask at walleterm {version}"),
            "--",
            &cask_text,
        ],
        source,
        &env,
    )?;
    run("git", &["push", "--quiet", "origin", &branch], source, &env)?;
    let body =
        format!("The release {tag} archive has SHA-256 `{sha256}`. Merge to publish it to Homebrew users.");
    let title = format!("Point the cask at walleterm {version}");
    let pr = run(
        "gh",
        &["pr", "create", "--repo", REPOSITORY, "--head", &branch, "--title", &title, "--body", &body],
        source,
        &env,
    )?;
    report.push_str(&format!("\nPublished {tag}. Merge {pr} to update the Homebrew cask."));
    report.push_str(&format!("\nInstall: brew tap {REPOSITORY} https://github.com/{REPOSITORY} && brew install --cask {REPOSITORY}/walleterm"));
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_versions_are_plain_semver() {
        assert!(valid_release_version("0.2.0"));
        for bad in ["0.2", "v0.2.0", "0.2.0-rc1", "0..1", "1.2.3.4", ""] {
            assert!(!valid_release_version(bad), "{bad}");
        }
    }

    #[test]
    fn the_cask_changes_only_its_version_and_checksum() {
        let cask =
            "cask \"walleterm\" do\n  version \"0.2.0\"\n  sha256 \"0000\"\n\n  binary \"walleterm\"\nend\n";
        assert_eq!(
            update_cask(cask, "0.3.0", "abcd"),
            "cask \"walleterm\" do\n  version \"0.3.0\"\n  sha256 \"abcd\"\n\n  binary \"walleterm\"\nend\n"
        );
    }

    #[test]
    fn ci_pins_are_read_from_the_workflow() {
        let workflow =
            std::fs::read_to_string(crate::repository().join(".github/workflows/test.yml")).unwrap();
        assert_eq!(pinned(&workflow, "bun-version").as_deref(), Some("1.4.2"));
    }
}
