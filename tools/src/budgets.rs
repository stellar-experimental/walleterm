//! Release limits from the Rust migration plan. Counts include both workspace packages.

use std::path::Path;

use serde_json::Value;

use crate::Result;

const MAX_BINARY_BYTES: u64 = 10_000_000;
const MAX_LOCK_PACKAGES: usize = 160;
const MAX_MACOS_PACKAGES: usize = 130;

/// Count every lockfile package, including optional dependencies and other platforms.
/// Cargo validates the lockfile before this check through `metadata --locked`.
pub fn dependencies(lock: &str, metadata: &Value) -> Result<()> {
    let locked = lock.lines().filter(|line| line.trim() == "[[package]]").count();
    let resolved =
        metadata["resolve"]["nodes"].as_array().ok_or("cargo metadata has no resolved package list.")?.len();
    if locked == 0 || resolved == 0 {
        return Err("The dependency package counts must not be empty.".into());
    }
    if locked > MAX_LOCK_PACKAGES {
        return Err(format!("Cargo.lock has {locked} packages; the limit is {MAX_LOCK_PACKAGES}."));
    }
    if resolved > MAX_MACOS_PACKAGES {
        return Err(format!(
            "The macOS workspace resolves {resolved} packages; the limit is {MAX_MACOS_PACKAGES}."
        ));
    }
    Ok(())
}

/// Check the complete executable before the package tool copies it into its output directory.
pub fn binary(path: &Path) -> Result<()> {
    let bytes = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?.len();
    if bytes > MAX_BINARY_BYTES {
        return Err(format!("The walleterm binary has {bytes} bytes; the limit is {MAX_BINARY_BYTES}."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn metadata(count: usize) -> Value {
        serde_json::json!({ "resolve": { "nodes": vec![Value::Null; count] } })
    }

    #[test]
    fn dependency_limits_include_the_boundary_and_refuse_larger_or_missing_graphs() {
        let lock = "[[package]]\n".repeat(160);
        assert!(dependencies(&lock, &metadata(130)).is_ok());
        assert!(dependencies(&(lock.clone() + "[[package]]\n"), &metadata(130)).is_err());
        assert!(dependencies(&lock, &metadata(131)).is_err());
        assert!(dependencies(&lock, &Value::Null).is_err());
        assert!(dependencies(&lock, &metadata(0)).is_err());
        assert!(dependencies("", &metadata(1)).is_err());
    }

    #[test]
    fn the_complete_binary_must_fit_before_packaging() {
        let scratch = crate::Scratch::new(&std::env::temp_dir(), "walleterm-budget-").unwrap();
        let path = scratch.0.join("walleterm");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_BINARY_BYTES).unwrap();
        assert!(binary(&path).is_ok());
        file.set_len(MAX_BINARY_BYTES + 1).unwrap();
        assert!(binary(&path).unwrap_err().contains("10000001"));
        assert!(binary(&scratch.0.join("missing")).is_err());
    }
}
