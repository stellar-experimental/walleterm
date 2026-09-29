//! Third-party notices for everything that a release binary contains: linked Rust crates, the embedded
//! browser packages, and the vendored syntax highlighter license.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::{Result, environment, run};

fn license_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok().map(|e| e.path()))
                .filter(|p| {
                    let name =
                        p.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_ascii_lowercase();
                    p.is_file()
                        && ["license", "licence", "copying", "notice"].iter().any(|k| name.starts_with(k))
                })
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// One package: its heading and its license texts, or its license identifier when it ships no text.
type Section = (String, Vec<String>);

fn section(title: &str, license: &str, dir: &Path) -> Result<Section> {
    let texts: Vec<String> = license_files(dir)
        .iter()
        .filter_map(|f| std::fs::read_to_string(f).ok())
        .map(|t| t.trim().to_owned())
        .filter(|t| !t.is_empty())
        .collect();
    if texts.is_empty() && license.is_empty() {
        return Err(format!("{title} has no license text or license identifier."));
    }
    let texts = if texts.is_empty() { vec![format!("License: {license}")] } else { texts };
    Ok((format!("{title} ({license})"), texts))
}

/// The resolved Apple silicon workspace, including build, test, and test-host dependencies.
pub fn metadata(root: &Path) -> Result<Value> {
    let text = run(
        "cargo",
        &[
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--all-features",
            "--filter-platform",
            "aarch64-apple-darwin",
        ],
        root,
        &environment(&[]),
    )?;
    serde_json::from_str(&text).map_err(|e| format!("cargo metadata: {e}"))
}

/// Rust crates reachable through normal dependencies. Workspace features provide a conservative upper bound.
fn rust_sections(metadata: &Value) -> Result<Vec<(String, Section)>> {
    let packages: BTreeMap<&str, &Value> = metadata["packages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| Some((p["id"].as_str()?, p)))
        .collect();
    let nodes: BTreeMap<&str, &Value> = metadata["resolve"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|n| Some((n["id"].as_str()?, n)))
        .collect();
    let root_id = packages
        .iter()
        .find(|(_, p)| p["name"] == "walleterm")
        .map(|(id, _)| *id)
        .ok_or("cargo metadata has no walleterm package.")?;
    let mut seen = BTreeSet::new();
    let mut queue = vec![root_id];
    while let Some(id) = queue.pop() {
        for dep in nodes.get(id).and_then(|n| n["deps"].as_array()).into_iter().flatten() {
            let normal = dep["dep_kinds"].as_array().into_iter().flatten().any(|k| k["kind"].is_null());
            if let Some(pkg) = dep["pkg"].as_str().filter(|_| normal)
                && seen.insert(pkg)
            {
                queue.push(pkg);
            }
        }
    }
    seen.iter()
        .map(|id| {
            let p = packages[id];
            let title = format!(
                "{} {}",
                p["name"].as_str().unwrap_or_default(),
                p["version"].as_str().unwrap_or_default()
            );
            let dir =
                Path::new(p["manifest_path"].as_str().unwrap_or_default()).parent().unwrap_or(Path::new("."));
            section(&title, p["license"].as_str().unwrap_or_default(), dir).map(|s| (title, s))
        })
        .collect()
}

/// Browser packages that the embedded site bundles: `dependencies` and their dependencies, plus the syntax tokenizers.
fn browser_sections(root: &Path) -> Result<Vec<(String, Section)>> {
    let app: Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("package.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let mut names: Vec<String> =
        app["dependencies"].as_object().into_iter().flatten().map(|(k, _)| k.clone()).collect();
    names.extend(
        app["devDependencies"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, _)| k.clone())
            .filter(|k| k.starts_with("@twinkleplop/")),
    );
    let mut sections = BTreeMap::new();
    let mut queue: Vec<(String, PathBuf)> = names.into_iter().map(|n| (n, root.to_path_buf())).collect();
    while let Some((name, from)) = queue.pop() {
        let dir = [from.join("node_modules").join(&name), root.join("node_modules").join(&name)]
            .into_iter()
            .find(|d| d.join("package.json").exists())
            .ok_or_else(|| format!("The production package {name} is missing. Run bun install."))?;
        let manifest: Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join("package.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let title = format!(
            "{} {}",
            manifest["name"].as_str().unwrap_or(&name),
            manifest["version"].as_str().unwrap_or_default()
        );
        if sections.contains_key(&title) {
            continue;
        }
        sections
            .insert(title.clone(), section(&title, manifest["license"].as_str().unwrap_or_default(), &dir)?);
        for dependency in manifest["dependencies"].as_object().into_iter().flatten().map(|(k, _)| k.clone()) {
            queue.push((dependency, dir.clone()));
        }
    }
    Ok(sections.into_iter().collect())
}

pub fn notices(root: &Path, metadata: &Value) -> Result<String> {
    let syntax =
        std::fs::read_to_string(root.join("demo/site/vendor/syntax.LICENSE")).map_err(|e| e.to_string())?;
    let mut parts = vec![
        "walleterm includes the following third-party software.".to_owned(),
        format!("== demo syntax highlighter (demo/site/vendor) ==\n\n{}", syntax.trim()),
    ];
    let mut all: Vec<(String, Section)> = rust_sections(metadata)?;
    all.extend(browser_sections(root)?);
    all.sort();
    all.dedup_by(|a, b| a.0 == b.0);
    // Each distinct license text appears once, after the heading of every package that ships it.
    // Texts that differ only in whitespace count as the same text.
    let key = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut grouped: Vec<(Vec<String>, String, String)> = Vec::new();
    for (_, (heading, texts)) in all {
        for text in texts {
            let normal = key(&text);
            match grouped.iter_mut().find(|(_, k, _)| *k == normal) {
                Some((headings, _, _)) => headings.push(heading.clone()),
                None => grouped.push((vec![heading.clone()], normal, text)),
            }
        }
    }
    parts.extend(grouped.into_iter().map(|(headings, _, text)| {
        let headings: Vec<String> = headings.iter().map(|h| format!("== {h} ==")).collect();
        format!("{}\n\n{text}", headings.join("\n"))
    }));
    Ok(parts.join("\n\n") + "\n")
}
