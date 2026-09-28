//! `install <prefix>`: build into a stage, keep complete releases by content hash, and switch links atomically.
//! A failed build leaves the installed command unchanged. Old releases stay for running processes and rollback.

use std::path::Path;

use crate::{Result, Scratch, sha256_hex};

fn replace_link(target: &Path, link: &Path) -> Result<()> {
    let temporary = link.with_file_name(format!(
        ".{}-{}",
        link.file_name().and_then(|n| n.to_str()).unwrap_or("link"),
        std::process::id()
    ));
    let _ = std::fs::remove_file(&temporary);
    std::os::unix::fs::symlink(target, &temporary).map_err(|e| format!("{}: {e}", temporary.display()))?;
    std::fs::rename(&temporary, link).map_err(|e| {
        let _ = std::fs::remove_file(&temporary);
        format!("{}: {e}", link.display())
    })
}

pub fn install(root: &Path, prefix: &Path) -> Result<String> {
    let prefix = std::path::absolute(prefix).map_err(|e| e.to_string())?;
    let versions = prefix.join("share/walleterm/releases");
    let stage = Scratch::new(&versions, ".install-")?;
    if crate::package::package(root, &stage.0.join("bin"), None).is_err() {
        return Err("The build failed. The installed version did not change.".into());
    }
    let mut hashed = Vec::new();
    for file in ["bin/walleterm", "bin/NOTICES.txt"] {
        hashed.extend(file.as_bytes());
        hashed.extend(std::fs::read(stage.0.join(file)).map_err(|e| format!("{file}: {e}"))?);
    }
    let release = versions.join(&sha256_hex(&hashed)[..24]);
    if !release.exists() {
        std::fs::rename(&stage.0, &release).map_err(|e| format!("{}: {e}", release.display()))?;
        stage.keep();
    }
    let bin = prefix.join("bin");
    std::fs::create_dir_all(&bin).map_err(|e| format!("{}: {e}", bin.display()))?;
    let alias = bin.join("stellar-walleterm");
    if alias.symlink_metadata().is_ok_and(|m| !m.file_type().is_symlink()) {
        return Err("stellar-walleterm already exists. Preserve it before installing the alias.".into());
    }
    replace_link(Path::new("walleterm"), &alias)?;
    replace_link(&release.join("bin/walleterm"), &bin.join("walleterm"))?;
    Ok(format!("Installed walleterm in {}.", bin.display()))
}
