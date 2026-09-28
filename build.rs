//! Embed the demo website that `bun run build` (or the package tool) produced.
//! This script never runs Bun or reaches a network. Missing assets fail the build.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=WALLETERM_ASSETS");
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let dir = std::env::var_os("WALLETERM_ASSETS").map_or_else(|| root.join("dist"), PathBuf::from);
    let manifest = dir.join("routes.tsv");
    println!("cargo:rerun-if-changed={}", manifest.display());
    let text = std::fs::read_to_string(&manifest).unwrap_or_else(|_| {
        panic!("The demo assets are missing at {}. Run `bun run build` first.", manifest.display())
    });
    let mut out = String::new();
    let mut files: HashMap<&str, usize> = HashMap::new();
    let mut entries = String::new();
    for line in text.lines().filter(|l| !l.is_empty()) {
        let fields: Vec<&str> = line.split('\t').collect();
        let [route, mime, sha256, path] = fields[..] else {
            panic!("routes.tsv has a malformed line: {line}")
        };
        assert!(route.starts_with('/') && sha256.len() == 64, "routes.tsv has a malformed line: {line}");
        println!("cargo:rerun-if-changed={path}");
        let next = files.len();
        let index = *files.entry(path).or_insert_with(|| {
            writeln!(out, "static F{next}: &[u8] = include_bytes!({path:?});").unwrap();
            next
        });
        writeln!(
            entries,
            "    Asset {{ route: {route:?}, mime: {mime:?}, sha256: {sha256:?}, bytes: F{index} }},"
        )
        .unwrap();
    }
    assert!(!entries.is_empty(), "routes.tsv lists no demo files");
    writeln!(out, "pub static ASSETS: &[Asset] = &[\n{entries}];").unwrap();
    std::fs::write(PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("assets.rs"), out).unwrap();
}
