//! `package <directory> [version]`: one release binary and its notices.

use std::path::Path;

use crate::{Result, Scratch, environment, run};

/// A version string of letters, digits, `.`, `+`, or `-`.
pub fn valid_version(version: &str) -> bool {
    !version.is_empty() && version.bytes().all(|b| b.is_ascii_alphanumeric() || b".+-".contains(&b))
}

/// Build the binary from `root` into `out/walleterm` and write `out/NOTICES.txt`. Returns the version.
pub fn package(root: &Path, out: &Path, version: Option<&str>) -> Result<String> {
    let version = match version {
        Some(v) => v.to_owned(),
        None => run("git", &["describe", "--tags", "--always", "--dirty"], root, &environment(&[]))
            .map(|v| v.trim_start_matches('v').to_owned())
            .unwrap_or_else(|_| "dev".into()),
    };
    if !valid_version(&version) {
        return Err("Use a version with letters, digits, \".\", \"+\", or \"-\".".into());
    }
    let metadata = crate::notices::metadata(root)?;
    std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
    // Build browser files and the binary in a private directory. Concurrent builds cannot mix them.
    let work = Scratch::new(&std::env::temp_dir(), "walleterm-package-")?;
    let assets = work.0.join("assets");
    let target = work.0.join("target");
    let (assets_text, target_text) = (assets.to_string_lossy(), target.to_string_lossy());
    run("bun", &["--no-env-file", "scripts/build.ts", &assets_text, "--minify"], root, &environment(&[]))?;
    let env = environment(&[
        ("WALLETERM_ASSETS", &assets_text),
        ("WALLETERM_VERSION", &version),
        ("MACOSX_DEPLOYMENT_TARGET", "13.0"),
        ("CARGO_TARGET_DIR", &target_text),
    ]);
    // The package never enables test-host and never copies binaries by wildcard.
    run(
        "cargo",
        &["build", "--release", "--locked", "--no-default-features", "--bin", "walleterm"],
        root,
        &env,
    )?;
    let binary = target.join("release/walleterm");
    crate::budgets::binary(&binary)?;
    std::fs::copy(&binary, out.join("walleterm")).map_err(|e| format!("copy walleterm: {e}"))?;
    let notices = crate::notices::notices(root, &metadata)?;
    std::fs::write(out.join("NOTICES.txt"), notices).map_err(|e| format!("NOTICES.txt: {e}"))?;
    Ok(version)
}
